# Found You

Found You (ранее Meta Data Insight; имя npm-пакета осталось `meta-data`) — одностраничное веб-приложение, которое показывает, что фотография раскрывает о месте, времени, устройстве и людях на снимке, и позволяет скачать безопасную копию. Разбор метаданных, детекция объектов, OCR, размытие и очистка выполняются в браузере; файл не покидает устройство. Единственный сетевой компонент — набор Cloudflare Pages Functions, которые по явному запросу пользователя превращают округлённые координаты и время съёмки в адрес, погоду, праздники и объекты поблизости. Продакшен: https://foundyou.morgunov.tech/.

## Что умеет

- **Входные форматы:** JPEG, PNG, WebP, AVIF, GIF, BMP, HEIC/HEIF. HEIC декодируется локально по цепочке `createImageBitmap` → `<img>` → библиотека `libheif-js` из бандла. Лимиты: 20 МБ и 40 мегапикселей (`src/hooks/useImageFile.ts`).
- **Метаданные:** EXIF, XMP, IPTC, ICC через `exifr`; для PNG дополнительно IHDR и текстовые чанки `tEXt`/`zTXt`/`iTXt` (например, prompt Stable Diffusion). Для HEIC TIFF-блок EXIF извлекается из контейнера вручную. Время съёмки хранится как «настенные часы» камеры (`shotDateLocal`) плюс смещение, если камера его записала.
- **Детекция лиц и объектов:** MediaPipe Tasks Vision (`@mediapipe/tasks-vision`): FaceDetector (BlazeFace short-range) находит лица, ObjectDetector (EfficientDet-Lite0, метки COCO) — людей и объекты для описания сцены. WASM-рантайм и обе модели самохостятся в `public/mediapipe`. Опция очистки «Скрыть лица (и людей без распознанного лица)» размывает рамки лиц с запасом ~15 % с каждой стороны, а для людей, у которых лицо не распознано (спиной, в маске), — верхнюю часть рамки человека (`selectBlurTargets` в `src/utils/cleanup.ts`). Делегат GPU (WebGL2) с откатом на CPU; если рантайм или модель не загрузились, интерфейс явно сообщает «детекция недоступна» и блокирует опцию.
- **OCR:** Tesseract.js v7, языки `rus+eng`, режим LSTM. Worker, WASM-ядро и traineddata раздаются с того же домена (`public/ocr`). Один singleton-воркер на страницу; распознавание стартует после завершения детекции, чтобы не конкурировать за GPU и сеть. Найденные области можно размыть.
- **Цифровой профиль:** эвристики по имени файла, разрешению, признакам вырезанных метаданных, истории редактирования, хешу файла и времени суток; оценка утечки 0–100; текстовое описание сцены по детекциям и OCR; Pro-таблица со всеми сырыми данными.
- **Контекст места (по запросу):** адрес, историческая погода на час съёмки, праздники, объекты и вероятные камеры в радиусе 250–300 м, карта (MapLibre GL, растровые тайлы OpenStreetMap). Всё это появляется только после нажатия «Показать контекст места».
- **Безопасная копия:** перекодирование через `<canvas>` (метаданные исходника не копируются), зачистка контейнерных сегментов, которые добавляет сам браузер (ICC-профиль, COM и т. п.), и проверка результата: экспортированный файл повторно разбирается `exifr`, и интерфейс показывает «было N полей метаданных, в файле осталось 0». Опции: размытие лиц (и людей без распознанного лица), OCR-текста и ручных масок; ослабление следа камеры (PRNU, включено по умолчанию); «анти-поиск» трёх уровней (микрокроп, поворот, шум, сдвиги яркости/контраста/насыщенности/оттенка, деформация; на третьем уровне — редукция цвета); зеркалирование; уменьшение размера; водяной знак; формат (исходный / JPEG / PNG / WebP) и качество. Неподдерживаемый браузером формат экспортируется как JPEG с уведомлением; расширение берётся из фактического `blob.type`. Нейтральное имя `photo-xxxxxx.ext` включено по умолчанию. Экспорт ограничен 40 Мп (16 Мп на iOS/iPadOS), предпросмотр — 2400 px по длинной стороне.
- **Размытие без `ctx.filter`:** в браузерах без поддержки CSS-фильтров на canvas (Safari до 18) используется пикселизация вместо тихого пропуска.
- **Языки и темы:** русский, английский, узбекский (`src/i18n`); темы light / dark / auto / high-contrast.

