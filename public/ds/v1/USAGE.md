# morgunov.tech design system — v1 — integration guide

A zero-build, framework-agnostic CSS layer. Any morgunov.tech service (static
HTML, Worker-served HTML, or a framework app) can adopt the shared look by
linking these files — no npm, no package install.

License: the layer is MIT (© Semyon Morgunov, [LICENSE](../../LICENSE) in the repository); the IBM Plex fonts it links are © IBM Corp. under the SIL Open Font License 1.1 ([fonts/OFL.txt](../../fonts/OFL.txt)).

## What's in the layer

| File | What it gives you | Reusable? |
|------|-------------------|-----------|
| `tokens.css` | colour + type tokens (`--v4-*`) for 4 themes | **the brand source of truth** |
| `fonts.css` | `@font-face` for IBM Plex Sans + Mono | yes |
| `base.css` | reset, body/type defaults, `.sr-only`, `.skip-link` | yes |
| `components.css` | top bar, service mark, language switch, theme switcher, buttons (`.v4-btn`), section heads, lists, prose, footer, focus ring, `.v4-root` shell | yes |
| `chrome.js` | the behaviour of the bar: theme, the dropdown controller, anchor navigation | yes — required with the service chrome |

**Not** in the layer (page-specific to s.morgunov.tech, do not expect them):
hero, stats strip, career/ventures tables, product/use cards, /collaborate
pricing, contact block. Build your own page layout on top of the tokens.

## Canonical origin

Served today from **`https://s.morgunov.tech/ds/v1/`** (CORS `*` is enabled on
`/ds/*` and `/fonts/*`, so cross-origin CSS **and** webfonts load fine).

> `s.morgunov.tech` is the only host that serves the layer: the apex
> `morgunov.tech` and `www` answer with a 301 to it (a Cloudflare Redirect
> Rule), so never point stylesheets at them. If the layer ever moves — to a
> dedicated `ds.morgunov.tech`, say — only the host below changes; the paths
> stay identical.

Cross-origin fonts work without absolute URLs: `@font-face` resolves its
`url("/fonts/…")` against the **stylesheet's** origin (s.morgunov.tech), not the
consuming page — and the woff2 responses now send `Access-Control-Allow-Origin`.

## Drop-in `<head>` snippet

Paste into any service's `<head>`. Load order matters:
**fonts → tokens → base → components → (your page CSS)**.

```html
<!-- morgunov.tech design system v1 — non-blocking preload-swap -->
<link rel="preload" href="https://s.morgunov.tech/ds/v1/fonts.css?v=64eea157" as="style" onload="this.onload=null;this.rel='stylesheet'" />
<link rel="preload" href="https://s.morgunov.tech/ds/v1/tokens.css?v=5629caeb" as="style" onload="this.onload=null;this.rel='stylesheet'" />
<link rel="preload" href="https://s.morgunov.tech/ds/v1/base.css?v=0e404315" as="style" onload="this.onload=null;this.rel='stylesheet'" />
<link rel="preload" href="https://s.morgunov.tech/ds/v1/components.css?v=52192cae" as="style" onload="this.onload=null;this.rel='stylesheet'" />
<noscript>
  <link rel="stylesheet" href="https://s.morgunov.tech/ds/v1/fonts.css?v=64eea157" />
  <link rel="stylesheet" href="https://s.morgunov.tech/ds/v1/tokens.css?v=5629caeb" />
  <link rel="stylesheet" href="https://s.morgunov.tech/ds/v1/base.css?v=0e404315" />
  <link rel="stylesheet" href="https://s.morgunov.tech/ds/v1/components.css?v=52192cae" />
</noscript>
```

The `?v=` values are content hashes; keep them current (the source repo bumps
them automatically via `scripts/version-stamp.py`). The `/ds/v1/` path is the
major version — breaking changes ship as `/ds/v2/`.

## Theme mechanism (required)

Tokens switch on a `data-theme` attribute on `<html>` (`dark` / `high-contrast`;
absence = light). Set it **before first paint** to avoid a flash. Inline this in
`<head>` (before the stylesheet links):

```html
<script>
  (function(){var d=document.documentElement;var p='auto';try{p=localStorage.getItem('theme-preference')||'auto'}catch(e){}var t=p==='auto'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;d.setAttribute('data-theme',t);d.setAttribute('data-theme-preference',p);})();
</script>
```

