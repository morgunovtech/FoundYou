/**
 * Shared test doubles for the Cloudflare Pages Functions in `functions/api/`.
 *
 * - `installCaches()` stubs a `caches.default` backed by a Map (keyed by request URL).
 * - `mockFetch()` stubs `globalThis.fetch` with a `vi.fn` and returns it for call assertions.
 * - `call()` invokes an `onRequest` handler the way Cloudflare does, collecting `waitUntil`
 *   promises and awaiting them so a background cache `put` has landed before the next call.
 *
 * Restore everything with `vi.unstubAllGlobals()` in `afterEach`.
 */
import { vi } from 'vitest';
import type { PagesEventContext } from '../../../functions/api/_types';

export const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin' } as const;
export const BASE = 'https://foundyou.test';

export type Handler = (context: PagesEventContext) => Promise<Response>;

interface StoredResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

export interface FakeCaches {
  default: {
    match: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };
  /** Raw store, for assertions on what was cached. */
  store: Map<string, StoredResponse>;
}

export function makeCaches(): FakeCaches {
  const store = new Map<string, StoredResponse>();
  const match = vi.fn(async (request: Request | string): Promise<Response | undefined> => {
    const url = typeof request === 'string' ? request : request.url;
    const hit = store.get(url);
    if (!hit) return undefined;
    // A fresh Response per lookup: the caller consumes the body.
    return new Response(hit.body, { status: hit.status, headers: hit.headers });
  });
  const put = vi.fn(async (request: Request | string, response: Response): Promise<void> => {
    const url = typeof request === 'string' ? request : request.url;
    store.set(url, {
      status: response.status,
      headers: Array.from(response.headers.entries()),
      body: await response.text()
    });
  });
  return { default: { match, put }, store };
}

export function installCaches(): FakeCaches {
  const caches = makeCaches();
  vi.stubGlobal('caches', caches);
  return caches;
}

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function mockFetch(impl: FetchImpl) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

/** A fetch that only settles when the caller aborts it (used for timeout paths). */
export const waitForAbort: FetchImpl = (_input, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });

/** A fetch that rejects immediately as if the AbortController had already fired. */
export const rejectAborted: FetchImpl = async () => {
  throw new DOMException('The operation was aborted.', 'AbortError');
};

export interface CallOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Default `true`: await every `waitUntil` promise before returning. */
  settle?: boolean;
}

export function urlOf(path: string, params: Record<string, string> = {}): string {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export async function call(handler: Handler, url: string, options: CallOptions = {}): Promise<Response> {
  const promises: Promise<unknown>[] = [];
  const request = new Request(url, { method: options.method ?? 'GET', headers: options.headers ?? SAME_ORIGIN });
  const response = await handler({
    request,
    env: {},
    params: {},
    waitUntil: (promise) => {
      promises.push(promise);
    }
  });
  if (options.settle !== false) await Promise.allSettled(promises);
  return response;
}

/** `call()` + parse: the JSON body and the Response together. */
export async function callJson<T = any>(handler: Handler, url: string, options: CallOptions = {}) {
  const response = await call(handler, url, options);
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = null as unknown as T;
  }
  return { response, body, text };
}

/** First fetch call as `{ url, init }`, whatever shape the caller used. */
export function fetchCall(fn: ReturnType<typeof vi.fn>, index = 0): { url: string; init: RequestInit | undefined } {
  const [input, init] = fn.mock.calls[index] as [RequestInfo | URL, RequestInit | undefined];
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return { url, init };
}
