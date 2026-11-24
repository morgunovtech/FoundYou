# morgunov.tech design system — v1 — integration guide

A zero-build, framework-agnostic CSS layer. Any morgunov.tech service (static
HTML, Worker-served HTML, or a framework app) can adopt the shared look by
linking these files — no npm, no package install.

## What's in the layer

| File | What it gives you | Reusable? |
|------|-------------------|-----------|
| `tokens.css` | colour + type tokens (`--v4-*`) for 4 themes | **the brand source of truth** |
| `fonts.css` | `@font-face` for IBM Plex Sans + Mono | yes |
| `base.css` | reset, body/type defaults, `.sr-only`, `.skip-link` | yes |
| `components.css` | top bar, language switch, theme switcher, buttons (`.v4-btn`), section heads, lists, prose, footer, focus ring, `.v4-root` shell | yes |

**Not** in the layer (page-specific to s.morgunov.tech, do not expect them):
hero, stats strip, career/ventures tables, product/use cards, /collaborate
pricing, contact block. Build your own page layout on top of the tokens.

## Canonical origin

Served today from **`https://s.morgunov.tech/ds/v1/`** (CORS `*` is enabled on
`/ds/*` and `/fonts/*`, so cross-origin CSS **and** webfonts load fine).

> When the apex `morgunov.tech` is confirmed to serve this same Pages project
> (or a dedicated `ds.morgunov.tech` is set up), switch the host below — the
> paths stay identical. Until then use `s.morgunov.tech`.

Cross-origin fonts work without absolute URLs: `@font-face` resolves its
`url("/fonts/…")` against the **stylesheet's** origin (s.morgunov.tech), not the
consuming page — and the woff2 responses now send `Access-Control-Allow-Origin`.

## Drop-in `<head>` snippet

Paste into any service's `<head>`. Load order matters:
**fonts → tokens → base → components → (your page CSS)**.

```html
<!-- morgunov.tech design system v1 — non-blocking preload-swap -->
<link rel="preload" href="https://s.morgunov.tech/ds/v1/fonts.css?v=64eea157" as="style" onload="this.onload=null;this.rel='stylesheet'" />
<link rel="preload" href="https://s.morgunov.tech/ds/v1/tokens.css?v=fa7fc139" as="style" onload="this.onload=null;this.rel='stylesheet'" />
<link rel="preload" href="https://s.morgunov.tech/ds/v1/base.css?v=0e404315" as="style" onload="this.onload=null;this.rel='stylesheet'" />
<link rel="preload" href="https://s.morgunov.tech/ds/v1/components.css?v=f7d07a70" as="style" onload="this.onload=null;this.rel='stylesheet'" />
<noscript>
  <link rel="stylesheet" href="https://s.morgunov.tech/ds/v1/fonts.css?v=64eea157" />
  <link rel="stylesheet" href="https://s.morgunov.tech/ds/v1/tokens.css?v=fa7fc139" />
  <link rel="stylesheet" href="https://s.morgunov.tech/ds/v1/base.css?v=0e404315" />
  <link rel="stylesheet" href="https://s.morgunov.tech/ds/v1/components.css?v=f7d07a70" />
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

## Top bar (optional chrome)

`components.css` ships the header primitives the main site uses: a `.v4-bar`
with a `.v4-nav.v4-dropdown` (links inline on desktop, a «Menu» dropdown
≤640px) and two more dropdowns on the right — language (`.v4-lang`) and theme
(`.v4-theme`). Every dropdown is the same shape: a toggle button with
`aria-controls` + a `.v4-menu` panel of `.v4-menu-item`s. The site's
`script.js` drives them (one open at a time, Escape/outside click/focus-out,
arrow keys) and stamps `data-js` on `<html>`; without it a `:focus-within`
fallback still opens the panels, so nothing depends on JavaScript. Copy the
header markup from any page of the site, or skip it and keep just the tokens.

Then apply the page class on `<body>`:

```html
<body class="v4-page">
```

## Consumer Content-Security-Policy

If your service sends a CSP, allow the DS origin for styles and fonts:

```
style-src 'self' 'unsafe-inline' https://s.morgunov.tech;
font-src  'self' https://s.morgunov.tech;
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
