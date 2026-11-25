import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteFooter } from '../../components/SiteFooter';
import { SiteHeader } from '../../components/SiteHeader';
import { I18nProvider, messages, type Language } from '../../i18n';
import { LANGUAGES } from '../../i18n/locale';
import {
  renderBar,
  renderFoot,
  renderHead,
  renderNotFoundPage,
  renderSkipLink,
  renderStaticBody
} from '../../site/renderStatic';
import { CHANGELOG_URL } from '../../site/siteContent';
import { ThemeProvider } from '../../theme';

// The bar and the footer are the family's, the same on every morgunov.tech page. They are drawn
// in two places here — as strings (the first paint of the three pages, and 404.html) and in
// React — and both must be the markup of the contract: the snippet of «Service chrome» in the
// vendored public/ds/v1/USAGE.md. A sync that brings a new contract fails this file until the
// header follows it.
const root = path.resolve(__dirname, '../../..');
const year = String(new Date().getFullYear());
const build = { version: __VERSION__, date: `${year}-01-01`, id: 'abc1234' };

interface Node {
  tag: string;
  attrs: Record<string, string>;
}

const decode = (text: string) =>
  text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Opening tags, closing tags and text of a fragment, in order; attributes by name. */
function parse(html: string): Array<Node | string> {
  const out: Array<Node | string> = [];
  const token = /<!--[\s\S]*?-->|<(\/?)([a-z0-9]+)((?:\s+[a-zA-Z:-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
  for (const match of html.matchAll(token)) {
    if (match[4] !== undefined) {
      const text = decode(match[4]).replace(/\s+/g, ' ').trim();
      if (text) out.push(`"${text}"`);
    } else if (match[2] && match[1]) {
      out.push(`</${match[2]}>`);
    } else if (match[2]) {
      const attrs: Record<string, string> = {};
      // HTML attribute names are case-insensitive: React writes `hrefLang`, the string `hreflang`.
      for (const [, name, value] of match[3].matchAll(/([a-zA-Z:-]+)(?:="([^"]*)")?/g))
        attrs[name.toLowerCase()] = decode(value ?? '');
      out.push({ tag: match[2], attrs });
    }
  }
  return out;
}

/**
 * A fragment as comparable lines. What a script sets at run time is left out: `aria-expanded`
 * (the controller stamps it on the toggles) and the checked theme (the stored preference).
 */
function lines(html: string): string[] {
  return parse(html).map((node) => {
    if (typeof node === 'string') return node;
    const names = Object.keys(node.attrs)
      .filter((name) => name !== 'aria-expanded' && !(name === 'aria-checked' && 'data-theme-value' in node.attrs))
      .sort();
    return `<${node.tag} ${names.map((name) => `${name}="${node.attrs[name]}"`).join(' ')}>`;
  });
}

/** Elements as `tag.class.class`, runs of the same element collapsed: the shape of the markup. */
function skeleton(html: string): string[] {
  const out: string[] = [];
  for (const node of parse(html)) {
    if (typeof node === 'string') continue;
    const entry = [node.tag, ...(node.attrs.class ?? '').split(/\s+/).filter(Boolean)].join('.');
    if (out[out.length - 1] !== entry) out.push(entry);
  }
  return out;
}

function contractSnippet(): string {
  const usage = readFileSync(path.join(root, 'public/ds/v1/USAGE.md'), 'utf8');
  const snippet = /<!-- chrome:snippet:start -->([\s\S]*?)<!-- chrome:snippet:end -->/.exec(usage)?.[1];
  if (!snippet) throw new Error('public/ds/v1/USAGE.md has no chrome snippet');
  return snippet;
}

const slice = (html: string, tag: string) => new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`).exec(html)?.[0] ?? '';

function reactChrome(lang: Language, node: React.ReactElement): string {
  // The provider reads the language from the address, then the browser's list; a test has no
  // address, so the list names it.
  vi.stubGlobal('navigator', { languages: [lang], language: lang });
  return renderToStaticMarkup(
    <I18nProvider>
      <ThemeProvider>{node}</ThemeProvider>
    </I18nProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the family bar', () => {
  it('is the markup of the contract (USAGE.md, «Service chrome») without the optional nav', () => {
    // This page has no section navigation, and the contract says to leave the whole nav out then.
    const contract = slice(contractSnippet(), 'header').replace(/<nav[\s\S]*?<\/nav>/, '');
    expect(skeleton(renderBar('ru'))).toEqual(skeleton(contract));
  });

  it('carries the mark, three language links and the four themes in the family order', () => {
    const bar = renderBar('en');
    expect(bar).toContain(
      '<a class="v4-service" href="https://s.morgunov.tech/"><span class="v4-service-family">morgunov.tech</span><span class="v4-service-sep" aria-hidden="true">/</span><span class="v4-service-name">Found You</span></a>'
    );
    expect(
      [
        ...bar.matchAll(
          /class="v4-menu-item v4-lang-link"[^>]* aria-checked="(true|false)" href="([^"]+)" hreflang="([a-z]+)"/g
        )
      ].map((m) => m.slice(1))
    ).toEqual([
      ['false', '/', 'ru'],
      ['true', '/en/', 'en'],
      ['false', '/uz/', 'uz']
    ]);
    expect([...bar.matchAll(/data-theme-value="([a-z-]+)"/g)].map((m) => m[1])).toEqual([
      'light',
      'dark',
      'auto',
      'high-contrast'
    ]);
    expect(bar).toContain('aria-label="EN — change language"');
    expect(bar).toContain('aria-label="Change colour theme"');
  });

  it.each(LANGUAGES)('React draws the same bar as the static page, %s', (lang) => {
    expect(lines(reactChrome(lang, <SiteHeader />))).toEqual(lines(renderBar(lang)));
  });
});

describe('the family footer', () => {
  it('is the markup of the contract', () => {
    expect(skeleton(renderFoot('ru', build))).toEqual(skeleton(slice(contractSnippet(), 'footer')));
  });

  it('names the release and leads to the changelog of this repository on GitHub, in a new tab', () => {
    expect(CHANGELOG_URL).toBe('https://github.com/morgunovtech/FoundYou/blob/main/CHANGELOG.md');
    const foot = renderFoot('ru', { version: '9.9.9', date: '2026-11-25', id: 'abc1234' });
    expect(foot).toContain(
      `<span>morgunov.tech / found you · 2026 · <a class="v4-build" href="${CHANGELOG_URL}" target="_blank" rel="noopener noreferrer">v9.9.9</a></span>`
    );
    // Neither the date nor the commit: the changelog has the first, a visitor does not ask for the second.
    expect(foot).not.toContain('2026-11-25');
    expect(foot).not.toContain('abc1234');
  });

  it('the deployed commit is in the head, not on the page', () => {
    expect(renderHead('ru', { version: '9.9.9', date: '2026-11-25', id: 'abc1234' })).toContain(
      '<meta name="build" content="abc1234" />'
    );
  });

  it('package.json names the top entry of the changelog', () => {
    const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
    const top = /^## (\d+\.\d+\.\d+) — /m.exec(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'))?.[1];
    expect(version).toBe(top);
  });

  it.each(LANGUAGES)('React draws the same footer as the static page, %s', (lang) => {
    expect(lines(reactChrome(lang, <SiteFooter />))).toEqual(lines(renderFoot(lang, build)));
  });
});

describe('the static pages', () => {
  it.each(LANGUAGES)('%s: skip link, then the shell with the bar first and the footer last', (lang) => {
    const body = renderStaticBody(lang, build);
    expect(body.startsWith(`${renderSkipLink(lang)}\n<div class="v4-root">\n${renderBar(lang)}\n<main id="main"`)).toBe(
      true
    );
    expect(body.endsWith(`</main>\n${renderFoot(lang, build)}\n</div>`)).toBe(true);
    expect(body).toContain(messages[lang].skipToContent);
  });

  it('404.html carries the chrome once per language, each copy marked and with ids of its own', () => {
    const page = renderNotFoundPage(readFileSync(path.join(root, '404.html'), 'utf8'), build);
    expect(page).not.toMatch(/<!-- fy:(skips|bars|foots) -->/);
    for (const lang of LANGUAGES) {
      const options = { idSuffix: `-${lang}`, attrs: ` lang="${lang}" data-fy-l="${lang}"` };
      expect(page).toContain(renderSkipLink(lang, options));
      expect(page).toContain(renderBar(lang, options));
      expect(page).toContain(renderFoot(lang, build, options));
      // The rule that shows one copy: every other language hides this one.
      expect(page).toContain(`html:not([lang="${lang}"]) [data-fy-l="${lang}"]`);
    }
    const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    // No React here: the layer's own controller drives the menus.
    expect(page).toContain('<script defer src="/ds/v1/chrome.js?v=dev"></script>');
    expect(page).toContain('<main id="main" class="fy-404">');
  });

  it('a 404.html without a marker is an error, not a page without its chrome', () => {
    expect(() => renderNotFoundPage('<body><!-- fy:skips --><!-- fy:bars --></body>', build)).toThrow(/fy:foots/);
  });
});
