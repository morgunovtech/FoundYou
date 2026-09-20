import { useEffect, useMemo } from 'react';
import type { StructuredMetadata } from '../types/metadata';
import type { ElevationResult, HistoricalWeatherResult, HolidaysResult, LandmarkResult, PlaceContextResult, PoiResult, ReverseGeocodeResult } from '../types/api';
import { useAPIFetch } from './useAPIFetch';
import { dedupeByNameAndDistance } from '../utils/insightsCompact';
import { isElevation, isHistoricalWeather, isHolidays, isLandmarkList, isPlaceContext, isPoiList, isReverseGeocode } from '../utils/apiShapes';

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
  reverse: { data: ReverseGeocodeResult | null; status: RemoteStatus };
  weather: { data: HistoricalWeatherResult | null; status: RemoteStatus };
  holidays: { data: HolidaysResult | null; status: RemoteStatus };
  /** What kind of place this is: land use, sensitive neighbours, transport, how many people live here. */
  placeContext: { data: PlaceContextResult | null; status: RemoteStatus };
  /** Wikipedia articles about places at the point: a landmark leaks far less than a home address. */
  landmarks: { items: LandmarkResult[]; status: RemoteStatus };
  poi: { items: PoiResult[]; status: RemoteStatus };
  surveillance: { items: PoiResult[]; status: RemoteStatus };
  /** Terrain height at the rounded point, to compare with the GPS altitude. */
  elevation: { data: ElevationResult | null; status: RemoteStatus };
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
 * time only; the image never leaves the device. Lookups run automatically; the note under
 * the card says what was sent.
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

  // Each lookup states the shape it reads: an answer that does not match is an error, not data
  // the components have to survive (`utils/apiShapes.ts`).
  const reverseFetch = useAPIFetch<ReverseGeocodeResult>(isReverseGeocode);
  const weatherFetch = useAPIFetch<HistoricalWeatherResult>(isHistoricalWeather);
  const holidaysFetch = useAPIFetch<HolidaysResult>(isHolidays);
  const poiFetch = useAPIFetch<PoiResult[]>(isPoiList);
  const surveillanceFetch = useAPIFetch<PoiResult[]>(isPoiList);
  const placeContextFetch = useAPIFetch<PlaceContextResult>(isPlaceContext);
  const landmarksFetch = useAPIFetch<LandmarkResult[]>(isLandmarkList);
  const elevationFetch = useAPIFetch<ElevationResult>(isElevation);

  const { request: reverseRequest, reset: reverseReset } = reverseFetch;
  const { request: weatherRequest, reset: weatherReset } = weatherFetch;
  const { request: holidaysRequest, reset: holidaysReset } = holidaysFetch;
  const { request: poiRequest, reset: poiReset } = poiFetch;
  const { request: surveillanceRequest, reset: surveillanceReset } = surveillanceFetch;
  const { request: placeContextRequest, reset: placeContextReset } = placeContextFetch;
  const { request: landmarksRequest, reset: landmarksReset } = landmarksFetch;
  const { request: elevationRequest, reset: elevationReset } = elevationFetch;

  // The request key: the data that would be sent. A different photo → forget the previous
  // answers and abort whatever is in flight.
  const requestKey = requestCoords ? `${requestCoords.lat},${requestCoords.lon}|${shotDateLocal ?? ''}` : null;
  useEffect(() => {
    reverseReset();
    weatherReset();
    holidaysReset();
    poiReset();
    surveillanceReset();
    placeContextReset();
    landmarksReset();
    elevationReset();
  }, [
    requestKey,
    reverseReset,
    weatherReset,
    holidaysReset,
    poiReset,
    surveillanceReset,
    placeContextReset,
    landmarksReset,
    elevationReset
  ]);

  useEffect(() => {
    if (!requestCoords) return;
    const params = new URLSearchParams({ lat: String(requestCoords.lat), lon: String(requestCoords.lon) });
    void reverseRequest(`/api/reverse-geocode?${params}`);
    void poiRequest(`/api/nearby-poi?${params}`);
    void surveillanceRequest(`/api/surveillance-candidates?${params}`);
    void placeContextRequest(`/api/place-context?${params}`);
    void elevationRequest(`/api/elevation?${params}`);
  }, [requestCoords, reverseRequest, poiRequest, surveillanceRequest, placeContextRequest, elevationRequest]);

  useEffect(() => {
    if (!requestCoords || !shotDate) return;
    const params = new URLSearchParams({
      lat: String(requestCoords.lat),
      lon: String(requestCoords.lon),
      timestamp: shotDate
    });
    // The wall-clock lets the server pick the hour in the location's own zone when EXIF had no offset.
    if (shotDateLocal) params.set('local', shotDateLocal);
    void weatherRequest(`/api/historical-weather?${params}`);
  }, [requestCoords, shotDate, shotDateLocal, weatherRequest]);

  const countryCode = reverseFetch.data?.countryCode?.toUpperCase() ?? null;
  const holidayDate = shotDateLocal ? shotDateLocal.slice(0, 10) : null;
  useEffect(() => {
    if (!countryCode || !holidayDate) return;
    const params = new URLSearchParams({ country: countryCode, date: holidayDate });
    void holidaysRequest(`/api/holidays?${params}`);
  }, [countryCode, holidayDate, holidaysRequest]);

  // Landmarks wait for the country, because the Wikipedia edition follows it: half the
  // monuments and mahallas of Tashkent have no article in the English one.
  useEffect(() => {
    if (!requestCoords) return;
    const params = new URLSearchParams({ lat: String(requestCoords.lat), lon: String(requestCoords.lon) });
    if (countryCode) params.set('country', countryCode);
    void landmarksRequest(`/api/landmarks?${params}`);
  }, [requestCoords, countryCode, landmarksRequest]);

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
    reverse: { data: reverseData, status: statusOf(reverseFetch) },
    weather: { data: weatherFetch.data ?? null, status: statusOf(weatherFetch) },
    holidays: { data: holidaysFetch.data ?? null, status: statusOf(holidaysFetch) },
    poi: { items: poiItems, status: statusOf(poiFetch) },
    surveillance: { items: surveillanceItems, status: statusOf(surveillanceFetch) },
    placeContext: { data: placeContextFetch.data ?? null, status: statusOf(placeContextFetch) },
    landmarks: { items: landmarksFetch.data ?? [], status: statusOf(landmarksFetch) },
    elevation: { data: elevationFetch.data ?? null, status: statusOf(elevationFetch) }
  };
}
