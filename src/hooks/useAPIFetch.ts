import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResponse } from '../types/api';

async function fetchWithRetry<T>(url: string, retries = 2, init?: RequestInit): Promise<ApiResponse<T>> {
  const outerSignal = init?.signal ?? null;
  let attempt = 0;
  let lastError: unknown;
  const jitter = () => Math.random() * 200;

  while (attempt <= retries) {
    if (outerSignal?.aborted) {
      return { ok: false, error: 'aborted' };
    }
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    outerSignal?.addEventListener('abort', onOuterAbort);
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal
      });
      if (!response.ok) {
        lastError = new Error(`status-${response.status}`);
      } else {
        return (await response.json()) as ApiResponse<T>;
      }
    } catch (error) {
      lastError = error;
      if (outerSignal?.aborted) {
        return { ok: false, error: 'aborted' };
      }
    } finally {
      clearTimeout(timeout);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    }
    attempt += 1;
    if (attempt <= retries) {
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt + jitter()));
    }
  }
  return { ok: false, error: lastError instanceof Error ? lastError.message : 'network-error' };
}

export function useAPIFetch<T>() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  // Номер запроса + abort: поздний ответ для старых координат не должен
  // перезаписывать свежие данные и сбрасывать loading чужого запроса.
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const base = import.meta.env.VITE_FUNCTIONS_BASE ?? '';

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      abortRef.current?.abort();
    },
    []
  );

  const request = useCallback(
    async (url: string, init?: RequestInit) => {
      const requestId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      const target = url.startsWith('http://') || url.startsWith('https://') ? url : `${base}${url}`;
      const result = await fetchWithRetry<T>(target, 2, { ...init, signal: controller.signal });
      if (requestId !== requestIdRef.current) {
        return result;
      }
      if (result.ok && result.data) {
        setData(result.data);
      } else {
        setError(result.error ?? 'unknown-error');
        setData(null);
      }
      setLoading(false);
      return result;
    },
    [base]
  );

  return { data, loading, error, request };
}