## Модель приватности

**Остаётся на устройстве:** сам файл, пиксели, разбор метаданных, детекция, OCR, эвристики профиля, очистка, экспорт и проверка результата. Ни одна из этих операций не делает сетевых запросов.

**Отправляется только по явному согласию.** Блок «Что можно узнать из данных» показывает координаты, время и движение из EXIF локально. Кнопка «Показать контекст места» запрашивает согласие на одну фотографию; после нажатия на собственные Functions уходят:

- широта и долгота, округлённые до 4 знаков (~11 м) ещё на клиенте (`src/components/ShockBlock.tsx`), сервер округляет повторно;
- дата и время съёмки (`timestamp` в ISO и `local` как настенные часы камеры) — только для запроса погоды;
- код страны из ответа геокодера и дата — только для запроса праздников.

Изображение, имя файла и остальные метаданные не отправляются. Смена языка не сбрасывает согласие; другая фотография запрашивает его заново. После согласия браузер также загружает тайлы карты напрямую с `tile.openstreetmap.org` — это единственный сторонний хост, разрешённый политикой CSP.

**Functions — прокси только для этого сайта.** Каждый обработчик принимает только GET/HEAD, проверяет `Sec-Fetch-Site` (с откатом на `Origin`/`Referer`) и отвечает 403 всем остальным; валидирует параметры (400), обращается к апстриму с общим User-Agent и таймаутом 8 с, не раскрывает текст ошибок апстрима, кэширует успешные ответы в edge-кэше по округлённым координатам и отдаёт `X-Robots-Tag: noindex`. IP пользователя апстримы (Nominatim, Open-Meteo, Overpass, Nager.Date) не видят.

**Модели и рантаймы самохостятся.** Tesseract (worker, ядро, traineddata), WASM-рантайм MediaPipe и модели детекции раздаются с домена приложения; на этапе выполнения ничего не грузится с CDN. Единственное сетевое обращение к третьей стороне при сборке — загрузка моделей `.tflite` с `storage.googleapis.com` скриптом `prepare:assets` (закреплённая версия, проверка размера и MD5).

**Нет аналитики и cookies.** В `localStorage` хранятся только `theme-preference` и `meta-data-lang`.

