import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import exifr from 'exifr';
import { stripContainerMetadata } from './utils/containerMetadata';
import { hammingDistance, phashFromBlob } from './utils/phash';
import { InfoBlock } from './components/InfoBlock';
import { SiteHeader } from './components/SiteHeader';
import { SiteFooter } from './components/SiteFooter';
import { UploadZone } from './components/UploadZone';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useImageFile } from './hooks/useImageFile';
import { useExifMetadata } from './hooks/useExifMetadata';
import { StoryBlock } from './components/StoryBlock';
import { ResultsBar } from './components/ResultsBar';
import { SceneBlock } from './components/SceneBlock';
import { CleanupDownloadBlock } from './components/CleanupDownloadBlock';
import { useImageAnalysis } from './hooks/useImageAnalysis';
import { useOCR } from './hooks/useOCR';
import { useContentCredentials } from './hooks/useContentCredentials';
import { findPlateCandidates } from './utils/plates';
import { canShareFiles, shareFile } from './utils/share';
import { useI18n, useT, type MessageKey } from './i18n';
import { FACE_LABEL, PERSON_LABEL, type DetectionErrorCode, type DetectionStage } from './types/detection';
import type { OCRErrorCode, OCRStage } from './hooks/useOCR';
import type {
  AntiSearchParams,
  CleanupPreviewDimensions,
  ManualMask,
  OutputFormat,
  QualityMode,
  VerifyResult
} from './types/cleanup';
import type { BasicFileInfo, StructuredMetadata } from './types/metadata';
import { generateSceneNarrative } from './utils/sceneNarrative';
import { analyzeFilename } from './utils/heuristics/filenameAnalyzer';
import { analyzeResolution } from './utils/heuristics/resolutionAnalyzer';
import { detectStrippedMetadata } from './utils/heuristics/strippedDetector';
import { analyzeEditingHistory } from './utils/heuristics/editingHistory';
import { generateFileHash } from './utils/heuristics/hashAnalyzer';
import { analyzeDateTime } from './utils/heuristics/temporalAnalyzer';
import { generateDigitalProfile, type DigitalProfile } from './utils/heuristics/digitalProfile';
import type { FilenameAnalysis } from './utils/heuristics/filenameAnalyzer';
import type { ResolutionAnalysis } from './utils/heuristics/resolutionAnalyzer';
import type { StrippedAnalysis } from './utils/heuristics/strippedDetector';
import type { EditingAnalysis } from './utils/heuristics/editingHistory';
import type { HashResult } from './utils/heuristics/hashAnalyzer';
import type { TemporalInsight } from './utils/heuristics/temporalAnalyzer';

export interface ProData {
  filename: FilenameAnalysis;
  resolution: ResolutionAnalysis;
  stripped: StrippedAnalysis;
  editing: EditingAnalysis;
  hash: HashResult | null;
  temporal: TemporalInsight[];
}
import {
  applyAntiSearch,
  applyColorReduction,
  applyMirror,
  applyPrnuCleanup,
  applyWatermark,
  blurDetections,
  selectBlurTargets,
  blurManualMasks,
  blurOcrRegions,
  blurPlates as blurPlateRegions,
  generateAntiSearchParams
} from './utils/cleanup';

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.src = src;
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('image-load'));
    };
  });
}

const blurDefault = 28;
const PREVIEW_MAX_DIMENSION = 2400;

/** Pipeline stage ids from the analysis hooks → progress labels shown by PreviewViewer / OCRBlock. */
const DETECTION_STAGE_KEYS: Record<DetectionStage, MessageKey> = {
  prep: 'detectionStagePrep',
  model: 'detectionStageModel',
  decode: 'detectionStageDecode',
  detect: 'detectionStageDetect',
  process: 'detectionStageProcess',
  done: 'detectionStageDone'
};

const OCR_STAGE_KEYS: Record<OCRStage, MessageKey> = {
  queued: 'ocrStageQueued',
  core: 'ocrStageLoad',
  lang: 'ocrStageLang',
  init: 'ocrStageInit',
  recognize: 'ocrStageRecognize',
  done: 'ocrStageDone'
};

/** Error codes from the hooks → user-facing messages (the hooks stay free of i18n). */
const OCR_ERROR_KEYS: Record<OCRErrorCode, MessageKey> = {
  'ocr-unavailable': 'ocrUnavailable',
  'ocr-failed': 'ocrError'
};

