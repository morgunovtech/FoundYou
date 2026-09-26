import type { Language } from './messages.ts';

/**
 * One page per language: `/` is Russian (and the `x-default` for search engines), `/en/` and
 * `/uz/` the other two. Each is a static entry of the Vite build rendered from the one template
 * by `localePages()` in `vite.config.ts`, with its own `<title>`, description, `hreflang` set and
 * JSON-LD, so a search engine indexes every language under its own address instead of one
 * address in whatever language its renderer happened to ask for. `public/theme-init.js` repeats
 * `localeFromPath` for the `lang` attribute before the first paint — keep the two in step.
 */
export const LANGUAGES: readonly Language[] = ['ru', 'en', 'uz'];

export function localePath(lang: Language): string {
  return lang === 'ru' ? '/' : `/${lang}/`;
}

/** The language a path names, or null off the three pages (the 404 page, a stray file). */
export function localeFromPath(pathname: string): Language | null {
  if (pathname === '/' || pathname === '/index.html') return 'ru';
  const match = /^\/(en|uz)(?:\/(?:index\.html)?)?$/.exec(pathname);
  return match ? (match[1] as Language) : null;
}
