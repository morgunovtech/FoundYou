import { useEffect, useRef, useState } from 'react';
import type { BasicFileInfo } from '../types/metadata';
import { detectSkew, rotateInPlace, unrotateRect, SKEW_WORTH_FIXING_DEGREES, type DrawableSource } from '../utils/ocrDeskew';

export interface OCRRegion {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface OCRResult {
  fullText: string;
  regions: OCRRegion[];
  /** Mean confidence (0–100) of the words that survived filtering; 0 when no text was kept. */
  meanConfidence?: number;
}

/**
 * Pipeline step ids; the component maps them to i18n keys
 * (`queued` → ocrStageQueued, `core` → ocrStageLoad, `lang` → ocrStageLang,
 *  `init` → ocrStageInit, `recognize` → ocrStageRecognize, `done` → ocrStageDone).
 */
export type OCRStage = 'queued' | 'core' | 'lang' | 'init' | 'recognize' | 'done';

export interface OCRProgress {
  stage: OCRStage;
  /** 0..1 */
  value: number;
}

/**
 * - `ocr-unavailable` — the Tesseract worker / core / traineddata could not be loaded (offline, 404).
 * - `ocr-failed`      — the engine is up but recognising this image failed.
 */
export type OCRErrorCode = 'ocr-unavailable' | 'ocr-failed';

export interface UseOCROptions {
  /** When false the hook stays in `queued` and does not start (used to run OCR after detection). Default true. */
  enabled?: boolean;
}

type TesseractWorker = import('tesseract.js').Worker;
type LoggerMessage = import('tesseract.js').LoggerMessage;
export type RecognizedPage = import('tesseract.js').RecognizeResult['data'];

/* ── self-hosted runtime (see scripts/prepare-assets.mjs) ─── */

const OCR_LANGS = 'rus+eng';
/** Tesseract.OEM.LSTM_ONLY — passed as the numeric value (as tesseract.js docs do) so we do not depend on the CJS→ESM interop exposing the `OEM` named export in production bundles. */
const OEM_LSTM_ONLY = 1;

const OCR_ASSET_PATHS = {
  workerPath: '/ocr/worker.min.js',
  /** Directory: the worker appends tesseract-core[-relaxedsimd|-simd]-lstm.wasm.js by SIMD support. */
  corePath: '/ocr/',
  /** Directory: the worker fetches `${langPath}/${lang}.traineddata.gz`. */
  langPath: '/ocr/lang'
} as const;

/** Worker creation is retried at most this many times per page load; each failed attempt leaks a half-spawned Worker inside tesseract.js. */
const MAX_WORKER_CREATE_FAILURES = 3;

class OCRAssetError extends Error {
  readonly code: OCRErrorCode = 'ocr-unavailable';
}

class OCRRecognizeError extends Error {
  readonly code: OCRErrorCode = 'ocr-failed';
}

function toErrorCode(err: unknown): OCRErrorCode {
  return err instanceof OCRAssetError ? err.code : 'ocr-failed';
}

/* ── singleton worker + serialised queue ───────────────────── */

type ProgressSink = (message: LoggerMessage) => void;

let workerPromise: Promise<TesseractWorker> | null = null;
let workerReady = false;
let workerCreateFailures = 0;
/** The newest consumer's sink; worker load progress is only interesting to the latest file. */
let activeSink: ProgressSink | null = null;
let queue: Promise<unknown> = Promise.resolve();
let lifecycleBound = false;

const noop = () => undefined;

function bindLifecycle() {
  if (lifecycleBound || typeof window === 'undefined') return;
  lifecycleBound = true;
  const dispose = () => {
    void disposeWorker();
  };
  window.addEventListener('pagehide', dispose);
  window.addEventListener('beforeunload', dispose);
}

/** Drops the singleton (next file recreates it) and terminates the worker in the background. */
async function disposeWorker() {
  const pending = workerPromise;
  workerPromise = null;
  workerReady = false;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // creation already failed — nothing to terminate
  }
}

