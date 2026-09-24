import React from 'react';
import { useI18n, useT, type Language } from '../i18n';
import { Chevron, Dropdown } from './Dropdown';

const LANGUAGES: Array<{ code: Language; label: string }> = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'uz', label: 'Oʻzbekcha' }
];

/** Text toggle showing the current code («RU») with a menu of the three languages. */
export const LanguageSwitcher: React.FC = () => {
  const { lang, setLanguage } = useI18n();
  const t = useT();

  return (
    <Dropdown
      className="fy-lang"
      toggleClassName="v4-bar-btn"
      toggleLabel={`${lang.toUpperCase()} — ${t('langMenuLabel')}`}
      items={LANGUAGES.map((entry) => ({
        value: entry.code,
        label: entry.label,
        checked: lang === entry.code,
        lang: entry.code
      }))}
      onSelect={(value) => setLanguage(value as Language)}
      toggleChildren={
        <>
          {lang.toUpperCase()}
          <Chevron />
        </>
      }
    />
  );
};
