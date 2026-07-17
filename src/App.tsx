import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { InfoBlock } from './components/InfoBlock';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { UploadZone } from './components/UploadZone';
import { useImageFile } from './hooks/useImageFile';
import { useExifMetadata } from './hooks/useExifMetadata';
import { PreviewViewer } from './components/PreviewViewer';
import { MetadataPanel } from './components/MetadataPanel';
import { ShockBlock } from './components/ShockBlock';
import { CleanupDownloadBlock } from './components/CleanupDownloadBlock';
import { useImageAnalysis } from './hooks/useImageAnalysis';
import type { ManualCoordinates } from './types/metadata';
import { useI18n, useT } from './i18n';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import type { AntiSearchParams, CleanupPreviewDimensions, ManualMask, QualityMode } from './types/cleanup';
import { qualityForMode } from './utils/quality';
import {
  applyAntiSearch,
  applyColorReduction,
  applyPrnuCleanup,
  applyWatermark,
  blurDetections,
  blurManualMasks,
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

// Лимит площади canvas: iOS Safari отдаёт null из toBlob (или пустой кадр)
// при площади больше ~16.7 МП; на остальных платформах ограничиваем 32 МП,
// чтобы попиксельные проходы (PRNU, анти-поиск) не убивали вкладку.
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const EXPORT_MAX_PIXELS = IS_IOS ? 16_000_000 : 32_000_000;

const RU_PLURAL_RANGE = { few: [2, 3, 4], many: [0, 5, 6, 7, 8, 9] };

function createAnonymisedName(extension: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `photo-${random}.${extension}`;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1];
  if (!base64) return 0;
  const padding = (base64.match(/=+$/)?.[0].length ?? 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

const App: React.FC = () => {
  const t = useT();
  const { lang } = useI18n();
  const { fileInfo, error, loading, processFile } = useImageFile();
  const { metadata } = useExifMetadata(fileInfo);
  const { loading: analysisLoading, error: analysisError, detectionStatus, detections, summary: analysisSummary } =
    useImageAnalysis(fileInfo);

  type NoticeState = { type: 'success' | 'error'; message: string };

  const [manualCoords, setManualCoords] = useState<ManualCoordinates | null>(null);
  const [removeMetadata, setRemoveMetadata] = useState(true);
  const [blurFaces, setBlurFaces] = useState(false);
  const [blurStrength, setBlurStrength] = useState(blurDefault);
  const [qualityMode, setQualityMode] = useState<QualityMode>('medium');
  const [renameFile, setRenameFile] = useState(false);
  const [manualMaskMode, setManualMaskMode] = useState(false);
  const [manualMasks, setManualMasks] = useState<ManualMask[]>([]);
  const [antiSearchEnabled, setAntiSearchEnabled] = useState(false);
  const [antiSearchLevel, setAntiSearchLevel] = useState(2);
  const [antiSearchParams, setAntiSearchParams] = useState<AntiSearchParams | null>(null);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [estimatedSize, setEstimatedSize] = useState<number | null>(null);
  const [previewDimensions, setPreviewDimensions] = useState<CleanupPreviewDimensions | null>(null);
  const decodedImageRef = React.useRef<{ url: string; image: HTMLImageElement } | null>(null);
  const reduceColor = antiSearchEnabled && antiSearchLevel === 3;
  const prnuCleanup = removeMetadata;
  const watermark = watermarkEnabled;

  const formatCountLabel = useCallback(
    (count: number, kind: 'person' | 'vehicle' | 'animal') => {
      const base =
        kind === 'person' ? 'nounPerson' : kind === 'vehicle' ? 'nounVehicle' : 'nounAnimal';
      if (lang === 'ru') {
        const mod10 = count % 10;
        const mod100 = count % 100;
        const form =
          mod10 === 1 && mod100 !== 11
            ? 'One'
            : RU_PLURAL_RANGE.few.includes(mod10) && ![12, 13, 14].includes(mod100)
            ? 'Few'
            : 'Many';
        return `${count} ${t(`${base}${form}` as const)}`;
      }
      if (lang === 'uz') {
        return `${count} ta ${t(`${base}One` as const)}`;
      }
      const form = count === 1 ? 'One' : 'Many';
      return `${count} ${t(`${base}${form}` as const)}`;
    },
    [lang, t]
  );

  const personDetections = useMemo(
    () => detections.filter((det) => det.label === 'person'),
    [detections]
  );

  useEffect(() => {
    if (antiSearchEnabled) {
      setAntiSearchParams(generateAntiSearchParams({ level: antiSearchLevel }));
    } else {
      setAntiSearchParams(null);
    }
  }, [antiSearchEnabled, antiSearchLevel]);

  const handleFile = useCallback(
    async (file: File) => {
      setManualCoords(null);
      setRemoveMetadata(true);
      setBlurFaces(false);
      setBlurStrength(blurDefault);
      setNotice(null);
      setQualityMode('medium');
      setEstimatedSize(null);
      setRenameFile(false);
      setManualMasks([]);
      setManualMaskMode(false);
      setAntiSearchEnabled(false);
      setAntiSearchParams(null);
      setAntiSearchLevel(2);
      setWatermarkEnabled(false);
      setPreviewDimensions(null);
      await processFile(file);
    },
    [processFile]
  );

  const createProcessedCanvas = useCallback(
    async (options?: { maxDimension?: number }) => {
      if (!fileInfo) return null;
      const longest = Math.max(fileInfo.width, fileInfo.height) || 1;
      const dimensionScale = options?.maxDimension ? Math.min(1, options.maxDimension / longest) : 1;
      const areaScale = Math.sqrt(EXPORT_MAX_PIXELS / Math.max(1, fileInfo.width * fileInfo.height));
      const targetScale = Math.min(1, dimensionScale, areaScale);
      const targetWidth = Math.max(1, Math.round(fileInfo.width * targetScale));
      const targetHeight = Math.max(1, Math.round(fileInfo.height * targetScale));

      // Кэш декодированного изображения: каждое движение слайдера перегенерирует
      // превью, и повторный decode полноразмерного фото занимал сотни мс.
      let image: HTMLImageElement;
      if (decodedImageRef.current && decodedImageRef.current.url === fileInfo.dataUrl) {
        image = decodedImageRef.current.image;
      } else {
        image = await loadImageElement(fileInfo.dataUrl);
        decodedImageRef.current = { url: fileInfo.dataUrl, image };
      }
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = targetWidth;
      baseCanvas.height = targetHeight;
      const ctx = baseCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('canvas');
      }
      ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

      const scaledDetections = personDetections.map((det) => ({
        ...det,
        x: det.x * targetScale,
        y: det.y * targetScale,
        width: det.width * targetScale,
        height: det.height * targetScale
      }));

      const scaledMasks = manualMasks.map((mask) => ({
        ...mask,
        points: mask.points.map((pt) => ({ x: pt.x * targetScale, y: pt.y * targetScale })),
        radius: mask.radius * targetScale
      }));

      if (blurFaces && scaledDetections.length > 0) {
        blurDetections(ctx, baseCanvas, scaledDetections, blurStrength);
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

      if (watermark) {
        workingCanvas = applyWatermark(workingCanvas, t('watermarkText'));
      }

      return workingCanvas;
    },
    [
      fileInfo,
      blurFaces,
      personDetections,
      blurStrength,
      manualMasks,
      antiSearchEnabled,
      antiSearchParams,
      reduceColor,
    watermark,
    prnuCleanup,
    t
  ]
  );

  const handleDownload = useCallback(async () => {
    if (!fileInfo) {
      return;
    }
    setProcessing(true);
    setNotice(null);
    try {
      if (import.meta.env.DEV) {
        console.info('[pipeline] export:start', { mime: fileInfo.mimeType, qualityMode });
      }
      const canvas = await createProcessedCanvas();
      if (!canvas) {
        throw new Error('no-canvas');
      }
      const mime = fileInfo.mimeType;
      const extension = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const exportType = mime === 'image/png' ? 'image/png' : mime === 'image/webp' ? 'image/webp' : 'image/jpeg';
      const exportQuality = exportType === 'image/png' ? undefined : qualityForMode(qualityMode);
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error('export-failed'));
          },
          exportType,
          exportQuality
        );
      });

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const baseName = (fileInfo.originalName ?? fileInfo.file.name).replace(/\.[^/.]+$/, '');
      const fallbackName = `${baseName}.cleaned.${extension}`;
      link.download = renameFile ? createAnonymisedName(extension) : fallbackName;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(link.href);
        document.body.removeChild(link);
      }, 2000);
      setNotice({ type: 'success', message: t('downloadReady') });
      if (import.meta.env.DEV) {
        console.info('[pipeline] export:done');
      }
    } catch (err) {
      console.error(err);
      setNotice({ type: 'error', message: t('cleanupFailed') });
    } finally {
      setProcessing(false);
    }
  }, [fileInfo, createProcessedCanvas, qualityMode, renameFile, t]);

  useEffect(() => {
    if (!fileInfo) {
      setPreviewDataUrl(null);
      setPreviewLoading(false);
      setEstimatedSize(null);
      setPreviewDimensions(null);
      decodedImageRef.current = null;
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    const longestSide = Math.max(fileInfo.width, fileInfo.height) || 1;
    const previewScale = Math.min(1, PREVIEW_MAX_DIMENSION / longestSide);
    // Debounce: перегенерация — это полный canvas-пайплайн (блюр + PRNU +
    // кодирование), а слайдеры шлют событие на каждый тик.
    const timer = window.setTimeout(() => {
      createProcessedCanvas({ maxDimension: PREVIEW_MAX_DIMENSION })
        .then((canvas) => {
          if (!canvas || cancelled) {
            return;
          }
          const mime = fileInfo.mimeType.includes('png') ? 'image/png' : 'image/jpeg';
          const quality = mime === 'image/jpeg' ? qualityForMode(qualityMode) : undefined;
          const dataUrl = canvas.toDataURL(mime, quality);
          if (!cancelled) {
            setPreviewDataUrl(dataUrl);
            setEstimatedSize(estimateDataUrlBytes(dataUrl));
            setPreviewDimensions({
              width: Math.round(canvas.width / previewScale),
              height: Math.round(canvas.height / previewScale)
            });
          }
        })
        .catch((err) => {
          console.error('cleanup-preview', err);
          if (!cancelled) {
            setPreviewDataUrl(null);
            setEstimatedSize(null);
            setPreviewDimensions(null);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setPreviewLoading(false);
          }
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fileInfo, qualityMode, createProcessedCanvas]);

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
    if (!analysisSummary) {
      if (analysisLoading) return t('sceneDescriptionLoading');
      if (analysisError) return t('sceneDescriptionUnavailable');
      return t('sceneDescriptionEmpty');
    }
    const segments: string[] = [];
    if (analysisSummary.people > 0) {
      segments.push(formatCountLabel(analysisSummary.people, 'person'));
    }
    if (analysisSummary.vehicles > 0) {
      segments.push(formatCountLabel(analysisSummary.vehicles, 'vehicle'));
    }
    if (analysisSummary.animals > 0) {
      segments.push(formatCountLabel(analysisSummary.animals, 'animal'));
    }
    if (segments.length === 0) {
      return t('sceneDescriptionEmpty');
    }
    return t('sceneDescriptionDetected', { items: segments.join('; ') });
  }, [analysisSummary, analysisLoading, analysisError, formatCountLabel, t]);

  return (
    <div className="app-shell">
      <header className="title-row">
        <div className="title-row__group">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <div className="intro-grid">
        <InfoBlock />
        <UploadZone loading={loading} onFile={handleFile} error={error ?? undefined} />
      </div>

      {fileInfo ? (
        <div className="grid-two-column">
          <div className="panel">
            <PreviewViewer
              fileInfo={fileInfo}
              detections={detections}
              sceneDescription={sceneDescription}
              progress={
                analysisLoading && detectionStatus
                  ? { label: t(detectionStatus.key), value: detectionStatus.progress }
                  : null
              }
            />
          </div>
          <MetadataPanel fileInfo={fileInfo} metadata={metadata} />
        </div>
      ) : null}

      {fileInfo ? (
        <ShockBlock
          metadata={metadata}
          manualCoords={manualCoords}
          onManualCoordsChange={setManualCoords}
        />
      ) : null}

      <CleanupDownloadBlock
        fileInfo={fileInfo}
        removeMetadata={removeMetadata}
        blurFaces={blurFaces}
        blurStrength={blurStrength}
        qualityMode={qualityMode}
        renameFile={renameFile}
        manualMaskMode={manualMaskMode}
        manualMasks={manualMasks}
        antiSearchEnabled={antiSearchEnabled}
        previewDimensions={previewDimensions}
        setRemoveMetadata={setRemoveMetadata}
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
        onClean={handleDownload}
        processing={processing}
        previewDataUrl={previewDataUrl}
        previewLoading={previewLoading}
        estimatedSize={estimatedSize}
        personDetections={personDetections}
        originalPreviewUrl={fileInfo?.thumbnailUrl ?? null}
      />
      {notice ? (
        <p className={`notice ${notice.type === 'success' ? 'notice--positive' : 'notice--negative'}`}>
          {notice.message}
        </p>
      ) : null}
    </div>
  );
};

export default App;
