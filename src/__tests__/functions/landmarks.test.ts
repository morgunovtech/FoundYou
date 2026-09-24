import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPSTREAM_TIMEOUT_MS, cacheKey } from '../../../functions/api/_geo';
import { onRequest } from '../../../functions/api/landmarks';
import type { ApiResponse, LandmarkResult } from '../../../src/types/api';
import { call, callJson, fetchCall, installCaches, jsonResponse, mockFetch, urlOf, waitForAbort, type FakeCaches } from './_harness';

const PATH = '/api/landmarks';
const TASHKENT = { lat: '41.3112', lon: '69.2797', country: 'UZ' };
/** The edge copy for the Tashkent cell, as the endpoint keys it (uz, ru, en). */
const TASHKENT_KEY = cacheKey('landmarks', '41.3112', '69.2797', 'uz-ru-en');

const geosearch = (rows: Array<{ title: string; dist: number }>) => ({
  batchcomplete: '',
  query: { geosearch: rows.map((row, index) => ({ pageid: index + 1, ns: 0, ...row, lat: 41.3112, lon: 69.2797 })) }
});

let caches: FakeCaches;

beforeEach(() => {
  caches = installCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
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
    // which is exactly what the card should be able to say — and it is kept for the week.
    const fetch = mockFetch(async () => jsonResponse(geosearch([])));
    const { response, body } = await callJson<ApiResponse<LandmarkResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: [] });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(caches.store.get(TASHKENT_KEY)?.headers).toContainEqual(['cache-control', `public, max-age=${7 * 86_400}, s-maxage=${7 * 86_400}`]);
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

describe('landmarks: when Wikipedia does not answer', () => {
  it('every edition failing is an outage, not an unremarkable place: 502 and nothing cached', async () => {
    // It used to answer `ok: []` and keep that for seven days, so a Wikipedia outage became
    // «nothing here» for a week for every reader who asked about the cell.
    const fetch = mockFetch(async () => jsonResponse({ error: 'SECRET maintenance' }, 503));
    const { response, body, text } = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(502);
    expect(body).toEqual({ ok: false, error: 'upstream-unavailable' });
    expect(text).not.toContain('SECRET');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(caches.store.size).toBe(0);

    await call(onRequest, urlOf(PATH, TASHKENT));
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('one edition down and the rest empty is still an empty answer, kept an hour rather than a week', async () => {
    let call_ = 0;
    mockFetch(async () => {
      call_ += 1;
      return call_ === 1 ? jsonResponse({}, 500) : jsonResponse(geosearch([]));
    });
    const { response, body } = await callJson<ApiResponse<LandmarkResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: [] });
    // The edition that was down may hold the article; the list is not the whole story.
    expect(caches.store.get(TASHKENT_KEY)?.headers).toContainEqual(['cache-control', 'public, max-age=3600, s-maxage=3600']);
  });

  it('one deadline for the whole loop: an edition that eats the budget stops the rest being asked', async () => {
    // Each edition used to get a fresh 8 s, so three could take 24 s against the page's 12 s
    // timeout. Here the first answers empty at once and the second hangs: when it is aborted at
    // the deadline there is nothing left for the third, which is never asked.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let secondStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    let call_ = 0;
    const fetch = mockFetch((input, init) => {
      call_ += 1;
      if (call_ === 1) return Promise.resolve(jsonResponse(geosearch([])));
      secondStarted();
      return waitForAbort(input, init);
    });

    const pending = callJson<ApiResponse<LandmarkResult[]>>(onRequest, urlOf(PATH, TASHKENT));
    await started;
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS);
    const { response, body } = await pending;

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetchCall(fetch, 1).init?.signal?.aborted).toBe(true);
    // The Uzbek edition answered, the Russian one never did and the English one was not asked:
    // an empty answer with a hole in it is kept for an hour, not a week.
    expect(caches.store.get(TASHKENT_KEY)?.headers).toContainEqual(['cache-control', 'public, max-age=3600, s-maxage=3600']);
  });

  it('the budget running out before anything answered is the outage case: 502, one fetch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const fetch = mockFetch((input, init) => {
      firstStarted();
      return waitForAbort(input, init);
    });

    const pending = callJson(onRequest, urlOf(PATH, TASHKENT));
    await started;
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS);
    const { response, body } = await pending;

    expect(response.status).toBe(502);
    expect(body).toEqual({ ok: false, error: 'upstream-unavailable' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(caches.store.size).toBe(0);
  });
});