const DETECTION_ERROR_KEYS: Record<DetectionErrorCode, MessageKey> = {
  'detection-unavailable': 'detectionUnavailable',
  'detection-failed': 'detectionFailed',
  'content-unavailable': 'contentUnavailable'
};

/** Formats `canvas.toBlob` can actually produce; anything else falls back to JPEG. */
const ENCODABLE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * iOS/iPadOS Safari refuses (or silently blanks) canvas backing stores above
 * ~16 Mpx; iPadOS 13+ ships a desktop UA, hence the touch-point check.
 */
function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

const MAX_EXPORT_PIXELS = isAppleMobile() ? 16_000_000 : 40_000_000;
const MAX_EXPORT_MEGAPIXELS = Math.round(MAX_EXPORT_PIXELS / 1_000_000);

function qualityForMode(mode: QualityMode): number {
  switch (mode) {
    case 'low':
      return 0.82;
    case 'medium':
      return 0.9;
    case 'original':
    default:
      return 0.98;
  }
}

function createAnonymisedName(extension: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `photo-${random}.${extension}`;
}

/** Requested mime (what the UI shows) vs. the one we can hand to `toBlob`. */
function resolveExportMime(outputFormat: OutputFormat, originalMime: string): { requested: string; mime: string } {
  const requested = outputFormat === 'original' ? originalMime : `image/${outputFormat}`;
  const mime = ENCODABLE_MIMES.has(requested) ? requested : 'image/jpeg';
  return { requested, mime };
}

function extensionForMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

