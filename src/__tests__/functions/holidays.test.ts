import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/api/holidays';
import type { ApiResponse, HolidaysResult } from '../../../src/types/api';
import { call, callJson, fetchCall, installCaches, jsonResponse, mockFetch, rejectAborted, urlOf } from './_harness';

const PATH = '/api/holidays';

/** Nager.Date v3 shape for DE 2024 (trimmed). */
const NAGER_DE_2024 = [
  { date: '2024-01-01', localName: 'Neujahr', name: "New Year's Day", countryCode: 'DE', fixed: true, global: true, counties: null, launchYear: null, types: ['Public'] },
  { date: '2024-10-03', localName: 'Tag der Deutschen Einheit', name: 'German Unity Day', countryCode: 'DE', fixed: true, global: true, counties: null, launchYear: 1990, types: ['Public'] },
  { date: '2024-11-01', localName: 'Allerheiligen', name: "All Saints' Day", countryCode: 'DE', fixed: true, global: false, counties: ['DE-BW', 'DE-BY'], launchYear: null, types: ['Public'] },
  { date: '2024-11-01', localName: 'Reformationstag (regional)', name: 'Reformation Day', countryCode: 'DE', fixed: true, global: false, counties: ['DE-SN'], launchYear: null, types: ['Public'] }
];

