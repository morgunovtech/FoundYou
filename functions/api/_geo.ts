import type { PagesEventContext } from './_types';

/** Nominatim requires an identifying UA; Overpass answers 406 without one. */
export const USER_AGENT = 'FoundYou/1.0 (+https://foundyou.morgunov.tech; contact: s@morgunov.tech)';
export const UPSTREAM_TIMEOUT_MS = 8_000;
export const HOUR = 3_600;
export const DAY = 86_400;

export interface LatLon {
  lat: number;
  lon: number;
}

/* ── geometry ─────────────────────────────────────────────── */

export function getPosition(element: any): LatLon | null {
  if (typeof element?.lat === 'number' && typeof element?.lon === 'number') {
    return { lat: element.lat, lon: element.lon };
  }
  if (element?.center && typeof element.center.lat === 'number' && typeof element.center.lon === 'number') {
    return { lat: element.center.lat, lon: element.center.lon };
  }
  return null;
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Initial great-circle bearing from one point to another, in degrees clockwise from north.
 * Computed here rather than on the page so the object's own coordinates never have to be sent:
 * a direction and a distance are what the card needs, and they say less than a position does.
 */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/* ── input validation ─────────────────────────────────────── */

/**
 * The alternatives must not overlap: `\d+\.?\d*` let the engine split one digit run between
 * `\d+` and `\d*` in every possible place before giving up, which is quadratic — 16 000 digits
 * cost ~137 ms of CPU. With `\d+(?:\.\d*)?` there is exactly one way to match a run.
 */
const COORD_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** No real coordinate needs more; the cap is the first line of defence against a long digit run. */
const COORD_MAX_LENGTH = 32;

/**
 * Strict coordinate parser: `null`/empty → null (so `Number(null) === 0`
 * can no longer smuggle an empty param through), non-finite → null,
 * |value| > max → null.
 */
export function parseCoord(raw: string | null, max: number): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > COORD_MAX_LENGTH || !COORD_RE.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || Math.abs(value) > max) return null;
  return value;
}

/** 4 decimals ≈ 11 m — enough for every upstream we call, and it makes cache keys collide on purpose. */
export function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4 + 0; // `+ 0` folds -0 into 0
}

/** Rounded coordinates as fixed-width strings for URLs and cache keys. */
export function coordKey(lat: number, lon: number): [string, string] {
  return [round4(lat).toFixed(4), round4(lon).toFixed(4)];
}

/* ── responses ────────────────────────────────────────────── */

export function cacheControl(cacheable: boolean, ttlSeconds?: number): string {
  if (!cacheable || !ttlSeconds || ttlSeconds <= 0) return 'no-store';
  const ttl = Math.floor(ttlSeconds);
  return `public, max-age=${ttl}, s-maxage=${ttl}`;
}

function isPubliclyCacheable(header: string | null): boolean {
  return !!header && /\bpublic\b/.test(header) && /\bmax-age=\d+/.test(header);
}

/**
 * JSON response with the security headers every /api/* answer needs
 * (`_headers` does not apply to Functions). `Cache-Control` is public for
 * `ttlSeconds` only when the payload is `ok`; every error is `no-store`.
 *
 * The public header is for the copy `withCache` stores at the edge. What reaches the browser is
 * always `no-store` — see `forBrowser` — so a `ttlSeconds` on a response that is not produced
 * inside `withCache` has no effect.
 */
export function json(payload: Record<string, unknown>, status = 200, extra?: HeadersInit, ttlSeconds?: number): Response {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex');
  headers.set('Cache-Control', cacheControl(payload.ok === true && status < 300, ttlSeconds));
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(payload), { status, headers });
}

function withHeaders(response: Response, set: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(set)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * The copy that leaves for the browser. Every /api/* URL carries the rounded coordinates of a
 * photograph, and an answer the browser's HTTP cache kept on disk — an address for a day, the
 * landmarks for a week, the terrain for a month — would be a history of places on the reader's
 * device, which invariant 2 forbids for map tiles for exactly this reason. So the browser gets
 * `no-store` whatever the endpoint asked for; the public `max-age` is for the edge copy alone.
 */
function forBrowser(response: Response, extra: Record<string, string> = {}): Response {
  return withHeaders(response, { ...extra, 'Cache-Control': 'no-store' });
}

/* ── origin check ─────────────────────────────────────────── */

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * The functions are a proxy for the SPA only. Modern browsers send
 * `Sec-Fetch-Site`; when it is absent we fall back to Origin/Referer, and
 * with none of them present the call is refused.
 *
 * Only `same-origin` passes: the SPA, the Vite dev server and every Pages preview call their own
 * `/api`, so `same-site` — any other host under the registrable domain — has no legitimate caller.
 */
export function isSameSite(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const host = new URL(request.url).host;
  const origin = hostOf(request.headers.get('origin'));
  if (origin) return origin === host;
  const referer = hostOf(request.headers.get('referer'));
  if (referer) return referer === host;
  return false;
}

/* ── upstream fetch ───────────────────────────────────────── */

export type UpstreamResult =
  /** `text` is the whole upstream body, read under the same deadline as the headers. */
  | { ok: true; text: string; status: number }
  /** `error` is the client-facing Response; `status` is the upstream status or null for timeout/network. */
  | { ok: false; error: Response; status: number | null };

/**
 * The body, or an AbortError the moment the deadline fires. A hand-built `Response` (a test
 * double, a cached copy) has no link to the controller, so the read has to be raced against the
 * signal rather than trusted to reject on its own; a real fetch body rejects either way.
 */
function readBody(response: Response, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void response.body?.cancel().catch(() => undefined);
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    response.text().then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * fetch() with UA, `Accept: application/json`, an AbortController timeout
 * and a normalised failure → Response mapping. Upstream error text and
 * `error.message` never reach the client.
 *
 * The body is read here, under the same timer as the headers. It used to be handed back as a
 * `Response` with the timer already cleared, so the `.json()` every caller then awaited had no
 * deadline at all: an upstream that sent its headers and then stalled held the request open
 * for as long as it liked.
 */
export async function fetchUpstream(url: string, init: RequestInit = {}, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<UpstreamResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('User-Agent')) headers.set('User-Agent', USER_AGENT);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      const status = response.status;
      return { ok: false, status, error: json({ ok: false, error: `upstream-${status}` }, status === 429 ? 429 : 502) };
    }
    const text = await readBody(response, controller.signal);
    return { ok: true, text, status: response.status };
  } catch (error) {
    const aborted = controller.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError';
    return aborted
      ? { ok: false, status: null, error: json({ ok: false, error: 'upstream-timeout' }, 504) }
      : { ok: false, status: null, error: json({ ok: false, error: 'upstream-unavailable' }, 502) };
  } finally {
    clearTimeout(timer);
  }
}