function getWorker(): Promise<TesseractWorker> {
  if (workerPromise) return workerPromise;
  if (workerCreateFailures >= MAX_WORKER_CREATE_FAILURES) {
    return Promise.reject(new OCRAssetError('ocr worker creation failed repeatedly'));
  }
  bindLifecycle();

  const created = (async () => {
    const Tesseract = await import('tesseract.js');

    // tesseract.js only rejects createWorker() when the `load` step fails or the Worker
    // itself errors; a failed language fetch / init only reaches `errorHandler` and the
    // returned promise would otherwise hang forever — so race it against errorHandler.
    let rejectAsset: (err: Error) => void = noop;
    const assetFailure = new Promise<never>((_, reject) => {
      rejectAsset = reject;
    });

    const creation = Tesseract.createWorker(OCR_LANGS, OEM_LSTM_ONLY, {
      ...OCR_ASSET_PATHS,
      workerBlobURL: false,
      cacheMethod: 'write',
      logger: (message) => activeSink?.(message),
      errorHandler: (err: unknown) => rejectAsset(new OCRAssetError(String(err)))
    });

    const worker = await Promise.race([creation, assetFailure]);
    workerReady = true;
    workerCreateFailures = 0;
    return worker;
  })().catch((err: unknown) => {
    workerPromise = null;
    workerReady = false;
    workerCreateFailures += 1;
    throw err instanceof OCRAssetError
      ? err
      : new OCRAssetError(err instanceof Error ? err.message : String(err));
  });

  workerPromise = created;
  return created;
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.then(noop, noop);
  return run;
}

/**
 * Runs recognition on the shared worker, one job at a time. Resolves `null` when the
 * job was cancelled before it started (a job already running cannot be aborted
 * without terminating the worker, so its result is simply dropped by the caller).
 */
function recognizeImage(
  image: Blob,
  sink: ProgressSink,
  isCancelled: () => boolean
): Promise<RecognizedPage | null> {
  activeSink = sink;
  return enqueue(async () => {
    if (isCancelled()) return null;
    const worker = await getWorker();
    if (isCancelled()) return null;
    try {
      const { data } = await worker.recognize(image, undefined, { text: true, blocks: true });
      return data;
    } catch (err) {
      // The worker may be left in a bad state — drop it so the next file starts fresh.
      void disposeWorker();
      throw new OCRRecognizeError(err instanceof Error ? err.message : String(err));
    }
  });
}

/* ── progress mapping ──────────────────────────────────────── */

const STATUS_RANGES: Record<string, { stage: OCRStage; from: number; to: number }> = {
  'loading tesseract core': { stage: 'core', from: 0.05, to: 0.2 },
  'initializing tesseract': { stage: 'core', from: 0.2, to: 0.25 },
  'loading language traineddata': { stage: 'lang', from: 0.25, to: 0.45 },
  'initializing api': { stage: 'init', from: 0.45, to: 0.5 },
  'recognizing text': { stage: 'recognize', from: 0.5, to: 0.98 }
};

function mapLoggerMessage(message: LoggerMessage): OCRProgress | null {
  const range = STATUS_RANGES[message.status];
  if (!range) return null;
  const p = Math.min(1, Math.max(0, Number(message.progress) || 0));
  return { stage: range.stage, value: range.from + (range.to - range.from) * p };
}

/* ── image preprocessing ───────────────────────────────────── */

const PREPROCESS_MAX_DIMENSION = 2000;
/** Below this many pixels the grayscale/contrast pass is skipped — Tesseract binarises internally anyway. */
const PREPROCESS_ENHANCE_MIN_PIXELS = 1_000_000;
const PREPROCESS_FILTER = 'grayscale(1) contrast(1.4)';

