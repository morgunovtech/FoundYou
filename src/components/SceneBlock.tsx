import React from 'react';
import type { BasicFileInfo } from '../types/metadata';
import type { BoundingBox } from '../types/detection';
import { useT } from '../i18n';
import { SectionHead } from './SectionHead';
import { PreviewViewer } from './PreviewViewer';
import { Explainer } from './Explainer';

interface SceneBlockProps {
  fileInfo: BasicFileInfo;
  detections: BoundingBox[];
  sceneDescription: string;
  detectionProgress: { label: string; value: number } | null;
  onMakeSafeCopy: () => void;
  onBlurFaces: () => void;
}

/**
 * Section 01 — what is in the photo. The preview with detection boxes and the
 * scene narrative, next to an explainer on how the same small model is run at
 * scale against a scraped profile. Nothing here is behind a toggle.
 */
export const SceneBlock: React.FC<SceneBlockProps> = ({
  fileInfo,
  detections,
  sceneDescription,
  detectionProgress,
  onMakeSafeCopy,
  onBlurFaces
}) => {
  const t = useT();
  return (
    <section className="v4-section" aria-labelledby="sec-scene">
      <SectionHead num="01" title={t('sceneTitle')} id="sec-scene" />
      <div className="fy-grid-2">
        <div className="fy-card">
          <PreviewViewer
            fileInfo={fileInfo}
            detections={detections}
            sceneDescription={sceneDescription}
            progress={detectionProgress}
          />
        </div>
        <div className="fy-explainers">
          <Explainer title={t('explainerAttackerTitle')}>
            <p>{t('sceneExplainer1')}</p>
            <p>{t('sceneExplainer2')}</p>
            <p>{t('sceneExplainer3')}</p>
          </Explainer>
          <Explainer title={t('factWhatToDo')}>
            <p>{t('sceneTodo')}</p>
            <div className="fy-actions">
              <button type="button" className="v4-btn fy-btn-sm" onClick={onBlurFaces}>
                {t('todoPeopleButton')}
              </button>
              <button type="button" className="v4-btn fy-btn-sm" onClick={onMakeSafeCopy}>
                {t('verdictCta')}
              </button>
            </div>
          </Explainer>
        </div>
      </div>
    </section>
  );
};
