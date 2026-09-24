import { describe, it, expect } from 'vitest';
import { interpretBody, shouldRetryAutomatically } from '../../hooks/useAPIFetch';
import { isPoiList } from '../../utils/apiShapes';
import type { PoiResult } from '../../types/api';

const POI: PoiResult = { name: 'Чайхана', category: 'cafe', distance: 320 };

describe('interpretBody', () => {
  it('passes the data through when the envelope and the shape are both right', () => {
    const result = interpretBody<PoiResult[]>({ ok: true, data: [POI] }, 200, true, isPoiList);
    expect(result).toEqual({ ok: true, data: [POI], status: 200, retryable: false });
  });

  it('turns a well-formed envelope around the wrong payload into an error, not into data', () => {
    // The shape that threw «items.filter is not a function» inside a component and blanked
    // the whole of section 02.
    const result = interpretBody({ ok: true, data: { items: [POI] } as unknown as PoiResult[] }, 200, true, isPoiList);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid-shape');
    expect(result.data).toBeUndefined();
    // A wrong payload is what the endpoint meant to send: retrying would return it again.
    expect(result.retryable).toBe(false);
  });

  it('keeps the payload untouched when no guard is given', () => {
    const odd = { items: [POI] } as unknown as PoiResult[];
    expect(interpretBody<PoiResult[]>({ ok: true, data: odd }, 200, true)).toMatchObject({ ok: true, data: odd });
  });

  it('reports an HTTP failure with its status and whether a retry may help', () => {
    expect(interpretBody(null, 502, false, isPoiList)).toMatchObject({ ok: false, error: 'status-502', retryable: true });
    expect(interpretBody(null, 400, false, isPoiList)).toMatchObject({ ok: false, error: 'status-400', retryable: false });
    expect(interpretBody({ ok: false, error: 'invalid-coordinates' }, 400, false, isPoiList)).toMatchObject({
      code: 'invalid-coordinates'
    });
  });

  it('reports the endpoint’s own error and a body that is not our envelope', () => {
    expect(interpretBody({ ok: false, error: 'upstream-timeout' }, 200, true, isPoiList)).toMatchObject({
      ok: false,
      error: 'upstream-timeout',
      code: 'upstream-timeout',
      retryable: false
    });
    expect(interpretBody(null, 200, true, isPoiList)).toMatchObject({ ok: false, error: 'invalid-json' });
  });
});

describe('shouldRetryAutomatically', () => {
  it('retries a 5xx, a timeout and a network failure on its own', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(shouldRetryAutomatically(interpretBody(null, status, false))).toBe(true);
    }
    expect(shouldRetryAutomatically({ ok: false, error: 'timeout', status: null, retryable: true })).toBe(true);
    expect(shouldRetryAutomatically({ ok: false, error: 'network-error', status: null, retryable: true })).toBe(true);
  });

  it('leaves a 429 to the reader: retryable for the button, never retried by the hook', () => {
    const limited = interpretBody(null, 429, false);
    expect(limited.retryable).toBe(true);
    expect(shouldRetryAutomatically(limited)).toBe(false);
  });

  it('never retries a success, an abort or a client error', () => {
    expect(shouldRetryAutomatically({ ok: true, data: [], status: 200, retryable: false })).toBe(false);
    expect(shouldRetryAutomatically({ ok: false, error: 'aborted', status: null, retryable: false })).toBe(false);
    expect(shouldRetryAutomatically(interpretBody(null, 400, false))).toBe(false);
    expect(shouldRetryAutomatically(interpretBody(null, 403, false))).toBe(false);
  });
});
