import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/api/surveillance-candidates';
import { onRequest as nearbyPoi } from '../../../functions/api/nearby-poi';
import type { ApiResponse, PoiResult } from '../../../src/types/api';
import { call, callJson, fetchCall, installCaches, jsonResponse, mockFetch, rejectAborted, urlOf } from './_harness';
import { COUNT_SEPARATOR, POI_ELEMENTS, SURVEILLANCE_ELEMENTS, TASHKENT, decodeQuery, distanceFromCell, overpassPayload } from './_overpassFixture';

const PATH = '/api/surveillance-candidates';
const POI_PATH = '/api/nearby-poi';

beforeEach(() => {
  installCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('surveillance-candidates: guards', () => {
  it('405 for POST', async () => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    const response = await call(onRequest, urlOf(PATH, TASHKENT), { method: 'POST' });
    expect(response.status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('403 without same-site evidence, 200 with Sec-Fetch-Site / Origin', async () => {
    mockFetch(async () => jsonResponse(overpassPayload()));
    const url = urlOf(PATH, TASHKENT);
    expect((await call(onRequest, url, { headers: {} })).status).toBe(403);
    expect((await call(onRequest, url, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
    // Another host under the same registrable domain is not the SPA: only same-origin passes.
    expect((await call(onRequest, url, { headers: { 'Sec-Fetch-Site': 'same-site' } })).status).toBe(403);
    expect((await call(onRequest, url, { headers: { Referer: 'https://foundyou.test/' } })).status).toBe(200);
  });

  it.each([
    ['missing', {}],
    ['empty lat', { lat: '', lon: '69.2' }],
    ['lat=95', { lat: '95', lon: '69.2' }],
    ['lon=181', { lat: '41.3', lon: '181' }]
  ])('400 invalid-coordinates: %s', async (_label, params) => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    const { response, body } = await callJson(onRequest, urlOf(PATH, params));
    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'invalid-coordinates' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('surveillance-candidates: success', () => {
  it('returns the .cctv set only, sorted by distance, with the surveillance category order', async () => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    const { response, body } = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(body.ok).toBe(true);

    const data = body.data!;
    // 6 cctv elements, one without a position → 5 remain (exactly the cap).
    expect(data).toHaveLength(5);
    const distances = data.map((item) => item.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances.every(Number.isInteger)).toBe(true);

    // category = surveillance || man_made
    expect(data).toContainEqual({ name: '', category: 'public', distance: distanceFromCell(SURVEILLANCE_ELEMENTS[0]) });
    expect(data).toContainEqual({ name: 'Kapitalbank ATM', category: 'outdoor', distance: distanceFromCell(SURVEILLANCE_ELEMENTS[1]) });
    expect(data).toContainEqual({ name: 'NBU', category: 'surveillance', distance: distanceFromCell(SURVEILLANCE_ELEMENTS[2]) });
    expect(data).toContainEqual({ name: 'Korzinka', category: 'indoor', distance: distanceFromCell(SURVEILLANCE_ELEMENTS[3]) });
    expect(data).toContainEqual({ name: '', category: 'surveillance', distance: distanceFromCell(SURVEILLANCE_ELEMENTS[5]) });

    // Elements that only live in the .poi set never show up here.
    expect(data.map((item) => item.name)).not.toContain('Cafe Uno');
    expect(data.map((item) => item.name)).not.toContain('Central Park');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caps at 5 and drops the farthest', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      type: 'node' as const,
      id: 100 + index,
      lat: 41.3112 + index * 0.0002,
      lon: 69.2797,
      tags: { man_made: 'surveillance', name: `cam-${index}` }
    }));
    mockFetch(async () => jsonResponse(overpassPayload([COUNT_SEPARATOR, ...many])));
    const { body } = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data!.map((item) => item.name)).toEqual(['cam-0', 'cam-1', 'cam-2', 'cam-3', 'cam-4']);
  });

  it('falls back to the category "surveillance" when no known tag is present', async () => {
    mockFetch(async () => jsonResponse(overpassPayload([COUNT_SEPARATOR, { type: 'node', id: 1, lat: 41.3112, lon: 69.2797, tags: { name: 'Mystery' } }])));
    const { body } = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data).toEqual([{ name: 'Mystery', category: 'surveillance', distance: 0 }]);
  });

  it('an empty .cctv set is an ok empty list', async () => {
    mockFetch(async () => jsonResponse(overpassPayload([...POI_ELEMENTS, COUNT_SEPARATOR])));
    const { response, body } = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: [] });
  });

  it('without the count separator falls back to tag heuristics', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFetch(async () => jsonResponse(overpassPayload([...POI_ELEMENTS, ...SURVEILLANCE_ELEMENTS])));
    const { body } = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    const names = body.data!.map((item) => item.name);
    expect(names).toContain('Kapitalbank ATM');
    expect(names).toContain('NBU');
    expect(names).not.toContain('Cafe Uno');
    expect(names).not.toContain('Dorixona 24');
  });

  it('posts the combined query with 4-decimal coordinates', async () => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    await call(onRequest, urlOf(PATH, TASHKENT));
    const { url, init } = fetchCall(fetch);
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    const query = decodeQuery(init);
    expect(query).toContain('node["man_made"="surveillance"](around:300,41.3112,69.2797)');
    expect(query).not.toContain('69.279737');
    expect(query).toContain('.poi out count;');
  });
});

