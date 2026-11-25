import type { Language, MessageKey } from '../i18n/messages.ts';

/**
 * The family chrome's data — what the bar says, in the order it says it — shared by the two
 * places that draw it: `renderStatic.ts` (HTML strings, for a reader without JavaScript and for
 * 404.html) and the React header (`components/SiteHeader.tsx`). The markup itself is the
 * contract of `public/ds/v1/USAGE.md`, «Service chrome»; `src/__tests__/site/chrome.test.ts`
 * holds both drawings to it.
 */

/** Where the service mark leads: the family's own site. */
export const FAMILY_URL = 'https://s.morgunov.tech/';

/** The service's name in the mark «MORGUNOV.TECH / FOUND YOU» (the layer sets the caps). */
export const SERVICE_NAME = 'Found You';

/** Each language under its own name, as the language menu lists them. */
export const LANGUAGE_NAMES: Record<Language, string> = { ru: 'Русский', en: 'English', uz: 'Oʻzbekcha' };

/** The four themes in the family's order. */
export const THEME_OPTIONS: ReadonlyArray<{
  value: 'light' | 'dark' | 'auto' | 'high-contrast';
  labelKey: MessageKey;
}> = [
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
  { value: 'auto', labelKey: 'themeAuto' },
  { value: 'high-contrast', labelKey: 'themeHighContrast' }
];
