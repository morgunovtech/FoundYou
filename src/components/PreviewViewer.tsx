import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BasicFileInfo } from '../types/metadata';
import { FACE_LABEL, PERSON_LABEL, type BoundingBox } from '../types/detection';
import { useI18n, useT } from '../i18n';
import { CONFIDENT_SCORE, isSceneObject, localizeLabel } from '../utils/sceneNarrative';

interface PreviewViewerProps {
  fileInfo: BasicFileInfo;
  detections: BoundingBox[];
  sceneDescription: string;
  progress?: { label: string; value: number } | null;
}

export const PreviewViewer: React.FC<PreviewViewerProps> = ({ fileInfo, detections, sceneDescription, progress }) => {
  const t = useT();
  const { lang } = useI18n();
  const [fullScreen, setFullScreen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const openFullscreen = useCallback(() => setFullScreen(true), []);
  const closeFullscreen = useCallback(() => {
    setFullScreen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!fullScreen) return;
    closeRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFullscreen();
      if (e.key === 'Tab') {
        e.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [fullScreen, closeFullscreen]);

  const overlays = useMemo(() => {
    // One label per human: a face inside a person box is drawn as an inner frame without text.
    const persons = detections.filter((det) => det.label === PERSON_LABEL && det.score >= CONFIDENT_SCORE);
    const insidePerson = (face: BoundingBox) => {
      const cx = face.x + face.width / 2;
      const cy = face.y + face.height / 2;
      return persons.some((p) => cx >= p.x && cx <= p.x + p.width && cy >= p.y && cy <= p.y + p.height);
    };
    return detections
      .filter((det) => (det.label === FACE_LABEL ? det.score >= CONFIDENT_SCORE : isSceneObject(det)))
      .map((det, index) => {
        const style: React.CSSProperties = {
          left: `${(det.x / fileInfo.width) * 100}%`,
          top: `${(det.y / fileInfo.height) * 100}%`,
          width: `${(det.width / fileInfo.width) * 100}%`,
          height: `${(det.height / fileInfo.height) * 100}%`
        };
        const face = det.label === FACE_LABEL;
        const uncertain = !face && det.score < CONFIDENT_SCORE;
        const silent = face && insidePerson(det);
        const label = face ? t('detectionLabelFace') : `${localizeLabel(det.label, lang)}${uncertain ? '?' : ''}`;
        const className = `fy-detection${silent ? ' fy-detection--face' : ''}${uncertain ? ' fy-detection--uncertain' : ''}`;
        return (
          <div key={`${det.label}-${index}`} className={className} style={style} aria-hidden="true">
            {silent ? null : <span className="fy-detection-label">{label}</span>}
          </div>
        );
      });
  }, [detections, fileInfo.height, fileInfo.width, lang, t]);

  return (
    <div className="fy-preview">
      <div
        ref={triggerRef}
        className="fy-preview-frame"
        role="button"
        tabIndex={0}
        aria-label={`${fileInfo.file.name} — ${t('fullscreenOpen')}`}
        onClick={openFullscreen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openFullscreen();
          }
        }}
        style={{ aspectRatio: `${fileInfo.width} / ${fileInfo.height}` }}
      >
        <img src={fileInfo.thumbnailUrl} alt={fileInfo.file.name} />
        <div className="fy-overlay">{overlays}</div>
      </div>
      <p className="fy-scene">{sceneDescription}</p>
      {progress ? (
        <div className="fy-progress" aria-live="polite">
          <div className="fy-progress-text">{progress.label}</div>
          <div
            className="fy-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.value * 100)}
          >
            <span style={{ width: `${Math.min(100, Math.max(0, progress.value * 100))}%` }} />
          </div>
        </div>
      ) : null}
      {fullScreen ? (
        <div className="fy-lightbox" role="dialog" aria-modal="true" aria-label={fileInfo.file.name} onClick={closeFullscreen}>
          <div className="fy-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <button ref={closeRef} type="button" className="v4-btn fy-btn-sm" onClick={closeFullscreen}>
              {t('fullscreenClose')}
            </button>
            <div className="fy-lightbox-media">
              <img src={fileInfo.dataUrl} alt={fileInfo.file.name} />
              <div className="fy-overlay">{overlays}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
