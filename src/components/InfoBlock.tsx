import React from 'react';
import { useT } from '../i18n';

/** Hero copy: eyebrow, title, tagline and the two feature lists. */
export const InfoBlock: React.FC = () => {
  const t = useT();
  return (
    <div className="fy-hero-text">
      <p className="fy-eyebrow">
        <b>{t('heroEyebrow')}</b>
        <span>{t('heroEyebrowMeta')}</span>
      </p>
      <h1 className="fy-h1" id="hero-title">
        {t('appTitle')}
      </h1>
      <p className="fy-tagline">{t('introLead')}</p>
      <ul className="v4-list">
        <li>{t('introHow')}</li>
        <li>{t('introSafe')}</li>
        <li>{t('introFeatureCleanup')}</li>
        <li>{t('introFeatureOcr')}</li>
      </ul>
      <h2 className="v4-h3">{t('introJobsTitle')}</h2>
      <ul className="v4-list">
        <li>{t('introJobPrivacy')}</li>
        <li>{t('introJobMasking')}</li>
        <li>{t('introJobProof')}</li>
        <li>{t('introJobPresets')}</li>
      </ul>
    </div>
  );
};
