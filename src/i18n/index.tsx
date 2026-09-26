import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { formatMessage, messages, type Language, type MessageKey, type MessagesMap } from './messages';
import { localeFromPath, localePath } from './locale';

export type { Language, MessageKey, MessagesMap };
export { formatMessage, messages };

type Messages = typeof messages.ru;

type I18nContextValue = {
  lang: Language;
  messages: Messages;
  setLanguage: (lang: Language) => void;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const LANG_STORAGE_KEY = 'meta-data-lang';

/*
 * Storage is read and written under try/catch, as the theme provider does: on WebKit with
 * storage blocked («Block All Cookies», some managed profiles, some embedded web views) the
 * mere access to `window.localStorage` throws, and this is the root provider — a throw here
 * happened before the first paint and showed the error page instead of the upload zone.
 */
function readStoredLanguage(): Language {
  let stored: string | null = null;
  try {
    if (typeof window !== 'undefined') stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    // No storage: the language is still chosen, it is just not remembered.
  }
  const browser = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  const fromPath = typeof window !== 'undefined' ? localeFromPath(window.location.pathname) : null;
  return initialLanguage(fromPath, stored, browser);
}

/**
 * The interface language of a visit. The address decides first: `/`, `/en/` and `/uz/` are
 * three pages, each indexed in its own language, and what the page says must be what its
 * address promises (`locale.ts`; on `/` a saved choice of another language is honoured by
 * `theme-init.js`, which moves to that page before anything paints). Off the three pages the
 * saved choice wins, then the browser's own list: the first tag that names one of the three
 * languages, in the browser's order; failing that, the languages of the region whose readers
 * reach for Russian (Kazakh, Kyrgyz, Tajik, Belarusian); failing that English for any other
 * browser, and Russian when there is no list at all (no `navigator`). `public/theme-init.js`
 * mirrors this for the `lang` attribute before the first paint — keep the two in step.
 */
export function initialLanguage(pathLang: Language | null, stored: string | null, browserLanguages: readonly string[]): Language {
  if (pathLang) return pathLang;
  if (stored === 'ru' || stored === 'en' || stored === 'uz') return stored;
  const bases = browserLanguages.map((tag) => String(tag).toLowerCase().split('-')[0]).filter(Boolean);
  for (const base of bases) {
    if (base === 'uz' || base === 'ru' || base === 'en') return base;
  }
  if (bases.some((base) => base === 'kk' || base === 'ky' || base === 'tg' || base === 'be')) return 'ru';
  return bases.length > 0 ? 'en' : 'ru';
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Language>(readStoredLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLang(next);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LANG_STORAGE_KEY, next);
      }
    } catch {
      // See readStoredLanguage.
    }
    // The address names the language (locale.ts): keep it true after an in-place switch, so a
    // reload or a copied link opens this language. No navigation — a loaded photo stays where it is.
    try {
      if (typeof window !== 'undefined' && localeFromPath(window.location.pathname) !== null) {
        const { search, hash } = window.location;
        window.history.replaceState(window.history.state, '', `${localePath(next)}${search}${hash}`);
      }
    } catch {
      // A history that refuses (a sandboxed frame): the language still switches.
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const value = useMemo<I18nContextValue>(() => ({
    lang,
    messages: messages[lang],
    setLanguage
  }), [lang, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
};

export const useT = () => {
  const { lang } = useI18n();
  return useCallback((key: MessageKey, params?: Record<string, string | number>): string => formatMessage(lang, key, params), [lang]);
};

