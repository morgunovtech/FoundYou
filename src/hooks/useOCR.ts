import { useEffect, useRef, useState } from 'react';
import type { BasicFileInfo } from '../types/metadata';

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
type RecognizedPage = import('tesseract.js').RecognizeResult['data'];

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
    return { blob, width, height };
  } catch (err) {
    console.warn('ocr-preprocess', err);
    return { blob: file, width: srcWidth, height: srcHeight };
  }
}

/* ── word/line filtering ─────────────────────────────────── */

interface WordInfo {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

function isGoodWord(word: WordInfo): boolean {
  const w = word.text.trim();
  if (w.length === 0) return false;

  // Pure punctuation/symbols — always skip
  const alphaCount = (w.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (alphaCount === 0) return false;

  // Length-proportional confidence: short words need higher confidence
  if (w.length <= 2) return word.confidence >= 50;
  if (w.length <= 4) return word.confidence >= 35;
  return word.confidence >= 25;
}

function extractRegions(
  data: any,
  scaleX: number,
  scaleY: number
): { regions: OCRRegion[]; cleanLines: string[] } {
  const regions: OCRRegion[] = [];
  const cleanLines: string[] = [];

  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        if (line.confidence < 20) continue;

        const goodWords: string[] = [];
        for (const word of line.words ?? []) {
          const w = word.text.trim();
          if (!isGoodWord(word)) continue;
          goodWords.push(w);

          const bbox = word.bbox;
          regions.push({
            text: w,
            x: bbox.x0 * scaleX,
            y: bbox.y0 * scaleY,
            width: (bbox.x1 - bbox.x0) * scaleX,
            height: (bbox.y1 - bbox.y0) * scaleY,
            confidence: word.confidence,
          });
        }

        const lineText = goodWords.join(' ');
        const lineAlpha = (lineText.match(/[\p{L}\p{N}]/gu) ?? []).length;
        if (lineAlpha < 2) continue;
        cleanLines.push(lineText);
      }
    }
  }

  return { regions, cleanLines };
}

/* ── fallback: extract from data.words when blocks are empty ── */

function extractFromWords(
  data: any,
  scaleX: number,
  scaleY: number
): { regions: OCRRegion[]; text: string } {
  const regions: OCRRegion[] = [];
  const words: string[] = [];

  for (const word of data.words ?? []) {
    if (!isGoodWord(word)) continue;
    const w = word.text.trim();
    words.push(w);

    if (word.bbox) {
      regions.push({
        text: w,
        x: word.bbox.x0 * scaleX,
        y: word.bbox.y0 * scaleY,
        width: (word.bbox.x1 - word.bbox.x0) * scaleX,
        height: (word.bbox.y1 - word.bbox.y0) * scaleY,
        confidence: word.confidence,
      });
    }
  }

  return { regions, text: words.join(' ') };
}

function buildResult(data: RecognizedPage, scaleX: number, scaleY: number): OCRResult {
  // Primary: extract from blocks hierarchy
  let { regions, cleanLines } = extractRegions(data, scaleX, scaleY);

  // Fallback 1: try data.words directly if blocks yielded nothing
  const dataAny = data as any;
  if (cleanLines.length === 0 && (dataAny.words ?? []).length > 0) {
    const fallback = extractFromWords(dataAny, scaleX, scaleY);
    regions = fallback.regions;
    cleanLines = fallback.text ? [fallback.text] : [];
  }

  // Fallback 2: use raw data.text if everything else is empty
  const fullText = cleanLines.length > 0 ? cleanLines.join('\n') : (data.text ?? '').trim();

  return { fullText, regions };
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

    // Regions map back to fileInfo.width/height coordinates (the preprocess canvas may be smaller)
    const scaleX = fileInfo.width / pre.width;
    const scaleY = fileInfo.height / pre.height;
    set.setResult(buildResult(data, scaleX, scaleY));
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
