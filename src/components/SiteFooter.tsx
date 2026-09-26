import React from 'react';
import { useT } from '../i18n';
import { REPO_URL } from '../site/siteContent';

/** Design-system footer: origin line with the version, its date and the build hash, privacy promise on the right. */
export const SiteFooter: React.FC = () => {
  const t = useT();
  const year = new Date().getFullYear();
  const build = __BUILD__;
  return (
    <footer className="v4-foot">
      <span>
        Found You · morgunov.tech · {year} · {t('footerVersion', { version: __VERSION__, date: __BUILD_DATE__ })} · {t('footerBuild')}&nbsp;
        {build === 'dev' ? (
          <code>dev</code>
        ) : (
          <a href={`${REPO_URL}/commit/${build}`} target="_blank" rel="noopener noreferrer">
            <code>{build}</code>
          </a>
        )}
      </span>
      <span className="v4-foot-privacy">{t('footerPrivacy')}</span>
    </footer>
  );
};
