import { describe, expect, it, vi } from 'vitest';
import { ALLOWED_EXTERNAL_HOSTS, installNetworkGuard, judgeRequest } from '../networkGuard';

const ORIGIN = 'https://foundyou.morgunov.tech';

describe('judgeRequest', () => {
  it('lets the page talk to itself and to blobs, and to a host on the allow-list', () => {
    expect(judgeRequest('/api/reverse-geocode?lat=1&lon=2', ORIGIN)).toEqual({ allowed: true });
    expect(judgeRequest(`${ORIGIN}/api/tiles/15/22716/12352.png`, ORIGIN)).toEqual({ allowed: true });
    expect(judgeRequest(`${ORIGIN}/mediapipe/wasm/vision_wasm_internal.wasm`, ORIGIN)).toEqual({ allowed: true });
    expect(judgeRequest('blob:https://foundyou.morgunov.tech/1234', ORIGIN)).toEqual({ allowed: true });
    expect(judgeRequest('data:image/png;base64,AAAA', ORIGIN)).toEqual({ allowed: true });
    expect(judgeRequest('https://tile.openstreetmap.org/15/1/2.png', ORIGIN, ['tile.openstreetmap.org'])).toEqual({ allowed: true });
    expect(judgeRequest(new URL('/zxing/zxing_reader.wasm', ORIGIN), ORIGIN)).toEqual({ allowed: true });
    expect(judgeRequest({ url: `${ORIGIN}/ocr/worker.min.js` }, ORIGIN)).toEqual({ allowed: true });
  });

  it('refuses the tile host itself now that tiles come through /api/tiles', () => {
    expect(judgeRequest('https://tile.openstreetmap.org/15/1/2.png', ORIGIN)).toEqual({ allowed: false, host: 'tile.openstreetmap.org' });
  });

  it('refuses everything else, including the vision library’s usage logger', () => {
    /*
     * @mediapipe/tasks-vision creates a logger per task that POSTs protobuf to Google every
     * 60 s with an API key baked into the WASM; measured: three requests a minute after the
     * sample photo was analysed. In production the CSP refuses it; here, this does.
     */
    expect(judgeRequest('https://odml.pa.googleapis.com/v1/log', ORIGIN)).toEqual({ allowed: false, host: 'odml.pa.googleapis.com' });
    expect(judgeRequest('https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/worker.min.js', ORIGIN)).toEqual({ allowed: false, host: 'cdn.jsdelivr.net' });
    expect(judgeRequest('https://foundyou.morgunov.tech.evil.example/x', ORIGIN)).toEqual({ allowed: false, host: 'foundyou.morgunov.tech.evil.example' });
    expect(judgeRequest('//cdn.example.com/a.js', ORIGIN)).toEqual({ allowed: false, host: 'cdn.example.com' });
  });

  it('keeps the allow-list in step with connect-src, which names no third party', () => {
    expect(ALLOWED_EXTERNAL_HOSTS).toEqual([]);
  });
});

describe('installNetworkGuard', () => {
  function fakeGlobal() {
    const fetch = vi.fn(async () => new Response('ok'));
    const open = vi.fn();
    class XMLHttpRequest {}
    (XMLHttpRequest.prototype as { open?: unknown }).open = open;
    const sendBeacon = vi.fn(() => true);
    const target = {
      location: { origin: ORIGIN },
      fetch,
      XMLHttpRequest,
      navigator: { sendBeacon }
    } as unknown as typeof globalThis;
    return { target, fetch, open, sendBeacon };
  }

  it('wraps fetch, XMLHttpRequest.open and sendBeacon', async () => {
    const { target, fetch, open, sendBeacon } = fakeGlobal();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(installNetworkGuard(target)).toEqual({ fetch: true, xhr: true, beacon: true });

    await expect(target.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' })).rejects.toThrow(/network-guard/);
    expect(fetch).not.toHaveBeenCalled();
    await target.fetch('/api/holidays?country=UZ&date=2026-06-14');
    expect(fetch).toHaveBeenCalledTimes(1);

    const xhr = new (target as unknown as { XMLHttpRequest: new () => XMLHttpRequest }).XMLHttpRequest();
    expect(() => xhr.open('POST', 'https://odml.pa.googleapis.com/v1/log')).toThrow(/network-guard/);
    expect(open).not.toHaveBeenCalled();
    xhr.open('GET', '/api/elevation?lat=1&lon=2');
    expect(open).toHaveBeenCalledTimes(1);

    expect(target.navigator.sendBeacon('https://example.com/collect', 'x')).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(target.navigator.sendBeacon('/api/x')).toBe(true);
    warn.mockRestore();
  });

  it('installs nothing without an origin to compare against', () => {
    expect(installNetworkGuard({ location: { origin: 'null' } } as unknown as typeof globalThis)).toEqual({ fetch: false, xhr: false, beacon: false });
  });
});
