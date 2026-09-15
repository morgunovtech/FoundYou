// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAPIFetch, type ApiResult } from '../../hooks/useAPIFetch';
import { fetchCall, jsonResponse, mockFetch, waitForAbort } from '../functions/_harness';

interface Hello {
  hello: string;
}

const HELLO = { hello: 'world' };
const INITIAL = { data: null, loading: false, error: null, status: null, retryable: false };

/** Let pending microtasks and one macrotask run (setImmediate is never faked here). */
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });

/** Fake only the timers the hook uses for its backoff/timeout so React's scheduler keeps working. */
function useDeterministicTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(Math, 'random').mockReturnValue(0); // backoff becomes exactly 300 ms, then 600 ms
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useAPIFetch: success path', () => {
  it('starts idle, resolves data and exposes the status', async () => {
    const fetch = mockFetch(async () => jsonResponse({ ok: true, data: HELLO }));
    const { result } = renderHook(() => useAPIFetch<Hello>());
    expect(result.current).toMatchObject(INITIAL);

    let outcome!: ApiResult<Hello>;
    await act(async () => {
      outcome = await result.current.request('/api/hello?x=1');
    });

    expect(outcome).toEqual({ ok: true, data: HELLO, status: 200, retryable: false });
    expect(result.current).toMatchObject({ data: HELLO, loading: false, error: null, status: 200, retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);

    const { url, init } = fetchCall(fetch);
    expect(url).toBe('/api/hello?x=1'); // VITE_FUNCTIONS_BASE is empty in tests
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false); // no preflight on GET
    expect(init?.signal).toBeDefined();
    expect(init?.signal?.aborted).toBe(false);
  });

  it('is loading while the request is in flight', async () => {
    let release!: (response: Response) => void;
    mockFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    const { result } = renderHook(() => useAPIFetch<Hello>());

    let promise!: Promise<ApiResult<Hello>>;
    act(() => {
      promise = result.current.request('/api/hello');
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      release(jsonResponse({ ok: true, data: HELLO }));
      await promise;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual(HELLO);
  });

  it('adds a JSON content type only when a body is sent and upper-cases the method', async () => {
    const fetch = mockFetch(async () => jsonResponse({ ok: true, data: HELLO }));
    const { result } = renderHook(() => useAPIFetch<Hello>());
    await act(async () => {
      await result.current.request('/api/hello', { method: 'post', body: JSON.stringify({ a: 1 }) });
    });
    const { init } = fetchCall(fetch);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });

  it('prefixes relative URLs with VITE_FUNCTIONS_BASE and leaves absolute ones alone', async () => {
    vi.stubEnv('VITE_FUNCTIONS_BASE', 'https://fn.test');
    const fetch = mockFetch(async () => jsonResponse({ ok: true, data: HELLO }));
    const { result } = renderHook(() => useAPIFetch<Hello>());
    await act(async () => {
      await result.current.request('/api/hello');
      await result.current.request('https://other.test/api/hello');
    });
    expect(fetchCall(fetch, 0).url).toBe('https://fn.test/api/hello');
    expect(fetchCall(fetch, 1).url).toBe('https://other.test/api/hello');
  });
});

describe('useAPIFetch: non-retryable failures', () => {
  it('404 → a single fetch, retryable:false, server code exposed', async () => {
    const fetch = mockFetch(async () => jsonResponse({ ok: false, error: 'not-found' }, 404));
    const { result } = renderHook(() => useAPIFetch<Hello>());

    let outcome!: ApiResult<Hello>;
    await act(async () => {
      outcome = await result.current.request('/api/missing');
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: false, error: 'status-404', code: 'not-found', status: 404, retryable: false });
    expect(result.current).toMatchObject({ data: null, loading: false, error: 'status-404', status: 404, retryable: false });
  });

  it('403 forbidden and 400 invalid input are not retried either', async () => {
    const fetch = mockFetch(async () => jsonResponse({ ok: false, error: 'forbidden' }, 403));
    const { result } = renderHook(() => useAPIFetch<Hello>());
    let outcome!: ApiResult<Hello>;
    await act(async () => {
      outcome = await result.current.request('/api/x');
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ ok: false, status: 403, code: 'forbidden', retryable: false });

    fetch.mockImplementation(async () => jsonResponse({ ok: false, error: 'invalid-coordinates' }, 400));
    await act(async () => {
      outcome = await result.current.request('/api/x');
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ ok: false, status: 400, code: 'invalid-coordinates', retryable: false });
  });

  it('200 with ok:false uses the body error as both error and code', async () => {
    mockFetch(async () => jsonResponse({ ok: false, error: 'no-hourly-data' }, 200));
    const { result } = renderHook(() => useAPIFetch<Hello>());
    let outcome!: ApiResult<Hello>;
    await act(async () => {
      outcome = await result.current.request('/api/x');
    });
    expect(outcome).toEqual({ ok: false, error: 'no-hourly-data', code: 'no-hourly-data', status: 200, retryable: false });
    expect(result.current.error).toBe('no-hourly-data');
  });

  it('200 with a non-JSON body → invalid-json, not retryable', async () => {
    const fetch = mockFetch(async () => new Response('<html>', { status: 200 }));
    const { result } = renderHook(() => useAPIFetch<Hello>());
    let outcome!: ApiResult<Hello>;
    await act(async () => {
      outcome = await result.current.request('/api/x');
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: false, error: 'invalid-json', status: 200, retryable: false });
    expect(result.current).toMatchObject({ error: 'invalid-json', retryable: false, status: 200 });
  });

  it('a non-JSON error body still yields the status error without a code', async () => {
    mockFetch(async () => new Response('Forbidden', { status: 403 }));
    const { result } = renderHook(() => useAPIFetch<Hello>());
    let outcome!: ApiResult<Hello>;
    await act(async () => {
      outcome = await result.current.request('/api/x');
    });
    expect(outcome).toEqual({ ok: false, error: 'status-403', code: undefined, status: 403, retryable: false });
  });
});

