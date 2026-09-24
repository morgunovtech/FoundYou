import { afterEach, describe, expect, it, vi } from 'vitest';

/** The guard installed by `src/__tests__/setup.ts`: a test that forgets to stub fetch fails loudly. */
describe('network guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a fetch without a stub throws network-disabled-in-tests with the URL', () => {
    expect(() => fetch('https://nominatim.openstreetmap.org/reverse')).toThrow(
      'network-disabled-in-tests: https://nominatim.openstreetmap.org/reverse'
    );
    expect(() => fetch(new URL('https://api.open-meteo.com/v1/archive'))).toThrow(
      'network-disabled-in-tests: https://api.open-meteo.com/v1/archive'
    );
    expect(() => fetch(new Request('https://overpass-api.de/api/interpreter'))).toThrow(
      'network-disabled-in-tests: https://overpass-api.de/api/interpreter'
    );
  });

  it('a stub works for the test that installs it, and unstubAllGlobals brings the guard back, not the real fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('stubbed'))
    );
    await expect(fetch('https://example.test/stubbed').then((r) => r.text())).resolves.toBe('stubbed');

    vi.unstubAllGlobals();
    expect(() => fetch('https://example.test/after')).toThrow('network-disabled-in-tests: https://example.test/after');
  });
});
