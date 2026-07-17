import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoundingBox } from '../types/detection';
import type { BasicFileInfo } from '../types/metadata';
import type { CleanupPreviewDimensions, ManualMask, QualityMode } from '../types/cleanup';
import { useT } from '../i18n';
import { formatBytesPrecise } from '../utils/format';
import { buildCleanupSummary } from '../utils/cleanupSummary';
import { qualityPercent } from '../utils/quality';

interface CleanupDownloadBlockProps {
  fileInfo: BasicFileInfo | null;
  removeMetadata: boolean;
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
  setRemoveMetadata: (value: boolean) => void;
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
  onClean: () => Promise<void>;
  processing: boolean;
  previewDataUrl: string | null;
  previewLoading: boolean;
  estimatedSize: number | null;
  personDetections: BoundingBox[];
  originalPreviewUrl: string | null;
}

const BRUSH_RADIUS = 18;
const MIN_POINT_DISTANCE = 4;

export const CleanupDownloadBlock: React.FC<CleanupDownloadBlockProps> = ({
  fileInfo,
  removeMetadata,
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
  setRemoveMetadata,
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
  onClean,
  processing,
  previewDataUrl,
  previewLoading,
  estimatedSize,
  personDetections,
  originalPreviewUrl
}) => {
  const t = useT();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [draftStroke, setDraftStroke] = useState<ManualMask | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [overlayRedrawKey, setOverlayRedrawKey] = useState(0);

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

  const peopleCount = useMemo(
    () => personDetections.filter((det) => det.label === 'person').length,
    [personDetections]
  );

  const blurSummary = useMemo(() => {
    if (manualMasks.length > 0) {
      return t('privacyDiffBlurManual', { count: manualMasks.length });
    }
    if (blurFaces && peopleCount > 0) {
      return t('privacyDiffBlurFaces', { count: peopleCount });
    }
    if (blurFaces) {
      return t('privacyDiffBlurFacesNoDetections');
    }
    return t('privacyDiffBlurNone');
  }, [blurFaces, manualMasks.length, peopleCount, t]);

  const renameSummary = useMemo(() => {
    if (!fileInfo) return t('privacyDiffRenameOff', { name: t('emptyValue') });
    const extension = fileInfo.mimeType.includes('png') ? 'png' : fileInfo.mimeType.includes('webp') ? 'webp' : 'jpg';
    const baseName = (fileInfo.originalName ?? fileInfo.file.name).replace(/\.[^/.]+$/, '');
    if (renameFile) {
      return t('privacyDiffRenameOn', { name: `photo-xxxxxx.${extension}` });
    }
    return t('privacyDiffRenameOff', { name: `${baseName}.${extension}` });
  }, [fileInfo, renameFile, t]);

  const summaryItems = useMemo(
    () =>
      buildCleanupSummary({
        removeMetadata,
        resolutionSummary,
        blurSummary,
        antiSearchEnabled,
        antiSearchLevel,
        renameSummary,
        watermarkEnabled,
        qualityMode,
        qualityPercent: qualityPercent(qualityMode),
        t
      }),
    [
      antiSearchEnabled,
      antiSearchLevel,
      blurSummary,
      qualityMode,
      removeMetadata,
      renameSummary,
      resolutionSummary,
      t,
      watermarkEnabled
    ]
  );

  const handleAntiSearchToggle = useCallback(
    (checked: boolean) => {
      setAntiSearchEnabled(checked);
    },
    [setAntiSearchEnabled]
  );

  const handleApplyAll = useCallback(() => {
    setRemoveMetadata(true);
    setRenameFile(true);
    setBlurFaces(true);
    setManualMaskMode(true);
    setAntiSearchEnabled(true);
    setAntiSearchLevel(3);
    setWatermarkEnabled(true);
  }, [
    setAntiSearchEnabled,
    setAntiSearchLevel,
    setBlurFaces,
    setManualMaskMode,
    setRemoveMetadata,
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
      setDraftStroke((prev) =>
        prev ? { ...prev, points: [...prev.points, nextPoint] } : prev
      );
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
    const handleResize = () => setOverlayRedrawKey((value) => value + 1);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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

    manualMasks.forEach((mask) => drawStroke(mask, 'rgba(59, 130, 246, 0.45)'));
    if (draftStroke) {
      drawStroke(draftStroke, 'rgba(255, 99, 71, 0.6)');
    }
  }, [draftStroke, fileInfo, manualMasks, mapStrokeToOverlay, overlayRedrawKey]);

  return (
    <section className="panel cleanup-panel">
      <div className="cleanup-panel__header">
        <div className="cleanup-panel__title">
          <h2 className="section-title">{t('cleanupTitle')}</h2>
          <button type="button" className="button button--ghost" onClick={handleApplyAll}>
            {t('cleanupApplyAll')}
          </button>
        </div>
        <p className="cleanup-panel__hint">{t('cleanupHint')}</p>
      </div>

      <div className="cleanup-options cleanup-options--grid">
        <div className="cleanup-card cleanup-card--select">
          <label className="cleanup-select">
            <span>{t('qualityLabel')}</span>
            <select value={qualityMode} onChange={(event) => setQualityMode(event.target.value as QualityMode)}>
              <option value="low">{t('qualityMode_low')}</option>
              <option value="medium">{t('qualityMode_medium')}</option>
              <option value="original">{t('qualityMode_original')}</option>
            </select>
          </label>
          <p className="cleanup-select__helper">{t('qualityHelper')}</p>
          <span className="cleanup-select__meta">
            {t('qualityPercentLabel', { percent: qualityPercent(qualityMode), size: estimatedLabel })}
          </span>
        </div>
        <label className="cleanup-checkbox">
          <input
            type="checkbox"
            checked={removeMetadata}
            onChange={(event) => setRemoveMetadata(event.target.checked)}
          />
          <span>
            <strong>{t('removeMetadata')}</strong>
            <small>{t('removeMetadataHint')}</small>
          </span>
        </label>
        <label className="cleanup-checkbox">
          <input type="checkbox" checked={renameFile} onChange={(event) => setRenameFile(event.target.checked)} />
          <span>
            <strong>{t('renameCheckbox')}</strong>
            <small>{t('renameHint')}</small>
          </span>
        </label>
        <label className="cleanup-checkbox">
          <input type="checkbox" checked={blurFaces} onChange={(event) => setBlurFaces(event.target.checked)} />
          <span>
            <strong>{t('blurFaces')}</strong>
            <small>{t('blurFacesHint')}</small>
          </span>
          {blurFaces ? (
            <div className="cleanup-slider">
              <label htmlFor="blur-strength-faces">{t('blurStrengthLabel')}</label>
              <input
                id="blur-strength-faces"
                type="range"
                min="8"
                max="64"
                step="1"
                value={blurStrength}
                onChange={(event) => setBlurStrength(Number(event.target.value))}
              />
              <span className="cleanup-slider__meta">{t('blurStrengthValue', { value: Math.round(blurStrength) })}</span>
            </div>
          ) : null}
        </label>
        <label className={`cleanup-checkbox ${manualMaskMode ? 'is-active' : ''}`}>
          <input
            type="checkbox"
            checked={manualMaskMode}
            onChange={(event) => setManualMaskMode(event.target.checked)}
          />
          <span>
            <strong>{t('manualMaskToggle')}</strong>
            <small>{t('manualMaskHint')}</small>
          </span>
          {manualMaskMode ? (
            <div className="cleanup-slider">
              <label htmlFor="blur-strength-manual">{t('blurStrengthLabel')}</label>
              <input
                id="blur-strength-manual"
                type="range"
                min="8"
                max="64"
                step="1"
                value={blurStrength}
                onChange={(event) => setBlurStrength(Number(event.target.value))}
              />
              <span className="cleanup-slider__meta">{t('blurStrengthValue', { value: Math.round(blurStrength) })}</span>
            </div>
          ) : null}
        </label>
        <label className={`cleanup-checkbox ${antiSearchEnabled ? 'is-active' : ''}`}>
          <input
            type="checkbox"
            checked={antiSearchEnabled}
            onChange={(event) => handleAntiSearchToggle(event.target.checked)}
          />
          <span>
            <strong>{t('antiSearchLabel')}</strong>
            <small>{t('antiSearchHint')}</small>
          </span>
          {antiSearchEnabled ? (
            <div className="cleanup-slider">
              <label htmlFor="anti-search-level">{t('antiSearchLevelLabel')}</label>
              <input
                id="anti-search-level"
                type="range"
                min="1"
                max="3"
                step="1"
                value={antiSearchLevel}
                onChange={(event) => setAntiSearchLevel(Number(event.target.value))}
              />
              <span className="cleanup-slider__meta">{t('antiSearchLevelValue', { value: antiSearchLevel })}</span>
            </div>
          ) : null}
        </label>
        <label className={`cleanup-checkbox ${watermarkEnabled ? 'is-active' : ''}`}>
          <input
            type="checkbox"
            checked={watermarkEnabled}
            onChange={(event) => setWatermarkEnabled(event.target.checked)}
          />
          <span>
            <strong>{t('watermarkToggle')}</strong>
            <small>{t('watermarkHint')}</small>
          </span>
        </label>
      </div>

      {manualMaskMode ? <p className="cleanup-preview__hint">{t('manualMaskDrawingHint')}</p> : null}

      {antiSearchEnabled ? (
        <p className="notice notice--muted">{t('antiSearchActiveHint')}</p>
      ) : (
        <p className="notice notice--muted">{t('antiSearchOffHint')}</p>
      )}


      <div className="cleanup-diff-grid">
        <figure className="cleanup-diff-grid__preview">
          <figcaption>{t('previewOriginal')}</figcaption>
          {originalPreviewUrl ? (
            <img src={originalPreviewUrl} alt={t('previewOriginalAlt')} className="cleanup-preview__image" />
          ) : (
            <p className="notice">{t('cleanupPreviewUnavailable')}</p>
          )}
        </figure>
        <figure className="cleanup-diff-grid__preview">
          <figcaption>{t('previewProcessed')}</figcaption>
          {previewLoading ? (
            <p className="notice">{t('cleanupPreviewGenerating')}</p>
          ) : previewDataUrl ? (
            <div className="cleanup-preview__frame">
              <img src={previewDataUrl} alt={t('cleanupPreviewAlt')} className="cleanup-preview__image" />
              <div
                className={`cleanup-preview__overlay ${manualMaskMode ? 'is-drawing' : ''}`}
                ref={overlayRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerLeave}
                onPointerLeave={handlePointerLeave}
                role="presentation"
                style={{ pointerEvents: manualMaskMode ? 'auto' : 'none' }}
              >
                <canvas ref={overlayCanvasRef} className="cleanup-preview__overlay-canvas" />
              </div>
            </div>
          ) : (
            <p className="notice">{t('cleanupPreviewUnavailable')}</p>
          )}
        </figure>
        <div className="cleanup-summary">
          <h3 className="cleanup-summary__title">{t('privacyDiffTitle')}</h3>
          <ul>
            {summaryItems.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
          <p className="cleanup-summary__hint">{t('privacyDiffHint')}</p>
        </div>
      </div>

      {manualMasks.length > 0 ? (
        <div className="cleanup-mask-list">
          <div className="cleanup-mask-list__header">
            <span>{t('manualMaskCount', { count: manualMasks.length })}</span>
          </div>
          <ul>
            {manualMasks.map((mask, index) => (
              <li key={mask.id}>
                <span>{t('manualMaskItem', { index: index + 1 })}</span>
                <button type="button" className="button button--ghost" onClick={() => onManualMaskRemove(mask.id)}>
                  {t('manualMaskRemove')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {blurFaces && peopleCount === 0 ? <p className="notice">{t('facesMissing')}</p> : null}

      <div className="cleanup-actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            void onClean();
          }}
          disabled={!fileInfo || processing}
        >
          {processing ? t('processing') : t('downloadClean')}
        </button>
        {!fileInfo ? <p className="notice">{t('cleanUnavailable')}</p> : null}
      </div>
    </section>
  );
};