interface PreprocessedImage {
  blob: Blob;
  /** Dimensions of `blob` — regions are scaled back to fileInfo.width/height with these. */
  width: number;
  height: number;
  /**
   * The same pixels as a canvas, when one was used: the deskew pass rotates this rather than
   * decoding again. Either kind — Chromium prefers `OffscreenCanvas` here, and excluding it once
   * meant the straightened pass never ran at all.
   */
  canvas?: DrawableSource;
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new OCRRecognizeError('preprocess-image-load'));
    };
    img.src = url;
  });
}

function enhancePixels(ctx: Canvas2D, width: number, height: number) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const contrasted = Math.min(255, Math.max(0, (gray - 128) * 1.4 + 128));
    d[i] = contrasted;
    d[i + 1] = contrasted;
    d[i + 2] = contrasted;
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Draws the image (EXIF orientation baked in by the browser decoder) onto a canvas
 * capped at PREPROCESS_MAX_DIMENSION and, for large images, applies grayscale +
 * contrast — via the GPU `ctx.filter` when supported, else a pixel loop. Uses an
 * OffscreenCanvas when available. Falls back to the original file on any failure.
 */
async function preprocessImage(file: File, fallbackWidth: number, fallbackHeight: number): Promise<PreprocessedImage> {
  const img = await loadImageElement(file);
  const srcWidth = img.naturalWidth || fallbackWidth;
  const srcHeight = img.naturalHeight || fallbackHeight;
  const longest = Math.max(srcWidth, srcHeight) || 1;
  const scale = Math.min(1, PREPROCESS_MAX_DIMENSION / longest);
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));
  const enhance = width * height > PREPROCESS_ENHANCE_MIN_PIXELS;

  try {
    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas = useOffscreen ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    if (!useOffscreen) {
      (canvas as HTMLCanvasElement).width = width;
      (canvas as HTMLCanvasElement).height = height;
    }
    const ctx = canvas.getContext('2d') as Canvas2D | null;
    if (!ctx) {
      return { blob: file, width: srcWidth, height: srcHeight };
    }

    const hasFilter = enhance && 'filter' in ctx && typeof ctx.filter === 'string';
    if (hasFilter) ctx.filter = PREPROCESS_FILTER;
    ctx.drawImage(img, 0, 0, width, height);
    if (hasFilter) ctx.filter = 'none';
    else if (enhance) enhancePixels(ctx, width, height);

    const blob =
      canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: 'image/png' })
        : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      return { blob: file, width: srcWidth, height: srcHeight };
    }
    return { blob, width, height, canvas };
  } catch (err) {
    console.warn('ocr-preprocess', err);
    return { blob: file, width: srcWidth, height: srcHeight };
  }
}

/* ── word/line filtering ─────────────────────────────────── */
/*
 * Tesseract happily "reads" foliage, water and textures as text (`MII NN`, `3 p`,
 * `AONE 2 BGR`, `7 wll`, `HAN atte`…). Every function below is pure and exported so
 * the thresholds can be pinned by tests (src/__tests__/hooks/ocrFilters.test.ts).
 *
 * Filtering runs at four levels, each of which can only drop, never add:
 *   word   — confidence by length + lexical plausibility (`isGoodWord`)
 *   box    — specks and whole-image boxes are not text (`isSaneBox`)
 *   line   — low-confidence lines and lines made only of fragments (`extractRegions`)
 *   result — a photo with fewer than two surviving words has no text (`buildResult`)
 */

export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WordInfo {
  text: string;
  confidence: number;
  bbox: Bbox;
}

/** Structural subset of tesseract.js' `Page` that the filters read; the real `Page` satisfies it. */
export interface RecognizedLineLike {
  confidence: number;
  words?: WordInfo[] | null;
}

