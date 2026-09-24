import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResponse } from '../types/api';

/** A retry may succeed: what `retryable` reports, and what the manual «Повторить» button acts on. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
/**
 * What the hook retries on its own, with backoff. 429 is deliberately not here: Nominatim and
 * Overpass answer it when a client is already asking too often, and asking again 300 ms later
 * and again 600 ms after that is exactly what those public servers ban an address for. The
 * reader can still press the button; the hook will not press it for them.
 */
const AUTO_RETRY_STATUS = new Set([500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;

/**
 * Rejects an `ok: true` answer whose `data` is not the shape the caller reads. Without it the
 * body is handed on with `T` merely asserted, and one malformed answer throws inside a component
 * and blanks its whole section (see `utils/apiShapes.ts`).
 */
export type ShapeGuard = (data: unknown) => boolean;

export interface ApiResult<T> extends ApiResponse<T> {
  /** HTTP status of the last response; null for network failures, timeouts and aborts. */
  status: number | null;
  /** Machine-readable error code from the server body (`{ok:false, error:'forbidden'}`), when any. */
  code?: string;
  /** True when a retry might succeed: 429 / 5xx, timeout or network failure. */
  retryable: boolean;
}

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  status: number | null;
  retryable: boolean;
}

const INITIAL_STATE: FetchState<never> = { data: null, loading: false, error: null, status: null, retryable: false };

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

/**
 * What one answer means, with no network or React around it: an HTTP failure, a body that is not
 * our envelope, an `ok: false` from the endpoint, a payload that is not the shape the caller
 * reads, or the data. The shape check is the one that stops a malformed answer from reaching a
 * component and blanking its section.
 */
export function interpretBody<T>(
  body: ApiResponse<T> | null,
  status: number,
  httpOk: boolean,
  accepts?: ShapeGuard
): ApiResult<T> {
  if (!httpOk) {
    return {
      ok: false,
      error: `status-${status}`,
      code: typeof body?.error === 'string' ? body.error : undefined,
      status,
      retryable: RETRYABLE_STATUS.has(status)
    };
  }
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'invalid-json', status, retryable: false };
  }
  if (!body.ok) {
    return { ok: false, error: body.error ?? 'unknown-error', code: body.error, status, retryable: false };
  }
  if (accepts && !accepts(body.data)) {
    // A well-formed envelope around the wrong payload: not worth a retry, and never worth
    // passing on — the page would read fields that are not there.
    return { ok: false, error: 'invalid-shape', status, retryable: false };
  }
  return { ok: true, data: body.data, status, retryable: false };
}

async function fetchOnce<T>(
  url: string,
  init: RequestInit | undefined,
  signal: AbortSignal | undefined,
  accepts: ShapeGuard | undefined
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort);
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers ?? {});
    // Only a body needs a content type; on GET it would just force a CORS preflight.
    if (init?.body != null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, { ...init, method, headers, signal: controller.signal });
    const status = response.status;

    let body: ApiResponse<T> | null = null;
    try {
      body = (await response.json()) as ApiResponse<T>;
    } catch {
      body = null;
    }

    return interpretBody<T>(body, status, response.ok, accepts);
  } catch (error) {
    if (signal?.aborted) {
      return { ok: false, error: 'aborted', status: null, retryable: false };
    }
    // Our own timeout controller fired, or the network failed — both are worth another try.
    return { ok: false, error: isAbortError(error) ? 'timeout' : 'network-error', status: null, retryable: true };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A 5xx, a timeout or a network failure (status null) — never a 429, which is the upstream asking for less. */
export function shouldRetryAutomatically(result: ApiResult<unknown>): boolean {
  if (result.ok || !result.retryable) return false;
  return result.status === null || AUTO_RETRY_STATUS.has(result.status);
}

async function fetchWithRetry<T>(
  url: string,
  init: RequestInit | undefined,
  signal: AbortSignal | undefined,
  accepts: ShapeGuard | undefined,
  retries = MAX_RETRIES
): Promise<ApiResult<T>> {
  let result: ApiResult<T> = { ok: false, error: 'network-error', status: null, retryable: true };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    result = await fetchOnce<T>(url, init, signal, accepts);
    if (!shouldRetryAutomatically(result) || signal?.aborted) {
      return result;
    }
    if (attempt < retries) {
      await sleep(300 * (attempt + 1) + Math.random() * 200);
    }
  }
  return result;
}

/**
 * `accepts` must be a stable reference — a module-level predicate from `utils/apiShapes.ts`, not
 * an inline lambda: it is a dependency of `request`, and the callers keep `request` in their own
 * effect dependencies, so a new identity on every render would re-fire the request.
 */
export function useAPIFetch<T>(accepts?: ShapeGuard) {
  const [state, setState] = useState<FetchState<T>>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const lastRef = useRef<{ url: string; init?: RequestInit } | null>(null);

  const base: string = import.meta.env.VITE_FUNCTIONS_BASE ?? '';

  // Whatever is still in flight when the component goes away must not resolve into setState.
  useEffect(() => () => abortRef.current?.abort(), []);

  const request = useCallback(
    async (url: string, init?: RequestInit): Promise<ApiResult<T>> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastRef.current = { url, init };

      setState((prev) => ({ ...prev, loading: true, error: null, status: null, retryable: false }));
      const target = url.startsWith('http://') || url.startsWith('https://') ? url : `${base}${url}`;
      const result = await fetchWithRetry<T>(target, init, controller.signal, accepts);

      if (controller.signal.aborted) return result;

      if (result.ok && result.data != null) {
        setState({ data: result.data, loading: false, error: null, status: result.status, retryable: false });
      } else {
        setState({
          data: null,
          loading: false,
          error: result.error ?? 'unknown-error',
          status: result.status,
          retryable: result.retryable
        });
      }
      return result;
    },
    [base, accepts]
  );

  /** Re-fire the last request (for the "retry" button after 429 / 5xx / timeout). */
  const retry = useCallback(() => {
    const last = lastRef.current;
    if (last) void request(last.url, last.init);
  }, [request]);

  /** Abort anything in flight and forget data/errors (call when the subject — the photo — changes). */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    lastRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { ...state, request, retry, reset };
}
