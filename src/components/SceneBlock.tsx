import React from 'react';
import type { BasicFileInfo } from '../types/metadata';
import type { BoundingBox } from '../types/detection';
import { useT } from '../i18n';
import { SectionHead } from './SectionHead';
import { PreviewViewer } from './PreviewViewer';
import { Explainer } from './Explainer';
import { Claim } from './Claim';
import { readSetting, type Setting } from '../utils/settingType';
import { readFaces, type Recognisability } from '../utils/faceRecognisability';
import { localizeLabel } from '../utils/sceneNarrative';
import { useI18n, type MessageKey } from '../i18n';

const SETTING_KEYS: Record<Setting, MessageKey> = {
  home: 'setting_home',
  workplace: 'setting_workplace',
  bathroom: 'setting_bathroom',
  kitchen: 'setting_kitchen',
  transport: 'setting_transport',
  street: 'setting_street',
  nature: 'setting_nature'
};

interface SceneBlockProps {
  fileInfo: BasicFileInfo;
  detections: BoundingBox[];
  sceneDescription: string;
  detectionProgress: { label: string; value: number } | null;
  /** 35-mm equivalent focal length, for the distance to the faces; absent in most files. */
  focalLength35mm?: number;
}

const RECOGNISABILITY_KEYS: Record<Recognisability, MessageKey> = {
  preferred: 'faceIedPreferred',
  standard: 'faceIedStandard',
  'human-only': 'faceIedHumanOnly',
  'too-small': 'faceIedTooSmall'
};

/**
 * Section 01 — what is in the photo: the preview with detection boxes (faces,
 * people, objects) and the scene narrative. People are counted here; section 02
 * has no separate people card. Nothing here is behind a toggle.
 */
export const SceneBlock: React.FC<SceneBlockProps> = ({
  fileInfo,
  detections,
  sceneDescription,
  detectionProgress,
  focalLength35mm
}) => {
  const t = useT();
  const { lang } = useI18n();
  /*
   * The setting is the part a photograph gives away with no metadata at all: a geotag can be
   * stripped, a bed cannot. It is a reading of the objects rather than a measurement, so the
   * card names the objects that carried it and the `Explainer` says as much.
   */
  const setting = React.useMemo(() => readSetting(detections), [detections]);
  /*
   * How much of a face the picture actually holds. The detector already returns the eye
   * keypoints and the pipeline already threw them away after using them to reject helmets and
   * reflections; the distance between the pupils answers what the box alone cannot — a face can
   * fill a quarter of the frame and still be a smudge. With the focal length it also gives how
   * far the camera was, because adult eyes are about 63 mm apart whoever they belong to.
   */
  const faces = React.useMemo(
    () => readFaces(detections, focalLength35mm, fileInfo.width, fileInfo.height),
    [detections, focalLength35mm, fileInfo.width, fileInfo.height]
  );
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
        {faces.length > 0 ? (
          <div className="fy-setting">
            <p className="fy-setting-value">
              {t(RECOGNISABILITY_KEYS[faces[0].level], { pixels: Math.round(faces[0].iedPx) })}
              {/* The pixel count is measured; the band it falls in is a reading of a standard. */}
              {' '}
              <Claim kind="fact" />
            </p>
            {faces[0].distanceMeters != null ? (
              <p className="fy-hint">{t('faceDistance', { distance: faces[0].distanceMeters.toFixed(1) })}</p>
            ) : null}
            <Explainer title={t('faceIedExplainTitle')}>
              <p>{t('faceIedExplainBody')}</p>
              <p>{t('faceIedExplainLimits')}</p>
            </Explainer>
          </div>
        ) : null}
        {setting ? (
          <div className="fy-setting">
            <p className="fy-setting-value">
              {t(SETTING_KEYS[setting.setting])}
              <span className="fy-muted">
                {' '}
                {t(setting.indoors ? 'settingIndoors' : 'settingOutdoors')}
              </span>
              {/* The objects are detected; «похоже на жильё» is what they add up to. */}
              {' '}
              <Claim kind="inference" />
            </p>
            <p className="fy-hint">
              {t('settingEvidence', { objects: setting.evidence.map((label) => localizeLabel(label, lang)).join(', ') })}
            </p>
            <Explainer title={t('settingExplainTitle')}>
              <p>{t('settingExplainBody')}</p>
            </Explainer>
          </div>
        ) : null}
      </div>
    </section>
  );
};
