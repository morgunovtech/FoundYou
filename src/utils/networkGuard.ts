/*
 * The page's own network policy, enforced in JavaScript.
 *
 * Privacy invariant 1 says nothing about the picture leaves the device, and invariant 3 that
 * no run-time asset comes from a CDN. In production the Content-Security-Policy in
 * `public/_headers` enforces both. It does not apply on the dev server, under `vite preview`
 * or in the smoke run — and one dependency does phone home: `@mediapipe/tasks-vision` creates
 * a usage logger per task that POSTs protobuf to `odml.pa.googleapis.com/v1/log` every 60 s
 * with an API key baked into the WASM (measured: three requests a minute after the sample
 * photo was analysed, one per detector). It has no switch. The c2pa toolkit would likewise
 * fetch a manifest a file points to on some server unless told not to.
 *
 * So the guard below is installed before any of them loads: `fetch`, `XMLHttpRequest.open` and
 * `navigator.sendBeacon` refuse any URL whose origin is not the page's own or one of the hosts
 * named here — the same list as `connect-src`, empty now that the map tiles come through
 * `/api/tiles` — and refuse it the way a CSP block does, with a
 * rejected promise, so the caller's own error handling runs. Relative URLs, `blob:` and `data:`
 * are the page's own by construction. Web workers have their own global and are not covered;
 * every worker this app starts (Tesseract, c2pa, maplibre) is self-hosted and talks to the
 * same origin.
 */

/**
 * Third-party hosts the page may talk to. Keep in step with `connect-src` in public/_headers.
 * Empty since 2026-09-24: the map tiles come through `/api/tiles`, so there is no host left.
 */
export const ALLOWED_EXTERNAL_HOSTS: readonly string[] = [];

export type NetworkGuardVerdict = { allowed: true } | { allowed: false; host: string };

/**
 * Whether a request to `input` may leave the page. `origin` is the page's own origin
 * (`location.origin`); the check is pure so it can be tested without a window.
 */
export function judgeRequest(input: unknown, origin: string, allowedHosts: readonly string[] = ALLOWED_EXTERNAL_HOSTS): NetworkGuardVerdict {
  const raw = input instanceof URL ? input.href : typeof input === 'string' ? input : readRequestUrl(input);
  if (raw === null) return { allowed: true };
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    // Not a URL at all: let the platform produce its own error.
    return { allowed: true };
  }
  if (url.protocol === 'blob:' || url.protocol === 'data:') return { allowed: true };
  if (url.origin === origin) return { allowed: true };
  if (allowedHosts.includes(url.host)) return { allowed: true };
  return { allowed: false, host: url.host };
}

function readRequestUrl(input: unknown): string | null {
  if (input && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string') {
    return (input as { url: string }).url;
  }
  return null;
}

function blocked(host: string): TypeError {
  return new TypeError(`network-guard: a request to ${host} was refused; this page talks only to its own origin and the map tiles`);
}

/** Installs the guard on the given global; called once from `main.tsx`. Returns what it wrapped, for tests. */
export function installNetworkGuard(target: typeof globalThis = globalThis): { fetch: boolean; xhr: boolean; beacon: boolean } {
  const origin = target.location?.origin;
  if (!origin || origin === 'null') return { fetch: false, xhr: false, beacon: false };
  const installed = { fetch: false, xhr: false, beacon: false };

  if (typeof target.fetch === 'function') {
    const original = target.fetch.bind(target);
    target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const verdict = judgeRequest(input, origin);
      if (!verdict.allowed) {
        console.warn('network-guard', verdict.host);
        return Promise.reject(blocked(verdict.host));
      }
      return original(input, init);
    }) as typeof fetch;
    installed.fetch = true;
  }

  const xhr = (target as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
  if (xhr && typeof xhr.prototype?.open === 'function') {
    const originalOpen = xhr.prototype.open;
    xhr.prototype.open = function guardedOpen(this: XMLHttpRequest, ...args: unknown[]) {
      const verdict = judgeRequest(args[1], origin);
      if (!verdict.allowed) {
        console.warn('network-guard', verdict.host);
        throw blocked(verdict.host);
      }
      return (originalOpen as (...a: unknown[]) => void).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;
    installed.xhr = true;
  }

  const nav = target.navigator as Navigator | undefined;
  if (nav && typeof nav.sendBeacon === 'function') {
    const originalBeacon = nav.sendBeacon.bind(nav);
    nav.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      const verdict = judgeRequest(url, origin);
      if (!verdict.allowed) {
        console.warn('network-guard', verdict.host);
        return false;
      }
      return originalBeacon(url, data);
    };
    installed.beacon = true;
  }

  return installed;
}