function mimeLabel(mime: string): string {
  const sub = mime.replace(/^image\//, '');
  if (sub === 'jpeg' || sub === 'jpg') return 'JPEG';
  if (sub === 'webp') return 'WebP';
  return sub.toUpperCase();
}

function countMetadataFields(metadata: StructuredMetadata | null): number {
  if (!metadata) return 0;
  const groups = metadata.groups;
  return (['exif', 'xmp', 'iptc', 'icc'] as const).reduce(
    (sum, key) => sum + Object.keys(groups[key] ?? {}).length,
    0
  );
}

/**
 * Re-parses the exported blob and counts what survived. `null` means exifr
 * could not read the container at all (WebP), not that fields remain.
 */
async function countRemainingMetadata(blob: Blob): Promise<number | null> {
  try {
    const parsed = await exifr.parse(blob, {
      tiff: true,
      xmp: true,
      iptc: true,
      icc: true,
      ihdr: true,
      mergeOutput: false
    });
    if (!parsed || typeof parsed !== 'object') return 0;
    let count = 0;
    for (const [segment, value] of Object.entries(parsed as Record<string, unknown>)) {
      // PNG IHDR is the structural header (size, bit depth), not identifying metadata.
      if (segment === 'ihdr') continue;
      if (value && typeof value === 'object') {
        count += Object.keys(value as Record<string, unknown>).length;
      }
    }
    return count;
  } catch (err) {
    console.warn('verify-metadata', err);
    return null;
  }
}

interface ProcessedResult {
  canvas: HTMLCanvasElement;
  /** Scale the canvas was rendered at (preview may be smaller than export). */
  scale: number;
  /** Scale the real export will use — resolution preset and platform cap, no preview limit. */
  exportScale: number;
  /** True when the platform pixel cap forced a smaller export than the preset asked for. */
  platformCapped: boolean;
}

const SEO_DESCRIPTIONS: Record<string, string> = {
  ru: 'Бесплатный онлайн-инструмент для анализа и удаления метаданных из фотографий. EXIF, GPS, OCR, поиск людей и объектов. Фото не покидает браузер; контекст места — только по запросу и по округлённым координатам.',
  en: 'Free browser-based tool to analyze and remove photo metadata. EXIF, GPS, OCR, people and object detection. The photo never leaves your browser; place context only on request, from rounded coordinates.',
  uz: "Fotosuratlar metama'lumotlarini tahlil qilish va olib tashlash uchun bepul vosita. EXIF, GPS, OCR, odamlar va obyektlarni aniqlash. Surat brauzerdan chiqmaydi; joy konteksti faqat so'rov bo'yicha, yaxlitlangan koordinatalar asosida.",
};

const SEO_TITLES: Record<string, string> = {
  ru: 'Found You — Анализ метаданных фото',
  en: 'Found You — Photo Metadata Analyzer',
  uz: 'Found You — Foto metadata tahlili',
};

const App: React.FC = () => {
  const t = useT();
  const { lang } = useI18n();

  // Update document title and meta description on language change
  useEffect(() => {
    document.title = SEO_TITLES[lang] ?? SEO_TITLES.ru;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', SEO_DESCRIPTIONS[lang] ?? SEO_DESCRIPTIONS.ru);
    }
  }, [lang]);
  const { fileInfo, error, loading, processFile } = useImageFile();
  const { metadata } = useExifMetadata(fileInfo);
  const credentials = useContentCredentials(fileInfo);
  const { loading: analysisLoading, error: analysisError, detectionStatus, detections, modelUnavailable, settledFile } =
    useImageAnalysis(fileInfo);
  // OCR starts only once detection has settled for this very file (success or failure):
  // both compete for the GPU/CPU and the network, and the profile needs detection first.
  const { loading: ocrLoading, error: ocrError, result: ocrResult, progress: ocrProgress } = useOCR(fileInfo, {
    enabled: settledFile === fileInfo
  });

  // Plates are OCR tokens that read like a plate or sit on a detected vehicle; shared by the profile and the blur.
  const plateCandidates = useMemo(
    () => (fileInfo ? findPlateCandidates(ocrResult, detections, { width: fileInfo.width, height: fileInfo.height }) : []),
    [fileInfo, ocrResult, detections]
  );

  const [digitalProfile, setDigitalProfile] = useState<DigitalProfile | null>(null);
  const [proData, setProData] = useState<ProData | null>(null);

  // Compute digital profile when analysis completes
  useEffect(() => {
    if (!fileInfo) { setDigitalProfile(null); setProData(null); return; }
    if (analysisLoading) return; // OCR joins later: the profile is recomputed when ocrResult arrives

    let cancelled = false;
    (async () => {
      const originalName = fileInfo.originalName ?? fileInfo.file.name;
      const filenameResult = analyzeFilename(originalName, lang);
      const resolutionResult = analyzeResolution(fileInfo.width, fileInfo.height, lang);
      const exif = metadata?.groups?.exif ?? {};
      const xmp = metadata?.groups?.xmp ?? {};
      const editingResult = analyzeEditingHistory(exif, xmp, lang);
      const strippedResult = detectStrippedMetadata({
        filename: originalName,
        filenameAnalysis: filenameResult,
        mimeType: fileInfo.mimeType,
        width: fileInfo.width,
        height: fileInfo.height,
        hasExif: Object.keys(exif).length > 2,
        hasSoftwareTag: !!(exif.Software ?? exif.software ?? xmp.CreatorTool ?? xmp.creatorTool),
        lang,
      });
      // Wall-clock of the camera, not the viewer's zone: "night photo" must be night where it was taken.
      const temporalResult = analyzeDateTime(metadata?.shotDateLocal ?? metadata?.shotDate, lang);
      // The perceptual hash needs the decoded picture; the byte hash needs the original bytes.
      const decoded = await loadImageElement(fileInfo.dataUrl).catch(() => null);
      const hashResult = await generateFileHash(fileInfo.originalFile ?? fileInfo.file, decoded);

      if (cancelled) return;

      const profile = generateDigitalProfile({
        filename: filenameResult,
        resolution: resolutionResult,
        stripped: strippedResult,
        editing: editingResult,
        hash: hashResult,
        temporal: temporalResult,
        metadata: metadata ?? null,
        detections,
        ocrResult: ocrResult ?? null,
        plates: plateCandidates,
        credentials: credentials.data,
        credentialsStatus: credentials.status,
        originalFilename: originalName,
        lang,
      });
      setDigitalProfile(profile);
      setProData({ filename: filenameResult, resolution: resolutionResult, stripped: strippedResult, editing: editingResult, hash: hashResult, temporal: temporalResult });
    })();
    return () => { cancelled = true; };
  }, [fileInfo, metadata, detections, ocrResult, plateCandidates, credentials.data, credentials.status, analysisLoading, ocrLoading, lang]);

  type NoticeState = { type: 'success' | 'error' | 'info'; message: string };

  const [prnuCleanup, setPrnuCleanup] = useState(true);
  const [blurFaces, setBlurFaces] = useState(false);
  const [blurStrength, setBlurStrength] = useState(blurDefault);
  const [qualityMode, setQualityMode] = useState<QualityMode>('medium');
  // The original filename is itself a leak the profile heuristics flag, so neutral naming is on by default.
  const [renameFile, setRenameFile] = useState(true);
  const [manualMaskMode, setManualMaskMode] = useState(false);
  const [manualMasks, setManualMasks] = useState<ManualMask[]>([]);
  const [antiSearchEnabled, setAntiSearchEnabled] = useState(false);
  const [antiSearchLevel, setAntiSearchLevel] = useState(2);
  const [antiSearchParams, setAntiSearchParams] = useState<AntiSearchParams | null>(null);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState('');
  const [blurText, setBlurText] = useState(false);
  const [blurPlates, setBlurPlates] = useState(false);
  /**
   * Cleaned file kept for a second tap when the share sheet needs a fresh user gesture. It is
   * stored with the settings it was made for, so any change simply makes it stale.
   */
  const [shareEntry, setShareEntry] = useState<{ file: File; token: object } | null>(null);
  const [mirrorEnabled, setMirrorEnabled] = useState(false);
  const [downscaleMax, setDownscaleMax] = useState<number>(0); // 0 = off
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('original');
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [estimatedSize, setEstimatedSize] = useState<number | null>(null);
  const [previewDimensions, setPreviewDimensions] = useState<CleanupPreviewDimensions | null>(null);
  const [platformCapped, setPlatformCapped] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const reduceColor = antiSearchEnabled && antiSearchLevel === 3;
  const watermark = watermarkEnabled;

  const metadataFieldCount = useMemo(() => countMetadataFields(metadata), [metadata]);

  /** Boxes the "hide faces" option works from: detected faces plus person boxes (fallback for people without a face). */
  const blurCandidates = useMemo(
    () => detections.filter((det) => det.label === FACE_LABEL || det.label === PERSON_LABEL),
    [detections]
  );
  /** Regions that will actually be blurred — shown as the count in the cleanup summary. */
  const blurTargetCount = useMemo(() => selectBlurTargets(blurCandidates).length, [blurCandidates]);

  useEffect(() => {
    if (antiSearchEnabled) {
      setAntiSearchParams(generateAntiSearchParams({ level: antiSearchLevel }));
    } else {
      setAntiSearchParams(null);
    }
  }, [antiSearchEnabled, antiSearchLevel]);

  /**
   * Swap the processed-preview blob URL, revoking whatever it replaces.
   * Functional updater so concurrent callers never leak the previous URL.
   */
  const replacePreviewUrl = useCallback((next: string | null) => {
    setPreviewDataUrl((prev) => {
      if (prev && prev !== next && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return next;
    });
  }, []);

  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    previewUrlRef.current = previewDataUrl;
  }, [previewDataUrl]);
  useEffect(
    () => () => {
      if (previewUrlRef.current && previewUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    },
    []
  );

  /**
   * Decoded source for the current file, shared by every preview regeneration
   * and the export. Stored as a promise so parallel callers await one decode.
   */
  const sourceImageRef = useRef<{ url: string; promise: Promise<HTMLImageElement> } | null>(null);
  const getSourceImage = useCallback((info: BasicFileInfo) => {
    const cached = sourceImageRef.current;
    if (cached && cached.url === info.dataUrl) return cached.promise;
    const promise = loadImageElement(info.dataUrl).catch((err) => {
      if (sourceImageRef.current?.promise === promise) sourceImageRef.current = null;
      throw err;
    });
    sourceImageRef.current = { url: info.dataUrl, promise };
    return promise;
  }, []);

  // New file (or none): drop the decoded source and every derived preview artefact.
  useEffect(() => {
    sourceImageRef.current = null;
    replacePreviewUrl(null);
    setEstimatedSize(null);
    setPreviewDimensions(null);
    setPlatformCapped(false);
    setVerifyResult(null);
  }, [fileInfo, replacePreviewUrl]);

  // Once a file is accepted, bring the first results section (01, the scene) into view and focus.
  const previousFileRef = useRef<BasicFileInfo | null>(null);
  useEffect(() => {
    const previous = previousFileRef.current;
    previousFileRef.current = fileInfo;
    if (!fileInfo || fileInfo === previous) return;
    const heading = document.getElementById('sec-scene');
    if (!heading) return;
    const reduceMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    heading.tabIndex = -1;
    heading.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    heading.focus({ preventScroll: true });
  }, [fileInfo]);

  const handleFile = useCallback(
    async (file: File) => {
      setPrnuCleanup(true);
      setBlurFaces(false);
      setBlurStrength(blurDefault);
      setNotice(null);
      setQualityMode('medium');
      setRenameFile(true);
      setManualMasks([]);
      setManualMaskMode(false);
      setAntiSearchEnabled(false);
      setAntiSearchParams(null);
      setAntiSearchLevel(2);
      setWatermarkEnabled(false);
      setWatermarkText('');
      setBlurText(false);
      setMirrorEnabled(false);
      setDownscaleMax(0);
      setOutputFormat('original');
      await processFile(file);
    },
    [processFile]
  );

  const createProcessedCanvas = useCallback(
    async (options?: { maxDimension?: number }): Promise<ProcessedResult | null> => {
      if (!fileInfo) return null;
      const { width: sourceWidth, height: sourceHeight } = fileInfo;
      const longest = Math.max(sourceWidth, sourceHeight) || 1;

      // Base scale first: resolution preset, then the platform pixel cap, then
      // (preview only) the preview ceiling. Every op below runs on that canvas,
      // so nothing is ever rendered larger than the file that leaves the app.
      const pixelCap = Math.sqrt(MAX_EXPORT_PIXELS / Math.max(1, sourceWidth * sourceHeight));
      let exportScale = 1;
      if (downscaleMax > 0) {
        exportScale = Math.min(exportScale, downscaleMax / longest);
      }
      const platformCapped = pixelCap < exportScale;
      exportScale = Math.min(exportScale, pixelCap);
      const scale = options?.maxDimension ? Math.min(exportScale, options.maxDimension / longest) : exportScale;
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

      const image = await getSourceImage(fileInfo);
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = targetWidth;
      baseCanvas.height = targetHeight;
      const ctx = baseCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('canvas');
      }
      ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

      const scaledDetections = blurCandidates.map((det) => ({
        ...det,
        x: det.x * scale,
        y: det.y * scale,
        width: det.width * scale,
        height: det.height * scale
      }));

      const scaledMasks = manualMasks.map((mask) => ({
        ...mask,
        points: mask.points.map((pt) => ({ x: pt.x * scale, y: pt.y * scale })),
        radius: mask.radius * scale
      }));

      if (blurFaces && scaledDetections.length > 0) {
        blurDetections(ctx, baseCanvas, scaledDetections, blurStrength);
      }

      if (blurText && ocrResult && ocrResult.regions.length > 0) {
        blurOcrRegions(ctx, baseCanvas, ocrResult.regions, blurStrength, scale);
      }

      if (blurPlates && plateCandidates.length > 0) {
        blurPlateRegions(ctx, baseCanvas, plateCandidates, blurStrength, scale);
      }

      if (scaledMasks.length > 0) {
        blurManualMasks(ctx, baseCanvas, scaledMasks, blurStrength);
      }

      let workingCanvas = baseCanvas;

      if (prnuCleanup) {
        workingCanvas = applyPrnuCleanup(workingCanvas);
      }

      if (antiSearchEnabled && antiSearchParams) {
        workingCanvas = applyAntiSearch(workingCanvas, antiSearchParams);
      }

      if (reduceColor) {
        workingCanvas = applyColorReduction(workingCanvas);
      }

      if (mirrorEnabled) {
        workingCanvas = applyMirror(workingCanvas);
      }

      if (watermark) {
        const wmText = watermarkText.trim() || t('watermarkText');
        workingCanvas = applyWatermark(workingCanvas, wmText);
      }

      return { canvas: workingCanvas, scale, exportScale, platformCapped };
    },
    [
      fileInfo,
      getSourceImage,
      blurFaces,
      blurText,
      blurPlates,
      plateCandidates,
      ocrResult,
      blurCandidates,
      blurStrength,
      manualMasks,
      antiSearchEnabled,
      antiSearchParams,
      reduceColor,
      mirrorEnabled,
      downscaleMax,
      watermark,
      watermarkText,
      prnuCleanup,
      t
    ]
  );

  /** Runs the pipeline and returns the verified clean file. Shared by download and share. */
  const exportCleanFile = useCallback(async (): Promise<{ file: File; requested: string; actualMime: string }> => {
    if (!fileInfo) {
      throw new Error('no-file');
    }
    if (import.meta.env.DEV) {
      console.info('[pipeline] export:start', { mime: fileInfo.mimeType, qualityMode, outputFormat });
    }
    const result = await createProcessedCanvas();
    if (!result) {
      throw new Error('no-canvas');
    }
    const { canvas } = result;
    setPlatformCapped(result.platformCapped);
    const { requested, mime: exportMime } = resolveExportMime(outputFormat, fileInfo.mimeType);
    const quality = exportMime === 'image/png' ? undefined : qualityForMode(qualityMode);
    const encodedBlob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((encoded) => {
        if (encoded) resolve(encoded);
        else reject(new Error('export-failed'));
      }, exportMime, quality);
    });
    // The browser's encoder adds container metadata of its own (Chrome: an sRGB ICC
    // profile in APP2 / iCCP). Harmless, but "0 fields left" must be literally true.
    const blob = await stripContainerMetadata(encodedBlob);
    // Safari answers a WebP request with PNG; trust the blob, not the request.
    const actualMime = blob.type || exportMime;
    const extension = extensionForMime(actualMime);
    const baseName = (fileInfo.originalName ?? fileInfo.file.name).replace(/\.[^/.]+$/, '');
    const fileName = renameFile ? createAnonymisedName(extension) : `${baseName}.cleaned.${extension}`;

    const remaining = await countRemainingMetadata(blob);
    // The perceptual distance to the original tells whether reverse image search still links the copy.
    const originalPhash = proData?.hash?.phash ?? null;
    const exportPhash = originalPhash ? await phashFromBlob(blob) : null;
    const phashDistance = originalPhash && exportPhash ? hammingDistance(originalPhash, exportPhash) : null;
    setVerifyResult({
      before: metadataFieldCount,
      after: remaining,
      phashDistance,
      trailingBytesBefore: metadata?.samsung?.bytes ?? 0
    });
    if (import.meta.env.DEV) {
      console.info('[pipeline] export:done', { mime: actualMime, remaining, phashDistance });
    }
    return { file: new File([blob], fileName, { type: actualMime }), requested, actualMime };
  }, [fileInfo, createProcessedCanvas, qualityMode, renameFile, outputFormat, metadataFieldCount, proData?.hash?.phash, metadata?.samsung?.bytes]);

  const triggerDownload = useCallback((file: File) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      document.body.removeChild(link);
    }, 2000);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!fileInfo) {
      return;
    }
    setProcessing(true);
    setNotice(null);
    try {
      const { file, requested, actualMime } = await exportCleanFile();
      triggerDownload(file);
      const messages = [t('downloadReady')];
      if (actualMime !== requested) {
        messages.push(t('formatFallback', { from: mimeLabel(requested), to: mimeLabel(actualMime) }));
      }
      setNotice({ type: 'success', message: messages.join(' ') });
    } catch (err) {
      console.error(err);
      setNotice({ type: 'error', message: t('cleanupFailed') });
    } finally {
      setProcessing(false);
    }
  }, [fileInfo, exportCleanFile, triggerDownload, t]);

  // The share sheet needs a user gesture and a long export can outlive it: the prepared file
  // is then kept for one more tap instead of being thrown away.
  // A fresh token whenever the pipeline or export settings change; the prepared file is tied to it.
  const shareToken = useMemo(() => ({}), [createProcessedCanvas, outputFormat, qualityMode, renameFile]);
  const shareReady = shareEntry && shareEntry.token === shareToken ? shareEntry.file : null;
  const setShareReady = useCallback((file: File | null) => setShareEntry(file ? { file, token: shareToken } : null), [shareToken]);

  const handleShare = useCallback(async () => {
    if (!fileInfo) {
      return;
    }
    setNotice(null);
    let file = shareReady;
    if (!file) {
      setProcessing(true);
      try {
        file = (await exportCleanFile()).file;
      } catch (err) {
        console.error(err);
        setNotice({ type: 'error', message: t('cleanupFailed') });
        return;
      } finally {
        setProcessing(false);
      }
    }
    const outcome = await shareFile(file, file.name);
    switch (outcome) {
      case 'shared':
        setShareReady(null);
        setNotice({ type: 'success', message: t('shareDone') });
        break;
      case 'cancelled':
        setShareReady(file);
        break;
      case 'needs-gesture':
        setShareReady(file);
        setNotice({ type: 'info', message: t('shareTapAgain') });
        break;
      default:
        setShareReady(null);
        triggerDownload(file);
        setNotice({ type: 'info', message: t('shareFallbackDownload') });
    }
  }, [fileInfo, shareReady, setShareReady, exportCleanFile, triggerDownload, t]);

  const shareSupported = useMemo(() => canShareFiles(), []);

  useEffect(() => {
    if (!fileInfo) {
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    // A new preview means the settings changed; the last verification no longer describes them.
    setVerifyResult(null);
    const { mime } = resolveExportMime(outputFormat, fileInfo.mimeType);
    const quality = mime === 'image/png' ? undefined : qualityForMode(qualityMode);

    const fail = (err: unknown) => {
      console.error('cleanup-preview', err);
      if (cancelled) return;
      replacePreviewUrl(null);
      setEstimatedSize(null);
      setPreviewDimensions(null);
      setPreviewLoading(false);
      setNotice({ type: 'error', message: t('cleanupPreviewFailed') });
    };

    const debounceTimer = setTimeout(() => {
      createProcessedCanvas({ maxDimension: PREVIEW_MAX_DIMENSION })
        .then((result) => {
          if (!result || cancelled) {
            return;
          }
          const { canvas, scale, exportScale } = result;
          // Encode with the export mime so the size estimate tracks the real output.
          canvas.toBlob((blob) => {
            if (cancelled) return;
            if (!blob) {
              fail(new Error('preview-encode'));
              return;
            }
            const ratio = exportScale / scale;
            const finalWidth = Math.max(1, Math.round(canvas.width * ratio));
            const finalHeight = Math.max(1, Math.round(canvas.height * ratio));
            const areaRatio = (finalWidth * finalHeight) / Math.max(1, canvas.width * canvas.height);
            replacePreviewUrl(URL.createObjectURL(blob));
            setEstimatedSize(Math.round(blob.size * areaRatio));
            setPreviewDimensions({ width: finalWidth, height: finalHeight });
            setPlatformCapped(result.platformCapped);
            setPreviewLoading(false);
          }, mime, quality);
        })
        .catch(fail);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
    };
  }, [fileInfo, createProcessedCanvas, qualityMode, outputFormat, replacePreviewUrl, t]);

  const handleManualMaskAdd = useCallback((mask: Omit<ManualMask, 'id'>) => {
    setManualMasks((current) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      return [...current, { id, ...mask }];
    });
  }, []);

  const handleManualMaskRemove = useCallback((id: string) => {
    setManualMasks((current) => current.filter((mask) => mask.id !== id));
  }, []);

  // Verdict CTA: bring the cleanup section into view and hand focus to its heading.
  const handleMakeSafeCopy = useCallback(() => {
    const heading = document.getElementById('sec-cleanup');
    if (!heading) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    heading.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }, []);

  // «What to do» buttons in the facts: switch the option on and go to the cleanup section.
  const handleBlurFaces = useCallback(() => {
    setBlurFaces(true);
    handleMakeSafeCopy();
  }, [handleMakeSafeCopy]);
  const handleBlurText = useCallback(() => {
    setBlurText(true);
    handleMakeSafeCopy();
  }, [handleMakeSafeCopy]);
  const handleBlurPlates = useCallback(() => {
    setBlurPlates(true);
    handleMakeSafeCopy();
  }, [handleMakeSafeCopy]);
  const factActions = useMemo(
    () => ({ blurFaces: handleBlurFaces, blurText: handleBlurText, blurPlates: handleBlurPlates }),
    [handleBlurFaces, handleBlurText, handleBlurPlates]
  );

  const sceneDescription = useMemo(() => {
    if (analysisLoading) return t('sceneDescriptionLoading');
    // An unavailable model must never read as "nothing found".
    if (analysisError) return t(DETECTION_ERROR_KEYS[analysisError]);
    if (!fileInfo || detections.length === 0) return t('sceneDescriptionEmpty');
    return generateSceneNarrative({
      detections,
      imageWidth: fileInfo.width,
      imageHeight: fileInfo.height,
      lang,
    });
  }, [analysisLoading, analysisError, fileInfo, detections, lang, t]);

  return (
    <>
      <a href="#main" className="skip-link">
        {t('skipToContent')}
      </a>
      <div className="v4-root">
        <SiteHeader />
        <main id="main" className="fy-main">
          <section className="fy-hero" aria-labelledby="hero-title">
            <InfoBlock scenariosActive={!fileInfo} />
            <UploadZone loading={loading} onFile={handleFile} error={error ?? undefined} />
            {fileInfo ? (
              <ErrorBoundary variant="inline" resetKey={fileInfo}>
                <ResultsBar fileInfo={fileInfo} profile={digitalProfile} onMakeSafeCopy={handleMakeSafeCopy} />
              </ErrorBoundary>
            ) : null}
          </section>

          {fileInfo ? (
            <ErrorBoundary variant="inline" resetKey={fileInfo}>
              <SceneBlock
                fileInfo={fileInfo}
                detections={detections}
                sceneDescription={sceneDescription}
                onMakeSafeCopy={handleMakeSafeCopy}
                onBlurFaces={handleBlurFaces}
                detectionProgress={
                  analysisLoading && detectionStatus
                    ? { label: t(DETECTION_STAGE_KEYS[detectionStatus.stage]), value: detectionStatus.progress }
                    : null
                }
              />
            </ErrorBoundary>
          ) : null}

          {fileInfo ? (
            <ErrorBoundary variant="inline" resetKey={fileInfo}>
              <StoryBlock
                fileInfo={fileInfo}
                metadata={metadata}
                profile={digitalProfile}
                proData={proData}
                detections={detections}
                ocrResult={ocrResult}
                ocrLoading={ocrLoading}
                ocrError={ocrError ? t(OCR_ERROR_KEYS[ocrError]) : null}
                ocrProgressLabel={ocrProgress ? t(OCR_STAGE_KEYS[ocrProgress.stage]) : null}
                onMakeSafeCopy={handleMakeSafeCopy}
                actions={factActions}
                credentials={credentials}
                plates={plateCandidates}
              />
            </ErrorBoundary>
          ) : null}

          {fileInfo ? (
            <ErrorBoundary variant="inline" resetKey={fileInfo}>
              <CleanupDownloadBlock
                fileInfo={fileInfo}
                prnuCleanup={prnuCleanup}
                blurFaces={blurFaces}
                blurStrength={blurStrength}
                qualityMode={qualityMode}
                renameFile={renameFile}
                manualMaskMode={manualMaskMode}
                manualMasks={manualMasks}
                antiSearchEnabled={antiSearchEnabled}
                previewDimensions={previewDimensions}
                setPrnuCleanup={setPrnuCleanup}
                setBlurFaces={setBlurFaces}
                setBlurStrength={setBlurStrength}
                setQualityMode={setQualityMode}
                setRenameFile={setRenameFile}
                setManualMaskMode={setManualMaskMode}
                onManualMaskAdd={handleManualMaskAdd}
                onManualMaskRemove={handleManualMaskRemove}
                setAntiSearchEnabled={setAntiSearchEnabled}
                antiSearchLevel={antiSearchLevel}
                setAntiSearchLevel={setAntiSearchLevel}
                watermarkEnabled={watermarkEnabled}
                setWatermarkEnabled={setWatermarkEnabled}
                watermarkText={watermarkText}
                setWatermarkText={setWatermarkText}
                blurText={blurText}
                setBlurText={setBlurText}
                mirrorEnabled={mirrorEnabled}
                setMirrorEnabled={setMirrorEnabled}
                downscaleMax={downscaleMax}
                setDownscaleMax={setDownscaleMax}
                outputFormat={outputFormat}
                setOutputFormat={setOutputFormat}
                ocrRegionCount={ocrResult?.regions.length ?? 0}
                plateCount={plateCandidates.length}
                blurPlates={blurPlates}
                setBlurPlates={setBlurPlates}
                shareSupported={shareSupported}
                shareReady={shareReady !== null}
                onShare={handleShare}
                onClean={handleDownload}
                processing={processing}
                previewDataUrl={previewDataUrl}
                previewLoading={previewLoading}
                estimatedSize={estimatedSize}
                blurTargetCount={blurTargetCount}
                originalPreviewUrl={fileInfo.thumbnailUrl ?? null}
                platformCapped={platformCapped}
                platformCapMegapixels={MAX_EXPORT_MEGAPIXELS}
                verifyResult={verifyResult}
                detectionUnavailable={modelUnavailable}
              />
            </ErrorBoundary>
          ) : null}
          {notice ? (
            <p className={`fy-status ${notice.type === 'success' ? 'fy-notice--positive' : notice.type === 'error' ? 'fy-notice--negative' : ''}`} role="status">
              {notice.message}
            </p>
          ) : null}
        </main>
        <SiteFooter />
      </div>
    </>
  );
};

export default App;
