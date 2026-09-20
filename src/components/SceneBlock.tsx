import React from 'react';
import type { BasicFileInfo } from '../types/metadata';
import type { BoundingBox } from '../types/detection';
import { useT } from '../i18n';
import { SectionHead } from './SectionHead';
import { PreviewViewer } from './PreviewViewer';
import { Explainer } from './Explainer';
import { readSetting, type Setting } from '../utils/settingType';
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
  const { lang } = useI18n();
  /*
   * The setting is the part a photograph gives away with no metadata at all: a geotag can be
   * stripped, a bed cannot. It is a reading of the objects rather than a measurement, so the
   * card names the objects that carried it and the `Explainer` says as much.
   */
  const setting = React.useMemo(() => readSetting(detections), [detections]);
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
        {setting ? (
          <div className="fy-setting">
            <p className="fy-setting-value">
              {t(SETTING_KEYS[setting.setting])}
              <span className="fy-muted">
                {' '}
                {t(setting.indoors ? 'settingIndoors' : 'settingOutdoors')}
              </span>
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