export interface RecognizedPageLike {
  blocks?: { paragraphs?: { lines?: RecognizedLineLike[] | null }[] | null }[] | null;
  /** Raw page text — deliberately never used as a fallback (it is unfiltered). */
  text?: string | null;
  /** Legacy flat word list (tesseract.js ≤ 5); absent in v7 output. */
  words?: WordInfo[] | null;
}

/** Size of the bitmap that was handed to Tesseract; word bboxes are in its pixel space. */
export interface OCRCanvasSize {
  width: number;
  height: number;
}

/** Minimum word confidence by token length (code points): ≤ 2 / 3–4 / ≥ 5. */
export const WORD_MIN_CONFIDENCE = { short: 82, medium: 68, long: 58 } as const;
/** Lines below this confidence are dropped wholesale, regardless of their words. */
export const LINE_MIN_CONFIDENCE = 45;
/** A surviving line must keep at least one word with this many letters/digits. */
export const LINE_MIN_WORD_ALNUM = 3;
/** Fewer surviving words than this in the whole page → the photo has no text. */
export const RESULT_MIN_GOOD_WORDS = 2;
/** At least this share of a token's characters must be letters or digits. */
export const TOKEN_MIN_ALNUM_RATIO = 0.6;
/** Word boxes smaller than this share of the OCR canvas area are specks. */
export const BOX_MIN_AREA_RATIO = 0.0002;
/** Word boxes shorter than this (OCR-canvas pixels) are specks. */
export const BOX_MIN_HEIGHT_PX = 6;
/** Word boxes wider than this share of the canvas are whole-image false hits. */
export const BOX_MAX_WIDTH_RATIO = 0.9;

const ALNUM_RE = /[\p{L}\p{N}]/gu;
const LATIN_RE = /\p{Script=Latin}/u;
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
/** Three identical letters in a row (case-insensitive). Digits are exempt: `1000`, `777 77 77`. */
const TRIPLE_LETTER_RE = /(\p{L})\1\1/iu;
/** `www.` is the one legitimate triple letter on signs. */
const WWW_RE = /^www\./iu;
/** Uzbek Latin oʻ/gʻ in all the apostrophe spellings Tesseract emits; they count as the base letter. */
const UZBEK_APOSTROPHE_RE = /['ʻʼ‘’`]/gu;
const VOWEL_RE = /[aeiouyаеёиоуыэюя]/u;

function alnumCount(text: string): number {
  return (text.match(ALNUM_RE) ?? []).length;
}

/**
 * Lexical sanity of one token, independent of confidence. Real text — signs, plates
 * (`01 A 123 BC`), phones (`+998`), prices, `ул.`, `Coca-Cola`, `to‘g‘ri` — passes;
 * the classic texture noise (`Hаn`, `wlll`, `p.`, `---`) does not.
 */
export function isPlausibleToken(text: string): boolean {
  const token = text.trim();
  if (token.length === 0) return false;

  const chars = [...token];
  const alnum = alnumCount(token);
  if (alnum === 0) return false;
  // Mostly punctuation/symbols (`(a`, `%^&a`, `a-b-c-d`)
  if (alnum / chars.length < TOKEN_MIN_ALNUM_RATIO) return false;
  // A lone letter/digit wrapped in punctuation (`p.`, `3)`, `(a`) — but a bare `A` or `3` may be a plate or a house number
  if (alnum === 1 && chars.length > 1) return false;
  // Latin and Cyrillic glyphs inside one word (`Hаn`) — Tesseract picks one model per real word
  if (LATIN_RE.test(token) && CYRILLIC_RE.test(token)) return false;
  // `wlll`, `Ннн` — no language written here triples a letter, except `www.`
  if (TRIPLE_LETTER_RE.test(token) && !WWW_RE.test(token)) return false;

  // Letter-only tokens of ≥ 4 letters need a vowel, unless they are an all-caps abbreviation (`HTML`, `ГИБДД`).
  const letters = token.replace(UZBEK_APOSTROPHE_RE, '');
  const lettersOnly = /^\p{L}+$/u.test(letters);
  if (lettersOnly && [...letters].length >= 4) {
    const allUpper = letters === letters.toUpperCase() && letters !== letters.toLowerCase();
    if (!allUpper && !VOWEL_RE.test(letters.toLowerCase())) return false;
  }

  return true;
}

/**
 * Confidence gate by token length, on top of `isPlausibleToken`. Short tokens are
 * the easiest to hallucinate, so they need both high confidence and a shape that
 * real short text has: all digits (`01`, `12`) or all capitals (`BC`, `A`).
 */
export function isGoodWord(word: WordInfo): boolean {
  const token = (word.text ?? '').trim();
  if (!isPlausibleToken(token)) return false;

  const length = [...token].length;
  if (length <= 2) {
    if (word.confidence < WORD_MIN_CONFIDENCE.short) return false;
    return /^\p{N}+$/u.test(token) || /^\p{Lu}+$/u.test(token);
  }
  if (length <= 4) return word.confidence >= WORD_MIN_CONFIDENCE.medium;
  return word.confidence >= WORD_MIN_CONFIDENCE.long;
}

/**
 * Geometry gate: specks (tiny area, < 6 px tall) and boxes spanning almost the whole
 * width are not words. Area/width checks need the canvas size; without it only the
 * absolute height check applies.
 */
export function isSaneBox(bbox: Bbox | null | undefined, canvas?: OCRCanvasSize): boolean {
  if (!bbox) return false;
  const width = bbox.x1 - bbox.x0;
  const height = bbox.y1 - bbox.y0;
  if (!(width > 0) || !(height > 0)) return false;
  if (height < BOX_MIN_HEIGHT_PX) return false;
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    if (width * height < canvas.width * canvas.height * BOX_MIN_AREA_RATIO) return false;
    if (width > canvas.width * BOX_MAX_WIDTH_RATIO) return false;
  }
  return true;
}

