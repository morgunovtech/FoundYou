import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UPSTREAM_TIMEOUT_MS,
  USER_AGENT,
  cacheControl,
  cacheKey,
  coordKey,
  defineHandler,
  fetchUpstream,
  getPosition,
  haversine,
  isSameSite,
  json,
  parseCoord,
  round4,
  withCache
} from '../../../functions/api/_geo';
import { BASE, SAME_ORIGIN, call, fetchCall, installCaches, jsonResponse, mockFetch, rejectAborted, waitForAbort } from './_harness';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('parseCoord', () => {
  it.each([
    [null, 90, null],
    ['', 90, null],
    ['   ', 90, null],
    ['abc', 90, null],
    ['41.3.1', 90, null],
    ['0x10', 90, null],
    ['Infinity', 90, null],
    ['NaN', 90, null],
    ['95', 90, null],
    ['-95', 90, null],
    ['181', 180, null],
    ['90', 90, 90],
    ['-90', 90, -90],
    ['180', 180, 180],
    ['0', 90, 0],
    ['.5', 90, 0.5],
    ['+41.3', 90, 41.3],
    ['1e1', 90, 10],
    ['  41.311158  ', 90, 41.311158]
  ])('parseCoord(%j, %d) → %j', (raw, max, expected) => {
    expect(parseCoord(raw, max)).toBe(expected);
  });
});

describe('round4 / coordKey', () => {
  it('rounds to 4 decimals', () => {
    expect(round4(41.311158)).toBe(41.3112);
    expect(round4(69.279737)).toBe(69.2797);
    expect(round4(1.00005)).toBe(1.0001);
    expect(round4(-1.23456)).toBe(-1.2346);
  });

  it('folds -0 into 0 so cache keys never differ on sign', () => {
    expect(Object.is(round4(-0.00004), 0)).toBe(true);
    expect(Object.is(round4(-0), 0)).toBe(true);
  });

  it('coordKey yields fixed-width strings', () => {
    expect(coordKey(41.3, 69)).toEqual(['41.3000', '69.0000']);
    expect(coordKey(41.311158, -0.00004)).toEqual(['41.3112', '0.0000']);
    expect(coordKey(-33.86882, 151.20929)).toEqual(['-33.8688', '151.2093']);
  });
});

describe('cacheControl / cacheKey', () => {
  it('public for cacheable positive ttl, no-store otherwise', () => {
    expect(cacheControl(true, 86_400)).toBe('public, max-age=86400, s-maxage=86400');
    expect(cacheControl(true, 1.9)).toBe('public, max-age=1, s-maxage=1');
    expect(cacheControl(false, 86_400)).toBe('no-store');
    expect(cacheControl(true, 0)).toBe('no-store');
    expect(cacheControl(true, -5)).toBe('no-store');
    expect(cacheControl(true)).toBe('no-store');
  });

  it('builds a synthetic internal URL with encoded parts', () => {
    expect(cacheKey('overpass', '41.3112', '69.2797')).toBe('https://cache.foundyou.internal/overpass/41.3112/69.2797');
    expect(cacheKey('holidays', 'UZ', 2026)).toBe('https://cache.foundyou.internal/holidays/UZ/2026');
    expect(cacheKey('x', 'a b/c')).toBe('https://cache.foundyou.internal/x/a%20b%2Fc');
    expect(cacheKey('x')).toBe('https://cache.foundyou.internal/x');
  });
});