beforeEach(() => {
  installCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('holidays: guards', () => {
  it('405 for POST', async () => {
    const fetch = mockFetch(async () => jsonResponse(NAGER_DE_2024));
    const response = await call(onRequest, urlOf(PATH, { country: 'DE', date: '2024-10-03' }), { method: 'POST' });
    expect(response.status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('403 without same-site evidence, 200 with Sec-Fetch-Site / Origin', async () => {
    mockFetch(async () => jsonResponse(NAGER_DE_2024));
    const url = urlOf(PATH, { country: 'DE', date: '2024-10-03' });
    expect((await call(onRequest, url, { headers: {} })).status).toBe(403);
    expect((await call(onRequest, url, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
    expect((await call(onRequest, url, { headers: { Origin: 'https://foundyou.test' } })).status).toBe(200);
  });

  it.each([
    ['missing country', { date: '2024-10-03' }],
    ['empty country', { country: '', date: '2024-10-03' }],
    ['3-letter country', { country: 'DEU', date: '2024-10-03' }],
    ['digits in country', { country: 'D1', date: '2024-10-03' }],
    ['missing date', { country: 'DE' }],
    ['date not ISO', { country: 'DE', date: '03.10.2024' }],
    ['month 13', { country: 'DE', date: '2024-13-01' }],
    ['Feb 30', { country: 'DE', date: '2024-02-30' }],
    ['year 1899', { country: 'DE', date: '1899-12-31' }],
    ['year 2101', { country: 'DE', date: '2101-01-01' }]
  ])('400 invalid-params: %s', async (_label, params) => {
    const fetch = mockFetch(async () => jsonResponse(NAGER_DE_2024));
    const { response, body } = await callJson(onRequest, urlOf(PATH, params));
    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'invalid-params' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('holidays: Nager 200', () => {
  it('maps the matching entries to HolidaysResult', async () => {
    const fetch = mockFetch(async () => jsonResponse(NAGER_DE_2024));
    const { response, body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'de', date: '2024-10-03' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400, s-maxage=86400');
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(body).toEqual({
      ok: true,
      data: {
        isHoliday: true,
        holidays: [{ date: '2024-10-03', localName: 'Tag der Deutschen Einheit', name: 'German Unity Day', global: true }]
      }
    });
    // Country is upper-cased in the upstream URL.
    expect(fetchCall(fetch).url).toBe('https://date.nager.at/api/v3/PublicHolidays/2024/DE');
  });

  it('returns every entry of the day and keeps global:false', async () => {
    mockFetch(async () => jsonResponse(NAGER_DE_2024));
    const { body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'DE', date: '2024-11-01' }));
    expect(body.data!.isHoliday).toBe(true);
    expect(body.data!.holidays).toHaveLength(2);
    expect(body.data!.holidays.every((h) => h.global === false)).toBe(true);
    expect(body.data!.holidays.map((h) => h.name)).toEqual(["All Saints' Day", 'Reformation Day']);
  });

  it('isHoliday:false with an empty list on an ordinary day', async () => {
    mockFetch(async () => jsonResponse(NAGER_DE_2024));
    const { response, body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'DE', date: '2024-10-04' }));
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { isHoliday: false, holidays: [] } });
  });

  it('fills a missing localName/name from the other field', async () => {
    mockFetch(async () =>
      jsonResponse([
        { date: '2024-05-01', name: 'Labour Day', global: true },
        { date: '2024-05-01', localName: 'Mehnat kuni' }
      ])
    );
    const { body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'XX', date: '2024-05-01' }));
    expect(body.data!.holidays).toEqual([
      { date: '2024-05-01', localName: 'Labour Day', name: 'Labour Day', global: true },
      { date: '2024-05-01', localName: 'Mehnat kuni', name: 'Mehnat kuni', global: false }
    ]);
  });

  it('caches the raw list per country+year: a second date in the same year is a HIT', async () => {
    const fetch = mockFetch(async () => jsonResponse(NAGER_DE_2024));
    const first = await call(onRequest, urlOf(PATH, { country: 'DE', date: '2024-10-03' }));
    const second = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'DE', date: '2024-01-01' }));
    expect(first.headers.get('X-Cache')).toBe('MISS');
    expect(second.response.headers.get('X-Cache')).toBe('HIT');
    expect(second.body.data!.holidays[0].localName).toBe('Neujahr');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a different year or country fetches again', async () => {
    const fetch = mockFetch(async () => jsonResponse(NAGER_DE_2024));
    await call(onRequest, urlOf(PATH, { country: 'DE', date: '2024-10-03' }));
    await call(onRequest, urlOf(PATH, { country: 'DE', date: '2023-10-03' }));
    await call(onRequest, urlOf(PATH, { country: 'AT', date: '2024-10-03' }));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetchCall(fetch, 1).url).toContain('/2023/DE');
    expect(fetchCall(fetch, 2).url).toContain('/2024/AT');
  });
});

describe('holidays: static fallback', () => {
  it('204 for UZ → Mustaqillik kuni on 2026-09-01', async () => {
    const fetch = mockFetch(async () => new Response(null, { status: 204 }));
    const { response, body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'uz', date: '2026-09-01' }));
    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        isHoliday: true,
        holidays: [{ date: '2026-09-01', localName: 'Mustaqillik kuni', name: 'Independence Day', global: true }]
      }
    });
    expect(fetchCall(fetch).url).toBe('https://date.nager.at/api/v3/PublicHolidays/2026/UZ');
  });

  it('404 for UZ → the same static table (Navruz)', async () => {
    mockFetch(async () => jsonResponse({ status: 404, title: 'SECRET Not Found' }, 404));
    const { response, body, text } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'UZ', date: '2026-03-21' }));
    expect(response.status).toBe(200);
    expect(body.data!.isHoliday).toBe(true);
    expect(body.data!.holidays[0]).toMatchObject({ date: '2026-03-21', name: 'Navruz', global: true });
    expect(text).not.toContain('SECRET');
  });

  it('UZ ordinary day → isHoliday:false', async () => {
    mockFetch(async () => new Response(null, { status: 204 }));
    const { body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'UZ', date: '2026-09-02' }));
    expect(body.data).toEqual({ isHoliday: false, holidays: [] });
  });

  it('the static year follows the requested date', async () => {
    mockFetch(async () => new Response(null, { status: 204 }));
    const { body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'UZ', date: '2031-12-08' }));
    expect(body.data!.holidays).toEqual([{ date: '2031-12-08', localName: 'Konstitutsiya kuni', name: 'Constitution Day', global: true }]);
  });

  it('the static list is cached: the second UZ lookup in the year is a HIT', async () => {
    const fetch = mockFetch(async () => new Response(null, { status: 204 }));
    await call(onRequest, urlOf(PATH, { country: 'UZ', date: '2026-09-01' }));
    const second = await call(onRequest, urlOf(PATH, { country: 'UZ', date: '2026-01-01' }));
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([204, 404])('unknown country on %d → isHoliday:false, 200', async (status) => {
    mockFetch(async () => new Response(status === 204 ? null : '{}', { status }));
    const { response, body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'XX', date: '2026-09-01' }));
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { isHoliday: false, holidays: [] } });
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400, s-maxage=86400');
  });
});

