import React from 'react';
import { useI18n, useT, type Language } from '../i18n';
import { LANGUAGES, localePath } from '../i18n/locale';
import { LANGUAGE_NAMES } from '../site/chrome';
import { Chevron, Dropdown } from './Dropdown';

/**
 * The family language menu: the current code («RU») and the three languages as links to the same
 * page in each. A plain click switches in place (`setLanguage`), so a loaded photo stays.
 */
export const LanguageSwitcher: React.FC = () => {
  const { lang, setLanguage } = useI18n();
  const t = useT();

  return (
    <Dropdown
      name="lang"
      toggleClassName="v4-bar-btn v4-lang-btn"
      toggleLabel={`${lang.toUpperCase()} — ${t('langMenuLabel')}`}
      itemClassName="v4-lang-link"
      items={LANGUAGES.map((code) => ({
        value: code,
        label: LANGUAGE_NAMES[code],
        checked: lang === code,
        lang: code,
        href: localePath(code)
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
