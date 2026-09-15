import React from 'react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';

/** Design-system top bar: brand on the left, language and theme menus on the right. */
export const SiteHeader: React.FC = () => (
  <header className="v4-bar" id="top">
    <div className="fy-brand">
      <a href="/" aria-current="page">
        Found You
      </a>
      <a href="https://morgunov.tech" rel="noopener noreferrer">
        morgunov.tech
      </a>
    </div>
    <div className="v4-bar-right">
      <LanguageSwitcher />
      <ThemeSwitcher />
    </div>
  </header>
);