describe('holidays: upstream failures', () => {
  const url = () => urlOf(PATH, { country: 'DE', date: '2024-10-03' });

  it.each([
    [500, 502, 'upstream-500'],
    [503, 502, 'upstream-503'],
    [429, 429, 'upstream-429']
  ])('upstream %d → %d %s without leaking the body', async (upstreamStatus, clientStatus, code) => {
    mockFetch(async () => jsonResponse({ error: { message: 'SECRET Nager message' } }, upstreamStatus));
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

  it('non-JSON or non-array payload → 502 upstream-invalid', async () => {
    mockFetch(async () => new Response('<html>SECRET</html>', { status: 200 }));
    const html = await callJson(onRequest, url());
    expect(html.response.status).toBe(502);
    expect(html.body).toEqual({ ok: false, error: 'upstream-invalid' });
    expect(html.text).not.toContain('SECRET');

    vi.unstubAllGlobals();
    installCaches();
    mockFetch(async () => jsonResponse({ message: 'SECRET object instead of list' }));
    const object = await callJson(onRequest, url());
    expect(object.response.status).toBe(502);
    expect(object.body).toEqual({ ok: false, error: 'upstream-invalid' });
    expect(object.text).not.toContain('SECRET');
  });

  it('errors are not cached', async () => {
    const fetch = mockFetch(async () => jsonResponse({}, 500));
    await call(onRequest, url());
    await call(onRequest, url());
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('holidays: the movable holidays of Uzbekistan', () => {
  /*
   * Nager answers 204 for UZ, and the two Eids are not fixed dates. They are set by the Muslim
   * Board of Uzbekistan, so an announced date is listed verbatim and anything else is computed
   * from the tabular calendar and flagged — the card then says the day may differ.
   */
  const noCoverage = () => mockFetch(async () => new Response(null, { status: 204 }));

  it('an announced date is a fact, with no caveat', async () => {
    noCoverage();
    const { body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'UZ', date: '2026-03-20' }));
    expect(body.data!.isHoliday).toBe(true);
    expect(body.data!.holidays[0].localName).toBe('Ramazon hayit');
    expect(body.data!.holidays[0].approximate).toBeUndefined();
  });

  it('the other announced date too', async () => {
    noCoverage();
    const { body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'UZ', date: '2026-05-27' }));
    expect(body.data!.holidays[0].localName).toBe('Qurbon hayit');
    expect(body.data!.holidays[0].approximate).toBeUndefined();
  });

  it('a year with no announcement is computed and says so', async () => {
    // Tabular calendar: 10 Dhu al-Hijjah 1448 lands on 2027-05-17. The flag is what keeps it
    // from being printed as a fact.
    noCoverage();
    const { body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'UZ', date: '2027-05-17' }));
    expect(body.data!.isHoliday).toBe(true);
    expect(body.data!.holidays[0].localName).toBe('Qurbon hayit');
    expect(body.data!.holidays[0].approximate).toBe(true);
  });

  it('the announced date wins over the computed one when they differ', async () => {
    // The table computes 2027-03-10; the Muslim Board announced 2027-03-09.
    noCoverage();
    const announced = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'UZ', date: '2027-03-09' }));
    expect(announced.body.data!.isHoliday).toBe(true);
    const computed = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'UZ', date: '2027-03-10' }));
    expect(computed.body.data!.isHoliday).toBe(false);
  });

  it('an ordinary day is still not a holiday', async () => {
    noCoverage();
    const { body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'UZ', date: '2026-03-25' }));
    expect(body.data!.isHoliday).toBe(false);
  });

  it('no movable holidays are invented for another country', async () => {
    mockFetch(async () => new Response(null, { status: 404 }));
    const { body } = await callJson<ApiResponse<HolidaysResult>>(onRequest, urlOf(PATH, { country: 'KZ', date: '2026-03-20' }));
    expect(body.data!.isHoliday).toBe(false);
  });
});
