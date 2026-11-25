import { formatMessage, type Language, type MessageKey } from '../i18n/messages.ts';
import { LANGUAGES, localePath } from '../i18n/locale.ts';
import { FAMILY_URL, LANGUAGE_NAMES, SERVICE_NAME, THEME_OPTIONS } from './chrome.ts';
import { AUTHOR_URL, CHANGELOG_URL, REPO_URL, SITE_ORIGIN, heroCopy, siteSections, verifyCopy, type SiteSection } from './siteContent.ts';

/**
 * The static side of the three language pages: the `<head>` a search engine reads (title,
 * description, canonical, the hreflang set, Open Graph, JSON-LD) and the body a reader without
 * JavaScript gets — the hero, the site copy and the «how to check» block — rendered from the
 * dictionary into the template `index.html` by `localePages()` in `vite.config.ts`. React clears
 * `#root` on mount and renders the same copy from the same model (`components/SiteContent.tsx`).
 * Pure strings, no DOM: this runs inside the Vite config, in Node.
 */
export interface BuildInfo {
  /** `version` from package.json. */
  version: string;
  /** The date of the commit being built, `YYYY-MM-DD`. */
  date: string;
  /** The short commit hash: `<meta name="build">` in the head of the three pages. */
  id: string;
}

/** 1.0.0 shipped on this day (CHANGELOG.md); the old JSON-LD claimed 2024-06-01, a date nothing was published on. */
export const DATE_PUBLISHED = '2026-09-15';

/** No Uzbek card has been drawn yet; the Russian one carries the same picture and the brand. */
export const OG_IMAGE: Record<Language, string> = {
  ru: '/images/og-card-ru.png',
  en: '/images/og-card-en.png',
  uz: '/images/og-card-ru.png'
};

export const OG_LOCALE: Record<Language, string> = { ru: 'ru_RU', en: 'en_US', uz: 'uz_UZ' };

/**
 * The author as his own site declares him (the `Person` node of the JSON-LD on s.morgunov.tech):
 * the same `@id` and `url`, so a search engine joins the two; the name in the Russian page's
 * script there, in the English one's elsewhere (the Uzbek page is Latin-script too).
 */
export function authorPerson(lang: Language): Record<string, string> {
  const ru = lang === 'ru';
  return {
    '@type': 'Person',
    '@id': `${AUTHOR_URL}/#person`,
    name: ru ? 'Семён Моргунов' : 'Semyon Morgunov',
    alternateName: ru ? 'Semyon Morgunov' : 'Семён Моргунов',
    url: `${AUTHOR_URL}/`
  };
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function pageUrl(lang: Language): string {
  return `${SITE_ORIGIN}${localePath(lang)}`;
}

function t(lang: Language, key: MessageKey, params?: Record<string, string | number>): string {
  return formatMessage(lang, key, params);
}

/**
 * One `@graph`: the organisation, the site, the application with a truthful publication date,
 * the build's date and version, and the FAQ — the same six questions that are visible on the
 * page in this language, which is what the structured-data guidelines require of a FAQPage.
 */
export function structuredData(lang: Language, build: BuildInfo): Record<string, unknown> {
  const sections = siteSections(lang);
  const what = sections.find((section) => section.id === 'sec-what');
  const faq = sections.find((section) => section.id === 'sec-faq');
  const organisationId = `${SITE_ORIGIN}/#organization`;
  const url = pageUrl(lang);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organisationId,
        name: 'Morgunov Tech',
        url: `${AUTHOR_URL}/`,
        logo: `${SITE_ORIGIN}/icon-512.png`
      },
      {
        '@type': 'WebSite',
        '@id': `${url}#website`,
        url,
        name: 'Found You',
        inLanguage: lang,
        publisher: { '@id': organisationId }
      },
      {
        '@type': 'WebApplication',
        '@id': `${url}#app`,
        name: 'Found You',
        alternateName: 'Meta Data Insight',
        url,
        image: `${SITE_ORIGIN}${OG_IMAGE[lang]}`,
        description: t(lang, 'siteMetaDescription'),
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any (browser-based)',
        browserRequirements: 'Requires JavaScript and WebAssembly',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
        softwareVersion: build.version,
        datePublished: DATE_PUBLISHED,
        dateModified: build.date,
        inLanguage: lang,
        featureList: (what?.terms ?? []).map((item) => `${item.term} — ${item.text}`),
        creator: { '@id': organisationId },
        author: authorPerson(lang),
        isPartOf: { '@id': `${url}#website` }
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        inLanguage: lang,
        mainEntity: (faq?.questions ?? []).map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer }
        }))
      }
    ]
  };
}

