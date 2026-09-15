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

/* ── input validation ─────────────────────────────────────── */

const COORD_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Strict coordinate parser: `null`/empty → null (so `Number(null) === 0`
 * can no longer smuggle an empty param through), non-finite → null,
 * |value| > max → null.
 */
export function parseCoord(raw: string | null, max: number): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed || !COORD_RE.test(trimmed)) return null;
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

function withHeader(response: Response, name: string, value: string): Response {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
 */
export function isSameSite(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'same-site';
  const host = new URL(request.url).host;
  const origin = hostOf(request.headers.get('origin'));
  if (origin) return origin === host;
  const referer = hostOf(request.headers.get('referer'));
  if (referer) return referer === host;
  return false;
}

/* ── upstream fetch ───────────────────────────────────────── */

export type UpstreamResult =
  | { ok: true; response: Response; status: number }
  /** `error` is the client-facing Response; `status` is the upstream status or null for timeout/network. */
  | { ok: false; error: Response; status: number | null };

/**
 * fetch() with UA, `Accept: application/json`, an AbortController timeout
 * and a normalised failure → Response mapping. Upstream error text and
 * `error.message` never reach the client.
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
    return { ok: true, response, status: response.status };
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
 */
export async function withCache(context: CacheContext, key: string, ttlSeconds: number, produce: () => Promise<Response>): Promise<Response> {
  const cache = edgeCache();
  const cacheRequest = new Request(key, { method: 'GET' });

  if (cache) {
    try {
      const hit = await cache.match(cacheRequest);
      if (hit) return withHeader(hit, 'X-Cache', 'HIT');
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

  return withHeader(fresh, 'X-Cache', 'MISS');
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
 * HEAD → same headers with an empty body.
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
      response = await handler({ request, url: new URL(request.url), context });
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