The `try/catch` matters: `localStorage` itself throws when storage is blocked
(Chrome «block all cookies», some webviews) and an unguarded read would leave
the page without a theme.

## Service chrome (required for a family service)

A page on `*.morgunov.tech` made for people repeats the chrome of the main
site: the same bar, the language and theme controls in the same place, the
same footer. A visitor who knows one page of the family knows them all — a
header of the service's own makes them learn the interface again. «Tokens
only» is for two cases: a page other people host themselves (see
«Self-contained consumers») and a document for print.

| Part | Markup | Rule |
|------|--------|------|
| Skip link | `a.skip-link`, first in `<body>` | leads to `#main` |
| Shell | `div.v4-root` | up to 1280px wide |
| Bar | `header.v4-bar` | the full width of the shell, an ink rule under it |
| Service mark | `a.v4-service` → `https://s.morgunov.tech/` | `MORGUNOV.TECH / NAME`; at 640px and below only the name shows |
| Navigation | `nav.v4-nav.v4-dropdown` with `.v4-bar-mid` | at most five links; a «Меню» dropdown at 640px and below; leave the whole `nav` out when the page has no sections |
| Language | `.v4-dropdown.v4-lang` | `RU ⌄`; the items are links to the same page in the other language |
| Theme | `.v4-dropdown.v4-theme` | the icon button; four items in this order: light, dark, auto, high contrast |
| Footer | `footer.v4-foot` | name · year · the build mark on the left, the privacy line on the right |
| Build mark | `a.v4-build` in the footer | the release, `vX.Y.Z`; a link to the repository's `CHANGELOG.md` on GitHub, in a new tab |

The right edge has one order everywhere: language, then theme at the very
edge. Labels, icons and the behaviour of the menus are the site's, not
look-alikes.

<!-- chrome:snippet:start -->
```html
<body class="v4-page">
  <a href="#main" class="skip-link">Перейти к основному содержимому</a>
  <div class="v4-root">
    <header class="v4-bar" id="top">
      <a class="v4-service" href="https://s.morgunov.tech/"><span class="v4-service-family">morgunov.tech</span><span class="v4-service-sep" aria-hidden="true">/</span><span class="v4-service-name">Service</span></a>
      <nav class="v4-nav v4-dropdown" aria-label="Основная навигация">
        <button class="v4-bar-btn v4-nav-toggle" type="button" aria-controls="site-nav">Меню<svg class="v4-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"></path></svg></button>
        <div class="v4-bar-mid" id="site-nav">
          <a href="#check">Проверка</a>
          <a href="#how">Как это работает</a>
        </div>
      </nav>
      <div class="v4-bar-right">
        <div class="v4-dropdown v4-lang">
          <button class="v4-bar-btn v4-lang-btn" type="button" aria-haspopup="menu" aria-controls="lang-menu" id="lang-toggle" aria-label="RU — сменить язык">RU<svg class="v4-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"></path></svg></button>
          <div class="v4-menu" id="lang-menu" role="menu" aria-labelledby="lang-toggle">
            <a class="v4-menu-item v4-lang-link" role="menuitemradio" aria-checked="true" href="/" hreflang="ru" lang="ru">Русский</a>
            <a class="v4-menu-item v4-lang-link" role="menuitemradio" aria-checked="false" href="/en/" hreflang="en" lang="en">English</a>
          </div>
        </div>
        <div class="v4-dropdown v4-theme">
          <button class="v4-icon-btn" type="button" aria-haspopup="menu" aria-controls="theme-menu" id="theme-toggle" aria-label="Сменить тему оформления">
            <svg class="v4-icon-sun" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3"></circle><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"></path></svg>
            <svg class="v4-icon-moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 9A6 6 0 1 1 7 2.5a4.5 4.5 0 0 0 6.5 6.5z"></path></svg>
            <svg class="v4-icon-contrast" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6"></circle><path d="M8 2v12a6 6 0 0 0 0-12z" fill="currentColor"></path></svg>
          </button>
          <div class="v4-menu v4-theme-menu" id="theme-menu" role="menu" aria-labelledby="theme-toggle">
            <button class="v4-menu-item v4-theme-btn" type="button" role="menuitemradio" data-theme-value="light" aria-checked="false">Светлая</button>
            <button class="v4-menu-item v4-theme-btn" type="button" role="menuitemradio" data-theme-value="dark" aria-checked="false">Тёмная</button>
            <button class="v4-menu-item v4-theme-btn" type="button" role="menuitemradio" data-theme-value="auto" aria-checked="false">Авто</button>
            <button class="v4-menu-item v4-theme-btn" type="button" role="menuitemradio" data-theme-value="high-contrast" aria-checked="false">Высокий контраст</button>
          </div>
        </div>
      </div>
    </header>

    <main id="main">
      <!-- the page -->
    </main>

    <footer class="v4-foot">
      <span>morgunov.tech / service · 2026 · <a class="v4-build" href="https://github.com/morgunovtech/SERVICE/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">v1.5.0</a></span>
      <span class="v4-foot-privacy">Без cookies, трекеров и аналитики</span>
    </footer>
  </div>
  <script defer src="https://s.morgunov.tech/ds/v1/chrome.js?v=57a9beca"></script>
</body>
```
<!-- chrome:snippet:end -->

