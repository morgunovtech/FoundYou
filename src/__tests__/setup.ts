/**
 * Vitest setup (see `test.setupFiles` in vite.config.ts): no test may reach the network.
 *
 * `globalThis.fetch` is replaced by a function that throws, so a Function test that forgets
 * to stub the upstream fails on the first call instead of quietly talking to Nominatim or
 * Open-Meteo from a CI runner. Tests that need fetch stub it themselves with
 * `vi.stubGlobal('fetch', …)` (the Functions harness does); `vi.unstubAllGlobals()` then
 * restores the *original* it recorded on the first stub, and because this module assigns the
 * guard directly rather than through `vi.stubGlobal`, that original is the guard, not Node's
 * real fetch — `src/__tests__/networkGuard.test.ts` pins both halves of that.
 */
function describeInput(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const networkDisabled = ((input: RequestInfo | URL): Promise<Response> => {
  throw new Error(`network-disabled-in-tests: ${describeInput(input)}`);
}) as typeof fetch;

globalThis.fetch = networkDisabled;
