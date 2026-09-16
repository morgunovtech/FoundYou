import { describe, expect, it } from 'vitest';
import { messages, type Language } from '../../i18n';
import { HERO_SCENARIO_KEYS } from '../../utils/heroScenarios';

const LANGS: Language[] = ['ru', 'en', 'uz'];

describe('hero title and sharing scenarios', () => {
  it('splits the title so lead + tail read as the plain appTitle', () => {
    for (const lang of LANGS) {
      const dict = messages[lang];
      expect(dict.heroTitleLead.trim().length).toBeGreaterThan(0);
      expect([dict.heroTitleLead, dict.heroTitleTail].filter(Boolean).join(' ')).toBe(dict.appTitle);
    }
  });

  it('has a distinct, translated phrase for every scenario in every language', () => {
    for (const lang of LANGS) {
      const phrases = HERO_SCENARIO_KEYS.map((key) => messages[lang][key]);
      expect(new Set(phrases).size).toBe(phrases.length);
      for (const phrase of phrases) {
        expect(phrase.trim()).toBe(phrase);
        expect(phrase.length).toBeGreaterThan(0);
        // No trailing punctuation: the phrase sits in the middle (uz) or at the end of the title.
        expect(/[.,;:!?]$/.test(phrase)).toBe(false);
      }
    }
    for (const key of HERO_SCENARIO_KEYS) {
      expect(messages.uz[key]).not.toBe(messages.en[key]);
      expect(messages.ru[key]).not.toBe(messages.en[key]);
    }
  });

  it('quotes the upload limit in the formats line', () => {
    for (const lang of LANGS) {
      expect(messages[lang].uploadFormats).toContain('{limit}');
    }
  });
});
