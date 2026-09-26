import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { messages, type Language } from '../../i18n';

/**
 * index.html carries a static copy of the hero — title, lead, four points, privacy line — in each
 * language, inside #root, for a reader that runs no JavaScript: an AI assistant, a text-only
 * crawler, a link unfurler. React replaces it on mount. This pins the copy to the dictionary, so
 * an edit to the hero text in one place cannot leave the other behind.
 */
const LANGS: readonly Language[] = ['ru', 'en', 'uz'];
const html = readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8');

/** What the site monitor (TofsDevOps, SEO_MIN_TEXT_CHARS) wants to see on the home page without JavaScript. */
const MIN_NO_JS_CHARS = 400;

function staticHero(lang: Language): string {
  const match = html.match(
    new RegExp(`<section class="fy-hero-text fy-static-hero" lang="${lang}">([\\s\\S]*?)</section>`)
  );
  if (!match) throw new Error(`index.html has no static hero for ${lang}`);
  return match[1];
}

/** Inner text of every <tag> in the fragment, whitespace collapsed. */
function inner(fragment: string, tag: string): string[] {
  return Array.from(fragment.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g')), (m) =>
    m[1].replace(/\s+/g, ' ').trim()
  );
}

describe('static hero in index.html', () => {
  for (const lang of LANGS) {
    it(`${lang}: repeats the dictionary word for word`, () => {
      const dict = messages[lang];
      const block = staticHero(lang);
      expect(inner(block, 'h1')).toEqual([dict.appTitle]);
      expect(inner(block, 'li')).toEqual([dict.introPoint1, dict.introPoint2, dict.introPoint3, dict.introPoint4]);
      expect(inner(block, 'p')).toEqual([dict.introLead, dict.introAction]);
    });

    it(`${lang}: is enough text for a reader without JavaScript`, () => {
      const text = staticHero(lang)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      expect(text.length).toBeGreaterThanOrEqual(MIN_NO_JS_CHARS);
    });
  }

  it('shows the block of <html lang> and hides the other two', () => {
    expect(html).toContain('.fy-hero .fy-static-hero{display:none}');
    for (const lang of LANGS) {
      expect(html).toContain(`html[lang="${lang}"] .fy-static-hero[lang="${lang}"]`);
    }
  });
});
