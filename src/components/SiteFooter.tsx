import React from 'react';
import { useT } from '../i18n';

const REPO_URL = 'https://github.com/morgunovtech/meta-data';

/** Design-system footer: origin line with the build hash, privacy promise on the right. */
export const SiteFooter: React.FC = () => {
  const t = useT();
  const year = new Date().getFullYear();
  const build = __BUILD__;
  return (
    <footer className="v4-foot">
      <span>
        Found You · morgunov.tech · {year} · {t('footerBuild')}&nbsp;
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
