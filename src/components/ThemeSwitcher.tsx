import React from 'react';
import { useTheme, type ThemePreference } from '../theme';
import { useT } from '../i18n';
import { THEME_OPTIONS } from '../site/chrome';
import { Dropdown } from './Dropdown';

/**
 * The family theme menu: the icon button and the four themes in the family's order. Which of
 * the three glyphs is visible is decided by `[data-theme]` on <html> in components.css, so the
 * button needs no state of its own.
 */
export const ThemeSwitcher: React.FC = () => {
  const { preference, setPreference } = useTheme();
  const t = useT();

  return (
    <Dropdown
      name="theme"
      toggleClassName="v4-icon-btn"
      menuClassName="v4-theme-menu"
      itemClassName="v4-theme-btn"
      toggleLabel={t('themeMenuLabel')}
      items={THEME_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
        checked: preference === option.value
      }))}
      onSelect={(value) => setPreference(value as ThemePreference)}
      toggleChildren={
        <>
          <svg className="v4-icon-sun" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" />
          </svg>
          <svg className="v4-icon-moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.5 9A6 6 0 1 1 7 2.5a4.5 4.5 0 0 0 6.5 6.5z" />
          </svg>
          <svg className="v4-icon-contrast" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 2v12a6 6 0 0 0 0-12z" fill="currentColor" />
          </svg>
        </>
      }
    />
  );
};
