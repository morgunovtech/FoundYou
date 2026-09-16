import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/api/historical-weather';
import type { ApiResponse, HistoricalWeatherResult } from '../../../src/types/api';
import { call, callJson, fetchCall, installCaches, jsonResponse, mockFetch, rejectAborted, urlOf } from './_harness';

const PATH = '/api/historical-weather';
const TASHKENT = { lat: '41.311158', lon: '69.279737' };
const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Open-Meteo archive shape for one day. Every series encodes the hour so the
 * test can tell which index was picked: temperature = 20 + h, pressure = 1000 + h…
 */
function openMeteo(date: string, timezone: string) {
  const time = Array.from({ length: 24 }, (_, h) => `${date}T${pad(h)}:00`);
  return {
    latitude: 41.3125,
    longitude: 69.25,
    generationtime_ms: 0.1,
    utc_offset_seconds: timezone === 'UTC' || timezone === 'GMT' ? 0 : 18_000,
    timezone,
    timezone_abbreviation: timezone === 'Asia/Tashkent' ? '+05' : 'GMT',
    elevation: 455,
    hourly_units: { time: 'iso8601', temperature_2m: '°C', precipitation: 'mm', cloudcover: '%', wind_speed_10m: 'km/h', pressure_msl: 'hPa' },
    hourly: {
      time,
      temperature_2m: time.map((_, h) => 20 + h),
      precipitation: time.map((_, h) => h / 10),
      cloudcover: time.map((_, h) => h),
      wind_speed_10m: time.map((_, h) => h + 1),
      pressure_msl: time.map((_, h) => 1000 + h),
      weather_code: time.map((_, h) => h % 4)
    }
  };
}

/** Answers like the real archive: the requested day, in the requested zone. */
function archiveFetch() {
  return mockFetch(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const date = url.searchParams.get('start_date') ?? '1970-01-01';
    const timezone = url.searchParams.get('timezone') === 'auto' ? 'Asia/Tashkent' : 'GMT';
    return jsonResponse(openMeteo(date, timezone));
  });
}

