import React from 'react';
import type { BasicFileInfo } from '../types/metadata';
import type { BoundingBox } from '../types/detection';
import { useT } from '../i18n';
import { SectionHead } from './SectionHead';
import { PreviewViewer } from './PreviewViewer';

interface SceneBlockProps {
  fileInfo: BasicFileInfo;
  detections: BoundingBox[];
  sceneDescription: string;
  detectionProgress: { label: string; value: number } | null;
}

/**
 * Section 01 — what is in the photo: the preview with detection boxes (faces,
 * people, objects) and the scene narrative. People are counted here; section 02
 * has no separate people card. Nothing here is behind a toggle.
 */
export const SceneBlock: React.FC<SceneBlockProps> = ({
  fileInfo,
  detections,
  sceneDescription,
  detectionProgress
}) => {
  const t = useT();
  return (
    <section className="v4-section" aria-labelledby="sec-scene">
      <SectionHead num="01" title={t('sceneTitle')} id="sec-scene" />
      <div className="fy-card fy-scene-card">
        <PreviewViewer
          fileInfo={fileInfo}
          detections={detections}
          sceneDescription={sceneDescription}
          progress={detectionProgress}
        />
      </div>
    </section>
  );
};
