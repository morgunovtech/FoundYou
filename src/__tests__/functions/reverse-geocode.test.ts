import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/api/reverse-geocode';
import type { ApiResponse, ReverseGeocodeResult } from '../../../src/types/api';
import { call, callJson, fetchCall, installCaches, jsonResponse, mockFetch, rejectAborted, urlOf } from './_harness';

const PATH = '/api/reverse-geocode';
const TASHKENT = { lat: '41.311158', lon: '69.279737' };

const nominatim = {
  place_id: 1,
  display_name: '12, Amir Temur Avenue, Yunusobod, Tashkent, 100000, Uzbekistan',
  address: {
    house_number: '12',
    road: 'Amir Temur Avenue',
    suburb: 'Yunusobod',
    city: 'Tashkent',
    state: 'Tashkent',
    country: 'Uzbekistan',
    country_code: 'uz'
  },
  // 0.001° tall × 0.002° wide → max delta 0.002° ≈ 222 m
  boundingbox: ['41.3105', '41.3115', '69.2790', '69.2810']
};

beforeEach(() => {
  installCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reverse-geocode: guards', () => {
  it('405 for POST', async () => {
    const fetch = mockFetch(async () => jsonResponse(nominatim));
    const response = await call(onRequest, urlOf(PATH, TASHKENT), { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('403 without Sec-Fetch-Site / Origin / Referer', async () => {
    const fetch = mockFetch(async () => jsonResponse(nominatim));
    const { response, body } = await callJson(onRequest, urlOf(PATH, TASHKENT), { headers: {} });
    expect(response.status).toBe(403);
    expect(body).toEqual({ ok: false, error: 'forbidden' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('200 with a same-host Origin instead of Sec-Fetch-Site', async () => {
    mockFetch(async () => jsonResponse(nominatim));
    const response = await call(onRequest, urlOf(PATH, TASHKENT), { headers: { Origin: 'https://foundyou.test' } });
    expect(response.status).toBe(200);
  });

  it.each([
    ['missing both', {}],
    ['missing lon', { lat: '41.3' }],
    ['empty lon', { lat: '41.3', lon: '' }],
    ['lat out of range', { lat: '95', lon: '69.2' }],
    ['lon out of range', { lat: '41.3', lon: '181' }],
    ['non-numeric', { lat: 'abc', lon: '69.2' }]
  ])('400 invalid-coordinates: %s', async (_label, params) => {
    const fetch = mockFetch(async () => jsonResponse(nominatim));
    const { response, body } = await callJson(onRequest, urlOf(PATH, params));
    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'invalid-coordinates' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('reverse-geocode: success', () => {
  it('maps the Nominatim answer to ReverseGeocodeResult with rounded coordinates', async () => {
    const fetch = mockFetch(async () => jsonResponse(nominatim));
    const { response, body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, TASHKENT));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400, s-maxage=86400');
    expect(response.headers.get('X-Cache')).toBe('MISS');

    expect(body.ok).toBe(true);
    const data = body.data!;
    expect(data).toMatchObject({
      address: nominatim.display_name,
      country: 'Uzbekistan',
      countryCode: 'UZ',
      city: 'Tashkent',
      state: 'Tashkent',
      district: 'Yunusobod',
      road: 'Amir Temur Avenue',
      houseNumber: '12',
      lat: 41.3112,
      lon: 69.2797
    });
    expect(data.precisionMeters).toBeCloseTo(0.002 * 111_139, 3);

    // Upstream sees the 4-decimal cell, never the caller's exact point.
    const { url, init } = fetchCall(fetch);
    expect(url).toBe('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=41.3112&lon=69.2797');
    expect(new Headers(init?.headers).get('User-Agent')).toContain('FoundYou');
  });

  it('falls back through town/village, pedestrian/footway, county and omits unknown fields', async () => {
    mockFetch(async () =>
      jsonResponse({
        display_name: 'Somewhere',
        address: { village: 'Qishloq', footway: 'Path', county: 'Tuman', country: 'Uzbekistan' }
      })
    );
    const { body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data).toEqual({
      address: 'Somewhere',
      country: 'Uzbekistan',
      city: 'Qishloq',
      district: 'Tuman',
      road: 'Path',
      lat: 41.3112,
      lon: 69.2797
    });
  });

  it('survives an empty Nominatim object with defaults', async () => {
    mockFetch(async () => jsonResponse({}));
    const { response, body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ address: 'Unknown address', country: 'Unknown', lat: 41.3112, lon: 69.2797 });
    expect(body.data!.precisionMeters).toBeUndefined();
    expect(body.data!.countryCode).toBeUndefined();
  });

  it('ignores a malformed bounding box', async () => {
    mockFetch(async () => jsonResponse({ ...nominatim, boundingbox: ['1', '2'] }));
    const { body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data!.precisionMeters).toBeUndefined();
  });

  it('answers HEAD with the same headers and no body', async () => {
    mockFetch(async () => jsonResponse(nominatim));
    const response = await call(onRequest, urlOf(PATH, TASHKENT), { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400, s-maxage=86400');
    expect(await response.text()).toBe('');
  });
});

describe('reverse-geocode: cache', () => {
  it('X-Cache HIT on the second identical call with a single upstream fetch', async () => {
    const fetch = mockFetch(async () => jsonResponse(nominatim));
    const first = await callJson(onRequest, urlOf(PATH, TASHKENT));
    const second = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(first.response.headers.get('X-Cache')).toBe('MISS');
    expect(second.response.headers.get('X-Cache')).toBe('HIT');
    expect(second.body).toEqual(first.body);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('points within the same 4-decimal cell share the cache entry', async () => {
    const fetch = mockFetch(async () => jsonResponse(nominatim));
    await call(onRequest, urlOf(PATH, { lat: '41.31116', lon: '69.27974' }));
    const second = await call(onRequest, urlOf(PATH, { lat: '41.31124', lon: '69.27966' }));
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('different cells fetch separately', async () => {
    const fetch = mockFetch(async () => jsonResponse(nominatim));
    await call(onRequest, urlOf(PATH, TASHKENT));
    await call(onRequest, urlOf(PATH, { lat: '41.3200', lon: '69.2800' }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('reverse-geocode: upstream failures', () => {
  it.each([
    [404, 502, 'upstream-404'],
    [500, 502, 'upstream-500'],
    [429, 429, 'upstream-429']
  ])('upstream %d → %d %s (no-store, no leak, not cached)', async (upstreamStatus, clientStatus, code) => {
    const fetch = mockFetch(async () => jsonResponse({ error: { code: upstreamStatus, message: 'SECRET Nominatim message' } }, upstreamStatus));
    const { response, body, text } = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(clientStatus);
    expect(body).toEqual({ ok: false, error: code });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(text).not.toContain('SECRET');

    await call(onRequest, urlOf(PATH, TASHKENT));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('timeout (AbortError) → 504 upstream-timeout', async () => {
    mockFetch(rejectAborted);
    const { response, body } = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(504);
    expect(body).toEqual({ ok: false, error: 'upstream-timeout' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('network failure → 502 upstream-unavailable', async () => {
    mockFetch(async () => {
      throw new TypeError('SECRET fetch failed');
    });
    const { response, body, text } = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(502);
    expect(body).toEqual({ ok: false, error: 'upstream-unavailable' });
    expect(text).not.toContain('SECRET');
  });

  it('non-JSON upstream body → 502 upstream-invalid', async () => {
    mockFetch(async () => new Response('<html>SECRET</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const { response, body, text } = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(502);
    expect(body).toEqual({ ok: false, error: 'upstream-invalid' });
    expect(text).not.toContain('SECRET');
  });
});