English labels: «Skip to main content», «Main navigation», «Menu», «EN — change
language», «Change colour theme», «Light», «Dark», «Auto», «High contrast»,
«No cookies, trackers or analytics».

**Build mark.** The footer names the release, not a commit: `vX.Y.Z`, the top entry of the
service's `CHANGELOG.md`. It is a link, and it always leads to the same place: that file in the
service's repository on GitHub (`https://github.com/<owner>/<repo>/blob/main/CHANGELOG.md`), where a
visitor reads the history of versions. Not a modal, not the releases page (a release may be missing,
the changelog is not), not a commit. A service whose repository is private has no build mark.

`chrome.js` is the site's `script.js` without its site-only parts — a checked
twin (`scripts/build-chrome.mjs`), so the menus of a service behave exactly as
on the site: one open at a time, Escape, outside click, focus-out, arrow keys,
the «theme-preference» key shared across the family's pages of one origin. It
needs nothing but the markup above and stamps `data-js` on `<html>`; without it
a `:focus-within` fallback still opens the panels, so nothing depends on
JavaScript. The theme-init script of «Theme mechanism» stays in `<head>`.

Then apply the page class on `<body>`:

```html
<body class="v4-page">
```

## Composition rules

Seven rules for a page of the family. On this site they are tests (`tests/composition.test.mjs`);
a service keeps to them by reading this list.

1. **One state — one sign, and never colour alone.** The selected item of a menu is a round mark
   before its label (`.v4-menu-item[aria-checked="true"]::before`), not coloured text in a frame.
   A toggle the script focused after a mouse click shows no focus ring (`chrome.js` marks that
   focus with `data-pointer-focus`); reached from the keyboard, it keeps the ring. Hover is orange
   text; do not add a frame, an underline or a fill to say the same thing twice.
2. **A number marks a sequence.** «Step 1 of 6» is a sequence. Sections of a page are not: a
   section head is a title and the rule under it, no «01».
3. **A link that leads on names what is behind it**, as a noun phrase: «Все проекты на GitHub»,
   not «Подробнее». A link that leaves the site ends with where it leads and carries «↗»; a link
   to a page of the same site carries «→». The glyph is added by the markup or the renderer, in
   an `aria-hidden` span after the label, never typed into the label.
4. **A row in a list of publications says when and where**: `06.2025 · YouTube`, one mono line.
   The place is the platform, taken from the address. No free-text tag, no filled chip.
5. **One button in a block.** The second way to do the same thing is a line of text with a link
   («или на почту: …»), not a second button. A link to read more first is not part of the
   button row.
6. **The build mark** — see «Service chrome».
7. **The only round shape is the live dot** (`.v4-live-dot`) and its two relatives, the busy mark
   of a button and the selected-item mark of a menu. Everything else keeps `border-radius: 0`. A
   live dot stands next to something that is running now (a service, a check in progress), not
   next to a word that already says «now».

## Captions and button states

Since v1.3.0 of the origin the caption tokens hold one value each:
`--v4-label-size` and `--v4-label-xs-size` are both 12px (they were 11px and
10px) and both trackings are 0.1em. The names are unchanged, so a consumer
needs no edit — its small caps simply grow to 12px with the next sync. A page
has two caption styles: sans caps for chrome and controls, mono caps for labels
of data; a date, a count or a version set in mono is plain 12px, never caps.

