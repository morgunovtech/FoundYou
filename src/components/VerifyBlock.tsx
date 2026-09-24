import React from 'react';
import { useT } from '../i18n';

const REPO_URL = 'https://github.com/morgunovtech/meta-data';

/**
 * «How to check that the photo goes nowhere» — the target of the trust link under the upload
 * button. The rest of the page states the promise; this is the part that lets a stranger check
 * it without taking anyone's word: the network tab, an offline run, the guard and the CSP in
 * the open source. It is always on the page (the link works before a photo is chosen) and it
 * is not a section number, because the numbered sections are the analysis of one photo.
 */
export const VerifyBlock: React.FC = () => {
  const t = useT();
  // `fy-howto`, not `fy-verify`: that class names the post-export verification line, which the smoke locates.
  return (
    <section className="v4-section fy-howto" aria-labelledby="sec-verify">
      <h2 className="v4-h2" id="sec-verify">
        {t('verifyTitle')}
      </h2>
      <p className="fy-verify-lead">{t('verifyLead')}</p>
      <ol className="fy-verify-steps">
        <li>{t('verifyStepNetwork')}</li>
        <li>{t('verifyStepOffline')}</li>
        <li>
          {t('verifyStepGuard')}{' '}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            {t('verifyRepoLink')}
          </a>
          .
        </li>
      </ol>
    </section>
  );
};