interface KeptWord {
  text: string;
  confidence: number;
  region: OCRRegion | null;
}

function toRegion(word: WordInfo, scaleX: number, scaleY: number): OCRRegion {
  return {
    text: word.text.trim(),
    x: word.bbox.x0 * scaleX,
    y: word.bbox.y0 * scaleY,
    width: (word.bbox.x1 - word.bbox.x0) * scaleX,
    height: (word.bbox.y1 - word.bbox.y0) * scaleY,
    confidence: word.confidence
  };
}

/** Word + box gates for one line's words. A word without a bbox (legacy `words` list) is kept as text only. */
function keepWords(words: WordInfo[], scaleX: number, scaleY: number, canvas?: OCRCanvasSize): KeptWord[] {
  const kept: KeptWord[] = [];
  for (const word of words) {
    if (!isGoodWord(word)) continue;
    if (word.bbox && !isSaneBox(word.bbox, canvas)) continue;
    kept.push({
      text: word.text.trim(),
      confidence: word.confidence,
      region: word.bbox ? toRegion(word, scaleX, scaleY) : null
    });
  }
  return kept;
}

/**
 * Line gate: a line survives only if it keeps a word with ≥ 3 letters/digits — which
 * also rules out lines made solely of ≤ 2-character fragments (`3 p`, `7 w`).
 */
function hasAnchorWord(kept: KeptWord[]): boolean {
  return kept.some((word) => alnumCount(word.text) >= LINE_MIN_WORD_ALNUM);
}

export interface ExtractedRegions {
  regions: OCRRegion[];
  cleanLines: string[];
  /** Confidence of every kept word, in reading order — feeds `meanConfidence`. */
  confidences: number[];
}

