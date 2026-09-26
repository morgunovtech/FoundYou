import { formatMessage, type Language, type MessageKey } from '../i18n/messages.ts';
import { LANGUAGES, localePath } from '../i18n/locale.ts';
import { AUTHOR_URL, REPO_URL, SITE_ORIGIN, heroCopy, siteSections, verifyCopy, type SiteSection } from './siteContent.ts';

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
  /** The short commit hash (the footer's «сборка»). */
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

/**
 * The body a reader without JavaScript gets, with the classes the React tree uses, so the first
 * paint and the mounted page look the same. The hero's `h1` carries no id: the smoke test waits
 * for `#hero-title`, which is the React hero's, and must not be satisfied by the static copy.
 */
export function renderStaticBody(lang: Language, build: BuildInfo): string {
  const hero = heroCopy(lang);
  const verify = verifyCopy(lang);
  const year = build.date.slice(0, 4);
  return [
    '<div class="v4-root">',
    '<header class="v4-bar" id="top">',
    `<div class="fy-brand"><a href="${localePath(lang)}" aria-current="page">Found You</a><a href="${AUTHOR_URL}" rel="noopener noreferrer">s.morgunov.tech</a></div>`,
    '</header>',
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
    '<footer class="v4-foot">',
    `<span>Found You · morgunov.tech · ${year} · ${escapeHtml(t(lang, 'footerVersion', { version: build.version, date: build.date }))} · ${escapeHtml(t(lang, 'footerBuild'))} <code>${escapeHtml(build.id)}</code></span>`,
    `<span class="v4-foot-privacy">${escapeHtml(t(lang, 'footerPrivacy'))}</span>`,
    '</footer>',
    '</div>'
  ].join('\n');
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
