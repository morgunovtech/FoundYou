import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest, parseTilePath } from '../../../functions/api/tiles/[[path]]';
import { call, fetchCall, installCaches, mockFetch, urlOf, type FakeCaches } from './_harness';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

function pngResponse(status = 200): Response {
  return new Response(PNG.slice(), { status, headers: { 'Content-Type': 'image/png' } });
}

const tile = (path: string) => call(onRequest, urlOf(`/api/tiles/${path}`), { params: { path: path.split('/') } });

describe('parseTilePath', () => {
  it('accepts z/x/y.png inside the grid and nothing else', () => {
    expect(parseTilePath(['15', '22716', '12352.png'])).toEqual({ z: 15, x: 22716, y: 12352 });
    expect(parseTilePath('0/0/0.png')).toEqual({ z: 0, x: 0, y: 0 });
    expect(parseTilePath(['20', '1', '1.png'])).toBeNull(); // past the standard layer's zoom
    expect(parseTilePath(['15', '32768', '1.png'])).toBeNull(); // 2^15 columns, so 32767 is the last
    expect(parseTilePath(['15', '1', '1.jpg'])).toBeNull();
    expect(parseTilePath(['15', '1'])).toBeNull();
    expect(parseTilePath(['15', '1', '1.png', 'x'])).toBeNull();
    expect(parseTilePath(['../15', '1', '1.png'])).toBeNull();
    expect(parseTilePath(undefined)).toBeNull();
  });
});

describe('GET /api/tiles/{z}/{x}/{y}.png', () => {
  let caches: FakeCaches;
  beforeEach(() => {
    caches = installCaches();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('relays the tile from OSM with this project’s User-Agent and tells the browser not to keep it', async () => {
    const fetch = mockFetch(async () => pngResponse());
    const response = await tile('15/22716/12352.png');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(new Uint8Array(await response.arrayBuffer()).slice(0, 8)).toEqual(PNG.slice(0, 8));
    const { url, init } = fetchCall(fetch);
    expect(url).toBe('https://tile.openstreetmap.org/15/22716/12352.png');
    expect(new Headers(init?.headers).get('User-Agent')).toMatch(/FoundYou/);
    // The edge keeps a public copy for a week; the reader's IP never reached OSM.
    expect(caches.default.put).toHaveBeenCalledTimes(1);
    const stored = Array.from(caches.store.values())[0];
    expect(new Headers(stored.headers).get('Cache-Control')).toMatch(/public, max-age=604800/);
  });

  it('answers a second request for the same tile from the edge cache', async () => {
    const fetch = mockFetch(async () => pngResponse());
    await tile('15/22716/12352.png');
    const hit = await tile('15/22716/12352.png');
    expect(hit.headers.get('X-Cache')).toBe('HIT');
    expect(hit.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a path outside the grid without asking OSM', async () => {
    const fetch = mockFetch(async () => pngResponse());
    for (const bad of ['20/1/1.png', '15/32768/1.png', '15/1/1.jpg', '15/1', 'a/b/c.png']) {
      const response = await tile(bad);
      expect(response.status, bad).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: 'invalid-tile' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes a missing tile on as 404 and a wrong body as 502, neither cached', async () => {
    mockFetch(async () => new Response('gone', { status: 404 }));
    const missing = await tile('15/1/1.png');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: 'tile-not-found' });
    mockFetch(async () => new Response('<html>not a tile</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const wrong = await tile('15/2/2.png');
    expect(wrong.status).toBe(502);
    expect(await wrong.json()).toEqual({ ok: false, error: 'upstream-invalid' });
    expect(caches.default.put).not.toHaveBeenCalled();
  });

  it('answers HEAD with the headers only and refuses other origins', async () => {
    mockFetch(async () => pngResponse());
    const head = await call(onRequest, urlOf('/api/tiles/15/1/1.png'), { method: 'HEAD', params: { path: ['15', '1', '1.png'] } });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Type')).toBe('image/png');
    expect(await head.text()).toBe('');
    const foreign = await call(onRequest, urlOf('/api/tiles/15/1/1.png'), { headers: { 'Sec-Fetch-Site': 'cross-site' }, params: { path: ['15', '1', '1.png'] } });
    expect(foreign.status).toBe(403);
  });
});