export function extractRegions(
  data: RecognizedPageLike,
  scaleX: number,
  scaleY: number,
  canvas?: OCRCanvasSize
): ExtractedRegions {
  const regions: OCRRegion[] = [];
  const cleanLines: string[] = [];
  const confidences: number[] = [];

  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        if (!(line.confidence >= LINE_MIN_CONFIDENCE)) continue;

        const kept = keepWords(line.words ?? [], scaleX, scaleY, canvas);
        if (kept.length === 0 || !hasAnchorWord(kept)) continue;

        cleanLines.push(kept.map((word) => word.text).join(' '));
        for (const word of kept) {
          confidences.push(word.confidence);
          if (word.region) regions.push(word.region);
        }
      }
    }
  }

  return { regions, cleanLines, confidences };
}

/** Legacy flat `data.words` (no line structure): the whole list is treated as one line and passes the same gates. */
function extractFromWords(
  words: WordInfo[],
  scaleX: number,
  scaleY: number,
  canvas?: OCRCanvasSize
): ExtractedRegions {
  const kept = keepWords(words, scaleX, scaleY, canvas);
  if (kept.length === 0 || !hasAnchorWord(kept)) return { regions: [], cleanLines: [], confidences: [] };
  return {
    regions: kept.flatMap((word) => (word.region ? [word.region] : [])),
    cleanLines: [kept.map((word) => word.text).join(' ')],
    confidences: kept.map((word) => word.confidence)
  };
}

/**
 * Turns a recognised page into the hook result. `scaleX/scaleY` map OCR-canvas pixels
 * back to the original image; `canvas` (the OCR bitmap size) enables the relative box
 * checks. The raw `data.text` is never used — it is exactly the unfiltered garbage
 * this pipeline exists to remove.
 */
export function buildResult(
  data: RecognizedPageLike,
  scaleX: number,
  scaleY: number,
  canvas?: OCRCanvasSize
): OCRResult {
  let extracted = extractRegions(data, scaleX, scaleY, canvas);

  if (extracted.cleanLines.length === 0 && data.words && data.words.length > 0) {
    extracted = extractFromWords(data.words, scaleX, scaleY, canvas);
  }

  const { regions, cleanLines, confidences } = extracted;
  if (confidences.length < RESULT_MIN_GOOD_WORDS) return { fullText: '', regions: [], meanConfidence: 0 };

  const meanConfidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  return { fullText: cleanLines.join('\n'), regions, meanConfidence };
}

/* ── main hook ───────────────────────────────────────────── */

interface OCRSession {
  cancelled: boolean;
  started: boolean;
}

interface OCRStateSetters {
  setProgress: (p: OCRProgress | null) => void;
  setResult: (r: OCRResult | null) => void;
  setError: (e: OCRErrorCode | null) => void;
  setLoading: (l: boolean) => void;
}

