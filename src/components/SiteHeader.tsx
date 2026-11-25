import React from 'react';
import { FAMILY_URL, SERVICE_NAME } from '../site/chrome';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';

/**
 * The family bar, the same on every morgunov.tech page (`public/ds/v1/USAGE.md`, «Service
 * chrome»): the mark «MORGUNOV.TECH / FOUND YOU» on the left, leading to the family's site, then
 * the language menu and the theme menu at the very edge. `renderBar` in `site/renderStatic.ts`
 * draws the same markup as a string for the first paint and for 404.html.
 */
export const SiteHeader: React.FC = () => (
  <header className="v4-bar" id="top">
    <a className="v4-service" href={FAMILY_URL}>
      <span className="v4-service-family">morgunov.tech</span>
      <span className="v4-service-sep" aria-hidden="true">
        /
      </span>
      <span className="v4-service-name">{SERVICE_NAME}</span>
    </a>
    <div className="v4-bar-right">
      <LanguageSwitcher />
      <ThemeSwitcher />
    </div>
  </header>
);
