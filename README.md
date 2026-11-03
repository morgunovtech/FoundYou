# Found You

A web app for anyone about to share a photo: it shows what the picture gives away about place, time, device and the people in it, and makes a cleaned copy without uploading the file anywhere.

**Live:** https://foundyou.morgunov.tech · **License:** [MIT](LICENSE) · **Русская версия:** [README.ru.md](README.ru.md)

## What it does

- **Opens common photo formats:** JPEG, PNG, WebP, AVIF, GIF, BMP and HEIC/HEIF. HEIC is decoded locally: `createImageBitmap`, then `<img>`, then the bundled `libheif-js`.
- **Reads the metadata:** EXIF, XMP, IPTC and ICC via `exifr`; for PNG also IHDR and the `tEXt`/`zTXt`/`iTXt` chunks (a Stable Diffusion prompt, for example). For HEIC the EXIF block is pulled out of the container by hand.
- **Finds faces, people and objects** with MediaPipe Tasks Vision: two BlazeFace passes (short- and full-range, on the frame as is and rotated 90° each way) for faces, EfficientDet-Lite2 (COCO labels) for people and objects. The result is drawn over the photo with a plain-language description of the scene.
- **Reads text** with Tesseract.js (Russian and English) and looks in it for license plates, card numbers (Luhn check), IBANs (mod 97), passport machine-readable zones, phone numbers, e-mail addresses, account names and document keywords. Text on signs is matched against the street, house number and nearby places already fetched; nothing extra is sent.
- **Decodes QR codes** on the device (`BarcodeDetector` or the bundled `jsqr`) and says what they are: Wi-Fi with a password, contact card, boarding pass, payment code, invite link. Contents are shown masked. If no QR code is found, `zxing-wasm` is loaded to read other barcodes (PDF417, Aztec, Data Matrix, Code 128).
- **Lists facts, not verdicts.** "What the photo says about you" covers where it was taken (map, nearby places), how (shot diagram), when, text and codes, and what it was taken on: device and OS, creation and edit dates with editing traces, authenticity. Each fact shows only the data; there are no conclusions about habits. "Show raw data" opens a table with every field.
- **Checks authenticity:** AI-generator traces down to the model and the prompt, screenshot likelihood with reasons, JPEG quantization tables against the camera named in EXIF, exposure against the sun's position, timestamp consistency, Live/Motion Photo as a sign of an untouched original, serial numbers and Content Credentials (C2PA: the self-hosted `c2pa` toolkit is loaded only when the file carries a signed manifest, and validates it). The "Frame checks" card runs three pixel tests on request (an error level map for pasted or redrawn areas, how many times the file was saved as JPEG, a noise map for areas with foreign grain) and says for each what was done, what was looked for, what came out and what it does not prove.
- **Judges where the file came from:** one judge (`src/utils/originJudge.ts`) combines the EXIF camera block, file name, a size at a messenger's limit, quantization tables, Live/Motion Photo markers, dates, the size against the one the camera recorded, and the thumbnail into one line with a confidence level and the reasons.
- **Scores the leak:** a 0–100 index with the cards and weights behind it, marked as an estimate rather than a fact. The same calculation predicts the index of the cleaned copy for the chosen settings (for example "73 → 20").
- **Adds place context** when EXIF has coordinates: address, historical weather for the hour of the shot, public holidays, nearby places (venues within 250 m, sights within 1 km, parks within 500 m, natural features and settlements within 1.5 km), surveillance cameras mapped in OpenStreetMap within 300 m, and a map (MapLibre GL, OSM raster tiles). The shot diagram is built from GPS and camera tags: direction and field of view, portrait or landscape, front or rear camera, speed, sun position (NOAA algorithm), camera clock against the local time zone, GPS altitude against the terrain. A tip explains how to turn off geotags for the device maker and model found in EXIF.
- **Makes a safe copy:** re-encodes through `<canvas>`, strips segments the browser adds itself (ICC profile, COM and so on), then re-reads the result with `exifr` and shows "N metadata fields before, 0 left". The "Metadata only" preset keeps JPEG/PNG pixels byte for byte and removes only metadata segments and anything after the end of the image (Samsung trailer, Motion Photo); other sources are re-encoded once at the highest quality.
- **Cleanup options:** blur faces, OCR text, license plates, QR codes, documents and contacts, or areas painted with a brush; weaken the camera sensor fingerprint (PRNU, on by default); reverse-image-search protection at three levels, tuned against a perceptual hash to a distance of 10, 14 or 18 bits out of 64; mirror; downscale; watermark; output format (original, JPEG, PNG, WebP) and quality; a neutral `photo-xxxxxx.ext` file name (on by default). Where the Web Share API is available (iOS, Android, macOS Safari), "Clean and share" sends the file straight to the share sheet, bypassing the gallery.
- **Three languages, four themes:** Russian, English and Uzbek at `/`, `/en/` and `/uz/`, each with its own title, description, `hreflang`, JSON-LD and a static copy of the page text for crawlers that do not run JavaScript. Themes: light, dark, auto, high-contrast.

