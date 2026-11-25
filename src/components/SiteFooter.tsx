import React from 'react';
import { useT } from '../i18n';
import { CHANGELOG_URL } from '../site/siteContent';

/**
 * The family footer, the same on every morgunov.tech page (ds/v1/USAGE.md, «Service chrome» and
 * «Build mark»): name · year · the build mark on the left, the privacy line on the right, and
 * nothing else. The build mark is the release as a link to the changelog on GitHub — the history
 * of versions — not a date and not a commit.
 */
export const SiteFooter: React.FC = () => {
  const t = useT();
  const year = new Date().getFullYear();
  return (
    <footer className="v4-foot">
      <span>
        morgunov.tech / found you · {year} ·{' '}
        <a className="v4-build" href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
          v{__VERSION__}
        </a>
      </span>
      <span className="v4-foot-privacy">{t('footerPrivacy')}</span>
    </footer>
  );
};
