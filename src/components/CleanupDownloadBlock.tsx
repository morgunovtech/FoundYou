import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BasicFileInfo } from '../types/metadata';
import type { CleanupPreviewDimensions, ManualMask, OutputFormat, QualityMode, VerifyResult } from '../types/cleanup';
import { useT } from '../i18n';
import { formatBytesPrecise } from '../utils/format';
import { buildCleanupSummary } from '../utils/cleanupSummary';
import { canvasBlurMode } from '../utils/cleanup';
import { SectionHead } from './SectionHead';

interface CleanupDownloadBlockProps {
  fileInfo: BasicFileInfo | null;
  /** Sensor-noise (PRNU) softening. Metadata is always stripped by the canvas re-encode. */
  prnuCleanup: boolean;
  blurFaces: boolean;
  blurStrength: number;
  qualityMode: QualityMode;
  renameFile: boolean;
  manualMaskMode: boolean;
  manualMasks: ManualMask[];
  antiSearchEnabled: boolean;
  antiSearchLevel: number;
  watermarkEnabled: boolean;
  previewDimensions: CleanupPreviewDimensions | null;
  setPrnuCleanup: (value: boolean) => void;
  setBlurFaces: (value: boolean) => void;
  setBlurStrength: (value: number) => void;
  setQualityMode: (mode: QualityMode) => void;
  setRenameFile: (value: boolean) => void;
  setManualMaskMode: (value: boolean) => void;
  onManualMaskAdd: (mask: Omit<ManualMask, 'id'>) => void;
  onManualMaskRemove: (id: string) => void;
  setAntiSearchEnabled: (value: boolean) => void;
  setAntiSearchLevel: (value: number) => void;
  setWatermarkEnabled: (value: boolean) => void;
  watermarkText: string;
  setWatermarkText: (value: string) => void;
  blurText: boolean;
  setBlurText: (value: boolean) => void;
  mirrorEnabled: boolean;
  setMirrorEnabled: (value: boolean) => void;
  downscaleMax: number;
  setDownscaleMax: (value: number) => void;
  outputFormat: OutputFormat;
  setOutputFormat: (value: OutputFormat) => void;
  ocrRegionCount: number;
  onClean: () => Promise<void>;
  processing: boolean;
  previewDataUrl: string | null;
  previewLoading: boolean;
  /** Approximate output size, extrapolated from the preview encode. */
  estimatedSize: number | null;
  /** Number of regions "hide faces" will blur: detected faces plus head-area fallbacks for people without a face. */
  blurTargetCount: number;
  originalPreviewUrl: string | null;
  /** True when the platform canvas limit reduced the export below the chosen resolution. */
  platformCapped?: boolean;
  platformCapMegapixels?: number;
  /** Post-export re-parse of the downloaded file. */
  verifyResult?: VerifyResult | null;
  /** True when the person detector could not run on this device; disables the people toggle. */
  detectionUnavailable?: boolean;
}

const BRUSH_RADIUS = 18;
const MIN_POINT_DISTANCE = 4;

const QUALITY_PERCENT: Record<QualityMode, number> = {
  low: Math.round(0.82 * 100),
  medium: Math.round(0.9 * 100),
  original: Math.round(0.98 * 100)
};