describe('json', () => {
  it('sets the security headers and a JSON content type', async () => {
    const response = json({ ok: true, data: 1 });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(await response.json()).toEqual({ ok: true, data: 1 });
  });

  it('is public only for ok payloads with a ttl', () => {
    expect(json({ ok: true }, 200, undefined, 60).headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=60');
    expect(json({ ok: true }).headers.get('Cache-Control')).toBe('no-store');
    expect(json({ ok: false, error: 'x' }, 200, undefined, 60).headers.get('Cache-Control')).toBe('no-store');
    expect(json({ ok: false, error: 'x' }, 502, undefined, 60).headers.get('Cache-Control')).toBe('no-store');
    expect(json({ ok: true }, 300, undefined, 60).headers.get('Cache-Control')).toBe('no-store');
  });

  it('applies extra headers on top', () => {
    const response = json({ ok: false, error: 'method-not-allowed' }, 405, { Allow: 'GET, HEAD', 'X-Robots-Tag': 'none' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(response.headers.get('X-Robots-Tag')).toBe('none');
  });
});

describe('isSameSite', () => {
  const request = (headers: Record<string, string>) => new Request(`${BASE}/api/x`, { headers });

  it('trusts Sec-Fetch-Site when present', () => {
    expect(isSameSite(request({ 'Sec-Fetch-Site': 'same-origin' }))).toBe(true);
    expect(isSameSite(request({ 'Sec-Fetch-Site': 'same-site' }))).toBe(true);
    expect(isSameSite(request({ 'Sec-Fetch-Site': 'cross-site' }))).toBe(false);
    expect(isSameSite(request({ 'Sec-Fetch-Site': 'none' }))).toBe(false);
  });

  it('Sec-Fetch-Site wins over a same-host Origin', () => {
    expect(isSameSite(request({ 'Sec-Fetch-Site': 'cross-site', Origin: BASE }))).toBe(false);
  });

  it('falls back to Origin, then Referer', () => {
    expect(isSameSite(request({ Origin: BASE }))).toBe(true);
    expect(isSameSite(request({ Origin: 'https://evil.example' }))).toBe(false);
    expect(isSameSite(request({ Referer: `${BASE}/some/page` }))).toBe(true);
    expect(isSameSite(request({ Referer: 'https://evil.example/page' }))).toBe(false);
    // A malformed Origin is ignored and Referer decides.
    expect(isSameSite(request({ Origin: 'not a url', Referer: `${BASE}/` }))).toBe(true);
  });

  it('a bad Origin is not rescued by a good Referer', () => {
    expect(isSameSite(request({ Origin: 'https://evil.example', Referer: `${BASE}/` }))).toBe(false);
  });

  it('refuses when nothing identifies the caller', () => {
    expect(isSameSite(request({}))).toBe(false);
  });
});

describe('getPosition / haversine', () => {
  it('reads node coordinates or a way/relation center', () => {
    expect(getPosition({ type: 'node', lat: 1, lon: 2 })).toEqual({ lat: 1, lon: 2 });
    expect(getPosition({ type: 'way', center: { lat: 3, lon: 4 } })).toEqual({ lat: 3, lon: 4 });
    expect(getPosition({ type: 'relation' })).toBeNull();
    expect(getPosition({ lat: '1', lon: '2' })).toBeNull();
    expect(getPosition(null)).toBeNull();
  });

  it('haversine returns metres', () => {
    expect(haversine(41.3, 69.2, 41.3, 69.2)).toBe(0);
    // One degree of latitude at the equator ≈ 111.2 km.
    expect(haversine(0, 0, 1, 0)).toBeCloseTo(111_195, -3);
    expect(haversine(0, 0, 0, 1)).toBeCloseTo(111_195, -3);
  });
});

describe('fetchUpstream', () => {
  it('adds User-Agent and Accept, keeps the caller headers', async () => {
    const fetch = mockFetch(async () => jsonResponse({ hello: 1 }));
    const result = await fetchUpstream('https://upstream.test/a', { headers: { 'X-Custom': 'yes' } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.status).toBe(200);
    expect(await result.response.json()).toEqual({ hello: 1 });

    const { url, init } = fetchCall(fetch);
    expect(url).toBe('https://upstream.test/a');
    const headers = new Headers(init?.headers);
    expect(headers.get('User-Agent')).toBe(USER_AGENT);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('X-Custom')).toBe('yes');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not override an explicit User-Agent / Accept', async () => {
    const fetch = mockFetch(async () => jsonResponse({}));
    await fetchUpstream('https://upstream.test/a', { headers: { 'User-Agent': 'custom/1', Accept: 'text/plain' } });
    const headers = new Headers(fetchCall(fetch).init?.headers);
    expect(headers.get('User-Agent')).toBe('custom/1');
    expect(headers.get('Accept')).toBe('text/plain');
  });

  it.each([
    [404, 502, 'upstream-404'],
    [500, 502, 'upstream-500'],
    [503, 502, 'upstream-503'],
    [429, 429, 'upstream-429']
  ])('upstream %d → client %d %s, without leaking the upstream body', async (upstreamStatus, clientStatus, code) => {
    mockFetch(async () => jsonResponse({ error: { message: 'SECRET upstream detail' } }, upstreamStatus));
    const result = await fetchUpstream('https://upstream.test/a');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.status).toBe(upstreamStatus);
    expect(result.error.status).toBe(clientStatus);
    expect(result.error.headers.get('Cache-Control')).toBe('no-store');
    const text = await result.error.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: code });
    expect(text).not.toContain('SECRET');
  });

  it('network failure → 502 upstream-unavailable without the error message', async () => {
    mockFetch(async () => {
      throw new TypeError('SECRET network detail');
    });
    const result = await fetchUpstream('https://upstream.test/a');
    if (result.ok) throw new Error('expected failure');
    expect(result.status).toBeNull();
    expect(result.error.status).toBe(502);
    const text = await result.error.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: 'upstream-unavailable' });
    expect(text).not.toContain('SECRET');
  });

  it('an AbortError from fetch → 504 upstream-timeout', async () => {
    mockFetch(rejectAborted);
    const result = await fetchUpstream('https://upstream.test/a');
    if (result.ok) throw new Error('expected failure');
    expect(result.status).toBeNull();
    expect(result.error.status).toBe(504);
    expect(await result.error.json()).toEqual({ ok: false, error: 'upstream-timeout' });
  });

  it('aborts a hanging fetch after timeoutMs (real timers)', async () => {
    const fetch = mockFetch(waitForAbort);
    const result = await fetchUpstream('https://upstream.test/slow', {}, 20);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.status).toBe(504);
    expect(await result.error.json()).toEqual({ ok: false, error: 'upstream-timeout' });
    expect(fetchCall(fetch).init?.signal?.aborted).toBe(true);
  });

  it('uses the 8 s default timeout (fake timers)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let started!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    mockFetch((input, init) => {
      started();
      return waitForAbort(input, init);
    });

    const pending = fetchUpstream('https://upstream.test/slow');
    await fetchStarted; // the timer is registered before fetch() is invoked
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    const result = await pending;
    if (result.ok) throw new Error('expected failure');
    expect(result.error.status).toBe(504);
  });
});