export function renderHead(lang: Language, build: BuildInfo): string {
  const title = escapeHtml(t(lang, 'siteMetaTitle'));
  const description = escapeHtml(t(lang, 'siteMetaDescription'));
  const ogTitle = escapeHtml(t(lang, 'siteOgTitle'));
  const ogAlt = escapeHtml(t(lang, 'siteOgImageAlt'));
  const image = `${SITE_ORIGIN}${OG_IMAGE[lang]}`;
  const alternates = LANGUAGES.filter((other) => other !== lang);
  // `</script>` inside a JSON string would end the block; `<` never appears in the dictionary, but a
  // future value must not be able to.
  const jsonLd = JSON.stringify(structuredData(lang, build), null, 2).replace(/</g, '\\u003c');
  const lines = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${pageUrl(lang)}" />`,
    ...LANGUAGES.map((other) => `<link rel="alternate" hreflang="${other}" href="${pageUrl(other)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${pageUrl('ru')}" />`,
    // The deployed commit, for whoever checks a release: the footer names the version only.
    `<meta name="build" content="${escapeHtml(build.id)}" />`,
    '',
    '<!-- Open Graph -->',
    '<meta property="og:type" content="website" />',
    `<meta property="og:url" content="${pageUrl(lang)}" />`,
    `<meta property="og:title" content="${ogTitle}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${image}" />`,
    '<meta property="og:image:type" content="image/png" />',
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${ogAlt}" />`,
    `<meta property="og:locale" content="${OG_LOCALE[lang]}" />`,
    ...alternates.map((other) => `<meta property="og:locale:alternate" content="${OG_LOCALE[other]}" />`),
    '<meta property="og:site_name" content="Found You" />',
    '',
    '<!-- Twitter Card -->',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${ogTitle}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:image:alt" content="${ogAlt}" />`,
    '',
    '<!-- Structured data: Organization, WebSite, WebApplication, FAQPage (the questions below on the page) -->',
    '<script type="application/ld+json">',
    jsonLd,
    '</script>'
  ];
  return lines.join('\n    ');
}

