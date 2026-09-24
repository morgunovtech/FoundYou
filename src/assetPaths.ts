/*
 * Where the self-hosted runtime assets are served from. Each root carries the installed
 * package version in its path (`/mediapipe/1.0.1/…`), written by `scripts/prepare-assets.mjs`
 * and injected here by Vite from the same `scripts/asset-versions.mjs`; `public/_headers`
 * caches those paths as immutable for a year. Before 2026-09-24 the paths were unversioned and
 * cached for a day, so every returning visitor fetched the 33 MB of models again the next day.
 */
const versions = __ASSET_VERSIONS__;

export const OCR_BASE = `/ocr/${versions.ocr}`;
export const MEDIAPIPE_BASE = `/mediapipe/${versions.mediapipe}`;
export const C2PA_BASE = `/c2pa/${versions.c2pa}`;
export const ZXING_BASE = `/zxing/${versions.zxing}`;
