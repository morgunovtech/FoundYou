import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/api/reverse-geocode';
import type { ApiResponse, ReverseGeocodeResult } from '../../../src/types/api';
import { call, callJson, fetchCall, installCaches, jsonResponse, mockFetch, rejectAborted, urlOf, type FakeCaches } from './_harness';
import { cacheKey } from '../../../functions/api/_geo';

const PATH = '/api/reverse-geocode';
const TASHKENT = { lat: '41.311158', lon: '69.279737' };
const TASHKENT_KEY = cacheKey('reverse-geocode', '41.3112', '69.2797');

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

let caches: FakeCaches;

beforeEach(() => {
  caches = installCaches();
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
    expect(response.headers.get('Cache-Control')).toBe('no-store');
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
    expect(url).toBe('https://nominatim.openstreetmap.org/reverse?format=jsonv2&extratags=1&namedetails=1&lat=41.3112&lon=69.2797');
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

  it('survives an empty Nominatim object with only the coordinates, inventing nothing', async () => {
    mockFetch(async () => jsonResponse({}));
    const { response, body, text } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(200);
    expect(body.data).toEqual({ lat: 41.3112, lon: 69.2797 });
    expect(text).not.toContain('Unknown');
  });

  it('Nominatim’s «Unable to geocode» is an answer with no address, not an English placeholder', async () => {
    // Its documented no-result form is HTTP 200 with `{ "error": "Unable to geocode" }` — open
    // sea, the poles. The endpoint used to answer «Unknown address» / «Unknown», which the page
    // then printed verbatim in a Russian or Uzbek card; now the fields are simply absent and the
    // page falls back to its own dictionary. It is still a real answer, and still cached.
    const fetch = mockFetch(async () => jsonResponse({ error: 'Unable to geocode' }));
    const first = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(first.response.status).toBe(200);
    expect(first.body).toEqual({ ok: true, data: { lat: 41.3112, lon: 69.2797 } });
    expect('address' in first.body.data!).toBe(false);
    expect('country' in first.body.data!).toBe(false);
    expect(first.text).not.toContain('Unknown');

    const second = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(second.response.headers.get('X-Cache')).toBe('HIT');
    expect(second.body).toEqual(first.body);
    expect(fetch).toHaveBeenCalledTimes(1);
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
    expect(response.headers.get('Cache-Control')).toBe('no-store');
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

  it('the edge keeps a public copy for a day; the browser is told no-store on MISS and HIT', async () => {
    // A resolved address against `?lat=…&lon=…` in the browser's HTTP cache is a history of
    // places on the reader's disk — the same reason the map tiles are never cached.
    mockFetch(async () => jsonResponse(nominatim));
    const miss = await call(onRequest, urlOf(PATH, TASHKENT));
    expect(miss.headers.get('Cache-Control')).toBe('no-store');
    expect(caches.store.get(TASHKENT_KEY)?.headers).toContainEqual(['cache-control', 'public, max-age=86400, s-maxage=86400']);

    const hit = await call(onRequest, urlOf(PATH, TASHKENT));
    expect(hit.headers.get('X-Cache')).toBe('HIT');
    expect(hit.headers.get('Cache-Control')).toBe('no-store');
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

describe('reverse-geocode: place type', () => {
  it('forwards what the point resolved to (category, type, addresstype, name) and drops blanks', async () => {
    mockFetch(async () =>
      jsonResponse({
        display_name: 'Lotus Hotel, 83-3, Rakatboshi Street, Yakkasaray, Tashkent, Uzbekistan',
        category: 'tourism',
        type: 'hotel',
        addresstype: 'tourism',
        name: 'Lotus Hotel',
        address: { road: 'Rakatboshi Street', house_number: '83-3', city: 'Tashkent', country: 'Uzbekistan', country_code: 'uz' }
      })
    );
    const { body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data).toMatchObject({ category: 'tourism', type: 'hotel', addressType: 'tourism', name: 'Lotus Hotel', houseNumber: '83-3' });

    mockFetch(async () => jsonResponse({ display_name: 'Road', category: '', type: 42, address: {} }));
    const blank = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, { lat: '10', lon: '10' }));
    expect(blank.body.data?.category).toBeUndefined();
    expect(blank.body.data?.type).toBeUndefined();
    expect(blank.body.data?.name).toBeUndefined();
  });
});

describe('reverse-geocode: distance to the matched object', () => {
  it('measures how far the answer is from the point asked about', async () => {
    // The match sits 0.0030° north and 0.0020° east of the rounded request point:
    // ≈333 m north, ≈168 m east at this latitude → ≈373 m.
    mockFetch(async () =>
      jsonResponse({ ...nominatim, lat: '41.3141', lon: '69.2817', category: 'highway', type: 'residential' })
    );
    const { body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.ok).toBe(true);
    expect(body.data!.distanceMeters).toBeGreaterThan(330);
    expect(body.data!.distanceMeters).toBeLessThan(420);
  });

  it('leaves the distance out when the upstream gave no coordinates', async () => {
    mockFetch(async () => jsonResponse(nominatim));
    const { body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.ok).toBe(true);
    expect(body.data!.distanceMeters).toBeUndefined();
  });

  it('answers 0 for a match on the rounded point itself', async () => {
    mockFetch(async () => jsonResponse({ ...nominatim, lat: '41.3112', lon: '69.2797' }));
    const { body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.ok).toBe(true);
    expect(body.data!.distanceMeters).toBe(0);
  });
});

describe('reverse-geocode: the finer answer', () => {
  /*
   * `extratags` and `namedetails` cost nothing extra in privacy — the same rounded cell goes to
   * the same upstream — and they answer three questions the plain reply cannot: which mahalla
   * the point is in, how many storeys the building has, and what the place is called locally.
   */
  const nominatim = (extra: Record<string, unknown>) => ({
    display_name: 'Амир Темур 12, Ташкент, Узбекистан',
    lat: '41.3112',
    lon: '69.2797',
    place_rank: 30,
    address: { country: 'Узбекистан', country_code: 'uz', city: 'Ташкент', road: 'Амир Темур', house_number: '12' },
    ...extra
  });

  it('reads the mahalla and prefers it over the coarser levels', async () => {
    mockFetch(async () => jsonResponse(nominatim({ address: { ...nominatim({}).address, neighbourhood: 'Мирзо Улугбек МФЙ', suburb: 'Мирзо-Улугбекский район' } })));
    const { body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797' }));
    expect(body.data!.neighbourhood).toBe('Мирзо Улугбек МФЙ');
    // The district is still reported; the mahalla is an extra row, not a replacement.
    expect(body.data!.district).toBe('Мирзо-Улугбекский район');
  });

  it('falls back through quarter, residential and city_block', async () => {
    // A different cell per case: the answer is cached by rounded coordinates, so reusing one
    // point would test the cache rather than the mapping.
    const cells = ['41.3112', '41.3113', '41.3114'];
    for (const [index, key] of ['quarter', 'residential', 'city_block'].entries()) {
      mockFetch(async () => jsonResponse(nominatim({ address: { ...nominatim({}).address, [key]: 'Кварт. 5' } })));
      const { body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, { lat: cells[index], lon: '69.2797' }));
      expect(body.data!.neighbourhood).toBe('Кварт. 5');
    }
  });

  it('reads the storeys and ignores a value that is not one', async () => {
    mockFetch(async () => jsonResponse(nominatim({ extratags: { 'building:levels': '9' } })));
    const ok = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797' }));
    expect(ok.body.data!.buildingLevels).toBe(9);

    const cells = ['41.3115', '41.3116', '41.3117', '41.3118'];
    for (const [index, bad] of ['многоэтажный', '-2', '9000', ''].entries()) {
      mockFetch(async () => jsonResponse(nominatim({ extratags: { 'building:levels': bad } })));
      const { body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, { lat: cells[index], lon: '69.2797' }));
      expect(body.data!.buildingLevels).toBeUndefined();
    }
  });

  it('gives the local name only when OSM holds one and it differs', async () => {
    mockFetch(async () => jsonResponse(nominatim({ namedetails: { name: 'Amir Temur Square', 'name:uz': 'Amir Temur xiyoboni' } })));
    const differs = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797' }));
    expect(differs.body.data!.localName).toBe('Amir Temur xiyoboni');

    mockFetch(async () => jsonResponse(nominatim({ namedetails: { name: 'Amir Temur xiyoboni', 'name:uz': 'Amir Temur xiyoboni' } })));
    const same = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, { lat: '41.3119', lon: '69.2797' }));
    expect(same.body.data!.localName).toBeUndefined();
  });

  it('carries Nominatim’s own idea of how specific the match is', async () => {
    mockFetch(async () => jsonResponse(nominatim({ place_rank: 16 })));
    const { body } = await callJson<ApiResponse<ReverseGeocodeResult>>(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797' }));
    expect(body.data!.placeRank).toBe(16);
  });
});