/* ── edge cache ───────────────────────────────────────────── */

export type CacheContext = Pick<PagesEventContext, 'request' | 'waitUntil'>;

function edgeCache(): Cache | null {
  if (typeof caches === 'undefined' || !('default' in caches)) return null;
  return (caches as unknown as { default: Cache }).default;
}

/** Synthetic GET key: `https://cache.foundyou.internal/<name>/<part>/<part>…` */
export function cacheKey(name: string, ...parts: Array<string | number>): string {
  const tail = parts.map((part) => encodeURIComponent(String(part))).join('/');
  return `https://cache.foundyou.internal/${name}${tail ? `/${tail}` : ''}`;
}

/**
 * `caches.default` lookup with a background `put` via `waitUntil`. Only
 * `ok` responses are stored; a stored copy without a public Cache-Control
 * gets `ttlSeconds`. Outside Cloudflare (Vite dev proxy) there is no
 * `caches`, so this degrades to calling `produce()` every time.
 *
 * Two copies with two headers: the one put in the edge cache keeps its public `max-age`,
 * because Cloudflare stores nothing without one; the one returned to the caller is `no-store`
 * on the HIT and the MISS path alike, so the browser never keeps `/api/…?lat=…&lon=…` on disk
 * (see `forBrowser`).
 */
export async function withCache(context: CacheContext, key: string, ttlSeconds: number, produce: () => Promise<Response>): Promise<Response> {
  const cache = edgeCache();
  const cacheRequest = new Request(key, { method: 'GET' });

  if (cache) {
    try {
      const hit = await cache.match(cacheRequest);
      if (hit) return forBrowser(hit, { 'X-Cache': 'HIT' });
    } catch (error) {
      console.warn('cache-match-failed', error);
    }
  }

  const fresh = await produce();

  if (cache && fresh.ok) {
    const stored = new Response(fresh.clone().body, fresh);
    if (!isPubliclyCacheable(stored.headers.get('Cache-Control'))) {
      stored.headers.set('Cache-Control', cacheControl(true, ttlSeconds));
    }
    const put = cache.put(cacheRequest, stored).catch((error) => console.warn('cache-put-failed', error));
    if (context.waitUntil) context.waitUntil(put);
    else await put;
  }

  return forBrowser(fresh, { 'X-Cache': 'MISS' });
}

/* ── handler wrapper ──────────────────────────────────────── */

export interface HandlerArgs {
  request: Request;
  url: URL;
  context: PagesEventContext;
}

export type Handler = (args: HandlerArgs) => Promise<Response>;

/**
 * Common guard for every endpoint: GET/HEAD only (405 otherwise), same-site
 * only (403 otherwise), unexpected throws → 500 without leaking the message,
 * HEAD → same headers with an empty body, and `Cache-Control: no-store` on
 * whatever the handler answered — the endpoints that build their own answer
 * after `withCache` (the Overpass three, holidays) pass through here too, so
 * the «no history of places on the device» rule holds by construction rather
 * than by every endpoint remembering it.
 */
export function defineHandler(handler: Handler): (context: PagesEventContext) => Promise<Response> {
  return async (context) => {
    const { request } = context;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ ok: false, error: 'method-not-allowed' }, 405, { Allow: 'GET, HEAD' });
    }
    if (!isSameSite(request)) {
      return json({ ok: false, error: 'forbidden' }, 403);
    }

    let response: Response;
    try {
      response = forBrowser(await handler({ request, url: new URL(request.url), context }));
    } catch (error) {
      console.error('api-handler-failed', error);
      response = json({ ok: false, error: 'internal-error' }, 500);
    }

    if (request.method === 'HEAD') {
      void response.body?.cancel().catch(() => undefined);
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return response;
  };
}