## Privacy

**The photo never leaves the browser.** The file and its pixels stay on the device. Metadata parsing, detection, OCR, the profile heuristics, cleanup, export and verification of the result run there and make no network requests.

**What the Functions receive.** Only when EXIF has coordinates, the page automatically asks the site's own Cloudflare Pages Functions for place context and says right under the result what was sent:

- latitude and longitude, rounded to 4 decimals (~11 m) on the client (`src/hooks/useGeoContext.ts`) and rounded again on the server;
- the capture date and time (ISO `timestamp` and the camera's wall-clock `local`), only for the weather request;
- the country code from the geocoder's answer and the date, only for the holidays request (the code also picks the Wikipedia languages for landmarks).

The image, the file name and the rest of the metadata are not sent.

| Endpoint | Receives | Upstream |
|---|---|---|
| `/api/reverse-geocode` | `lat`, `lon` | Nominatim |
| `/api/historical-weather` | `lat`, `lon`, `timestamp`, `local` | Open-Meteo Archive |
| `/api/elevation` | `lat`, `lon` | Open-Meteo Elevation (Copernicus GLO-90) |
| `/api/nearby-poi` | `lat`, `lon` | Overpass (OSM) |
| `/api/surveillance-candidates` | `lat`, `lon` | Overpass (OSM) |
| `/api/place-context` | `lat`, `lon` | Overpass (OSM) |
| `/api/landmarks` | `lat`, `lon`, `country` (optional) | Wikipedia geosearch |
| `/api/holidays` | `country`, `date` | Nager.Date; a built-in table for countries it does not cover (currently only UZ) |
| `/api/tiles/{z}/{x}/{y}.png` | tile coordinates | tile.openstreetmap.org |

**The Functions are proxies for this site only.** Each handler accepts only GET/HEAD, checks `Sec-Fetch-Site` (falling back to `Origin`/`Referer`) and answers 403 to anyone else, validates parameters, calls the upstream with a shared User-Agent and an 8 s timeout, hides upstream error text, caches successful answers at the edge by rounded coordinates and sends `X-Robots-Tag: noindex`. The upstreams never see the user's IP. Answers reach the browser with `Cache-Control: no-store`, so an address found from coordinates does not settle in the browser's disk cache.

**The map loads only on request.** Tiles are fetched only after "Show the map", through `/api/tiles`, so OpenStreetMap sees Cloudflare's address and our User-Agent, not the reader. Tiles are cached at the edge for a week and sent to the browser with `no-store` (a tile cache on the device is a history of places).

**Models and runtimes are self-hosted.** Tesseract (worker, core, language data), the MediaPipe WASM runtime and detection models, the Content Credentials toolkit and the `zxing-wasm` reader are served from the app's own domain; nothing is loaded from a CDN at run time. The only third-party request during the build is `prepare:assets` downloading the `.tflite` models from `storage.googleapis.com` (pinned version, size and MD5 checked).

**A network guard blocks telemetry.** MediaPipe Tasks Vision sends usage statistics to `odml.pa.googleapis.com` with no off switch. Two layers stop it: `src/utils/networkGuard.ts` wraps `fetch`, `XMLHttpRequest` and `sendBeacon` and drops any request from the page to another host (also on the dev server and in `vite preview`), and in production the CSP forbids the same. The page itself explains how to check this: the "How to check that the photo goes nowhere" link under the upload button.

**No analytics, no cookies.** `localStorage` holds only `theme-preference` and `meta-data-lang`. Tesseract.js keeps its language data (`rus`, `eng`, about 10 MB) in IndexedDB so it is not downloaded on every visit; nothing about the user or the photo is stored there.

**Security headers** (`public/_headers`): a CSP with no third-party host at all (`default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`), HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a Permissions-Policy that denies camera, microphone, geolocation and more, and COOP `same-origin`. For `/api/*` the headers are set in `functions/api/_geo.ts`, because `_headers` does not apply to Functions.

## Limitations

- **File size:** up to 50 MB and 120 megapixels (60 on iPhone and iPad). Export is capped at 40 MP (16 MP on iOS/iPadOS); the preview at 2400 px on the long side.
- **OCR reads Russian and English only.** License plates have no dedicated model: candidates are picked from the recognized text (plate-like tokens and short alphanumeric tokens at the bottom of a detected vehicle).
- **Face blur covers detected faces only.** People whose face is not found (turned away, masked) have to be covered with the brush.
- **Detection can be unavailable.** If the MediaPipe runtime or a model fails to load, the page says so and disables the face option.
- **Authenticity checks are signals, not proof.** Without a C2PA manifest, the AI-generation check relies on metadata alone, and the page says so. Each frame check states what it does not prove; the leak index is marked as an estimate.
- **Place context depends on public services** (Nominatim, Open-Meteo, Overpass, Nager.Date, Wikipedia). A 429 is not retried automatically, only by the "Retry" button, because public servers ban for it. Weather is available only for dates from 1940-01-01 up to tomorrow.
- **Browser differences:** without canvas filter support (Safari before 18) blur falls back to pixelation; a format the browser cannot encode is exported as JPEG with a notice; "Clean and share" appears only where the Web Share API can share files.

## Tech stack

- **App:** React, TypeScript, Vite; a single-page app with no backend and no database.
- **In the browser:** `exifr` (metadata), `libheif-js` (HEIC), `@mediapipe/tasks-vision` (faces and objects), `tesseract.js` (OCR), `c2pa` (Content Credentials), `jsqr` and `zxing-wasm` (codes), `maplibre-gl` (map), `@photostructure/tz-lookup` (time zone of the place).
- **Server side:** Cloudflare Pages Functions in TypeScript (`functions/api/`), sharing helpers in `functions/api/_geo.ts` and one Overpass query in `functions/api/_overpass.ts`. Only `/api/*` is routed to Functions (`public/_routes.json`).
- **Quality:** Vitest, ESLint, Prettier, a browser smoke test on `playwright-core`. GitHub Actions runs lint, typecheck, tests, build and the smoke test on every pull request and push to `main`.
- **Design:** the morgunov.tech v1 design system, vendored into `public/ds/v1/`. Fonts are IBM Plex Sans and Mono (© IBM Corp.) under the SIL Open Font License 1.1 (`public/fonts/OFL.txt`); the MIT license does not cover them.

```
src/            the app: App.tsx, components/, hooks/, utils/ (analysis and cleanup), i18n/,
                site/ (static page text, head, JSON-LD, sitemap.xml, llms-full.txt)
functions/api/  Pages Functions, one file per endpoint; shared helpers in _geo.ts and _overpass.ts
public/         _headers, _routes.json, design system and fonts;
                ocr/, mediapipe/, c2pa/, zxing/ are generated by prepare:assets
scripts/        prepare-assets.mjs, smoke.mjs and helper scripts
docs/           audit, ADRs and review notes
```

The project was formerly called Meta Data Insight; the npm package is still named `meta-data`.

## Run locally

Requires Node 22 (`.nvmrc`; the exact range is in `engines` in `package.json`).

```bash
npm ci
npm run prepare:assets   # once after install, and after updating tesseract.js or @mediapipe/tasks-vision
npm run dev              # http://localhost:5173
```

`prepare:assets` (`scripts/prepare-assets.mjs`) copies the Tesseract, MediaPipe, `c2pa` and `zxing-wasm` runtimes from `node_modules` into `public/` and downloads the three `.tflite` models; its output is git-ignored. In dev mode `/api/*` runs the same Functions code as production through a Vite plugin (`functionsDevProxy` in `vite.config.ts`), without the edge cache. `VITE_FUNCTIONS_BASE` points `/api/*` at another host.

## Tests

```bash
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm test               # Vitest unit tests, including the Pages Functions
npm run format:check   # Prettier
npm run build          # prepare:assets + typecheck + vite build
npm run smoke          # browser smoke test against a running dev server (needs Chrome)
```

The Functions tests call `onRequest` directly with a mocked `fetch` and `caches.default` (`src/__tests__/functions/_harness.ts`), so they check real status codes, headers and caching without Cloudflare.

## Deploy

Cloudflare Pages builds and deploys from `main` through its Git integration; Functions are picked up from `functions/` automatically.

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Node:** the version from `.nvmrc`; set `NODE_VERSION` if needed.

The build needs internet access: `prepare:assets` downloads the MediaPipe models, which are not stored in the repository. `public/_headers` and `public/_routes.json` are copied into `dist/` as is. The footer links to the deployed commit (`CF_PAGES_COMMIT_SHA`).

## Further reading

- [docs/adr/0001-heic-decoding-and-metadata-extraction.md](docs/adr/0001-heic-decoding-and-metadata-extraction.md): why HEIC is decoded and parsed in the browser (in Russian).
- [docs/audit-2026-09-15.md](docs/audit-2026-09-15.md): security, performance, dependency, code quality and resilience audit with a work plan (in Russian).
- [CHANGELOG.md](CHANGELOG.md): change history (in Russian).
- [CLAUDE.md](CLAUDE.md): conventions for working in the code.

---
Built by [Semyon Morgunov](https://s.morgunov.tech) with Claude Code as pair programmer.