function renderSection(section: SiteSection): string {
  const parts: string[] = [];
  if (section.lead) parts.push(`<p class="fy-site-lead">${escapeHtml(section.lead)}</p>`);
  if (section.terms) {
    parts.push(
      `<dl class="fy-site-terms">${section.terms
        .map((item) => `<div><dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.text)}</dd></div>`)
        .join('')}</dl>`
    );
  }
  if (section.steps) parts.push(`<ol class="fy-site-steps">${section.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`);
  if (section.table) {
    const head = section.table.columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join('');
    const body = section.table.rows
      .map((row) => `<tr><th scope="row">${escapeHtml(row[0])}</th><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td></tr>`)
      .join('');
    parts.push(`<table class="fy-site-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
  }
  if (section.list) parts.push(`<ul class="fy-site-list">${section.list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
  if (section.questions) {
    parts.push(
      section.questions
        .map((item) => `<div class="fy-site-qa"><h3 class="fy-site-q">${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p></div>`)
        .join('')
    );
  }
  if (section.paragraphs) parts.push(section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join(''));
  if (section.link) parts.push(`<p><a href="${escapeHtml(section.link.href)}" rel="noopener noreferrer">${escapeHtml(section.link.label)}</a></p>`);
  return [
    `<section class="v4-section fy-site" id="${section.id}" aria-labelledby="${section.id}-title">`,
    `<h2 class="v4-h2" id="${section.id}-title">${escapeHtml(section.title)}</h2>`,
    ...parts,
    '</section>'
  ].join('\n');
}

const CHEVRON =
  '<svg class="v4-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"></path></svg>';

const THEME_ICONS = [
  '<svg class="v4-icon-sun" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3"></circle><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"></path></svg>',
  '<svg class="v4-icon-moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 9A6 6 0 1 1 7 2.5a4.5 4.5 0 0 0 6.5 6.5z"></path></svg>',
  '<svg class="v4-icon-contrast" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6"></circle><path d="M8 2v12a6 6 0 0 0 0-12z" fill="currentColor"></path></svg>'
].join('');

/**
 * How one copy of the chrome is written into a page. The three language pages carry it once;
 * 404.html is one file for every language and carries it three times, each copy marked with its
 * language and shown by `html[lang]` — so the ids take a suffix there.
 */
export interface ChromeOptions {
  /** Appended to every id (`lang-menu-en`). */
  idSuffix?: string;
  /** Extra attributes of the outer element, with the leading space (` lang="en" data-fy-l="en"`). */
  attrs?: string;
}

/** The link a keyboard reader meets first: straight to the content (`#main`). */
export function renderSkipLink(lang: Language, options: ChromeOptions = {}): string {
  return `<a href="#main" class="skip-link"${options.attrs ?? ''}>${escapeHtml(t(lang, 'skipToContent'))}</a>`;
}

/**
 * The family bar as a string: the markup of `public/ds/v1/USAGE.md`, «Service chrome» — the
 * mark, the language menu (links to the same page in each language), the theme menu (four items
 * in the family's order). `components/SiteHeader.tsx` draws the same markup in React;
 * `src/__tests__/site/chrome.test.ts` compares the two.
 */
export function renderBar(lang: Language, options: ChromeOptions = {}): string {
  const id = (name: string) => `${name}${options.idSuffix ?? ''}`;
  const code = lang.toUpperCase();
  const languages = LANGUAGES.map(
    (entry) =>
      `<a class="v4-menu-item v4-lang-link" role="menuitemradio" aria-checked="${entry === lang}" href="${localePath(entry)}" hreflang="${entry}" lang="${entry}">${escapeHtml(LANGUAGE_NAMES[entry])}</a>`
  );
  const themes = THEME_OPTIONS.map(
    (option) =>
      `<button class="v4-menu-item v4-theme-btn" type="button" role="menuitemradio" data-theme-value="${option.value}" aria-checked="false">${escapeHtml(t(lang, option.labelKey))}</button>`
  );
  return [
    `<header class="v4-bar" id="${id('top')}"${options.attrs ?? ''}>`,
    `<a class="v4-service" href="${FAMILY_URL}"><span class="v4-service-family">morgunov.tech</span><span class="v4-service-sep" aria-hidden="true">/</span><span class="v4-service-name">${escapeHtml(SERVICE_NAME)}</span></a>`,
    '<div class="v4-bar-right">',
    '<div class="v4-dropdown v4-lang">',
    `<button class="v4-bar-btn v4-lang-btn" type="button" aria-haspopup="menu" aria-controls="${id('lang-menu')}" id="${id('lang-toggle')}" aria-label="${escapeHtml(`${code} — ${t(lang, 'langMenuLabel')}`)}">${code}${CHEVRON}</button>`,
    `<div class="v4-menu" id="${id('lang-menu')}" role="menu" aria-labelledby="${id('lang-toggle')}">`,
    ...languages,
    '</div>',
    '</div>',
    '<div class="v4-dropdown v4-theme">',
    `<button class="v4-icon-btn" type="button" aria-haspopup="menu" aria-controls="${id('theme-menu')}" id="${id('theme-toggle')}" aria-label="${escapeHtml(t(lang, 'themeMenuLabel'))}">${THEME_ICONS}</button>`,
    `<div class="v4-menu v4-theme-menu" id="${id('theme-menu')}" role="menu" aria-labelledby="${id('theme-toggle')}">`,
    ...themes,
    '</div>',
    '</div>',
    '</div>',
    '</header>'
  ].join('\n');
}

/**
 * The family footer: name · year · the build mark on the left, the privacy line on the right,
 * and nothing else. The build mark is the release as a link to the changelog on GitHub.
 */
export function renderFoot(lang: Language, build: BuildInfo, options: ChromeOptions = {}): string {
  const year = build.date.slice(0, 4);
  return [
    `<footer class="v4-foot"${options.attrs ?? ''}>`,
    `<span>morgunov.tech / found you · ${year} · <a class="v4-build" href="${CHANGELOG_URL}" target="_blank" rel="noopener noreferrer">v${escapeHtml(build.version)}</a></span>`,
    `<span class="v4-foot-privacy">${escapeHtml(t(lang, 'footerPrivacy'))}</span>`,
    '</footer>'
  ].join('\n');
}

/**
 * The body a reader without JavaScript gets, with the classes the React tree uses, so the first
 * paint and the mounted page look the same. The hero's `h1` carries no id: the smoke test waits
 * for `#hero-title`, which is the React hero's, and must not be satisfied by the static copy.
 */
export function renderStaticBody(lang: Language, build: BuildInfo): string {
  const hero = heroCopy(lang);
  const verify = verifyCopy(lang);
  return [
    renderSkipLink(lang),
    '<div class="v4-root">',
    renderBar(lang),
    '<main id="main" class="fy-main">',
    '<section class="fy-hero">',
    '<div class="fy-hero-text">',
    `<h1 class="fy-h1">${escapeHtml(hero.title)}</h1>`,
    `<p class="fy-tagline">${escapeHtml(hero.lead)}</p>`,
    `<ul class="fy-intro-list">${hero.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>`,
    `<p class="fy-tagline fy-intro-action">${escapeHtml(hero.action)}</p>`,
    '</div>',
    '</section>',
    ...siteSections(lang).map(renderSection),
    '<section class="v4-section fy-howto" aria-labelledby="sec-verify">',
    `<h2 class="v4-h2" id="sec-verify">${escapeHtml(verify.title)}</h2>`,
    `<p class="fy-verify-lead">${escapeHtml(verify.lead)}</p>`,
    '<ol class="fy-verify-steps">',
    `<li>${escapeHtml(verify.stepNetwork)}</li>`,
    `<li>${escapeHtml(verify.stepOffline)}</li>`,
    `<li>${escapeHtml(verify.stepGuard)} <a href="${REPO_URL}" rel="noopener noreferrer">${escapeHtml(verify.repoLink)}</a>.</li>`,
    '</ol>',
    '</section>',
    '</main>',
    renderFoot(lang, build),
    '</div>'
  ].join('\n');
}

/**
 * 404.html: one file Cloudflare Pages serves for every unknown address, in whichever of the
 * three languages `theme-init.js` puts on `<html lang>`. It carries the chrome once per language
 * at the `<!-- fy:skips -->`, `<!-- fy:bars -->` and `<!-- fy:foots -->` markers; the page's own
 * rule shows the copy of the current language. The menus are driven by the layer's `chrome.js`
 * — there is no React on this page.
 */
export function renderNotFoundPage(template: string, build: BuildInfo): string {
  const parts: Array<[string, (lang: Language, options: ChromeOptions) => string]> = [
    ['<!-- fy:skips -->', renderSkipLink],
    ['<!-- fy:bars -->', renderBar],
    ['<!-- fy:foots -->', (lang, options) => renderFoot(lang, build, options)]
  ];
  let page = template;
  for (const [marker, render] of parts) {
    if (!page.includes(marker)) throw new Error(`locale-pages: 404.html has no ${marker} marker`);
    const copies = LANGUAGES.map((lang) => render(lang, { idSuffix: `-${lang}`, attrs: ` lang="${lang}" data-fy-l="${lang}"` }));
    page = page.replace(marker, copies.join('\n'));
  }
  return page;
}

/**
 * The page of one language from the template: `<html lang>`, the `<!-- fy:head -->` marker and
 * the `<!-- fy:static -->` marker inside `#root`. A template without a marker is an error, not a
 * page that quietly ships without its head.
 */
export function renderLocalePage(template: string, lang: Language, build: BuildInfo): string {
  for (const marker of ['<!-- fy:head -->', '<!-- fy:static -->']) {
    if (!template.includes(marker)) throw new Error(`locale-pages: index.html has no ${marker} marker`);
  }
  return template
    .replace(/<html lang="[a-z]+"/, `<html lang="${lang}"`)
    .replace('<!-- fy:head -->', renderHead(lang, build))
    .replace('<!-- fy:static -->', renderStaticBody(lang, build));
}

export function renderSitemap(date: string): string {
  const alternates = LANGUAGES.map(
    (lang) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${pageUrl(lang)}" />`
  ).join('');
  const entries = LANGUAGES.map(
    (lang) =>
      `  <url>\n    <loc>${pageUrl(lang)}</loc>\n    <lastmod>${date}</lastmod>\n    ${alternates}<xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl('ru')}" />\n  </url>`
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    ''
  ].join('\n');
}

/** Everything the interface explains, in English, for an assistant that read llms.txt and wants the rest. */
export function renderLlmsFull(build: BuildInfo): string {
  const lang: Language = 'en';
  const hero = heroCopy(lang);
  const verify = verifyCopy(lang);
  const lines: string[] = [
    '# Found You — full reference for AI assistants',
    '',
    `> ${t(lang, 'siteMetaDescription')} Version ${build.version}, updated ${build.date}. Short summary: ${SITE_ORIGIN}/llms.txt`,
    '',
    '## Pages',
    '',
    ...LANGUAGES.map((page) => `- ${pageUrl(page)} — ${page === 'ru' ? 'Russian (default)' : page === 'en' ? 'English' : 'Uzbek'}`),
    '',
    `## ${hero.title}`,
    '',
    hero.lead,
    '',
    ...hero.points.map((point) => `- ${point}`),
    '',
    hero.action,
    ''
  ];
  for (const section of siteSections(lang)) {
    lines.push(`## ${section.title}`, '');
    if (section.lead) lines.push(section.lead, '');
    if (section.terms) lines.push(...section.terms.map((item) => `- **${item.term}** — ${item.text}`), '');
    if (section.steps) lines.push(...section.steps.map((step, index) => `${index + 1}. ${step}`), '');
    if (section.table) {
      lines.push(
        `| ${section.table.columns.join(' | ')} |`,
        '|---|---|---|',
        ...section.table.rows.map((row) => `| ${row.join(' | ')} |`),
        ''
      );
    }
    if (section.list) lines.push(...section.list.map((item) => `- ${item}`), '');
    if (section.questions) {
      for (const item of section.questions) lines.push(`### ${item.question}`, '', item.answer, '');
    }
    if (section.paragraphs) lines.push(...section.paragraphs, '');
    if (section.link) lines.push(`${section.link.label}: ${section.link.href}`, '');
  }
  lines.push(
    `## ${verify.title}`,
    '',
    verify.lead,
    '',
    `1. ${verify.stepNetwork}`,
    `2. ${verify.stepOffline}`,
    `3. ${verify.stepGuard} ${REPO_URL}`,
    '',
    '## Source and licence',
    '',
    `MIT. Repository: ${REPO_URL}. Author: ${AUTHOR_URL}`,
    ''
  );
  return lines.join('\n');
}