/** Design-system colour token as rgba() for canvas strokes; falls back to the light-theme value. */
function tokenRgba(name: string, alpha: number, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const match = /^#([0-9a-f]{6})$/i.exec(raw);
  if (!match) return fallback;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const CleanupDownloadBlockInner: React.FC<CleanupDownloadBlockProps> = ({
  fileInfo,
  prnuCleanup,
  blurFaces,
  blurStrength,
  qualityMode,
  renameFile,
  manualMaskMode,
  manualMasks,
  antiSearchEnabled,
  antiSearchLevel,
  watermarkEnabled,
  previewDimensions,
  setPrnuCleanup,
  setBlurFaces,
  setBlurStrength,
  setQualityMode,
  setRenameFile,
  setManualMaskMode,
  onManualMaskAdd,
  onManualMaskRemove,
  setAntiSearchEnabled,
  setAntiSearchLevel,
  setWatermarkEnabled,
  watermarkText,
  setWatermarkText,
  blurText,
  setBlurText,
  mirrorEnabled,
  setMirrorEnabled,
  downscaleMax,
  setDownscaleMax,
  outputFormat,
  setOutputFormat,
  ocrRegionCount,
  onClean,
  processing,
  previewDataUrl,
  previewLoading,
  estimatedSize,
  blurTargetCount,
  originalPreviewUrl,
  platformCapped = false,
  platformCapMegapixels,
  verifyResult = null,
  detectionUnavailable = false
}) => {
  const t = useT();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [draftStroke, setDraftStroke] = useState<ManualMask | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [overlayRedrawKey, setOverlayRedrawKey] = useState(0);
  const blurMode = useMemo(() => canvasBlurMode(), []);

  const estimatedLabel = useMemo(() => {
    if (estimatedSize != null) {
      return formatBytesPrecise(estimatedSize);
    }
    if (fileInfo) {
      return formatBytesPrecise(fileInfo.originalSizeBytes ?? fileInfo.sizeBytes);
    }
    return t('emptyValue');
  }, [estimatedSize, fileInfo, t]);

  const finalDimensions = useMemo(() => {
    if (previewDimensions) {
      return previewDimensions;
    }
    if (fileInfo) {
      return { width: fileInfo.width, height: fileInfo.height };
    }
    return null;
  }, [previewDimensions, fileInfo]);

  const resolutionSummary = useMemo(() => {
    if (!fileInfo || !finalDimensions) {
      return t('emptyValue');
    }
    const before = `${fileInfo.width}×${fileInfo.height}`;
    const after = `${finalDimensions.width}×${finalDimensions.height}`;
    if (fileInfo.width === finalDimensions.width && fileInfo.height === finalDimensions.height) {
      return t('privacyDiffResolutionSame', { value: before });
    }
    return t('privacyDiffResolutionChanged', { before, after });
  }, [fileInfo, finalDimensions, t]);

  const blurSummary = useMemo(() => {
    if (manualMasks.length > 0) {
      return t('privacyDiffBlurManual', { count: manualMasks.length });
    }
    if (blurFaces && blurTargetCount > 0) {
      return t('privacyDiffBlurFaces', { count: blurTargetCount });
    }
    if (blurFaces) {
      return t('privacyDiffBlurFacesNoDetections');
    }
    return t('privacyDiffBlurNone');
  }, [blurFaces, manualMasks.length, blurTargetCount, t]);

  const renameSummary = useMemo(() => {
    if (!fileInfo) return t('privacyDiffRenameOff', { name: t('emptyValue') });
    const extension = fileInfo.mimeType.includes('png') ? 'png' : fileInfo.mimeType.includes('webp') ? 'webp' : 'jpg';
    const baseName = (fileInfo.originalName ?? fileInfo.file.name).replace(/\.[^/.]+$/, '');
    if (renameFile) {
      return t('privacyDiffRenameOn', { name: `photo-xxxxxx.${extension}` });
    }
    return t('privacyDiffRenameOff', { name: `${baseName}.${extension}` });
  }, [fileInfo, renameFile, t]);

  const blurActive = (blurFaces && blurTargetCount > 0) || (blurText && ocrRegionCount > 0) || manualMasks.length > 0;

  const summaryItems = useMemo(
    () =>
      buildCleanupSummary({
        prnuCleanup,
        resolutionSummary,
        blurSummary,
        blurActive,
        blurMode,
        platformCapped,
        platformCapMegapixels,
        antiSearchEnabled,
        antiSearchLevel,
        renameSummary,
        watermarkEnabled,
        qualityMode,
        qualityPercent: QUALITY_PERCENT[qualityMode],
        t
      }),
    [
      antiSearchEnabled,
      antiSearchLevel,
      blurActive,
      blurMode,
      blurSummary,
      platformCapMegapixels,
      platformCapped,
      prnuCleanup,
      qualityMode,
      renameSummary,
      resolutionSummary,
      t,
      watermarkEnabled
    ]
  );

  const handleApplyAll = useCallback(() => {
    setPrnuCleanup(true);
    setRenameFile(true);
    if (!detectionUnavailable) setBlurFaces(true);
    setBlurText(true);
    setManualMaskMode(true);
    setAntiSearchEnabled(true);
    setAntiSearchLevel(3);
    setWatermarkEnabled(true);
    setMirrorEnabled(false); // mirror is destructive, not in "apply all"
    setDownscaleMax(1920);
  }, [
    detectionUnavailable,
    setAntiSearchEnabled,
    setAntiSearchLevel,
    setBlurFaces,
    setBlurText,
    setDownscaleMax,
    setManualMaskMode,
    setMirrorEnabled,
    setPrnuCleanup,
    setRenameFile,
    setWatermarkEnabled
  ]);

  const toImagePoint = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!fileInfo || !overlayRef.current) return null;
      const rect = overlayRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const x = ((event.clientX - rect.left) / rect.width) * fileInfo.width;
      const y = ((event.clientY - rect.top) / rect.height) * fileInfo.height;
      return { x, y };
    },
    [fileInfo]
  );

  const mapStrokeToOverlay = useCallback(
    (mask: ManualMask) => {
      if (!fileInfo || !overlayRef.current) return null;
      const rect = overlayRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const scaleX = rect.width / fileInfo.width;
      const scaleY = rect.height / fileInfo.height;
      return {
        points: mask.points.map((pt) => ({ x: pt.x * scaleX, y: pt.y * scaleY })),
        radius: mask.radius * ((scaleX + scaleY) / 2)
      };
    },
    [fileInfo]
  );

  const getBrushRadius = useCallback(() => {
    if (!fileInfo) return BRUSH_RADIUS;
    const base = Math.min(fileInfo.width, fileInfo.height) * 0.012;
    return Math.max(12, base);
  }, [fileInfo]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!manualMaskMode || !fileInfo || !overlayRef.current) {
        return;
      }
      const imagePoint = toImagePoint(event);
      if (!imagePoint) return;
      overlayRef.current.setPointerCapture(event.pointerId);
      setDraftStroke({ id: 'draft', points: [imagePoint], radius: getBrushRadius() });
      lastPointRef.current = imagePoint;
      event.preventDefault();
    },
    [fileInfo, getBrushRadius, manualMaskMode, toImagePoint]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!manualMaskMode || !draftStroke) {
        return;
      }
      const nextPoint = toImagePoint(event);
      if (!nextPoint) return;
      const lastPoint = lastPointRef.current ?? draftStroke.points[draftStroke.points.length - 1];
      const dx = nextPoint.x - lastPoint.x;
      const dy = nextPoint.y - lastPoint.y;
      if (Math.hypot(dx, dy) < MIN_POINT_DISTANCE) {
        return;
      }
      lastPointRef.current = nextPoint;
      setDraftStroke((prev) => (prev ? { ...prev, points: [...prev.points, nextPoint] } : prev));
      event.preventDefault();
    },
    [draftStroke, manualMaskMode, toImagePoint]
  );

  const finalizeMask = useCallback(() => {
    if (!draftStroke || draftStroke.points.length < 2) {
      setDraftStroke(null);
      lastPointRef.current = null;
      return;
    }
    onManualMaskAdd(draftStroke);
    setDraftStroke(null);
    lastPointRef.current = null;
  }, [draftStroke, onManualMaskAdd]);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (overlayRef.current) {
        overlayRef.current.releasePointerCapture(event.pointerId);
      }
      finalizeMask();
      event.preventDefault();
    },
    [finalizeMask]
  );

  const handlePointerLeave = useCallback(() => {
    finalizeMask();
  }, [finalizeMask]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setOverlayRedrawKey((value) => value + 1), 150);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const container = overlayRef.current;
    if (!canvas || !container || !fileInfo) return;
    const { width, height } = container.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    const drawStroke = (mask: ManualMask, color: string) => {
      const mapped = mapStrokeToOverlay(mask);
      if (!mapped || mapped.points.length < 2) return;
      ctx.save();
      ctx.lineWidth = Math.max(mapped.radius, 6);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(mapped.points[0].x, mapped.points[0].y);
      for (let i = 1; i < mapped.points.length; i += 1) {
        const pt = mapped.points[i];
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    // Committed masks in ink, the stroke being drawn in the brand accent.
    const inkColor = tokenRgba('--v4-fg', 0.9, 'rgba(20, 17, 13, 0.9)');
    const accent = tokenRgba('--v4-orange', 1, 'rgba(217, 83, 30, 1)');
    manualMasks.forEach((mask) => drawStroke(mask, inkColor));
    if (draftStroke) {
      drawStroke(draftStroke, accent);
    }
  }, [draftStroke, fileInfo, manualMasks, mapStrokeToOverlay, overlayRedrawKey, previewDataUrl]);

  const showBlurStrength = blurFaces || blurText || manualMaskMode;

  const verifyMessage = useMemo(() => {
    if (!verifyResult) return null;
    if (verifyResult.after == null) {
      return { tone: 'neutral' as const, text: t('verifyUnavailable', { before: verifyResult.before }) };
    }
    if (verifyResult.after > 0) {
      return {
        tone: 'negative' as const,
        text: t('verifyResultWarning', { before: verifyResult.before, after: verifyResult.after })
      };
    }
    return { tone: 'positive' as const, text: t('verifyResult', { before: verifyResult.before }) };
  }, [t, verifyResult]);

  return (
    <section className="v4-section" aria-labelledby="sec-cleanup">
      <SectionHead num="05" title={t('cleanupTitle')} id="sec-cleanup">
        <button type="button" className="v4-btn fy-btn-sm" onClick={handleApplyAll}>
          {t('cleanupApplyAll')}
        </button>
      </SectionHead>
      <p className="fy-section-lead">{t('cleanupHint')}</p>

      <div className="fy-cleanup">
        <div className="fy-grid-cards">
          {/* Card 1: quality, resolution, format */}
          <div className="fy-card">
            <h3 className="v4-h3">{t('outputGroupTitle')}</h3>
            <div className="fy-field">
              <label className="fy-field-label" htmlFor="cleanup-quality">
                {t('qualityLabel')}
              </label>
              <select
                id="cleanup-quality"
                className="fy-select"
                value={qualityMode}
                onChange={(event) => setQualityMode(event.target.value as QualityMode)}
              >
                <option value="low">{t('qualityMode_low')}</option>
                <option value="medium">{t('qualityMode_medium')}</option>
                <option value="original">{t('qualityMode_original')}</option>
              </select>
            </div>
            <div className="fy-field">
              <label className="fy-field-label" htmlFor="cleanup-resolution">
                {t('resolutionLabel')}
              </label>
              <select
                id="cleanup-resolution"
                className="fy-select"
                value={downscaleMax}
                onChange={(event) => setDownscaleMax(Number(event.target.value))}
              >
                <option value={0}>{t('resolutionOriginal')}</option>
                <option value={1280}>{t('resolutionMessenger')}</option>
                <option value={1920}>{t('resolutionSocial')}</option>
                <option value={2560}>{t('resolutionModerate')}</option>
              </select>
            </div>
            <div className="fy-field">
              <label className="fy-field-label" htmlFor="cleanup-format">
                {t('formatLabel')}
              </label>
              <select
                id="cleanup-format"
                className="fy-select"
                value={outputFormat}
                onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}
              >
                <option value="original">{t('formatOriginal')}</option>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
              </select>
            </div>
            <span className="fy-field-meta">
              {t('qualityPercentLabel', { percent: QUALITY_PERCENT[qualityMode], size: estimatedLabel })}
            </span>
          </div>

          {/* Card 2: metadata */}
          <div className="fy-card">
            <h3 className="v4-h3">{t('metadataGroupTitle')}</h3>
            <p className="fy-hint">{t('metadataAlwaysRemoved')}</p>
            <label className="fy-check">
              <input type="checkbox" checked={prnuCleanup} onChange={(event) => setPrnuCleanup(event.target.checked)} />
              <span>{t('prnuToggle')}</span>
            </label>
            <label className="fy-check">
              <input type="checkbox" checked={renameFile} onChange={(event) => setRenameFile(event.target.checked)} />
              <span>{t('renameCheckbox')}</span>
            </label>
            <label className="fy-check">
              <input type="checkbox" checked={watermarkEnabled} onChange={(event) => setWatermarkEnabled(event.target.checked)} />
              <span>{t('watermarkToggle')}</span>
            </label>
            {watermarkEnabled ? (
              <input
                type="text"
                className="fy-input"
                aria-label={t('watermarkText')}
                placeholder={t('watermarkText')}
                value={watermarkText}
                onChange={(event) => setWatermarkText(event.target.value)}
              />
            ) : null}
          </div>

          {/* Card 3: hide people, text, manual masks */}
          <div className="fy-card">
            <h3 className="v4-h3">{t('hideGroupTitle')}</h3>
            <label className="fy-check">
              <input
                type="checkbox"
                checked={blurFaces && !detectionUnavailable}
                disabled={detectionUnavailable}
                onChange={(event) => setBlurFaces(event.target.checked)}
              />
              <span>{t('blurFaces')}</span>
            </label>
            {detectionUnavailable ? <p className="fy-hint">{t('detectionUnavailableHint')}</p> : null}
            <label className="fy-check">
              <input type="checkbox" checked={blurText} onChange={(event) => setBlurText(event.target.checked)} />
              <span>{t('textWithCount', { count: ocrRegionCount })}</span>
            </label>
            <label className="fy-check">
              <input type="checkbox" checked={manualMaskMode} onChange={(event) => setManualMaskMode(event.target.checked)} />
              <span>{t('manualMaskToggle')}</span>
            </label>
            {showBlurStrength ? (
              <div className="fy-field">
                <label className="fy-field-label" htmlFor="blur-strength">
                  {t('blurStrengthLabel')}
                </label>
                <input
                  id="blur-strength"
                  className="fy-range"
                  type="range"
                  min="8"
                  max="64"
                  step="1"
                  value={blurStrength}
                  onChange={(event) => setBlurStrength(Number(event.target.value))}
                />
                <span className="fy-field-meta">{t('blurStrengthValue', { value: Math.round(blurStrength) })}</span>
              </div>
            ) : null}
          </div>

          {/* Card 4: anti-search protection */}
          <div className="fy-card">
            <h3 className="v4-h3">{t('searchProtectionTitle')}</h3>
            <label className="fy-check">
              <input type="checkbox" checked={antiSearchEnabled} onChange={(event) => setAntiSearchEnabled(event.target.checked)} />
              <span>{t('antiSearchLabel')}</span>
            </label>
            {antiSearchEnabled ? (
              <div className="fy-field">
                <label className="fy-field-label" htmlFor="anti-search-level">
                  {t('antiSearchLevelLabel')}
                </label>
                <input
                  id="anti-search-level"
                  className="fy-range"
                  type="range"
                  min="1"
                  max="3"
                  step="1"
                  value={antiSearchLevel}
                  onChange={(event) => setAntiSearchLevel(Number(event.target.value))}
                />
                <span className="fy-field-meta">{t('antiSearchLevelValue', { value: antiSearchLevel })}</span>
              </div>
            ) : null}
            <label className="fy-check">
              <input type="checkbox" checked={mirrorEnabled} onChange={(event) => setMirrorEnabled(event.target.checked)} />
              <span>{t('mirrorLabel')}</span>
            </label>
          </div>
        </div>

        {manualMaskMode ? <p className="fy-hint">{t('manualMaskDrawingHint')}</p> : null}
        <p className="fy-notice">{antiSearchEnabled ? t('antiSearchActiveHint') : t('antiSearchOffHint')}</p>

        <div className="fy-diff">
          <figure>
            <figcaption>{t('previewOriginal')}</figcaption>
            {originalPreviewUrl ? (
              <div className="fy-diff-frame">
                <img src={originalPreviewUrl} alt={t('previewOriginalAlt')} />
              </div>
            ) : (
              <p className="fy-notice">{t('cleanupPreviewUnavailable')}</p>
            )}
          </figure>
          <figure>
            <figcaption>{t('previewProcessed')}</figcaption>
            {/* The frame stays mounted while a new preview renders: unmounting it
                would drop pointer capture mid-stroke and lose the mask being drawn. */}
            {previewDataUrl ? (
              <div className="fy-diff-frame" aria-busy={previewLoading || undefined}>
                <img src={previewDataUrl} alt={t('cleanupPreviewAlt')} />
                <div
                  className={`fy-mask-overlay ${manualMaskMode ? 'is-drawing' : ''}`}
                  ref={overlayRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerLeave}
                  onPointerLeave={handlePointerLeave}
                  role={manualMaskMode ? 'img' : 'presentation'}
                  aria-label={manualMaskMode ? t('manualMaskDrawingHint') : undefined}
                  style={{ pointerEvents: manualMaskMode ? 'auto' : 'none' }}
                >
                  <canvas ref={overlayCanvasRef} />
                </div>
              </div>
            ) : (
              <p className="fy-notice">{previewLoading ? t('cleanupPreviewGenerating') : t('cleanupPreviewUnavailable')}</p>
            )}
            {previewDataUrl && previewLoading ? (
              <p className="fy-notice" role="status">
                {t('cleanupPreviewGenerating')}
              </p>
            ) : null}
          </figure>
          <div className="fy-card fy-summary">
            <h3 className="v4-h3">{t('privacyDiffTitle')}</h3>
            <ul className="v4-list">
              {summaryItems.map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
            <p className="fy-hint">{t('privacyDiffHint')}</p>
          </div>
        </div>

        {manualMasks.length > 0 ? (
          <div className="fy-card fy-masks">
            <h3 className="v4-h3">{t('manualMaskCount', { count: manualMasks.length })}</h3>
            <ul className="fy-rows">
              {manualMasks.map((mask, index) => (
                <li key={mask.id}>
                  <span>{t('manualMaskItem', { index: index + 1 })}</span>
                  <button type="button" className="v4-btn fy-btn-sm" onClick={() => onManualMaskRemove(mask.id)}>
                    {t('manualMaskRemove')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {blurFaces && !detectionUnavailable && blurTargetCount === 0 ? <p className="fy-notice">{t('facesMissing')}</p> : null}

        <div className="fy-actions">
          <button
            type="button"
            className="v4-btn v4-btn-primary"
            onClick={() => {
              void onClean();
            }}
            disabled={!fileInfo || processing}
          >
            {processing ? t('processing') : t('downloadClean')}
          </button>
          {!fileInfo ? <p className="fy-notice">{t('cleanUnavailable')}</p> : null}
        </div>
        {verifyMessage ? (
          <p
            className={`fy-notice fy-verify${
              verifyMessage.tone === 'positive'
                ? ' fy-notice--positive'
                : verifyMessage.tone === 'negative'
                  ? ' fy-notice--negative'
                  : ''
            }`}
            role="status"
          >
            {verifyMessage.text}
          </p>
        ) : null}
      </div>
    </section>
  );
};

export const CleanupDownloadBlock = React.memo(CleanupDownloadBlockInner);
CleanupDownloadBlock.displayName = 'CleanupDownloadBlock';
