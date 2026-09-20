import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/api/landmarks';
import type { ApiResponse, LandmarkResult } from '../../../src/types/api';
import { call, callJson, fetchCall, installCaches, jsonResponse, mockFetch, urlOf } from './_harness';

const PATH = '/api/landmarks';

const geosearch = (rows: Array<{ title: string; dist: number }>) => ({
  batchcomplete: '',
  query: { geosearch: rows.map((row, index) => ({ pageid: index + 1, ns: 0, ...row, lat: 41.3112, lon: 69.2797 })) }
});

beforeEach(() => {
  installCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('landmarks: guards', () => {
  it('405 for POST', async () => {
    const fetch = mockFetch(async () => jsonResponse(geosearch([])));
    expect((await call(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797' }), { method: 'POST' })).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('403 without same-site evidence', async () => {
    mockFetch(async () => jsonResponse(geosearch([])));
    expect((await call(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797' }), { headers: {} })).status).toBe(403);
  });

  it('400 for coordinates that are not coordinates', async () => {
    const fetch = mockFetch(async () => jsonResponse(geosearch([])));
    const { response, body } = await callJson(onRequest, urlOf(PATH, { lat: 'north', lon: '69.2797' }));
    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'invalid-coordinates' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('landmarks: what leaves the device', () => {
  it('sends only the rounded cell, never the caller’s own precision', async () => {
    const fetch = mockFetch(async () => jsonResponse(geosearch([{ title: 'Амир Темур хиёбони', dist: 120 }])));
    await call(onRequest, urlOf(PATH, { lat: '41.311158', lon: '69.279737', country: 'UZ' }));
    const { url } = fetchCall(fetch);
    expect(url).toContain('41.3112');
    expect(url).toContain('69.2797');
    expect(url).not.toContain('41.311158');
  });

  it('never sends anything but the coordinates and the radius', async () => {
    const fetch = mockFetch(async () => jsonResponse(geosearch([{ title: 'X', dist: 10 }])));
    await call(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797', country: 'UZ' }));
    const { url, init } = fetchCall(fetch);
    // No capture time, no country, no file name: a coordinate and a radius, nothing else.
    expect(url).not.toMatch(/timestamp|date|country=/);
    expect(init?.body).toBeUndefined();
  });
});

describe('landmarks: which Wikipedia is asked', () => {
  it('asks the local edition first for a country that has one', async () => {
    const fetch = mockFetch(async () => jsonResponse(geosearch([{ title: 'Amir Temur xiyoboni', dist: 90 }])));
    const { body } = await callJson<ApiResponse<LandmarkResult[]>>(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797', country: 'UZ' }));
    expect(fetchCall(fetch).url).toContain('uz.wikipedia.org');
    expect(body.data![0].lang).toBe('uz');
  });

  it('falls through to the next edition when the first knows nothing', async () => {
    // Half the monuments and mahallas of Tashkent have no article in the English Wikipedia,
    // and plenty have none in the Uzbek one either. An empty answer is not a failure.
    let call_ = 0;
    mockFetch(async () => {
      call_ += 1;
      return jsonResponse(call_ === 1 ? geosearch([]) : geosearch([{ title: 'Сквер Амира Темура', dist: 90 }]));
    });
    const { body } = await callJson<ApiResponse<LandmarkResult[]>>(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797', country: 'UZ' }));
    expect(body.data![0].lang).toBe('ru');
  });

  it('defaults to English for a country with no table entry', async () => {
    const fetch = mockFetch(async () => jsonResponse(geosearch([{ title: 'Somewhere', dist: 10 }])));
    await call(onRequest, urlOf(PATH, { lat: '48.8584', lon: '2.2945', country: 'FR' }));
    expect(fetchCall(fetch).url).toContain('en.wikipedia.org');
  });

  it('a country code that is not one cannot steer the request', async () => {
    // The edition is picked from a fixed table and checked against a fixed set, so nothing a
    // caller writes can reach a host of their choosing.
    const fetch = mockFetch(async () => jsonResponse(geosearch([{ title: 'X', dist: 1 }])));
    await call(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797', country: 'evil.example.com' }));
    expect(fetchCall(fetch).url).toContain('en.wikipedia.org');
  });
});

describe('landmarks: the answer', () => {
  it('maps titles and distances, nearest first as Wikipedia returns them', async () => {
    mockFetch(async () =>
      jsonResponse(geosearch([{ title: 'Ближе', dist: 40.4 }, { title: 'Дальше', dist: 300.6 }]))
    );
    const { body } = await callJson<ApiResponse<LandmarkResult[]>>(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797', country: 'UZ' }));
    expect(body.data).toEqual([
      { title: 'Ближе', distance: 40, lang: 'uz' },
      { title: 'Дальше', distance: 301, lang: 'uz' }
    ]);
  });

  it('an empty list is a real answer, not a failure', async () => {
    // Every edition answered and none knows this place: the point is somewhere unremarkable,
    // which is exactly what the card should be able to say.
    mockFetch(async () => jsonResponse(geosearch([])));
    const { response, body } = await callJson<ApiResponse<LandmarkResult[]>>(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797', country: 'UZ' }));
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: [] });
  });

  it('drops a row without a usable title or distance', async () => {
    mockFetch(async () =>
      jsonResponse({ query: { geosearch: [{ title: 'Хорошая', dist: 10 }, { title: 42, dist: 20 }, { title: 'Без расстояния' }] } })
    );
    const { body } = await callJson<ApiResponse<LandmarkResult[]>>(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797', country: 'UZ' }));
    expect(body.data).toEqual([{ title: 'Хорошая', distance: 10, lang: 'uz' }]);
  });

  it('a broken answer from one edition does not sink the request', async () => {
    let call_ = 0;
    mockFetch(async () => {
      call_ += 1;
      if (call_ === 1) return new Response('<html>not json</html>', { status: 200 });
      return jsonResponse(geosearch([{ title: 'Нашлось', dist: 15 }]));
    });
    const { body } = await callJson<ApiResponse<LandmarkResult[]>>(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797', country: 'UZ' }));
    expect(body.data).toEqual([{ title: 'Нашлось', distance: 15, lang: 'ru' }]);
  });

  it('caps the list so one busy square does not fill the card', async () => {
    mockFetch(async () => jsonResponse(geosearch(Array.from({ length: 12 }, (_, i) => ({ title: `Объект ${i}`, dist: i * 10 })))));
    const { body } = await callJson<ApiResponse<LandmarkResult[]>>(onRequest, urlOf(PATH, { lat: '41.3112', lon: '69.2797', country: 'UZ' }));
    expect(body.data!.length).toBeLessThanOrEqual(5);
  });
});