async function runOCR(fileInfo: BasicFileInfo, session: OCRSession, set: OCRStateSetters) {
  let lastValue = 0;
  const report = (p: OCRProgress) => {
    if (session.cancelled) return;
    lastValue = Math.max(lastValue, p.value); // never move backwards (rus + eng each report 0→1)
    set.setProgress({ stage: p.stage, value: lastValue });
  };

  try {
    report(workerReady ? { stage: 'recognize', value: 0.5 } : { stage: 'core', value: 0.02 });

    const pre = await preprocessImage(fileInfo.file, fileInfo.width, fileInfo.height);
    if (session.cancelled) return;

    const sink: ProgressSink = (message) => {
      const mapped = mapLoggerMessage(message);
      if (mapped) report(mapped);
    };
    const data = await recognizeImage(pre.blob, sink, () => session.cancelled);
    if (session.cancelled || !data) return;

    // Regions map back to fileInfo.width/height coordinates (the preprocess canvas may be smaller);
    // the canvas size itself drives the relative speck / whole-image box checks.
    const scaleX = fileInfo.width / pre.width;
    const scaleY = fileInfo.height / pre.height;
    const canvasSize = { width: pre.width, height: pre.height };
    let result = buildResult(data, scaleX, scaleY, canvasSize);

    /*
     * Nothing survived, and the picture may simply be crooked. Tesseract reads level lines: the
     * same label at 20° gives confidence 26 and no words where upright gives 92 and all of them.
     * A second pass on a straightened copy is worth roughly 2.2 s here (7–10 s on a phone), so it
     * is spent only when the first pass came back empty — a screenshot or a document, which is
     * where the time would be noticed, never reaches this branch.
     */
    if (result.regions.length === 0 && pre.canvas) {
      /*
       * Wrapped on its own: this pass is an extra chance, never a risk to the answer already in
       * hand. A throw from the rotation, the re-encode or the second recognition would otherwise
       * escape to the outer handler and replace a truthful «текст не обнаружен» with an error.
       */
      try {
      const measuring = performance.now();
      const skew = detectSkew(pre.canvas);
      if (session.cancelled) return;
      if (Math.abs(skew.angle) >= SKEW_WORTH_FIXING_DEGREES) {
        if (import.meta.env.DEV) {
          console.info('[ocr] nothing found upright; trying a straightened pass', {
            angle: skew.angle,
            measuredInMs: Math.round(performance.now() - measuring)
          });
        }
        report({ stage: 'recognize', value: 0.55 });
        const straightened = rotateInPlace(pre.canvas, skew.angle);
        const rotatedBlob = await new Promise<Blob | null>((resolve) => straightened.toBlob(resolve, 'image/png'));
        if (session.cancelled) return;
        if (rotatedBlob) {
          const second = await recognizeImage(rotatedBlob, sink, () => session.cancelled);
          if (session.cancelled) return;
          if (second) {
            // Built in the rotated frame first, then every box is carried back so the blur in
            // section 03 lands on the words as they actually sit in the photo.
            const rotatedResult = buildResult(second, scaleX, scaleY, canvasSize);
            if (rotatedResult.regions.length > 0) {
              const original = { width: fileInfo.width, height: fileInfo.height };
              result = {
                ...rotatedResult,
                regions: rotatedResult.regions.map((region) => ({
                  ...region,
                  ...unrotateRect(region, skew.angle, original)
                }))
              };
              if (import.meta.env.DEV) {
                console.info('[ocr] straightened pass found text', { words: result.regions.length });
              }
            }
          }
        }
      }
      } catch (err) {
        console.warn('ocr-deskew-pass', err);
      }
    }

    set.setResult(result);
    report({ stage: 'done', value: 1 });
  } catch (err) {
    if (session.cancelled) return;
    console.error('ocr', err);
    set.setError(toErrorCode(err));
  } finally {
    if (!session.cancelled) set.setLoading(false);
  }
}

export function useOCR(fileInfo: BasicFileInfo | null, options?: UseOCROptions) {
  const enabled = options?.enabled ?? true;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<OCRErrorCode | null>(null);
  const [result, setResult] = useState<OCRResult | null>(null);
  const [progress, setProgress] = useState<OCRProgress | null>(null);
  const sessionRef = useRef<OCRSession | null>(null);

  // One session per file: reset state, mark the previous session cancelled.
  useEffect(() => {
    if (!fileInfo) {
      sessionRef.current = null;
      setLoading(false);
      setError(null);
      setResult(null);
      setProgress(null);
      return;
    }
    const session: OCRSession = { cancelled: false, started: false };
    sessionRef.current = session;
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress({ stage: 'queued', value: 0 });
    return () => {
      session.cancelled = true;
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [fileInfo]);

  // Start at most once per file, the first time `enabled` is true. Flipping `enabled`
  // back to false does not cancel a run — only a new file (or null) does.
  useEffect(() => {
    const session = sessionRef.current;
    if (!fileInfo || !enabled || !session || session.started || session.cancelled) return;
    session.started = true;
    void runOCR(fileInfo, session, { setProgress, setResult, setError, setLoading });
  }, [fileInfo, enabled]);

  return { loading, error, result, progress };
}
