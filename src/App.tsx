import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import exifr from 'exifr';
import { sniffContainer, stripContainerMetadata } from './utils/containerMetadata';
import { hammingDistance, phashFromBlob } from './utils/phash';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';
import { extensionForMime } from './utils/format';
import { countMetadataFields } from './utils/metadataFields';
import { extrapolateSize, sampleWindows } from './utils/sizeEstimate';
import { InfoBlock } from './components/InfoBlock';
import { SiteHeader } from './components/SiteHeader';
import { SiteFooter } from './components/SiteFooter';
import { UploadZone } from './components/UploadZone';
import { StickyActions } from './components/StickyActions';
import { VerifyBlock } from './components/VerifyBlock';
import { SiteContent } from './components/SiteContent';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useImageFile, type FileErrorCode, type FileWarningCode } from './hooks/useImageFile';
import { useExifMetadata } from './hooks/useExifMetadata';
import { maxExportPixels, megapixels } from './utils/platform';
import { StoryBlock } from './components/StoryBlock';
import { SceneBlock } from './components/SceneBlock';
import { CleanupDownloadBlock } from './components/CleanupDownloadBlock';
import { useImageAnalysis } from './hooks/useImageAnalysis';
import { useOCR } from './hooks/useOCR';
import { useContentCredentials } from './hooks/useContentCredentials';
import { findPlateCandidates } from './utils/plates';
import { findPii } from './utils/pii';
import { useQrCodes } from './hooks/useQrCodes';
import { canShareFiles, shareFile } from './utils/share';
import { useI18n, useT, type MessageKey } from './i18n';
import { FACE_LABEL, type DetectionErrorCode, type DetectionStage } from './types/detection';
import type { OCRErrorCode, OCRStage } from './hooks/useOCR';
import type {
  AntiSearchParams,
  CleanupPreviewDimensions,
  ManualMask,
  OutputFormat,
  QualityMode,
  VerifyResult
} from './types/cleanup';
import type { BasicFileInfo } from './types/metadata';
import { generateSceneNarrative } from './utils/sceneNarrative';
import { analyzeFilename } from './utils/heuristics/filenameAnalyzer';
import { analyzeResolution } from './utils/heuristics/resolutionAnalyzer';
import { detectStrippedMetadata, hasCameraExif } from './utils/heuristics/strippedDetector';
import { judgeOrigin, type OriginJudgement } from './utils/originJudge';
import { judgeCompression, type CompressionVerdict } from './utils/jpegQuant';
import { scoreScreenshot, type ScreenshotScore } from './utils/screenshot';
import { buildFileHistory, type FileEvent } from './utils/fileHistory';
import { useContainerSignals } from './hooks/useContainerSignals';
import { useFrameStats } from './hooks/useFrameStats';
import { analyzeEditingHistory } from './utils/heuristics/editingHistory';
import { generateFileHash } from './utils/heuristics/hashAnalyzer';
import { analyzeDateTime } from './utils/heuristics/temporalAnalyzer';
import { generateDigitalProfile, predictLeakAfter, type DigitalProfile } from './utils/heuristics/digitalProfile';
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
  /** The one verdict on where the file has been since the shutter, with its grounds. */
  origin: OriginJudgement;
  /** The JPEG tables against the maker in EXIF; null for other containers. */
  compression: CompressionVerdict | null;
  /** The screenshot probability with its reasons. */
  screenshot: ScreenshotScore;
  /** What happened to the file after the shutter, as dated events. */
  history: FileEvent[];
}
import {
  applyAntiSearch,
  applyAntiSearchMeasured,
  antiSearchTargetBits,
  blurBoxes,
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
/** Size-estimate sampling: four windows of 1024 px, measured against a full encode in `sizeEstimate.ts`. */
const SIZE_SAMPLE_SIDE = 1024;
const SIZE_SAMPLE_GRID = 2;

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

const FILE_ERROR_KEYS: Record<FileErrorCode, MessageKey> = {
  'file-too-large': 'fileTooLarge',
  'file-too-large-resolution': 'fileTooLargeResolution',
  'unsupported-format': 'unsupportedFormat',
  'heic-conversion-failed': 'heicConversionFailed',
  'browser-format-unsupported': 'browserFormatUnsupported',
  'corrupted-file': 'corruptedFile'
};

const FILE_WARNING_KEYS: Record<FileWarningCode, MessageKey> = {
  'jpeg-truncated': 'truncatedJpeg',
  'png-truncated': 'truncatedPng'
};

/** Formats `canvas.toBlob` can actually produce; anything else falls back to JPEG. */
const ENCODABLE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** The per-platform export ceiling lives in `utils/platform.ts`, next to the measurement behind it. */
const MAX_EXPORT_PIXELS = maxExportPixels();
const MAX_EXPORT_MEGAPIXELS = megapixels(MAX_EXPORT_PIXELS);

/** Nothing to blur: one shared empty list, so an option that is off never changes the pipeline's identity. */
const NO_BOXES: never[] = [];

/** The byte count of the «metadata only» export: the container rewrite is cheap enough to run for the summary. */
async function losslessSize(info: BasicFileInfo): Promise<number> {
  const source = info.originalFile ?? info.file;
  const bytes = await source.arrayBuffer();
  const container = sniffContainer(new Uint8Array(bytes));
  if (!container) return source.size;
  return (await stripContainerMetadata(new Blob([bytes], { type: container }))).size;
}

/**
 * The encoder quality for a mode. «match» re-encodes at the quality the source was written
 * with (its tables say so, exactly for libjpeg and roughly otherwise), clamped to what is
 * sensible: a 90 % copy of an 80 % original was bigger than the original, which no one
 * pressing «clean» asked for.
 */
function qualityForMode(mode: QualityMode, sourceQuality: number | null): number {
  switch (mode) {
    case 'low':
      return 0.82;
    case 'medium':
      return 0.9;
    case 'match':
      return sourceQuality != null ? Math.min(0.95, Math.max(0.5, sourceQuality / 100)) : 0.9;
    case 'original':
    default:
      return 0.98;
  }
}

/** A PNG or a screenshot-named file: no sensor noise to weaken, no quality knob, nothing to re-encode for. */
function isScreenLikeFile(name: string, mimeType: string, lang: 'ru' | 'en' | 'uz'): boolean {
  return mimeType === 'image/png' || analyzeFilename(name, lang).isScreenshot;
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

function mimeLabel(mime: string): string {
  const sub = mime.replace(/^image\//, '');
  if (sub === 'jpeg' || sub === 'jpg') return 'JPEG';
  if (sub === 'webp') return 'WebP';
  return sub.toUpperCase();
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

/** An identity for the settings a prepared share file was made with; a change in any of them makes a new one. */
type ShareToken = Record<string, never>;

/** What `exportCleanFile` hands back; the caller decides whether the page still shows the photo it was made for. */
interface CleanExport {
  file: File;
  requested: string;
  actualMime: string;
  verify: VerifyResult;
  platformCapped: boolean;
}

const App: React.FC = () => {
  const t = useT();
  const { lang } = useI18n();

  // The title and description a search engine reads from the rendered page must be the ones the
  // static page carries (src/site/renderStatic.ts): the same two dictionary keys, so an in-place
  // language switch keeps the tab and the meta in step with the copy.
  useEffect(() => {
    document.title = t('siteMetaTitle');
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', t('siteMetaDescription'));
    }
  }, [t]);
  const reducedMotion = usePrefersReducedMotion();
  /** «Open the picker» of the drop zone, for the sticky «new photo» button. */
  const pickerRef = useRef<(() => void) | null>(null);
  const { fileInfo, error: fileError, warning: fileWarning, loading, processFile } = useImageFile();
  /** The photo on the page right now, for work that started under an earlier one. */
  const latestFileRef = useRef<BasicFileInfo | null>(null);
  // Authenticity inputs read once per file: the JPEG tables from the bytes, the flat-pixel share
  // from the pixels. Both feed the origin judge in the profile below and the cards in section 02.
  const jpeg = useContainerSignals(fileInfo);
  const frame = useFrameStats(fileInfo);
  useEffect(() => {
    latestFileRef.current = fileInfo;
  }, [fileInfo]);
  const inlineErrorLabels = useMemo(() => ({ inlineTitle: t('errorInlineTitle'), retry: t('errorRetry') }), [t]);
  const { metadata } = useExifMetadata(fileInfo);
  const credentials = useContentCredentials(fileInfo);
  const { loading: analysisLoading, error: analysisError, detectionStatus, detections, modelUnavailable, settledFile } =
    useImageAnalysis(fileInfo);
  // OCR starts only once detection has settled for this very file (success or failure):
  // both compete for the GPU/CPU and the network, and the profile needs detection first.
  const { loading: ocrLoading, error: ocrError, result: ocrResult, progress: ocrProgress } = useOCR(fileInfo, {
    enabled: settledFile === fileInfo
  });

  /**
   * Decoded source for the current file, shared by the perceptual hash, the QR pass,
   * every preview regeneration and the export. Stored as a promise so parallel callers await one decode.
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

  const { codes: qrCodes, loading: qrLoading } = useQrCodes(fileInfo, getSourceImage);
  // Plates are OCR tokens that read like a plate or sit on a detected vehicle; shared by the profile and the blur.
  // Names in a chat are only looked for on a screen capture; the flag comes from the file alone,
  // not from the profile, because the profile depends on these findings in turn.
  const screenLike = useMemo(
    () => (fileInfo ? isScreenLikeFile(fileInfo.originalName ?? fileInfo.file.name, fileInfo.originalMimeType ?? fileInfo.mimeType, lang) : false),
    [fileInfo, lang]
  );
  const piiFindings = useMemo(() => findPii(ocrResult, { screenLike }), [ocrResult, screenLike]);
  /** OCR boxes a document or contact was read from: what «Скрыть документы» blurs. */
  const documentBoxes = useMemo(() => {
    if (!ocrResult) return [];
    const indexes = new Set(piiFindings.flatMap((finding) => finding.regions));
    return ocrResult.regions.filter((_, index) => indexes.has(index));
  }, [ocrResult, piiFindings]);
  const plateCandidates = useMemo(
    () => (fileInfo ? findPlateCandidates(ocrResult, detections, { width: fileInfo.width, height: fileInfo.height }) : []),
    [fileInfo, ocrResult, detections]
  );

  /**
   * The profile is stored with the file it was built for and read back only while that file
   * is the current one, so section 02 never shows another photo's facts while this one is
   * still being analysed.
   */
  const [profileEntry, setProfileEntry] = useState<{ file: BasicFileInfo; profile: DigitalProfile; proData: ProData } | null>(null);
  const digitalProfile = profileEntry && profileEntry.file === fileInfo ? profileEntry.profile : null;
  const proData = profileEntry && profileEntry.file === fileInfo ? profileEntry.proData : null;

  /**
   * The byte hash and the perceptual hash, once per file. They used to be recomputed inside the
   * profile effect, which runs three to five times per photo as detection, credentials, QR and
   * OCR land — each time re-reading up to 50 MB and hashing it — and a rejection there (an
   * expired Android content URI, `crypto.subtle` missing on an insecure LAN origin) left
   * section 02 on «factsPending» for good. A failure is `hash: null`, which `ProData` allows.
   */
  const [hashEntry, setHashEntry] = useState<{ file: BasicFileInfo; hash: HashResult | null } | null>(null);
  useEffect(() => {
    if (!fileInfo) return;
    let cancelled = false;
    (async () => {
      let hash: HashResult | null = null;
      try {
        const decoded = await getSourceImage(fileInfo).catch(() => null);
        hash = await generateFileHash(fileInfo.originalFile ?? fileInfo.file, decoded);
      } catch (err) {
        console.warn('file-hash', err);
      }
      if (!cancelled) setHashEntry({ file: fileInfo, hash });
    })();
    return () => {
      cancelled = true;
    };
  }, [fileInfo, getSourceImage]);
  const fileHash = hashEntry && hashEntry.file === fileInfo ? hashEntry : null;

  // Compute digital profile when analysis completes
  useEffect(() => {
    if (!fileInfo) return;
    if (analysisLoading) return; // OCR joins later: the profile is recomputed when ocrResult arrives
    if (!fileHash) return; // the hashes arrive once per file (above); the profile follows them

    let cancelled = false;
    (async () => {
      const originalName = fileInfo.originalName ?? fileInfo.file.name;
      const filenameResult = analyzeFilename(originalName, lang);
      const resolutionResult = analyzeResolution(fileInfo.width, fileInfo.height, lang);
      const exif = metadata?.groups?.exif ?? {};
      const xmp = metadata?.groups?.xmp ?? {};
      const editingResult = analyzeEditingHistory(exif, xmp, lang, metadata?.groups?.png ?? null, metadata?.groups?.iptc ?? null);
      // Make / Model / DateTimeOriginal, not the six-field resolution stub every re-encoder
      // writes: a Telegram file carries that stub and used to count as «metadata preserved».
      const cameraExif = hasCameraExif(exif);
      const strippedResult = detectStrippedMetadata({
        filename: originalName,
        filenameAnalysis: filenameResult,
        mimeType: fileInfo.mimeType,
        width: fileInfo.width,
        height: fileInfo.height,
        hasExif: cameraExif,
        hasSoftwareTag: !!(exif.Software ?? exif.software ?? xmp.CreatorTool ?? xmp.creatorTool),
        // PNG text chunks, XMP and IPTC are metadata too: a generator's «parameters» chunk is
        // exactly the thing the card used to call «метаданные были удалены».
        hasOtherMetadata:
          Object.keys(metadata?.groups?.png ?? {}).length > 0 ||
          Object.keys(xmp).length > 0 ||
          Object.keys(metadata?.groups?.iptc ?? {}).length > 0,
        lang,
      });
      // Wall-clock of the camera, not the viewer's zone: "night photo" must be night where it was taken.
      const temporalResult = analyzeDateTime(metadata?.shotDateLocal ?? metadata?.shotDate, lang);
      const hashResult = fileHash.hash;
      const originalMime = fileInfo.originalMimeType ?? fileInfo.mimeType;
      const compression = jpeg ? judgeCompression(jpeg, metadata?.cameraMake) : null;
      const screenshot = scoreScreenshot({
        filenameScreenshot: filenameResult.isScreenshot,
        knownScreenSize: resolutionResult.isScreenshot,
        hasCameraExif: Boolean(metadata?.cameraMake || metadata?.cameraModel),
        hasShotDate: Boolean(metadata?.shotDateLocal),
        mimeType: originalMime,
        flatRatio: frame?.flatRatio ?? null
      });
      const history = buildFileHistory({
        metadata: metadata ?? null,
        editing: editingResult,
        stripped: strippedResult,
        credentials: credentials.data ?? null,
        lastModified: (fileInfo.originalFile ?? fileInfo.file).lastModified || null,
        width: fileInfo.originalWidth ?? fileInfo.width,
        height: fileInfo.originalHeight ?? fileInfo.height,
        phash: hashResult?.phash ?? null
      });
      // One verdict over every sign, so the rows of the origin card stop contradicting each other.
      const origin = judgeOrigin({
        mimeType: originalMime,
        width: fileInfo.width,
        height: fileInfo.height,
        hasCameraExif: cameraExif,
        filename: filenameResult,
        stripped: strippedResult,
        editing: editingResult,
        compression,
        livePhoto: Boolean(metadata?.apple?.livePhoto),
        motionPhoto: metadata?.samsung?.motionPhotoBytes != null,
        modifiedLater: history.some((event) => event.kind === 'modified' && event.at != null),
        resized: history.some((event) => event.kind === 'resized'),
        thumbnailDiffers: history.some((event) => event.kind === 'thumbnail' && event.same === false),
        screenshotLikely: filenameResult.isScreenshot || screenshot.level === 'likely' || screenshot.level === 'certain'
      });
      // Yield once so a burst of arrivals (OCR, then plates and documents) coalesces into one profile.
      await Promise.resolve();

      if (cancelled) return;

      const profile = generateDigitalProfile({
        filename: filenameResult,
        resolution: resolutionResult,
        stripped: strippedResult,
        editing: editingResult,
        hash: hashResult,
        temporal: temporalResult,
        origin,
        metadata: metadata ?? null,
        detections,
        ocrResult: ocrResult ?? null,
        plates: plateCandidates,
        qrCodes,
        pii: piiFindings,
        credentials: credentials.data,
        credentialsStatus: credentials.status,
        originalFilename: originalName,
        lang,
      });
      setProfileEntry({
        file: fileInfo,
        profile,
        proData: {
          filename: filenameResult,
          resolution: resolutionResult,
          stripped: strippedResult,
          editing: editingResult,
          hash: hashResult,
          temporal: temporalResult,
          origin,
          compression,
          screenshot,
          history
        }
      });
    })();
    return () => { cancelled = true; };
  }, [fileInfo, metadata, detections, ocrResult, plateCandidates, qrCodes, piiFindings, credentials.data, credentials.status, analysisLoading, ocrLoading, lang, fileHash, jpeg, frame]);

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
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState('');
  const [blurText, setBlurText] = useState(false);
  const [blurPlates, setBlurPlates] = useState(false);
  const [blurQr, setBlurQr] = useState(false);
  const [blurDocuments, setBlurDocuments] = useState(false);
  /**
   * Cleaned file kept for a second tap when the share sheet needs a fresh user gesture. It is
   * stored with the settings it was made for, so any change simply makes it stale.
   */
  const [shareEntry, setShareEntry] = useState<{ file: File; token: ShareToken } | null>(null);
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
  /** The quality the source JPEG was written with, from its tables; null for other containers or before they are read. */
  const sourceQuality = useMemo(() => (jpeg ? jpeg.ijgQuality ?? jpeg.estimatedQuality : null), [jpeg]);
  /*
   * Defaults that depend on what the file is, once per file, when the tables have been read: a
   * JPEG written below 90 % is re-encoded at its own quality rather than blown up to 90 %.
   */
  const defaultsAppliedFor = useRef<BasicFileInfo | null>(null);
  useEffect(() => {
    if (!fileInfo || defaultsAppliedFor.current === fileInfo) return;
    const isJpeg = /jpe?g/i.test(fileInfo.originalMimeType ?? fileInfo.mimeType);
    if (isJpeg && jpeg === null) return; // the tables are still being read
    defaultsAppliedFor.current = fileInfo;
    if (sourceQuality != null && sourceQuality < 90) setQualityMode('match');
  }, [fileInfo, jpeg, sourceQuality]);
  /** The index the copy would have with the current settings: the same arithmetic as the index itself. */
  const leakAfter = useMemo(
    () => (digitalProfile ? predictLeakAfter(digitalProfile, { blurFaces, blurText, blurPlates, blurQr, blurDocuments }) : null),
    [digitalProfile, blurFaces, blurText, blurPlates, blurQr, blurDocuments]
  );
  const reduceColor = antiSearchEnabled && antiSearchLevel === 3;
  const watermark = watermarkEnabled;
  /**
   * «Только метаданные» on a JPEG or PNG source: nothing in the settings touches the pixels, so
   * the export keeps the original picture bytes and only rewrites the container (every
   * metadata segment and anything after the end of the image go). Other sources (HEIC,
   * WebP) have no original JPEG/PNG bytes to keep and are re-encoded once instead.
   */
  const losslessExport = useMemo(
    () =>
      Boolean(fileInfo) &&
      !fileInfo?.wasConverted &&
      (fileInfo?.mimeType === 'image/jpeg' || fileInfo?.mimeType === 'image/png') &&
      !prnuCleanup &&
      !blurFaces &&
      !blurText &&
      !blurPlates &&
      !blurQr &&
      !blurDocuments &&
      manualMasks.length === 0 &&
      !antiSearchEnabled &&
      !mirrorEnabled &&
      downscaleMax === 0 &&
      !watermarkEnabled &&
      qualityMode === 'original' &&
      outputFormat === 'original',
    [fileInfo, prnuCleanup, blurFaces, blurText, blurPlates, blurQr, blurDocuments, manualMasks.length, antiSearchEnabled, mirrorEnabled, downscaleMax, watermarkEnabled, qualityMode, outputFormat]
  );

  const metadataFieldCount = useMemo(() => countMetadataFields(metadata), [metadata]);

  /** Boxes the «hide faces» option works from: detected faces only; people without a face are covered with the brush. */
  const blurCandidates = useMemo(() => detections.filter((det) => det.label === FACE_LABEL), [detections]);
  /** Perceptual-hash distance the anti-search transform reached on the last preview; shown in the summary. */
  const [antiSearchDistance, setAntiSearchDistance] = useState<number | null>(null);
  /** Regions that will actually be blurred — shown as the count in the cleanup summary. */
  const blurTargetCount = useMemo(() => selectBlurTargets(blurCandidates).length, [blurCandidates]);

  // A fresh random set whenever the toggle or the level changes; nothing to mirror through an effect.
  const antiSearchParams = useMemo<AntiSearchParams | null>(
    () => (antiSearchEnabled ? generateAntiSearchParams({ level: antiSearchLevel }) : null),
    [antiSearchEnabled, antiSearchLevel]
  );
  /**
   * The strength the measured preview settled on, keyed by the seed of the params it started
   * from. The export applies it once instead of measuring again on the full-size canvas.
   */
  const measuredAntiSearchRef = useRef<{ seed: number; params: AntiSearchParams } | null>(null);

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

  // New file (or none): drop the decoded source and every derived preview artefact. The cache is
  // keyed by the file's URL, so it is cleared only when it holds another file's picture: the QR
  // effect runs before this one and has already primed it for the new file, and nulling it here
  // used to decode every picture twice.
  useEffect(() => {
    if (sourceImageRef.current && sourceImageRef.current.url !== fileInfo?.dataUrl) sourceImageRef.current = null;
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
    const reduceMotion = reducedMotion;
    heading.tabIndex = -1;
    heading.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    heading.focus({ preventScroll: true });
  }, [fileInfo, reducedMotion]);

  // A rejected file: the picker may have been opened from the sticky button at the bottom of a
  // long page, and the message lives in the drop zone at the top — bring it into view.
  useEffect(() => {
    if (!fileError) return;
    document.getElementById('upload-zone')?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [fileError, reducedMotion]);

  const handleFile = useCallback(
    async (file: File) => {
      // A screenshot or a PNG has no sensor noise to weaken and nothing to re-encode for: the
      // defaults take the lossless path (container rewritten, pixels kept), the same as «Только
      // метаданные». PRNU on a screenshot only added noise to interface pixels.
      const screenLikeFile = isScreenLikeFile(file.name, file.type, lang);
      setPrnuCleanup(!screenLikeFile);
      setBlurFaces(false);
      setBlurStrength(blurDefault);
      setNotice(null);
      setQualityMode(screenLikeFile ? 'original' : 'medium');
      setRenameFile(true);
      setManualMasks([]);
      setManualMaskMode(false);
      setAntiSearchEnabled(false);
      setAntiSearchLevel(2);
      setWatermarkEnabled(false);
      setWatermarkText('');
      setBlurText(false);
      setBlurPlates(false);
      setBlurQr(false);
      setBlurDocuments(false);
      setMirrorEnabled(false);
      setDownscaleMax(0);
      setOutputFormat('original');
      await processFile(file);
    },
    [processFile, lang]
  );

  // Only the inputs a switched-on option reads may re-run the pipeline: OCR, plates, QR codes and
  // document boxes arrive at different moments, and each used to cost a full preview (a per-pixel
  // PRNU pass, an encode, four sample windows) whether or not anything read them.
  const facesToBlur = useMemo(() => (blurFaces ? blurCandidates : NO_BOXES), [blurFaces, blurCandidates]);
  const textToBlur = useMemo(() => (blurText ? ocrResult : null), [blurText, ocrResult]);
  const platesToBlur = useMemo(() => (blurPlates ? plateCandidates : NO_BOXES), [blurPlates, plateCandidates]);
  const qrToBlur = useMemo(() => (blurQr ? qrCodes : NO_BOXES), [blurQr, qrCodes]);
  const documentsToBlur = useMemo(() => (blurDocuments ? documentBoxes : NO_BOXES), [blurDocuments, documentBoxes]);

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

      const scaledDetections = facesToBlur.map((det) => ({
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

      if (scaledDetections.length > 0) {
        blurDetections(ctx, baseCanvas, scaledDetections, blurStrength);
      }

      if (textToBlur && textToBlur.regions.length > 0) {
        blurOcrRegions(ctx, baseCanvas, textToBlur.regions, blurStrength, scale);
      }

      if (platesToBlur.length > 0) {
        blurPlateRegions(ctx, baseCanvas, platesToBlur, blurStrength, scale);
      }

      if (qrToBlur.length > 0) {
        // A QR box is blurred like a text region: the same padding, the same strength.
        blurBoxes(ctx, baseCanvas, qrToBlur, blurStrength, scale);
      }

      if (documentsToBlur.length > 0) {
        blurBoxes(ctx, baseCanvas, documentsToBlur, blurStrength, scale);
      }

      if (scaledMasks.length > 0) {
        blurManualMasks(ctx, baseCanvas, scaledMasks, blurStrength);
      }

      let workingCanvas = baseCanvas;

      if (prnuCleanup) {
        workingCanvas = applyPrnuCleanup(workingCanvas);
      }

      if (antiSearchEnabled && antiSearchParams) {
        const settled = measuredAntiSearchRef.current;
        if (!options?.maxDimension && settled && settled.seed === antiSearchParams.noiseSeed) {
          // Export: the preview already found the strength that meets the target; apply it once.
          workingCanvas = applyAntiSearch(workingCanvas, settled.params);
        } else {
          // Preview: measured against the perceptual hash of the frame, the field and crop grow
          // until the level's target is met; the result is kept for the export.
          const measured = applyAntiSearchMeasured(workingCanvas, antiSearchParams, antiSearchTargetBits(antiSearchLevel));
          workingCanvas = measured.canvas;
          measuredAntiSearchRef.current = { seed: antiSearchParams.noiseSeed, params: measured.params };
          setAntiSearchDistance(measured.distance);
        }
      } else {
        setAntiSearchDistance(null);
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
      facesToBlur,
      textToBlur,
      platesToBlur,
      qrToBlur,
      documentsToBlur,
      blurStrength,
      manualMasks,
      antiSearchEnabled,
      antiSearchParams,
      antiSearchLevel,
      reduceColor,
      mirrorEnabled,
      downscaleMax,
      watermark,
      watermarkText,
      prnuCleanup,
      t
    ]
  );

  /**
   * Runs the pipeline and returns the verified clean file. Shared by download and share. It
   * changes no state of its own: the caller checks that the photo it started for is still the
   * one on the page before applying `verify` and `platformCapped` — an export of A that finished
   * after B was loaded used to stamp A's «было N полей, осталось 0» under B's preview.
   */
  const exportCleanFile = useCallback(async (): Promise<CleanExport> => {
    if (!fileInfo) {
      throw new Error('no-file');
    }
    if (import.meta.env.DEV) {
      console.info('[pipeline] export:start', { mime: fileInfo.mimeType, qualityMode, outputFormat, losslessExport });
    }
    const { requested, mime: exportMime } = resolveExportMime(outputFormat, fileInfo.mimeType);
    let blob: Blob | null = null;
    let platformCapped = false;
    if (losslessExport) {
      // The original bytes, minus every metadata segment and whatever follows the end of the image.
      // The container is read from the bytes: a file whose extension lies about its format takes
      // the re-encode path below rather than leaving with its metadata intact.
      const source = fileInfo.originalFile ?? fileInfo.file;
      const bytes = await source.arrayBuffer();
      const container = sniffContainer(new Uint8Array(bytes));
      if (container) blob = await stripContainerMetadata(new Blob([bytes], { type: container }));
    }
    if (!blob) {
      const result = await createProcessedCanvas();
      if (!result) {
        throw new Error('no-canvas');
      }
      const { canvas } = result;
      platformCapped = result.platformCapped;
      const quality = exportMime === 'image/png' ? undefined : qualityForMode(qualityMode, sourceQuality);
      const encodedBlob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((encoded) => {
          if (encoded) resolve(encoded);
          else reject(new Error('export-failed'));
        }, exportMime, quality);
      });
      // The browser's encoder adds container metadata of its own (Chrome: an sRGB ICC
      // profile in APP2 / iCCP). Harmless, but "0 fields left" must be literally true.
      blob = await stripContainerMetadata(encodedBlob);
    }
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
    const verify: VerifyResult = {
      before: metadataFieldCount,
      after: remaining,
      phashDistance,
      trailingBytesBefore: metadata?.samsung?.bytes ?? 0,
      thumbnailBytesBefore: metadata?.thumbnail?.bytes ?? 0,
      leakBefore: digitalProfile?.leakScore ?? null,
      leakAfter,
      antiSearchApplied: antiSearchEnabled
    };
    if (import.meta.env.DEV) {
      console.info('[pipeline] export:done', { mime: actualMime, remaining, phashDistance });
    }
    return { file: new File([blob], fileName, { type: actualMime }), requested, actualMime, verify, platformCapped };
  }, [
    fileInfo,
    createProcessedCanvas,
    losslessExport,
    qualityMode,
    sourceQuality,
    renameFile,
    outputFormat,
    metadataFieldCount,
    proData?.hash?.phash,
    metadata?.samsung?.bytes,
    metadata?.thumbnail?.bytes,
    digitalProfile?.leakScore,
    leakAfter,
    antiSearchEnabled
  ]);

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
    const startedFor = fileInfo;
    setProcessing(true);
    setNotice(null);
    try {
      const { file, requested, actualMime, verify, platformCapped: capped } = await exportCleanFile();
      triggerDownload(file);
      // The photo changed while this ran: the file is what was asked for, the state under B's preview is not.
      if (latestFileRef.current !== startedFor) return;
      setVerifyResult(verify);
      setPlatformCapped(capped);
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
  // The token's identity is the point: a new object whenever any of these changes, and nothing
  // else reads it, which is why the dependency list is longer than the body uses.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shareToken = useMemo<ShareToken>(() => ({}), [createProcessedCanvas, outputFormat, qualityMode, renameFile]);
  const shareReady = shareEntry && shareEntry.token === shareToken ? shareEntry.file : null;
  const setShareReady = useCallback((file: File | null) => setShareEntry(file ? { file, token: shareToken } : null), [shareToken]);

  const handleShare = useCallback(async () => {
    if (!fileInfo) {
      return;
    }
    setNotice(null);
    let file = shareReady;
    if (!file) {
      const startedFor = fileInfo;
      setProcessing(true);
      try {
        const exported = await exportCleanFile();
        file = exported.file;
        if (latestFileRef.current !== startedFor) return;
        setVerifyResult(exported.verify);
        setPlatformCapped(exported.platformCapped);
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

  /**
   * Bytes per pixel measured where they will apply: `SIZE_SAMPLE_GRID`² windows of the picture,
   * drawn straight from the source at the scale the export will use and encoded with the export
   * settings. The cleanup ops are not applied to the windows — a blurred face costs a little
   * less, the anti-search noise a little more, both far below the error this replaces
   * (see `utils/sizeEstimate.ts`). Returns null when it cannot sample; the caller falls back.
   */
  const sampledExportSize = useCallback(
    async (
      finalWidth: number,
      finalHeight: number,
      exportScale: number,
      mime: string,
      quality: number | undefined
    ): Promise<number | null> => {
      if (!fileInfo || exportScale <= 0) return null;
      const side = Math.min(SIZE_SAMPLE_SIDE, finalWidth, finalHeight);
      if (side < 64) return null;
      const sourceSide = Math.min(fileInfo.width, fileInfo.height, Math.max(1, Math.round(side / exportScale)));
      const image = await getSourceImage(fileInfo);
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const windows = sampleWindows(fileInfo.width, fileInfo.height, sourceSide, SIZE_SAMPLE_GRID);
      let bytes = 0;
      for (const { sx, sy } of windows) {
        ctx.drawImage(image, sx, sy, sourceSide, sourceSide, 0, 0, side, side);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
        if (!blob) return null;
        bytes += blob.size;
      }
      return extrapolateSize(bytes, windows.length * side * side, finalWidth * finalHeight);
    },
    [fileInfo, getSourceImage]
  );

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
    const quality = mime === 'image/png' ? undefined : qualityForMode(qualityMode, sourceQuality);

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
            replacePreviewUrl(URL.createObjectURL(blob));
            if (losslessExport) {
              // «Только метаданные» keeps the original bytes: the export is the source's own size
              // whatever the platform cap says, and its byte count is the stripped container's,
              // not the re-encode's. The summary used to promise a downscale that never happened.
              setPreviewDimensions({ width: fileInfo.width, height: fileInfo.height });
              setPlatformCapped(false);
              setPreviewLoading(false);
              losslessSize(fileInfo)
                .then((size) => {
                  if (!cancelled) setEstimatedSize(size);
                })
                .catch((err: unknown) => {
                  console.warn('lossless-size', err);
                  if (!cancelled) setEstimatedSize(fileInfo.sizeBytes);
                });
              return;
            }
            setPreviewDimensions({ width: finalWidth, height: finalHeight });
            setPlatformCapped(result.platformCapped);
            setPreviewLoading(false);
            if (ratio <= 1.001) {
              // The preview is the export: its own size is the answer, nothing to extrapolate.
              setEstimatedSize(blob.size);
              return;
            }
            const areaFallback = Math.round(blob.size * ratio * ratio);
            // Put the rough figure up at once. The four sample windows take a moment to encode,
            // and until they answered the row kept showing the number from the previous quality.
            setEstimatedSize(areaFallback);
            sampledExportSize(finalWidth, finalHeight, exportScale, mime, quality)
              .then((size) => {
                if (!cancelled) setEstimatedSize(size ?? areaFallback);
              })
              .catch((err: unknown) => {
                console.warn('size-estimate', err);
                if (!cancelled) setEstimatedSize(areaFallback);
              });
          }, mime, quality);
        })
        .catch(fail);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
    };
  }, [fileInfo, createProcessedCanvas, qualityMode, sourceQuality, outputFormat, losslessExport, replacePreviewUrl, sampledExportSize, t]);

  const handleManualMaskAdd = useCallback((mask: Omit<ManualMask, 'id'>) => {
    setManualMasks((current) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      return [...current, { id, ...mask }];
    });
  }, []);

  const handleManualMaskRemove = useCallback((id: string) => {
    setManualMasks((current) => current.filter((mask) => mask.id !== id));
  }, []);

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
            <UploadZone
              loading={loading}
              onFile={handleFile}
              error={fileError ? t(FILE_ERROR_KEYS[fileError.code], fileError.params) : undefined}
              warning={fileWarning ? t(FILE_WARNING_KEYS[fileWarning]) : undefined}
              pickerRef={pickerRef}
            />
          </section>

          {fileInfo ? (
            <ErrorBoundary variant="inline" resetKey={fileInfo} labels={inlineErrorLabels}>
              <SceneBlock
                fileInfo={fileInfo}
                detections={detections}
                sceneDescription={sceneDescription}
                focalLength35mm={metadata?.focalLength35mm}
                detectionProgress={
                  analysisLoading && detectionStatus
                    ? { label: t(DETECTION_STAGE_KEYS[detectionStatus.stage]), value: detectionStatus.progress }
                    : null
                }
              />
            </ErrorBoundary>
          ) : null}

          {fileInfo ? (
            <ErrorBoundary variant="inline" resetKey={fileInfo} labels={inlineErrorLabels}>
              <StoryBlock
                fileInfo={fileInfo}
                metadata={metadata}
                profile={digitalProfile}
                proData={proData}
                jpeg={jpeg}
                frame={frame}
                detections={detections}
                ocrResult={ocrResult}
                ocrLoading={ocrLoading}
                ocrError={ocrError ? t(OCR_ERROR_KEYS[ocrError]) : null}
                ocrProgressLabel={ocrProgress ? t(OCR_STAGE_KEYS[ocrProgress.stage]) : null}
                credentials={credentials}
                qrCodes={qrCodes}
                pii={piiFindings}
              />
            </ErrorBoundary>
          ) : null}

          {fileInfo ? (
            <ErrorBoundary variant="inline" resetKey={fileInfo} labels={inlineErrorLabels}>
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
                qrCount={qrCodes.length}
                blurQr={blurQr}
                setBlurQr={setBlurQr}
                documentCount={documentBoxes.length}
                blurDocuments={blurDocuments}
                setBlurDocuments={setBlurDocuments}
                shareSupported={shareSupported}
                shareReady={shareReady !== null}
                onShare={handleShare}
                onClean={handleDownload}
                processing={processing}
                previewDataUrl={previewDataUrl}
                previewLoading={previewLoading}
                estimatedSize={estimatedSize}
                blurTargetCount={blurTargetCount}
                ocrPending={ocrLoading}
                qrPending={qrLoading}
                losslessExport={losslessExport}
                sourceQuality={sourceQuality}
                leakBefore={digitalProfile?.leakScore ?? null}
                leakAfter={leakAfter}
                antiSearchDistance={antiSearchDistance}
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
          <SiteContent />
          <VerifyBlock />
        </main>
        <StickyActions photoLoaded={Boolean(fileInfo)} onNewPhoto={() => pickerRef.current?.()} />
        <SiteFooter />
      </div>
    </>
  );
};

export default App;