`components.css` styles every state of `.v4-btn` / `.v4-btn-primary`: hover,
focus, pressed (`:active`), disabled and busy. Disabled is `disabled` on a
`<button>` or `aria-disabled="true"` on a link — a dashed outline in
`--v4-dim`. Busy is the class `.is-busy` together with `aria-busy="true"` and
`aria-disabled="true"` while the request runs: the button keeps its look and
its focus and shows the pulsing square before the label. On a device that
cannot hover (`@media (hover: none)`) hover paints nothing, so a tapped button
does not stay inverted. A paragraph in `.v4-prose` and an item of `.v4-list`
stop at 62ch; on a phone (640px and below) `body.v4-page` is 16px.

## Self-contained consumers (inline tokens)

A product that other people self-host — the TofsDevOps status page — must not
depend on this site for its colours and layout: copy the `:root` and theme
blocks of `tokens.css` into the page's own `<style>` (they are small), write the
page CSS against `--v4-*`, and take only the fonts from here, with absolute
URLs (`src: url("https://s.morgunov.tech/fonts/plex-sans-latin-400.woff2")`,
`/fonts/*` answers with `Access-Control-Allow-Origin: *`). With
`font-display: swap` the system stack of `--v4-sans` stands in until the files
arrive, or for good when the origin is unreachable.

A copy drifts, so every copy is kept by one mechanism (TofsDevOps, Lenses,
Found You): a manifest `ds.json` next to the copy names the origin, the
directory and every file with the origin's hash — the first 8 hex characters
of `sha1(file)`, the value `scripts/version-stamp.py` writes into `?v=`, so an
entry reads «synced to `tokens.css` `fa7fc139`»:

```json
{"origin": "https://s.morgunov.tech", "root": "s.morgunov.tech",
 "files": {"ds/v1/tokens.css": "fa7fc139", "ds/v1/fonts.css": "64eea157"}}
```

`scripts/ds_sync.py <manifest> --check` (or `ds-sync.mjs --check` in a Node
project) runs offline in the consumer's CI: a file edited by hand or a
half-done sync fails it. `--write` fetches every listed file from the origin
and updates the manifest; the consumer's `.github/workflows/ds-sync.yml` runs
it weekly and opens a PR when anything changed, so a change here reaches
every copy as a reviewable PR within a week (or at once: run the workflow by
hand). The hash algorithm is therefore part of this layer's contract: keep
`?v=` at `sha1[:8]`.

The consumers that link this origin directly (Fingerprint) pin the
same `?v=` values in their HTML; the origin ignores the query and serves the
current file, so a change here reaches their visitors on the next uncached
load — but a returning visitor keeps the immutable cached copy until the pin
moves. Bumping those pins is still by hand.

A PDF rendered from HTML (WeasyPrint and the like) is a consumer too: use the
`@media print` palette of `tokens.css` as its light theme and the same
`@font-face` rules with absolute URLs — the renderer fetches the woff2 files
itself.

## Status colours (not in the layer yet)

`tokens.css` has no semantic palette: no «ok / warning / down». Until it does,
the consumers that need one (Fingerprint, the TofsDevOps status page) share
these page-local values, checked for AA on `--v4-bg` and `--v4-paper` of each
theme — the candidate for `--v4-ok`, `--v4-warn`, `--v4-bad` if they ever move
into the layer:

| Theme | ok | warn | bad |
|-------|----|------|-----|
| light | `#27703f` | `#8a5a00` | `#b3261e` |
| dark | `#6cc08a` | `#e2a93b` | `#ff7a6e` |
| high-contrast | `#7dffb0` | `#ffe08a` | `#ff8a80` |

Colour the text, the line or a square mark — never a filled block (the only
filled surface in the system is the primary button).

## Consumer Content-Security-Policy

If your service sends a CSP, allow the DS origin for styles and fonts:

```
style-src 'self' 'unsafe-inline' https://s.morgunov.tech;
font-src  'self' https://s.morgunov.tech;
script-src 'self' https://s.morgunov.tech;   (for chrome.js)
```

(`'unsafe-inline'` only if you inline the theme script above; otherwise move it
to a file and drop it.)

## Minimal example

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script>/* theme-init script from above */</script>
  <!-- DS snippet from above -->
</head>
<body class="v4-page">
  <div class="v4-root">
    <a class="v4-btn v4-btn-primary" href="#">Primary action</a>
  </div>
</body>
</html>
```

## Reduced motion

`components.css` ships its own `@media (prefers-reduced-motion: reduce)` block
(scroll-behavior reset + global animation/transition zeroing), so the DS layer
honours the preference even when a consumer loads no page stylesheet. A page
stylesheet may repeat the same block at its very end for cascade safety —
about-me-page's `styles.css` does.
