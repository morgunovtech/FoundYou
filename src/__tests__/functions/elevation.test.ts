import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/api/elevation';
import type { ApiResponse, ElevationResult } from '../../../src/types/api';
import { call, callJson, fetchCall, installCaches, jsonResponse, mockFetch, urlOf } from './_harness';

const PATH = '/api/elevation';
const POINT = { lat: '41.36123', lon: '69.92395' };

beforeEach(() => {
  installCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('elevation: guards', () => {
  it('405 for POST, 403 without same-site evidence, 400 for bad coordinates', async () => {
    const fetch = mockFetch(async () => jsonResponse({ elevation: [1270] }));
    expect((await call(onRequest, urlOf(PATH, POINT), { method: 'POST' })).status).toBe(405);
    expect((await call(onRequest, urlOf(PATH, POINT), { headers: {} })).status).toBe(403);
    const bad = await callJson(onRequest, urlOf(PATH, { lat: '95', lon: '69' }));
    expect(bad.response.status).toBe(400);
    expect(bad.body).toEqual({ ok: false, error: 'invalid-coordinates' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('elevation: success and failure', () => {
  it('asks Open-Meteo for the rounded point and returns the first value with the DEM resolution', async () => {
    const fetch = mockFetch(async () => jsonResponse({ elevation: [1270.5] }));
    const { response, body } = await callJson<ApiResponse<ElevationResult>>(onRequest, urlOf(PATH, POINT));
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { elevation: 1270.5, resolutionMeters: 90 } });
    expect(response.headers.get('Cache-Control')).toBe(`public, max-age=${30 * 86_400}, s-maxage=${30 * 86_400}`);
    const { url } = fetchCall(fetch);
    expect(url).toBe('https://api.open-meteo.com/v1/elevation?latitude=41.3612&longitude=69.9240');
  });

  it('502 upstream-invalid when the answer has no elevation array or a non-numeric value', async () => {
    mockFetch(async () => jsonResponse({ elevation: ['n/a'] }));
    const first = await callJson(onRequest, urlOf(PATH, POINT));
    expect(first.response.status).toBe(502);
    expect(first.body).toEqual({ ok: false, error: 'upstream-invalid' });
    mockFetch(async () => jsonResponse({ error: true, reason: 'nope' }));
    expect((await call(onRequest, urlOf(PATH, { lat: '10', lon: '10' }))).status).toBe(502);
    // Open-Meteo answers `[null]` off the DEM; `Number(null)` is 0 and must not become sea level for a month.
    mockFetch(async () => jsonResponse({ elevation: [null] }));
    const nulled = await callJson(onRequest, urlOf(PATH, { lat: '20', lon: '20' }));
    expect(nulled.response.status).toBe(502);
    expect(nulled.body).toEqual({ ok: false, error: 'upstream-invalid' });
    expect(nulled.response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('X-Cache HIT on the second identical call with a single upstream fetch', async () => {
    const fetch = mockFetch(async () => jsonResponse({ elevation: [12] }));
    const first = await call(onRequest, urlOf(PATH, POINT));
    const second = await call(onRequest, urlOf(PATH, POINT));
    expect(first.headers.get('X-Cache')).toBe('MISS');
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
