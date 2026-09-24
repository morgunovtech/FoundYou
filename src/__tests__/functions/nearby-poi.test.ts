import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/api/nearby-poi';
import { onRequest as surveillance } from '../../../functions/api/surveillance-candidates';
import type { ApiResponse, PoiResult } from '../../../src/types/api';
import { call, callJson, fetchCall, installCaches, jsonResponse, mockFetch, rejectAborted, urlOf } from './_harness';
import {
  COUNT_SEPARATOR,
  POI_ELEMENTS,
  SURVEILLANCE_ELEMENTS,
  TASHKENT,
  decodeQuery,
  bearingFromCell,
  distanceFromCell,
  overpassPayload,
  type FakeElement
} from './_overpassFixture';

const PATH = '/api/nearby-poi';
const SURVEILLANCE_PATH = '/api/surveillance-candidates';

beforeEach(() => {
  installCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('nearby-poi: guards', () => {
  it('405 for POST', async () => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    const response = await call(onRequest, urlOf(PATH, TASHKENT), { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('403 without same-site evidence, 200 with Sec-Fetch-Site / Origin', async () => {
    mockFetch(async () => jsonResponse(overpassPayload()));
    const url = urlOf(PATH, TASHKENT);
    const forbidden = await callJson(onRequest, url, { headers: {} });
    expect(forbidden.response.status).toBe(403);
    expect(forbidden.body).toEqual({ ok: false, error: 'forbidden' });
    expect((await call(onRequest, url, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
    expect((await call(onRequest, url, { headers: { Origin: 'https://foundyou.test' } })).status).toBe(200);
  });

  it.each([
    ['missing', {}],
    ['empty lon', { lat: '41.3', lon: '' }],
    ['lat=95', { lat: '95', lon: '69.2' }],
    ['lon=-181', { lat: '41.3', lon: '-181' }]
  ])('400 invalid-coordinates: %s', async (_label, params) => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    const { response, body } = await callJson(onRequest, urlOf(PATH, params));
    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'invalid-coordinates' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('nearby-poi: success', () => {
  it('returns the 5 nearest POIs from the .poi set, sorted, with integer distances', async () => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    const { response, body } = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(body.ok).toBe(true);

    const data = body.data!;
    expect(data).toHaveLength(5);
    for (const item of data) {
      expect(Object.keys(item).sort()).toEqual(['bearing', 'category', 'distance', 'name']);
      expect(Number.isInteger(item.distance)).toBe(true);
    }
    const distances = data.map((item) => item.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));

    // Nearest is the cafe; Zara (farthest) is cut; the relation without a position never appears.
    expect(data[0]).toEqual({
      name: 'Cafe Uno',
      category: 'cafe',
      distance: distanceFromCell(POI_ELEMENTS[0]),
      // The direction from the shot to the object, so the page can say what was in the frame.
      // A bearing and a distance say strictly less than the object's coordinates would.
      bearing: bearingFromCell(POI_ELEMENTS[0])
    });
    expect(data.map((item) => item.name)).not.toContain('Zara');
    expect(data.map((item) => item.name)).not.toContain('Underground parking');
    // Surveillance-only elements never leak into the POI list.
    expect(data.map((item) => item.name)).not.toContain('Kapitalbank ATM');
    expect(data.map((item) => item.category)).not.toContain('public');

    // Category comes from amenity/shop/tourism/leisure; the nameless museum has name ''.
    expect(data).toContainEqual({
      name: '',
      category: 'museum',
      distance: distanceFromCell(POI_ELEMENTS[2]),
      bearing: bearingFromCell(POI_ELEMENTS[2])
    });
    expect(data).toContainEqual({
      name: 'Korzinka',
      category: 'supermarket',
      distance: distanceFromCell(POI_ELEMENTS[1]),
      bearing: bearingFromCell(POI_ELEMENTS[1])
    });
    expect(data).toContainEqual({
      name: 'Central Park',
      category: 'park',
      distance: distanceFromCell(POI_ELEMENTS[5]),
      bearing: bearingFromCell(POI_ELEMENTS[5])
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('posts the combined query with 4-decimal coordinates and the count separator', async () => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    await call(onRequest, urlOf(PATH, TASHKENT));

    const { url, init } = fetchCall(fetch);
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(new Headers(init?.headers).get('User-Agent')).toContain('FoundYou');
    expect(String(init?.body)).toMatch(/^data=/);

    const query = decodeQuery(init);
    expect(query).toContain('[out:json]');
    expect(query).toContain('(around:250,41.3112,69.2797)');
    expect(query).toContain('(around:300,41.3112,69.2797)');
    expect(query).not.toContain('41.311158');
    expect(query).toContain(')->.poi;');
    expect(query).toContain(')->.cctv;');
    expect(query).toContain(')->.ctx;');
    // Three sets, two separators: `place-context` is served from the same cached answer.
    expect(query.replace(/\s+/g, ' ')).toContain('.poi out center; .poi out count; .cctv out center; .cctv out count; .ctx out center;');
  });

  it('uses brand when name is missing and falls back to category "poi"', async () => {
    mockFetch(async () =>
      jsonResponse(
        overpassPayload([
          { type: 'node', id: 1, lat: 41.3113, lon: 69.2798, tags: { brand: 'Evos', amenity: 'fast_food' } },
          { type: 'node', id: 2, lat: 41.3114, lon: 69.2798, tags: { name: 'Untagged' } },
          { type: 'node', id: 3, lat: 41.3114, lon: 69.2799 },
          COUNT_SEPARATOR
        ])
      )
    );
    const { body } = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data).toEqual([
      { name: 'Evos', category: 'fast_food', distance: expect.any(Number), bearing: expect.any(Number) },
      { name: 'Untagged', category: 'poi', distance: expect.any(Number), bearing: expect.any(Number) },
      { name: '', category: 'poi', distance: expect.any(Number), bearing: expect.any(Number) }
    ]);
  });

  it('an empty .poi set is an ok empty list', async () => {
    mockFetch(async () => jsonResponse(overpassPayload([COUNT_SEPARATOR, ...SURVEILLANCE_ELEMENTS])));
    const { response, body } = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: [] });
  });

  it('without the count separator falls back to splitting by tags', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFetch(async () => jsonResponse(overpassPayload([...POI_ELEMENTS, ...SURVEILLANCE_ELEMENTS])));
    const { body } = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.ok).toBe(true);
    const names = body.data!.map((item) => item.name);
    expect(names).toContain('Cafe Uno');
    // A camera way carries no `amenity`, so the tag heuristic never counts it as a POI.
    expect(names).not.toContain('NBU');
    expect(body.data!.map((item) => item.category)).not.toContain('surveillance');
    expect(body.data!.map((item) => item.category)).not.toContain('public');
    expect(console.warn).toHaveBeenCalledWith('overpass-missing-separator');
  });
});

describe('nearby-poi: shared Overpass fetch', () => {
  it('nearby-poi then surveillance-candidates for the same cell → exactly one upstream fetch', async () => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    const poi = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    const cctv = await callJson<ApiResponse<PoiResult[]>>(surveillance, urlOf(SURVEILLANCE_PATH, TASHKENT));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(poi.response.headers.get('X-Cache')).toBe('MISS');
    expect(cctv.response.headers.get('X-Cache')).toBe('HIT');
    expect(poi.body.data!.map((item) => item.name)).toContain('Cafe Uno');
    expect(cctv.body.data!.map((item) => item.name)).toContain('Kapitalbank ATM');
  });

  it('concurrent calls from both endpoints share the in-flight request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = mockFetch(async () => {
      await gate;
      return jsonResponse(overpassPayload());
    });

    const pending = Promise.all([
      call(onRequest, urlOf(PATH, TASHKENT)),
      call(surveillance, urlOf(SURVEILLANCE_PATH, TASHKENT))
    ]);
    // Let both handlers reach loadOverpassSets before the upstream answers.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const [poi, cctv] = await pending;

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(poi.status).toBe(200);
    expect(cctv.status).toBe(200);
    expect((await poi.json()).data.length).toBeGreaterThan(0);
    expect((await cctv.json()).data.length).toBeGreaterThan(0);
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

  it('points that round to the same cell share one fetch; another cell fetches again', async () => {
    const fetch = mockFetch(async () => jsonResponse(overpassPayload()));
    await call(onRequest, urlOf(PATH, { lat: '41.31116', lon: '69.27974' }));
    await call(onRequest, urlOf(PATH, { lat: '41.31124', lon: '69.27966' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    await call(onRequest, urlOf(PATH, { lat: '41.3200', lon: '69.2800' }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('nearby-poi: upstream failures', () => {
  it.each([
    [404, 502, 'upstream-404'],
    [500, 502, 'upstream-500'],
    [429, 429, 'upstream-429']
  ])('upstream %d → %d %s without leaking the body, not cached', async (upstreamStatus, clientStatus, code) => {
    const fetch = mockFetch(
      async () =>
        new Response('<p>SECRET Overpass error text</p>', {
          status: upstreamStatus,
          headers: { 'Content-Type': 'text/html' }
        })
    );
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

  it('Overpass "timed out" remark on HTTP 200 → 504 and not cached', async () => {
    const fetch = mockFetch(async () =>
      jsonResponse({
        ...overpassPayload([]),
        remark: 'runtime error: Query timed out in "query" at line 3 after 8 seconds. SECRET'
      })
    );
    const { response, body, text } = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(504);
    expect(body).toEqual({ ok: false, error: 'upstream-timeout' });
    expect(text).not.toContain('SECRET');
    await call(onRequest, urlOf(PATH, TASHKENT));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('non-JSON body or a missing elements array → 502 upstream-invalid', async () => {
    mockFetch(async () => new Response('<html>SECRET</html>', { status: 200 }));
    const html = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(html.response.status).toBe(502);
    expect(html.body).toEqual({ ok: false, error: 'upstream-invalid' });
    expect(html.text).not.toContain('SECRET');

    vi.unstubAllGlobals();
    installCaches();
    mockFetch(async () => jsonResponse({ version: 0.6, elements: 'SECRET' }));
    const noElements = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(noElements.response.status).toBe(502);
    expect(noElements.body).toEqual({ ok: false, error: 'upstream-invalid' });
    expect(noElements.text).not.toContain('SECRET');
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
});

describe('nearby-poi: landmarks and settlements', () => {
  it('asks Overpass for sights, history, parks, natural features and places at wider radii', async () => {
    let init: RequestInit | undefined;
    mockFetch(async (_input, requestInit) => {
      init = requestInit;
      return jsonResponse(overpassPayload());
    });
    await callJson(onRequest, urlOf(PATH, TASHKENT));
    const query = decodeQuery(init);
    // `tourism=yes` / `historic=yes` mark a building, not a sight: they are excluded in the query.
    expect(query).toContain('nwr["tourism"]["tourism"!="yes"](around:1000,41.3112,69.2797)');
    expect(query).toContain('nwr["historic"]["historic"!="yes"](around:1000,41.3112,69.2797)');
    expect(query).toContain('[timeout:6]');
    expect(query).toContain('nwr["leisure"~"^(park|');
    expect(query).toContain('(around:500,41.3112,69.2797)');
    expect(query).toContain('nwr["natural"~"^(peak|spring|');
    expect(query).toContain('(around:1500,41.3112,69.2797)');
    expect(query).toContain('node["place"~"^(city|town|village|hamlet|');
    // Venues stay tight: a bench 800 m away is noise, a peak 800 m away is the landmark.
    expect(query).toContain('node["amenity"](around:250,41.3112,69.2797)');
  });

  it('uses the landmark tag as the category and orders far features by distance', async () => {
    const elements: FakeElement[] = [
      {
        type: 'node',
        id: 21,
        lat: 41.32,
        lon: 69.2797,
        tags: { natural: 'peak', name: 'Kichik Chimyon', ele: '1300' }
      },
      { type: 'node', id: 22, lat: 41.3112, lon: 69.29, tags: { place: 'hamlet', name: 'Teshiktosh' } },
      {
        type: 'way',
        id: 23,
        center: { lat: 41.315, lon: 69.2797 },
        tags: { tourism: 'camp_site', name: 'Chimgan camp' }
      },
      { type: 'node', id: 24, lat: 41.3113, lon: 69.2798, tags: { historic: 'monument', name: 'Obelisk' } },
      { type: 'way', id: 25, center: { lat: 41.3125, lon: 69.2805 }, tags: { leisure: 'park', name: 'Central Park' } }
    ];
    mockFetch(async () => jsonResponse(overpassPayload([...elements, COUNT_SEPARATOR])));
    const { body } = await callJson<ApiResponse<PoiResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.ok).toBe(true);
    expect(body.data?.map((item) => [item.name, item.category])).toEqual([
      ['Obelisk', 'monument'],
      ['Central Park', 'park'],
      ['Chimgan camp', 'camp_site'],
      ['Teshiktosh', 'hamlet'],
      ['Kichik Chimyon', 'peak']
    ]);
    expect(body.data?.[4].distance).toBeGreaterThan(900);
  });
});