describe('withCache', () => {
  const context = () => {
    const promises: Promise<unknown>[] = [];
    return {
      promises,
      ctx: {
        request: new Request(`${BASE}/api/x`),
        waitUntil: (promise: Promise<unknown>) => {
          promises.push(promise);
        }
      }
    };
  };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('degrades to calling produce() every time when there is no caches global', async () => {
    vi.stubGlobal('caches', undefined);
    const produce = vi.fn(async () => json({ ok: true, n: 1 }, 200, undefined, 60));
    const { ctx } = context();
    const first = await withCache(ctx, cacheKey('t', 1), 60, produce);
    const second = await withCache(ctx, cacheKey('t', 1), 60, produce);
    expect(produce).toHaveBeenCalledTimes(2);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    expect(second.headers.get('X-Cache')).toBe('MISS');
  });

  it('ignores a caches object without `default`', async () => {
    vi.stubGlobal('caches', {});
    const produce = vi.fn(async () => json({ ok: true }, 200, undefined, 60));
    const { ctx } = context();
    await withCache(ctx, cacheKey('t', 1), 60, produce);
    await withCache(ctx, cacheKey('t', 1), 60, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('MISS then HIT: stores through waitUntil and serves the copy', async () => {
    const caches = installCaches();
    const produce = vi.fn(async () => json({ ok: true, n: 1 }, 200, undefined, 60));
    const { ctx, promises } = context();

    const first = await withCache(ctx, cacheKey('t', 1), 60, produce);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    expect(await first.json()).toEqual({ ok: true, n: 1 });
    expect(promises).toHaveLength(1);
    await Promise.all(promises);
    expect(caches.default.put).toHaveBeenCalledTimes(1);
    expect(caches.store.has(cacheKey('t', 1))).toBe(true);

    const second = await withCache(ctx, cacheKey('t', 1), 60, produce);
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(await second.json()).toEqual({ ok: true, n: 1 });
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('keys are distinct per URL', async () => {
    installCaches();
    const produce = vi.fn(async () => json({ ok: true }, 200, undefined, 60));
    const { ctx } = context();
    await withCache(ctx, cacheKey('t', 1), 60, produce);
    await withCache(ctx, cacheKey('t', 2), 60, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('never stores error responses', async () => {
    const caches = installCaches();
    const produce = vi.fn(async () => json({ ok: false, error: 'upstream-500' }, 502));
    const { ctx, promises } = context();
    const response = await withCache(ctx, cacheKey('t', 'err'), 60, produce);
    await Promise.all(promises);
    expect(response.status).toBe(502);
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(caches.default.put).not.toHaveBeenCalled();
    await withCache(ctx, cacheKey('t', 'err'), 60, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('gives a stored copy without a public Cache-Control the ttl', async () => {
    const caches = installCaches();
    const { ctx, promises } = context();
    await withCache(ctx, cacheKey('t', 'plain'), 120, async () => new Response('{"ok":true}', { status: 200 }));
    await Promise.all(promises);
    const stored = caches.store.get(cacheKey('t', 'plain'));
    expect(stored?.headers).toContainEqual(['cache-control', 'public, max-age=120, s-maxage=120']);
  });

  it('keeps an explicit public Cache-Control on the stored copy', async () => {
    const caches = installCaches();
    const { ctx, promises } = context();
    await withCache(ctx, cacheKey('t', 'explicit'), 120, async () => json({ ok: true }, 200, undefined, 5));
    await Promise.all(promises);
    const stored = caches.store.get(cacheKey('t', 'explicit'));
    expect(stored?.headers).toContainEqual(['cache-control', 'public, max-age=5, s-maxage=5']);
  });

  it('awaits the put itself when the context has no waitUntil', async () => {
    const caches = installCaches();
    await withCache({ request: new Request(`${BASE}/api/x`) }, cacheKey('t', 'sync'), 60, async () => json({ ok: true }, 200, undefined, 60));
    expect(caches.store.has(cacheKey('t', 'sync'))).toBe(true);
  });

  it('a failing match falls back to produce(); a failing put is swallowed', async () => {
    const caches = installCaches();
    caches.default.match.mockRejectedValueOnce(new Error('match boom'));
    caches.default.put.mockRejectedValueOnce(new Error('put boom'));
    const { ctx, promises } = context();
    const response = await withCache(ctx, cacheKey('t', 'flaky'), 60, async () => json({ ok: true, n: 7 }, 200, undefined, 60));
    await expect(Promise.all(promises)).resolves.toBeDefined();
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(await response.json()).toEqual({ ok: true, n: 7 });
    expect(console.warn).toHaveBeenCalledWith('cache-match-failed', expect.any(Error));
    expect(console.warn).toHaveBeenCalledWith('cache-put-failed', expect.any(Error));
  });
});

describe('defineHandler', () => {
  const echo = defineHandler(async ({ url }) => json({ ok: true, data: { q: url.searchParams.get('q') } }, 200, undefined, 60));

  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])('%s → 405 with Allow', async (method) => {
    const response = await call(echo, `${BASE}/api/echo`, { method });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: false, error: 'method-not-allowed' });
  });

  it('403 without any same-site evidence', async () => {
    const response = await call(echo, `${BASE}/api/echo`, { headers: {} });
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: false, error: 'forbidden' });
  });

  it('200 with Sec-Fetch-Site or a same-host Origin', async () => {
    const viaSecFetch = await call(echo, `${BASE}/api/echo?q=1`, { headers: SAME_ORIGIN });
    expect(viaSecFetch.status).toBe(200);
    expect(await viaSecFetch.json()).toEqual({ ok: true, data: { q: '1' } });

    const viaOrigin = await call(echo, `${BASE}/api/echo?q=2`, { headers: { Origin: BASE } });
    expect(viaOrigin.status).toBe(200);
    expect(await viaOrigin.json()).toEqual({ ok: true, data: { q: '2' } });
  });

  it('a throwing handler → 500 internal-error without the message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = defineHandler(async () => {
      throw new Error('SECRET stack detail');
    });
    const response = await call(boom, `${BASE}/api/boom`);
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: 'internal-error' });
    expect(text).not.toContain('SECRET');
    expect(console.error).toHaveBeenCalledWith('api-handler-failed', expect.any(Error));
  });

  it('HEAD keeps status and headers but drops the body', async () => {
    const response = await call(echo, `${BASE}/api/echo?q=1`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=60');
    expect(await response.text()).toBe('');
  });

  it('a HEAD to a failing handler mirrors the error status with an empty body', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = defineHandler(async () => {
      throw new Error('x');
    });
    const response = await call(boom, `${BASE}/api/boom`, { method: 'HEAD' });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('');
  });
});