**Заголовки безопасности** (`public/_headers`): CSP (`default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `connect-src`/`img-src` с единственным сторонним хостом `tile.openstreetmap.org`, `frame-ancestors 'none'`), HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, Permissions-Policy с запретом камеры, микрофона, геолокации и др., COOP `same-origin`. Для ответов `/api/*` заголовки ставятся в `functions/api/_geo.ts`, так как `_headers` на Functions не действует.

## Архитектура

SPA на React + TypeScript (Vite), без бэкенда и базы данных. Cloudflare Pages раздаёт статику из `dist/`; `public/_routes.json` направляет на Functions только `/api/*`.

Все Functions построены на общих помощниках из `functions/api/_geo.ts`: `defineHandler` (метод, same-site, перехват исключений, HEAD), `parseCoord` (строгий разбор с диапазоном ±90/±180), `round4`/`coordKey`, `fetchUpstream` (UA, `Accept`, таймаут, нормализация ошибок), `withCache` (`caches.default` + `waitUntil`, синтетический GET-ключ `https://cache.foundyou.internal/...`) и `json` (единый формат ответа и заголовки). Ответ всегда `{ ok: true, data }` либо `{ ok: false, error: '<code>' }`; успешные ответы получают `Cache-Control: public, max-age, s-maxage`, ошибки — `no-store`; заголовок `X-Cache: HIT|MISS`.

| Эндпоинт | Параметры | Апстрим | TTL кэша | Специфичные статусы |
|---|---|---|---|---|
| `GET /api/reverse-geocode` | `lat`, `lon` | Nominatim `reverse?format=jsonv2` | 24 ч | 400 `invalid-coordinates` |
| `GET /api/historical-weather` | `lat`, `lon`, `local` (`YYYY-MM-DDTHH:mm[:ss]`, приоритетно) или `timestamp` (ISO) | Open-Meteo Archive, почасовые temperature / precipitation / cloudcover / wind / pressure; `timezone=auto` для `local` | 24 ч | 400 `invalid-coordinates` / `invalid-timestamp` / `invalid-parameters`; 404 `no-hourly-data`. Даты вне 1940-01-01…завтра отклоняются |
| `GET /api/nearby-poi` | `lat`, `lon` | Overpass, радиус 250 м (amenity, shop, tourism, leisure); топ-5 по расстоянию | 24 ч | 400 `invalid-coordinates` |
| `GET /api/surveillance-candidates` | `lat`, `lon` | Overpass, радиус 300 м (`man_made=surveillance`, банки, банкоматы, ТЦ, супермаркеты); топ-5 | 24 ч | 400 `invalid-coordinates` |
| `GET /api/holidays` | `country` (ISO-3166 alpha-2), `date` (`YYYY-MM-DD`, 1900–2100) | Nager.Date `PublicHolidays/{year}/{country}`; для стран, которые Nager не покрывает (ответ 204/404), статическая таблица фиксированных праздников — сейчас только UZ | список на страну и год: 30 дней (для неизвестной страны — 1 день); ответ: 24 ч | 400 `invalid-params` |

Общие статусы для всех эндпоинтов: 405 `method-not-allowed` (с `Allow: GET, HEAD`), 403 `forbidden`, 429 при 429 от апстрима (`upstream-429`), 502 `upstream-<status>` / `upstream-unavailable` / `upstream-invalid`, 504 `upstream-timeout`, 500 `internal-error`. Оба Overpass-эндпоинта выполняют один общий запрос с двумя именованными наборами и делят его между параллельными вызовами (`functions/api/_overpass.ts`); ответ Overpass с `remark` о таймауте не кэшируется и отдаётся как 504.

Клиентский хук `src/hooks/useAPIFetch.ts` ставит таймаут 12 с, повторяет запрос до двух раз при 429 / 5xx / таймауте / сетевой ошибке с нарастающей задержкой, отменяет запросы при смене фотографии и даёт кнопку «Повторить» для транзиентных ошибок.

## Локальная разработка

Требуется Node 22 (`.nvmrc`; точное ограничение — в поле `engines` файла `package.json`).

```bash
npm ci
npm run prepare:assets   # один раз после установки или обновления tesseract.js / @mediapipe/tasks-vision
npm run dev              # http://localhost:5173
```

`npm run prepare:assets` (`scripts/prepare-assets.mjs`) копирует из `node_modules` worker и WASM-ядра Tesseract и traineddata `rus`/`eng` в `public/ocr/`, WASM-рантайм MediaPipe (`vision_wasm[_nosimd]_internal.{js,wasm}`) в `public/mediapipe/wasm/`, а также скачивает модели `blaze_face_short_range.tflite` и `efficientdet_lite0.tflite` с `storage.googleapis.com` в `public/mediapipe/models/` (закреплённая версия, проверка размера и MD5). Скрипт идемпотентен, использует только встроенные модули Node и не имеет зависимостей; результат в git не попадает (`.gitignore`). Переменная `PREPARE_ASSETS_RAW_WASM=1` дополнительно копирует отдельные `.wasm`-файлы ядра (не требуются: в бандле ядро встроено в `.wasm.js`).

В dev-режиме плагин `functionsDevProxy` в `vite.config.ts` подхватывает `functions/api/*.ts` через `ssrLoadModule`, поэтому `/api/*` работает тем же кодом, что и в продакшене (без edge-кэша: вне Cloudflare `withCache` просто вызывает апстрим). Переменная `VITE_FUNCTIONS_BASE` позволяет направить `/api/*` на другой хост. Для Claude Code есть конфигурация `vite-dev` в `.claude/launch.json`.

## Качество

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit (src, functions, vite.config.ts)
npm test            # vitest: src/utils/__tests__ (утилиты) и src/__tests__/functions (Pages Functions)
npm run build       # prepare:assets + typecheck + vite build
```

Тесты Functions вызывают `onRequest` напрямую с подменённым `fetch` и `caches.default` (общий `_harness.ts`), поэтому проверяют реальные статусы, заголовки и кэширование без Cloudflare. Точный список скриптов (в том числе форматирование Prettier) — в `package.json`.

## Деплой на Cloudflare Pages

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Functions directory:** `functions` (подхватывается автоматически)
- **Node:** версия из `.nvmrc`; при необходимости продублируйте её в переменной окружения `NODE_VERSION`.

Сборке нужен доступ в интернет: `prepare:assets` скачивает модели MediaPipe (`.tflite`) с `storage.googleapis.com` (в репозитории бинарники не хранятся). `public/_headers` и `public/_routes.json` попадают в `dist/` как есть и применяются Pages. Хеш коммита из `CF_PAGES_COMMIT_SHA` подставляется в футер (`__BUILD__` в `vite.config.ts`) как ссылка на коммит в GitHub. Кэширование статики: `/assets/*`, `/fonts/*`, `/ds/v1/*` — год и `immutable`; `/ocr/*` и `/mediapipe/*` — сутки; `/images/*` — неделя.

## Дизайн-система

Интерфейс построен на дизайн-системе morgunov.tech v1 (источник — репозиторий `about-me-page`, каталог `ds/v1`). Слой вендорится в репозиторий, а не подключается по ссылке:

- `public/ds/v1/{fonts,tokens,base,components}.css` — копии файлов DS; `USAGE.md` рядом описывает контракт.
- `public/fonts/*.woff2` — IBM Plex Sans и Mono (латиница и кириллица).
- `src/styles.css` — только страничные стили Found You с префиксом `.fy-`, поверх токенов `--v4-*`.

Синхронизация с источником — копирование файлов из `about-me-page/ds/v1` и `about-me-page/fonts`. Хеши `?v=` для ссылок на DS в `index.html` проставляются при сборке (плагин `dsVersionStamp` в `vite.config.ts`), править их руками не нужно.

Правила системы: `border-radius: 0`, без теней и градиентов, без эмодзи, без `font-weight: 700`; цвета и шрифты только из токенов, размеры и отступы — литералы (собственных `--space-*` токенов нет). Тема хранится в `localStorage['theme-preference']` (`light` / `dark` / `auto` / `high-contrast`) и ставится скриптом `public/theme-init.js` в `<head>` до первой отрисовки; старый ключ `meta-data-theme-mode` мигрируется.

## Карта репозитория

```
index.html                  SEO, критический CSS, JSON-LD, подключение DS
public/
  _headers, _routes.json    заголовки безопасности и маршрутизация Functions
  ds/v1/, fonts/            вендоренная дизайн-система и шрифты
  ocr/, mediapipe/          генерируются prepare:assets, в git не хранятся
  theme-init.js, llms.txt, sitemap.xml, robots.txt, manifest.json, иконки, OG-карточки
functions/api/
  _geo.ts, _overpass.ts, _types.ts       общие помощники
  reverse-geocode.ts, historical-weather.ts, nearby-poi.ts,
  surveillance-candidates.ts, holidays.ts
src/
  App.tsx                   состояние очистки, конвейер предпросмотра и экспорта, проверка
  components/               SiteHeader, SiteFooter, UploadZone, PreviewViewer, MetadataPanel,
                            OCRBlock, ProfileBlock, ShockBlock + DataInsightsCompact, MapBlock,
                            CleanupDownloadBlock, ErrorBoundary, ...
  hooks/                    useImageFile, useExifMetadata, useImageAnalysis, useOCR, useAPIFetch
  utils/                    cleanup, containerMetadata, heic, sceneNarrative, heuristics/, ...
  utils/__tests__/          vitest: утилиты
  __tests__/functions/      vitest: Pages Functions (onRequest с подменённым fetch и caches)
  i18n/index.tsx            словари ru / en / uz, типизированные ключи
  theme/index.tsx           ThemeProvider
  styles.css                страничные стили .fy-*
scripts/prepare-assets.mjs  самохостинг Tesseract и MediaPipe (WASM-рантайм + модели)
docs/                       аудит и сравнение с chronoscope
```

## Документы

- [docs/audit-2026-09-15.md](docs/audit-2026-09-15.md) — аудит безопасности, производительности, зависимостей, качества кода и отказоустойчивости с планом работ.
- [docs/chronoscope-diff.md](docs/chronoscope-diff.md) — сравнение с предшественником chronoscope.
- [CHANGELOG.md](CHANGELOG.md) — история изменений.
- [CLAUDE.md](CLAUDE.md) — соглашения для работы с кодом.
