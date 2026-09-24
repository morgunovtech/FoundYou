import { describe, expect, it } from 'vitest';
import { makeCaches } from './_harness';

/*
 * The fake `caches.default` has to refuse what Cloudflare's refuses, or a regression that stored
 * the browser copy — `no-store` since `withCache` started stripping the public header — would
 * look cached here and be nothing of the kind in production.
 */
describe('the fake caches.default', () => {
  const key = 'https://cache.foundyou.internal/t/1';
  const answer = (control: string, status = 200, extra: Record<string, string> = {}) =>
    new Response('{"ok":true}', { status, headers: { 'Cache-Control': control, ...extra } });

  it('stores a public GET answer and serves a fresh copy of it', async () => {
    const caches = makeCaches();
    await caches.default.put(new Request(key), answer('public, max-age=60'));
    expect(caches.store.has(key)).toBe(true);
    const hit = await caches.default.match(new Request(key));
    expect(await hit!.json()).toEqual({ ok: true });
  });

  it.each(['no-store', 'private', 'no-cache', 'public, max-age=0', 'public, s-maxage=0'])('silently does not store %s', async (control) => {
    const caches = makeCaches();
    await caches.default.put(new Request(key), answer(control));
    expect(caches.store.size).toBe(0);
    expect(await caches.default.match(new Request(key))).toBeUndefined();
  });

  it('throws for a non-GET key, a 206 and Vary: *', async () => {
    const caches = makeCaches();
    await expect(caches.default.put(new Request(key, { method: 'POST' }), answer('public, max-age=60'))).rejects.toThrow(TypeError);
    await expect(caches.default.put(new Request(key), answer('public, max-age=60', 206))).rejects.toThrow(TypeError);
    await expect(caches.default.put(new Request(key), answer('public, max-age=60', 200, { Vary: '*' }))).rejects.toThrow(TypeError);
    expect(caches.store.size).toBe(0);
  });
});
