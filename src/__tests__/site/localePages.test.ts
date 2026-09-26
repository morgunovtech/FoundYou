import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { messages } from '../../i18n';
import { LANGUAGES, localeFromPath, localePath } from '../../i18n/locale';
import { DATE_PUBLISHED, escapeHtml, renderLlmsFull, renderLocalePage, renderSitemap } from '../../site/renderStatic';
import { SITE_ORIGIN, heroCopy, siteSections, verifyCopy } from '../../site/siteContent';

/**
 * The three pages are rendered from `index.html` and the dictionary at build time; this renders
 * them the same way and reads what a search engine, an AI assistant and a reader without
 * JavaScript would. A dictionary string changed in one place cannot leave the page behind,
 * because there is no second copy — the test pins the renderer to the dictionary, not a file.
 */
const template = readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8');
const build = { version: '1.4.0', date: '2026-09-26', id: 'abc1234' };

/** What the site monitor (TofsDevOps, SEO_MIN_TEXT_CHARS) wants to see on a page without JavaScript. */
const MIN_NO_JS_CHARS = 400;

function noJsText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function jsonLd(html: string): Array<Record<string, unknown>> {
  return Array.from(html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g), (match) =>
    JSON.parse(match[1])
  );
}

type Node = Record<string, unknown> & { '@type': string };

describe('the three language pages', () => {
  for (const lang of LANGUAGES) {
    describe(lang, () => {
      const html = renderLocalePage(template, lang, build);
      const dict = messages[lang];
      const text = noJsText(html);

      it('names its language and its address, and points at the other two', () => {
        expect(html).toContain(`<html lang="${lang}"`);
        expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}${localePath(lang)}" />`);
        for (const other of LANGUAGES) {
          expect(html).toContain(`<link rel="alternate" hreflang="${other}" href="${SITE_ORIGIN}${localePath(other)}" />`);
        }
        expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/" />`);
        expect(html).toContain(`<meta property="og:url" content="${SITE_ORIGIN}${localePath(lang)}" />`);
        expect(html).not.toContain('fy:head');
        expect(html).not.toContain('fy:static');
      });

      it('carries the title and description of its dictionary, at lengths a result page shows', () => {
        expect(html).toContain(`<title>${escapeHtml(dict.siteMetaTitle)}</title>`);
        expect(html).toContain(`<meta name="description" content="${escapeHtml(dict.siteMetaDescription)}" />`);
        // 70 is the upper bound the site monitor (TofsDevOps, title_len) accepts without a remark.
        expect(dict.siteMetaTitle.length).toBeLessThanOrEqual(70);
        expect(dict.siteMetaDescription.length).toBeGreaterThanOrEqual(50);
        expect(dict.siteMetaDescription.length).toBeLessThanOrEqual(160);
      });

      it('renders the hero, every section and the «how to check» block word for word', () => {
        const hero = heroCopy(lang);
        for (const line of [hero.title, hero.lead, ...hero.points, hero.action]) expect(text).toContain(line);
        for (const section of siteSections(lang)) {
          expect(text).toContain(section.title);
          if (section.lead) expect(text).toContain(section.lead);
          for (const item of section.terms ?? []) expect(text).toContain(`${item.term} ${item.text}`);
          for (const step of section.steps ?? []) expect(text).toContain(step);
          for (const row of section.table?.rows ?? []) for (const cell of row) expect(text).toContain(cell);
          for (const item of section.list ?? []) expect(text).toContain(item);
          for (const item of section.questions ?? []) expect(text).toContain(`${item.question} ${item.answer}`);
          for (const paragraph of section.paragraphs ?? []) expect(text).toContain(paragraph);
        }
        const verify = verifyCopy(lang);
        for (const line of [verify.title, verify.lead, verify.stepNetwork, verify.stepOffline]) expect(text).toContain(line);
      });

      it('has one h1 and enough text for a reader without JavaScript', () => {
        expect(html.match(/<h1\b/g)).toHaveLength(1);
        expect(text.length).toBeGreaterThanOrEqual(MIN_NO_JS_CHARS);
        // The static h1 must not satisfy the smoke test's wait for the React hero.
        expect(html).not.toContain('id="hero-title"');
      });

      it('marks up the visible questions and a truthful application record', () => {
        const blocks = jsonLd(html);
        expect(blocks).toHaveLength(1);
        const graph = blocks[0]['@graph'] as Node[];
        const byType = (type: string) => graph.find((node) => node['@type'] === type);
        const faq = byType('FAQPage') as unknown as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
        const questions = siteSections(lang).find((section) => section.id === 'sec-faq')?.questions ?? [];
        expect(faq.mainEntity.map((entry) => entry.name)).toEqual(questions.map((item) => item.question));
        expect(faq.mainEntity.map((entry) => entry.acceptedAnswer.text)).toEqual(questions.map((item) => item.answer));
        const app = byType('WebApplication') as Record<string, unknown>;
        expect(app.datePublished).toBe(DATE_PUBLISHED);
        expect(app.dateModified).toBe(build.date);
        expect(app.softwareVersion).toBe(build.version);
        expect(app.inLanguage).toBe(lang);
        expect(app.isAccessibleForFree).toBe(true);
        expect(byType('WebSite')).toBeTruthy();
        expect(byType('Organization')).toBeTruthy();
      });
    });
  }

  it('sitemap lists the three pages with the build date and their alternates', () => {
    const sitemap = renderSitemap(build.date);
    for (const lang of LANGUAGES) expect(sitemap).toContain(`<loc>${SITE_ORIGIN}${localePath(lang)}</loc>`);
    expect(sitemap.match(/<lastmod>2026-09-26<\/lastmod>/g)).toHaveLength(3);
    expect(sitemap).toContain('hreflang="x-default"');
  });

  it('llms-full.txt carries every section in English', () => {
    const full = renderLlmsFull(build);
    for (const section of siteSections('en')) expect(full).toContain(`## ${section.title}`);
    for (const lang of LANGUAGES) expect(full).toContain(`${SITE_ORIGIN}${localePath(lang)}`);
    expect(full).toContain(`Version ${build.version}, updated ${build.date}`);
  });
});

describe('localeFromPath', () => {
  it('names the three pages and nothing else', () => {
    expect(localeFromPath('/')).toBe('ru');
    expect(localeFromPath('/index.html')).toBe('ru');
    expect(localeFromPath('/en/')).toBe('en');
    expect(localeFromPath('/en')).toBe('en');
    expect(localeFromPath('/uz/index.html')).toBe('uz');
    expect(localeFromPath('/404.html')).toBeNull();
    expect(localeFromPath('/en/anything')).toBeNull();
    expect(localeFromPath('/english/')).toBeNull();
  });

  it('round-trips with localePath', () => {
    for (const lang of LANGUAGES) expect(localeFromPath(localePath(lang))).toBe(lang);
  });
});
