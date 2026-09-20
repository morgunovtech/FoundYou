import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/api/place-context';
import type { ApiResponse, PlaceContextResult } from '../../../src/types/api';
import { call, callJson, fetchCall, installCaches, jsonResponse, mockFetch, urlOf } from './_harness';
import { COUNT_SEPARATOR, CONTEXT_ELEMENTS, POI_ELEMENTS, SURVEILLANCE_ELEMENTS, TASHKENT, overpassPayload, type FakeElement } from './_overpassFixture';

const PATH = '/api/place-context';

const payload = (context: FakeElement[] = CONTEXT_ELEMENTS, poi: FakeElement[] = POI_ELEMENTS) =>
  overpassPayload([...poi, COUNT_SEPARATOR, ...SURVEILLANCE_ELEMENTS, COUNT_SEPARATOR, ...context]);

beforeEach(() => {
  installCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('place-context: guards', () => {
  it('405 for POST', async () => {
    const fetch = mockFetch(async () => jsonResponse(payload()));
    const response = await call(onRequest, urlOf(PATH, TASHKENT), { method: 'POST' });
    expect(response.status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('403 without same-site evidence', async () => {
    mockFetch(async () => jsonResponse(payload()));
    expect((await call(onRequest, urlOf(PATH, TASHKENT), { headers: {} })).status).toBe(403);
  });

  it('400 for coordinates that are not coordinates', async () => {
    const fetch = mockFetch(async () => jsonResponse(payload()));
    const { response, body } = await callJson(onRequest, urlOf(PATH, { lat: '200', lon: '69.2797' }));
    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'invalid-coordinates' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('only the rounded cell ever reaches the upstream', async () => {
    const fetch = mockFetch(async () => jsonResponse(payload()));
    await call(onRequest, urlOf(PATH, TASHKENT));
    const sent = decodeURIComponent(String(fetchCall(fetch).init?.body ?? ''));
    expect(sent).toContain('41.3112');
    expect(sent).toContain('69.2797');
    // The caller's own precision must not leak into the query.
    expect(sent).not.toContain('41.311158');
  });
});

describe('place-context: what kind of place this is', () => {
  it('takes the nearest land use, not the first one', async () => {
    mockFetch(async () => jsonResponse(payload()));
    const { body } = await callJson<ApiResponse<PlaceContextResult>>(onRequest, urlOf(PATH, TASHKENT));
    // Two polygons cover the area; the one centred on the point wins over the one 500 m away.
    expect(body.data!.landuse).toBe('residential');
  });

  it('lists the sensitive neighbours nearest first and drops the far ones', async () => {
    mockFetch(async () => jsonResponse(payload()));
    const { body } = await callJson<ApiResponse<PlaceContextResult>>(onRequest, urlOf(PATH, TASHKENT));
    const kinds = body.data!.sensitive.map((item) => item.kind);
    expect(kinds).toContain('kindergarten');
    expect(kinds).toContain('hospital');
    // The school is ~2 km away: beyond 500 m it says nothing about whoever stood at the point.
    expect(kinds).not.toContain('school');
    const distances = body.data!.sensitive.map((item) => item.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('a military site is reported however far it is', async () => {
    // The 1 km radius is in the query; unlike the amenities it is not cut again by distance,
    // because a military neighbour matters at a range where a kindergarten does not.
    mockFetch(async () => jsonResponse(payload()));
    const { body } = await callJson<ApiResponse<PlaceContextResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data!.sensitive.some((item) => item.kind === 'military')).toBe(true);
  });

  it('separates transport from the sensitive list', async () => {
    mockFetch(async () => jsonResponse(payload()));
    const { body } = await callJson<ApiResponse<PlaceContextResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data!.transport.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['railway:station', 'public_transport'])
    );
    expect(body.data!.sensitive.some((item) => item.kind.startsWith('railway'))).toBe(false);
  });

  it('says nothing rather than something empty when OSM knows nothing here', async () => {
    mockFetch(async () => jsonResponse(payload([], [])));
    const { response, body } = await callJson<ApiResponse<PlaceContextResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(200);
    expect(body.data).toEqual({ landuse: undefined, sensitive: [], transport: [] });
  });
});

describe('place-context: how many people live here', () => {
  const place = (tags: Record<string, string>): FakeElement => ({ type: 'node', id: 90, lat: 41.3112, lon: 69.2797, tags });

  it('reads the population off the nearest settlement OSM records one for', async () => {
    mockFetch(async () => jsonResponse(payload(CONTEXT_ELEMENTS, [place({ place: 'city', name: 'Ташкент', population: '2860000' })])));
    const { body } = await callJson<ApiResponse<PlaceContextResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data!.population).toBe(2_860_000);
    expect(body.data!.placeName).toBe('Ташкент');
    expect(body.data!.placeKind).toBe('city');
  });

  it('accepts the spaced form OSM sometimes carries', async () => {
    mockFetch(async () => jsonResponse(payload(CONTEXT_ELEMENTS, [place({ place: 'village', name: 'Чимган', population: '1 240' })])));
    const { body } = await callJson<ApiResponse<PlaceContextResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data!.population).toBe(1240);
  });

  it('refuses a population that is not a count', async () => {
    // «около 800», «0», a decade of vandalism: better no row than an invented number.
    for (const [index, bad] of ['около 800', '0', '-5', '999000000'].entries()) {
      mockFetch(async () => jsonResponse(payload(CONTEXT_ELEMENTS, [place({ place: 'village', name: 'X', population: bad })])));
      const { body } = await callJson<ApiResponse<PlaceContextResult>>(
        onRequest,
        urlOf(PATH, { lat: `41.31${20 + index}`, lon: '69.2797' })
      );
      expect(body.data!.population).toBeUndefined();
    }
  });

  it('prefers the nearer settlement when two record a population', async () => {
    mockFetch(async () =>
      jsonResponse(
        payload(CONTEXT_ELEMENTS, [
          { type: 'node', id: 91, lat: 41.3150, lon: 69.2797, tags: { place: 'city', name: 'Дальний', population: '500000' } },
          place({ place: 'suburb', name: 'Ближний', population: '12000' })
        ])
      )
    );
    const { body } = await callJson<ApiResponse<PlaceContextResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data!.placeName).toBe('Ближний');
  });

  it('ignores a settlement beyond the radius', async () => {
    mockFetch(async () =>
      jsonResponse(payload(CONTEXT_ELEMENTS, [{ type: 'node', id: 92, lat: 41.35, lon: 69.2797, tags: { place: 'city', name: 'Далеко', population: '500000' } }]))
    );
    const { body } = await callJson<ApiResponse<PlaceContextResult>>(onRequest, urlOf(PATH, TASHKENT));
    expect(body.data!.population).toBeUndefined();
  });
});
