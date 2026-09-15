import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StructuredMetadata } from '../types/metadata';
import type { HistoricalWeatherResult, HolidaysResult, PoiResult, ReverseGeocodeResult } from '../types/api';
import { useAPIFetch } from './useAPIFetch';
import { dedupeByNameAndDistance } from '../utils/insightsCompact';

/** Lifecycle of one server lookup, as exposed by `useAPIFetch`. */
export interface RemoteStatus {
  loading: boolean;
  error: string | null;
  /** True when the failure was transient (429 / 5xx / timeout / network) and a retry may succeed. */
  retryable: boolean;
  retry: () => void;
}

export interface GeoContext {
  /** Exact coordinates from EXIF (for display and the map). */
  coords: { lat: number; lon: number } | null;
  /** What actually leaves the device: coordinates rounded to 4 decimals (~11 m). */
  requestCoords: { lat: number; lon: number } | null;
  accuracyMeters: number | null;
  /** Whether place-context lookups are allowed (persisted preference, default on). */
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  reverse: { data: ReverseGeocodeResult | null; status: RemoteStatus };
  weather: { data: HistoricalWeatherResult | null; status: RemoteStatus };
  holidays: { data: HolidaysResult | null; status: RemoteStatus };
  poi: { items: PoiResult[]; status: RemoteStatus };
  surveillance: { items: PoiResult[]; status: RemoteStatus };
}

const PREFERENCE_KEY = 'geo-context';

function readPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** 4 decimals ≈ 11 m: enough for address / weather / POI lookups, too coarse to pin a doorstep. */
function roundCoord(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function statusOf(fetch: { loading: boolean; error: string | null; retryable: boolean; retry: () => void }): RemoteStatus {
  return { loading: fetch.loading, error: fetch.error, retryable: fetch.retryable, retry: fetch.retry };
}

/**
 * Place context for a photo: address, weather at the capture hour, holidays, nearby places and
 * likely cameras. Requests go to our own Functions with rounded coordinates and the capture
 * time only; the image never leaves the device. Lookups run automatically unless the user
 * switched them off (the preference persists in localStorage).
 */
export function useGeoContext(metadata: StructuredMetadata | null): GeoContext {
  const gps = metadata?.gps;
  const coords = useMemo(() => (gps ? { lat: gps.lat, lon: gps.lon } : null), [gps]);
  const requestCoords = useMemo(
    () => (coords ? { lat: roundCoord(coords.lat), lon: roundCoord(coords.lon) } : null),
    [coords]
  );
  const shotDate = metadata?.shotDate ?? null;
  const shotDateLocal = metadata?.shotDateLocal ?? null;

  const [enabled, setEnabledState] = useState<boolean>(readPreference);
  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try {
      if (value) window.localStorage.removeItem(PREFERENCE_KEY);
      else window.localStorage.setItem(PREFERENCE_KEY, 'off');
    } catch {
      // Storage blocked — the choice still applies for this page view.
    }
  }, []);

  const reverseFetch = useAPIFetch<ReverseGeocodeResult>();
  const weatherFetch = useAPIFetch<HistoricalWeatherResult>();
  const holidaysFetch = useAPIFetch<HolidaysResult>();
  const poiFetch = useAPIFetch<PoiResult[]>();
  const surveillanceFetch = useAPIFetch<PoiResult[]>();

  const { request: reverseRequest, reset: reverseReset } = reverseFetch;
  const { request: weatherRequest, reset: weatherReset } = weatherFetch;
  const { request: holidaysRequest, reset: holidaysReset } = holidaysFetch;
  const { request: poiRequest, reset: poiReset } = poiFetch;
  const { request: surveillanceRequest, reset: surveillanceReset } = surveillanceFetch;

  // The request key: the data that would be sent. A different photo → forget the previous
  // answers and abort whatever is in flight.
  const requestKey = requestCoords ? `${requestCoords.lat},${requestCoords.lon}|${shotDateLocal ?? ''}` : null;
  useEffect(() => {
    reverseReset();
    weatherReset();
    holidaysReset();
    poiReset();
    surveillanceReset();
  }, [requestKey, reverseReset, weatherReset, holidaysReset, poiReset, surveillanceReset]);

  useEffect(() => {
    if (!enabled || !requestCoords) return;
    const params = new URLSearchParams({ lat: String(requestCoords.lat), lon: String(requestCoords.lon) });
    void reverseRequest(`/api/reverse-geocode?${params}`);
    void poiRequest(`/api/nearby-poi?${params}`);
    void surveillanceRequest(`/api/surveillance-candidates?${params}`);
  }, [enabled, requestCoords, reverseRequest, poiRequest, surveillanceRequest]);

  useEffect(() => {
    if (!enabled || !requestCoords || !shotDate) return;
    const params = new URLSearchParams({
      lat: String(requestCoords.lat),
      lon: String(requestCoords.lon),
      timestamp: shotDate
    });
    // The wall-clock lets the server pick the hour in the location's own zone when EXIF had no offset.
    if (shotDateLocal) params.set('local', shotDateLocal);
    void weatherRequest(`/api/historical-weather?${params}`);
  }, [enabled, requestCoords, shotDate, shotDateLocal, weatherRequest]);

  const countryCode = reverseFetch.data?.countryCode?.toUpperCase() ?? null;
  const holidayDate = shotDateLocal ? shotDateLocal.slice(0, 10) : null;
  useEffect(() => {
    if (!enabled || !countryCode || !holidayDate) return;
    const params = new URLSearchParams({ country: countryCode, date: holidayDate });
    void holidaysRequest(`/api/holidays?${params}`);
  }, [enabled, countryCode, holidayDate, holidaysRequest]);

  const reverseData = reverseFetch.data ?? null;
  const accuracyMeters = useMemo(() => {
    const candidates = [gps?.accuracy, reverseData?.precisionMeters].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
    );
    return candidates.length === 0 ? null : Math.min(...candidates);
  }, [gps?.accuracy, reverseData?.precisionMeters]);

  const poiItems = useMemo(() => (poiFetch.data ? dedupeByNameAndDistance(poiFetch.data).slice(0, 8) : []), [poiFetch.data]);
  const surveillanceItems = useMemo(
    () => (surveillanceFetch.data ? dedupeByNameAndDistance(surveillanceFetch.data).slice(0, 8) : []),
    [surveillanceFetch.data]
  );

  return {
    coords,
    requestCoords,
    accuracyMeters,
    enabled,
    setEnabled,
    reverse: { data: reverseData, status: statusOf(reverseFetch) },
    weather: { data: weatherFetch.data ?? null, status: statusOf(weatherFetch) },
    holidays: { data: holidaysFetch.data ?? null, status: statusOf(holidaysFetch) },
    poi: { items: poiItems, status: statusOf(poiFetch) },
    surveillance: { items: surveillanceItems, status: statusOf(surveillanceFetch) }
  };
}