describe('useAPIFetch: retries', () => {
  it('503 → up to 3 attempts with 300 ms and 600 ms backoff, then retryable:true', async () => {
    useDeterministicTimers();
    const fetch = mockFetch(async () => jsonResponse({ ok: false, error: 'upstream-503' }, 503));
    const { result } = renderHook(() => useAPIFetch<Hello>());

    let promise!: Promise<ApiResult<Hello>>;
    act(() => {
      promise = result.current.request('/api/flaky');
    });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    await advance(299);
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(1);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(true);

    await advance(599);
    expect(fetch).toHaveBeenCalledTimes(2);
    await advance(1);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(3);

    let outcome!: ApiResult<Hello>;
    await act(async () => {
      outcome = await promise;
    });
    expect(outcome).toEqual({ ok: false, error: 'status-503', code: 'upstream-503', status: 503, retryable: true });
    expect(result.current).toMatchObject({ data: null, loading: false, error: 'status-503', status: 503, retryable: true });
    expect(fetch).toHaveBeenCalledTimes(3); // no fourth attempt
  });

  it.each([429, 500, 502, 504])('%d is retried', async (status) => {
    useDeterministicTimers();
    const fetch = mockFetch(async () => jsonResponse({ ok: false, error: `upstream-${status}` }, status));
    const { result } = renderHook(() => useAPIFetch<Hello>());
    let promise!: Promise<ApiResult<Hello>>;
    act(() => {
      promise = result.current.request('/api/flaky');
    });
    await flush();
    await advance(300);
    await flush();
    await advance(600);
    let outcome!: ApiResult<Hello>;
    await act(async () => {
      outcome = await promise;
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(outcome).toMatchObject({ ok: false, status, retryable: true });
  });

  it('recovers when a retry succeeds', async () => {
    useDeterministicTimers();
    const fetch = mockFetch(async () => jsonResponse({ ok: false, error: 'upstream-503' }, 503));
    fetch.mockImplementationOnce(async () => jsonResponse({ ok: false, error: 'upstream-503' }, 503));
    fetch.mockImplementationOnce(async () => jsonResponse({ ok: true, data: HELLO }));
    const { result } = renderHook(() => useAPIFetch<Hello>());

    let promise!: Promise<ApiResult<Hello>>;
    act(() => {
      promise = result.current.request('/api/flaky');
    });
    await flush();
    await advance(300);
    let outcome!: ApiResult<Hello>;
    await act(async () => {
      outcome = await promise;
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ ok: true, data: HELLO, status: 200, retryable: false });
    expect(result.current).toMatchObject({ data: HELLO, error: null, status: 200, loading: false });
  });

  it('a network failure is retried and reported as network-error with status null', async () => {
    useDeterministicTimers();
    const fetch = mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { result } = renderHook(() => useAPIFetch<Hello>());
    let promise!: Promise<ApiResult<Hello>>;
    act(() => {
      promise = result.current.request('/api/offline');
    });
    await flush();
    await advance(300);
    await flush();
    await advance(600);
    let outcome!: ApiResult<Hello>;
    await act(async () => {
      outcome = await promise;
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({ ok: false, error: 'network-error', status: null, retryable: true });
    expect(result.current).toMatchObject({ error: 'network-error', status: null, retryable: true, loading: false });
  });

  it('a hanging request times out after 12 s per attempt and is retried', async () => {
    useDeterministicTimers();
    const fetch = mockFetch(waitForAbort);
    const { result } = renderHook(() => useAPIFetch<Hello>());
    let promise!: Promise<ApiResult<Hello>>;
    act(() => {
      promise = result.current.request('/api/slow');
    });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);

    await advance(12_000); // first attempt times out
    await flush();
    await advance(300);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetchCall(fetch, 0).init?.signal?.aborted).toBe(true);

    await advance(12_000);
    await flush();
    await advance(600);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(3);

    await advance(12_000);
    let outcome!: ApiResult<Hello>;
    await act(async () => {
      outcome = await promise;
    });
    expect(outcome).toEqual({ ok: false, error: 'timeout', status: null, retryable: true });
    expect(result.current).toMatchObject({ error: 'timeout', retryable: true, loading: false });
  });
});

describe('useAPIFetch: abort', () => {
  it('aborts the in-flight request on unmount and does not touch state afterwards', async () => {
    const fetch = mockFetch(waitForAbort);
    const { result, unmount } = renderHook(() => useAPIFetch<Hello>());

    let promise!: Promise<ApiResult<Hello>>;
    act(() => {
      promise = result.current.request('/api/slow');
    });
    expect(result.current.loading).toBe(true);
    unmount();

    const outcome = await promise;
    expect(outcome).toEqual({ ok: false, error: 'aborted', status: null, retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1); // an abort is never retried
    expect(fetchCall(fetch).init?.signal?.aborted).toBe(true);
  });

  it('a new request aborts the previous one and only the latest updates state', async () => {
    const fetch = mockFetch(waitForAbort);
    const { result } = renderHook(() => useAPIFetch<Hello>());

    let first!: Promise<ApiResult<Hello>>;
    act(() => {
      first = result.current.request('/api/first');
    });

    fetch.mockImplementation(async () => jsonResponse({ ok: true, data: HELLO }));
    let second!: ApiResult<Hello>;
    await act(async () => {
      second = await result.current.request('/api/second');
    });

    expect(await first).toMatchObject({ ok: false, error: 'aborted' });
    expect(second).toMatchObject({ ok: true, data: HELLO });
    expect(result.current).toMatchObject({ data: HELLO, loading: false, error: null, status: 200 });
    expect(fetchCall(fetch, 0).init?.signal?.aborted).toBe(true);
    expect(fetchCall(fetch, 1).init?.signal?.aborted).toBe(false);
  });
});

describe('useAPIFetch: retry() and reset()', () => {
  it('retry() re-fires the last request with the same url and init', async () => {
    const fetch = mockFetch(async () => jsonResponse({ ok: false, error: 'upstream-429' }, 429));
    const { result } = renderHook(() => useAPIFetch<Hello>());

    // Make the first call non-retryable so it settles after one fetch.
    fetch.mockImplementationOnce(async () => jsonResponse({ ok: false, error: 'forbidden' }, 403));
    await act(async () => {
      await result.current.request('/api/hello', { headers: { 'X-Test': '1' } });
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('status-403');

    fetch.mockImplementation(async () => jsonResponse({ ok: true, data: HELLO }));
    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetchCall(fetch, 1).url).toBe(fetchCall(fetch, 0).url);
    expect(new Headers(fetchCall(fetch, 1).init?.headers).get('X-Test')).toBe('1');
    expect(result.current).toMatchObject({ data: HELLO, error: null, status: 200, retryable: false });
  });

  it('retry() is a no-op before any request', async () => {
    const fetch = mockFetch(async () => jsonResponse({ ok: true, data: HELLO }));
    const { result } = renderHook(() => useAPIFetch<Hello>());
    act(() => {
      result.current.retry();
    });
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current).toMatchObject(INITIAL);
  });

  it('reset() clears data and errors', async () => {
    mockFetch(async () => jsonResponse({ ok: true, data: HELLO }));
    const { result } = renderHook(() => useAPIFetch<Hello>());
    await act(async () => {
      await result.current.request('/api/hello');
    });
    expect(result.current.data).toEqual(HELLO);

    act(() => {
      result.current.reset();
    });
    expect(result.current).toMatchObject(INITIAL);
  });

  it('reset() aborts an in-flight request and forgets it for retry()', async () => {
    const fetch = mockFetch(waitForAbort);
    const { result } = renderHook(() => useAPIFetch<Hello>());

    let promise!: Promise<ApiResult<Hello>>;
    act(() => {
      promise = result.current.request('/api/slow');
    });
    act(() => {
      result.current.reset();
    });

    expect(await promise).toMatchObject({ ok: false, error: 'aborted' });
    expect(result.current).toMatchObject(INITIAL);

    act(() => {
      result.current.retry();
    });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1); // nothing left to retry
  });

  it('request/retry/reset identities are stable across renders', async () => {
    mockFetch(async () => jsonResponse({ ok: true, data: HELLO }));
    const { result, rerender } = renderHook(() => useAPIFetch<Hello>());
    const before = { request: result.current.request, retry: result.current.retry, reset: result.current.reset };
    await act(async () => {
      await result.current.request('/api/hello');
    });
    rerender();
    expect(result.current.request).toBe(before.request);
    expect(result.current.retry).toBe(before.retry);
    expect(result.current.reset).toBe(before.reset);
  });
});
