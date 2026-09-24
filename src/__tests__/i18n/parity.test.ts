import { describe, expect, it } from 'vitest';
import { formatMessage, messages, type Language, type MessageKey } from '../../i18n';

const LANGS: readonly Language[] = ['ru', 'en', 'uz'];

/** Captured before anything else runs: the probe in the formatMessage tests must not leak into the parity checks. */
const KEYS = Object.keys(messages.ru).sort();

/**
 * Empty on purpose. `heroTitleTail` is the part of the title after the rotating scenario, and in
 * Russian and English the scenario ends the sentence; `sceneDepth_midground` is the depth word the
 * narrative omits when an object is neither in front nor at the back.
 */
const EMPTY_ALLOWED: Record<Language, ReadonlySet<string>> = {
  ru: new Set(['heroTitleTail', 'sceneDepth_midground']),
  en: new Set(['heroTitleTail', 'sceneDepth_midground']),
  uz: new Set(['sceneDepth_midground'])
};

const CYRILLIC = /\p{Script=Cyrillic}/u;

function valueOf(lang: Language, key: string): unknown {
  return (messages[lang] as Record<string, unknown>)[key];
}

function placeholders(value: string): string[] {
  return Array.from(value.matchAll(/\{([a-zA-Z0-9_]+)\}/g), (match) => match[1]).sort();
}

describe('dictionary parity', () => {
  it('ru, en and uz have identical key sets', () => {
    for (const lang of LANGS) {
      expect(Object.keys(messages[lang]).sort(), lang).toEqual(KEYS);
    }
  });

  it('every value is a string', () => {
    const offenders: string[] = [];
    for (const lang of LANGS) {
      for (const key of KEYS) {
        if (typeof valueOf(lang, key) !== 'string') offenders.push(`${lang}.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every key uses the same set of {placeholders} in every language', () => {
    const mismatches: string[] = [];
    for (const key of KEYS) {
      const reference = placeholders(String(valueOf('ru', key))).join(',');
      for (const lang of ['en', 'uz'] as const) {
        const actual = placeholders(String(valueOf(lang, key))).join(',');
        if (actual !== reference) mismatches.push(`${key}: ru {${reference}} vs ${lang} {${actual}}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('no value is empty except the allowlisted ones', () => {
    const empty: string[] = [];
    for (const lang of LANGS) {
      for (const key of KEYS) {
        if (valueOf(lang, key) === '' && !EMPTY_ALLOWED[lang].has(key)) empty.push(`${lang}.${key}`);
      }
    }
    expect(empty).toEqual([]);
  });

  it('the allowlisted empties are still empty (otherwise the allowlist is stale)', () => {
    for (const lang of LANGS) {
      for (const key of EMPTY_ALLOWED[lang]) {
        expect(valueOf(lang, key), `${lang}.${key}`).toBe('');
      }
    }
  });

  it.each(['en', 'uz'] as const)('%s values contain no Cyrillic', (lang) => {
    const cyrillic = KEYS.filter((key) => CYRILLIC.test(String(valueOf(lang, key)))).map(
      (key) => `${key}: ${String(valueOf(lang, key)).slice(0, 60)}`
    );
    expect(cyrillic).toEqual([]);
  });
});

describe('formatMessage', () => {
  it('inserts a parameter containing $& literally, not as a replacement pattern', () => {
    // `uploadFormats` reads «… до {limit} МБ»; String.prototype.replace with a string pattern would
    // expand `$&` to the matched «{limit}».
    const out = formatMessage('ru', 'uploadFormats', { limit: '$&' });
    expect(out).toContain('$&');
    expect(out).not.toContain('{limit}');
  });

  it('replaces a placeholder that appears twice in a value both times', () => {
    // No dictionary value repeats a placeholder today, so the behaviour is pinned through a probe
    // key added for the duration of this test and removed again.
    const dictionary = messages.ru as Record<string, string>;
    const probe = '__parityProbeTwice';
    dictionary[probe] = 'from {n} to {n}';
    try {
      expect(formatMessage('ru', probe as MessageKey, { n: 7 })).toBe('from 7 to 7');
    } finally {
      delete dictionary[probe];
    }
  });
});
