import { describe, expect, it } from 'vitest';
import { initialLanguage } from '../../i18n';

describe('initialLanguage', () => {
  it('takes the language the address names before anything else', () => {
    expect(initialLanguage('en', 'ru', ['ru-RU'])).toBe('en');
    expect(initialLanguage('uz', null, ['en-US'])).toBe('uz');
    expect(initialLanguage('ru', 'en', ['en-US'])).toBe('ru');
  });

  it('keeps a saved choice whatever the browser says, off the three pages', () => {
    expect(initialLanguage(null, 'uz', ['en-US'])).toBe('uz');
    expect(initialLanguage(null, 'en', ['ru-RU'])).toBe('en');
  });

  it('takes the first of the three languages the browser names, in its order', () => {
    expect(initialLanguage(null, null, ['uz-UZ', 'ru', 'en'])).toBe('uz');
    expect(initialLanguage(null, null, ['de-DE', 'ru-RU', 'en-US'])).toBe('ru');
    expect(initialLanguage(null, null, ['en-GB', 'uz'])).toBe('en');
    expect(initialLanguage(null, null, ['RU'])).toBe('ru');
  });

  it('falls back to Russian for the region that reads it, and to English for the rest of the world', () => {
    expect(initialLanguage(null, null, ['kk-KZ'])).toBe('ru');
    expect(initialLanguage(null, null, ['tg-TJ', 'fa'])).toBe('ru');
    expect(initialLanguage(null, null, ['de-DE', 'fr'])).toBe('en');
    expect(initialLanguage(null, null, ['ja'])).toBe('en');
  });

  it('is Russian when the browser has no list at all', () => {
    expect(initialLanguage(null, null, [])).toBe('ru');
    expect(initialLanguage(null, 'nonsense', [])).toBe('ru');
  });
});