beforeEach(() => {
  installCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('historical-weather: guards', () => {
  it('405 for POST', async () => {
    const fetch = archiveFetch();
    const response = await call(onRequest, urlOf(PATH, { ...TASHKENT, local: '2024-06-14T18:30:12' }), { method: 'POST' });
    expect(response.status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('403 without same-site evidence, 200 with Sec-Fetch-Site or Origin', async () => {
    archiveFetch();
    const url = urlOf(PATH, { ...TASHKENT, local: '2024-06-14T18:30:12' });
    expect((await call(onRequest, url, { headers: {} })).status).toBe(403);
    expect((await call(onRequest, url, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
    expect((await call(onRequest, url, { headers: { Origin: 'https://foundyou.test' } })).status).toBe(200);
  });

  it.each([
    ['lat out of range', { lat: '95', lon: '69.2', local: '2024-06-14T18:30' }],
    ['empty lon', { lat: '41.3', lon: '', local: '2024-06-14T18:30' }],
    ['missing coords', { local: '2024-06-14T18:30' }]
  ])('400 invalid-coordinates: %s', async (_label, params) => {
    const fetch = archiveFetch();
    const { response, body } = await callJson(onRequest, urlOf(PATH, params));
    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'invalid-coordinates' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('400 invalid-parameters when neither local nor timestamp is given', async () => {
    const fetch = archiveFetch();
    const { response, body } = await callJson(onRequest, urlOf(PATH, TASHKENT));
    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'invalid-parameters' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['local: garbage', { local: 'garbage' }],
    ['local: space instead of T', { local: '2024-06-14 18:30:12' }],
    ['local: month 13', { local: '2024-13-01T10:00' }],
    ['local: Feb 30', { local: '2024-02-30T10:00' }],
    ['local: hour 24', { local: '2024-06-14T24:00' }],
    ['local: minute 60', { local: '2024-06-14T10:60' }],
    ['local: before the archive', { local: '1939-12-31T23:00' }],
    ['local: far future', { local: '2999-01-01T00:00' }],
    ['timestamp: unparsable', { timestamp: 'not-a-date' }],
    ['timestamp: before the archive', { timestamp: '1939-12-31T12:00:00Z' }],
    ['timestamp: far future', { timestamp: '2999-01-01T00:00:00Z' }]
  ])('400 invalid-timestamp: %s', async (_label, params) => {
    const fetch = archiveFetch();
    const { response, body } = await callJson(onRequest, urlOf(PATH, { ...TASHKENT, ...params }));
    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'invalid-timestamp' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('historical-weather: target resolution', () => {
  it('local= → timezone=auto, the wall-clock hour and a HistoricalWeatherResult', async () => {
    const fetch = archiveFetch();
    const { response, body } = await callJson<ApiResponse<HistoricalWeatherResult>>(
      onRequest,
      urlOf(PATH, { ...TASHKENT, local: '2024-06-14T18:30:12' })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400, s-maxage=86400');
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ temperature: 38, cloudCover: 18, windSpeed: 19, pressure: 1018, weatherCode: 2, timezone: 'Asia/Tashkent' });
    expect(body.data!.precipitation).toBeCloseTo(1.8, 6);

    const url = new URL(fetchCall(fetch).url);
    expect(url.origin + url.pathname).toBe('https://archive-api.open-meteo.com/v1/archive');
    expect(url.searchParams.get('latitude')).toBe('41.3112');
    expect(url.searchParams.get('longitude')).toBe('69.2797');
    expect(url.searchParams.get('start_date')).toBe('2024-06-14');
    expect(url.searchParams.get('end_date')).toBe('2024-06-14');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('hourly')).toBe('temperature_2m,precipitation,cloudcover,wind_speed_10m,pressure_msl,weather_code');
  });

  it('local= without seconds is accepted', async () => {
    archiveFetch();
    const { response, body } = await callJson<ApiResponse<HistoricalWeatherResult>>(onRequest, urlOf(PATH, { ...TASHKENT, local: '2024-06-14T07:05' }));
    expect(response.status).toBe(200);
    expect(body.data!.temperature).toBe(27);
  });

  it('timestamp= → timezone=UTC and the UTC hour', async () => {
    const fetch = archiveFetch();
    const { body } = await callJson<ApiResponse<HistoricalWeatherResult>>(
      onRequest,
      urlOf(PATH, { ...TASHKENT, timestamp: '2024-06-14T18:30:12+05:00' }) // 13:30 UTC
    );
    expect(body.data).toMatchObject({ temperature: 33, pressure: 1013, timezone: 'GMT' });
    const url = new URL(fetchCall(fetch).url);
    expect(url.searchParams.get('timezone')).toBe('UTC');
    expect(url.searchParams.get('start_date')).toBe('2024-06-14');
  });

  it('timestamp= rolls the date over to the UTC day', async () => {
    const fetch = archiveFetch();
    const { body } = await callJson<ApiResponse<HistoricalWeatherResult>>(
      onRequest,
      urlOf(PATH, { ...TASHKENT, timestamp: '2024-06-14T23:30:00-03:00' }) // 2024-06-15 02:30 UTC
    );
    expect(body.data!.temperature).toBe(22);
    expect(new URL(fetchCall(fetch).url).searchParams.get('start_date')).toBe('2024-06-15');
  });

  it('local= wins over timestamp= when both are present', async () => {
    const fetch = archiveFetch();
    const { body } = await callJson<ApiResponse<HistoricalWeatherResult>>(
      onRequest,
      urlOf(PATH, { ...TASHKENT, local: '2024-06-14T18:30:12', timestamp: '2020-01-01T00:00:00Z' })
    );
    expect(body.data!.temperature).toBe(38);
    const url = new URL(fetchCall(fetch).url);
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('start_date')).toBe('2024-06-14');
  });

  it('the archive start day itself is accepted', async () => {
    archiveFetch();
    const response = await call(onRequest, urlOf(PATH, { ...TASHKENT, local: '1940-01-01T00:00' }));
    expect(response.status).toBe(200);
  });
});

describe('historical-weather: payload handling', () => {
  it('404 no-hourly-data when the requested hour is absent', async () => {
    mockFetch(async () => jsonResponse({ ...openMeteo('2024-06-13', 'GMT'), timezone: 'GMT' }));
    const { response, body } = await callJson(onRequest, urlOf(PATH, { ...TASHKENT, timestamp: '2024-06-14T10:00:00Z' }));
    expect(response.status).toBe(404);
    expect(body).toEqual({ ok: false, error: 'no-hourly-data' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('404 no-hourly-data when hourly is missing entirely', async () => {
    mockFetch(async () => jsonResponse({ latitude: 1, longitude: 2 }));
    const { response, body } = await callJson(onRequest, urlOf(PATH, { ...TASHKENT, timestamp: '2024-06-14T10:00:00Z' }));
    expect(response.status).toBe(404);
    expect(body).toEqual({ ok: false, error: 'no-hourly-data' });
  });

  it('null / non-numeric series values become null, numeric strings are coerced', async () => {
    mockFetch(async () => {
      const payload = openMeteo('2024-06-14', 'GMT');
      const hourly = payload.hourly as Record<string, unknown[]>;
      hourly.temperature_2m[10] = null;
      hourly.precipitation[10] = 'n/a';
      hourly.cloudcover[10] = '55';
      delete (payload.hourly as Partial<typeof payload.hourly>).pressure_msl;
      return jsonResponse({ ...payload, timezone: 42 });
    });
    const { body } = await callJson<ApiResponse<HistoricalWeatherResult>>(onRequest, urlOf(PATH, { ...TASHKENT, timestamp: '2024-06-14T10:00:00Z' }));
    expect(body.data).toEqual({ temperature: null, precipitation: null, cloudCover: 55, windSpeed: 11, pressure: null, weatherCode: 2, timezone: undefined });
  });
});

describe('historical-weather: cache', () => {
  it('X-Cache HIT on the second identical call with one fetch', async () => {
    const fetch = archiveFetch();
    const url = urlOf(PATH, { ...TASHKENT, local: '2024-06-14T18:30:12' });
    const first = await callJson(onRequest, url);
    const second = await callJson(onRequest, url);
    expect(first.response.headers.get('X-Cache')).toBe('MISS');
    expect(second.response.headers.get('X-Cache')).toBe('HIT');
    expect(second.body).toEqual(first.body);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('the cache key is per hour, not per minute', async () => {
    const fetch = archiveFetch();
    await call(onRequest, urlOf(PATH, { ...TASHKENT, local: '2024-06-14T18:05:00' }));
    const second = await call(onRequest, urlOf(PATH, { ...TASHKENT, local: '2024-06-14T18:59:59' }));
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('local and utc modes for the same wall-clock are separate entries', async () => {
    const fetch = archiveFetch();
    await call(onRequest, urlOf(PATH, { ...TASHKENT, local: '2024-06-14T18:00:00' }));
    const second = await call(onRequest, urlOf(PATH, { ...TASHKENT, timestamp: '2024-06-14T18:00:00Z' }));
    expect(second.headers.get('X-Cache')).toBe('MISS');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('historical-weather: upstream failures', () => {
  const url = () => urlOf(PATH, { ...TASHKENT, local: '2024-06-14T18:30:12' });

  it.each([
    [404, 502, 'upstream-404'],
    [500, 502, 'upstream-500'],
    [429, 429, 'upstream-429']
  ])('upstream %d → %d %s without leaking reason', async (upstreamStatus, clientStatus, code) => {
    mockFetch(async () => jsonResponse({ error: true, reason: 'SECRET Open-Meteo reason' }, upstreamStatus));
    const { response, body, text } = await callJson(onRequest, url());
    expect(response.status).toBe(clientStatus);
    expect(body).toEqual({ ok: false, error: code });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(text).not.toContain('SECRET');
  });

  it('timeout → 504 upstream-timeout', async () => {
    mockFetch(rejectAborted);
    const { response, body } = await callJson(onRequest, url());
    expect(response.status).toBe(504);
    expect(body).toEqual({ ok: false, error: 'upstream-timeout' });
  });

  it('non-JSON → 502 upstream-invalid', async () => {
    mockFetch(async () => new Response('SECRET plain text', { status: 200 }));
    const { response, body, text } = await callJson(onRequest, url());
    expect(response.status).toBe(502);
    expect(body).toEqual({ ok: false, error: 'upstream-invalid' });
    expect(text).not.toContain('SECRET');
  });

  it('errors are not cached: the next call fetches again', async () => {
    const fetch = mockFetch(async () => jsonResponse({}, 500));
    await call(onRequest, url());
    await call(onRequest, url());
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