describe('surveillance-candidates: shared Overpass fetch', () => {
  it('surveillance-candidates then nearby-poi for the same cell → exactly one upstream fetch', async () => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    const cctv = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    const poi = await callJson<ApiResponse<PoiResult[]>>(nearbyPoi, urlOf(POI_PATH, TASHKENT));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cctv.response.headers.get('X-Cache')).toBe('MISS');
    expect(poi.response.headers.get('X-Cache')).toBe('HIT');
    expect(cctv.body.data!.map((item) => item.name)).toContain('NBU');
    expect(poi.body.data!.map((item) => item.name)).toContain('Cafe Uno');
  });

  it('X-Cache HIT on the second identical call', async () => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    const first = await callJson(onRequest, urlOf(PATH, TASHKENT));
    const second = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(first.response.headers.get('X-Cache')).toBe('MISS');
    expect(second.response.headers.get('X-Cache')).toBe('HIT');
    expect(second.body).toEqual(first.body);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('surveillance-candidates: upstream failures', () => {
  it.each([
    [404, 502, 'upstream-404'],
    [500, 502, 'upstream-500'],
    [429, 429, 'upstream-429']
  ])('upstream %d → %d %s without leaking the body', async (upstreamStatus, clientStatus, code) => {
    mockFetch(async () => new Response('SECRET Overpass error', { status: upstreamStatus }));
    const { response, body, text } = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(clientStatus);
    expect(body).toEqual({ ok: false, error: code });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(text).not.toContain('SECRET');
  });

  it('timeout (AbortError) → 504 upstream-timeout', async () => {
    mockFetch(rejectAborted);
    const { response, body } = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(504);
    expect(body).toEqual({ ok: false, error: 'upstream-timeout' });
  });

  it('Overpass runtime-error remark on HTTP 200 → 504', async () => {
    mockFetch(async () => jsonResponse({ ...overpassPayload([]), remark: 'runtime error: Query run out of memory SECRET' }));
    const { response, body, text } = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(504);
    expect(body).toEqual({ ok: false, error: 'upstream-timeout' });
    expect(text).not.toContain('SECRET');
  });

  it('non-JSON → 502 upstream-invalid', async () => {
    mockFetch(async () => new Response('SECRET not json', { status: 200 }));
    const { response, body, text } = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(502);
    expect(body).toEqual({ ok: false, error: 'upstream-invalid' });
    expect(text).not.toContain('SECRET');
  });

  it('errors are not cached', async () => {
    const fetch = mockFetch(async () => new Response('', { status: 500 }));
    await call(onRequest, urlOf(PATH, TASHKENT));
    await call(onRequest, urlOf(PATH, TASHKENT));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
