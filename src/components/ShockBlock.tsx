import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import type { StructuredMetadata } from '../types/metadata';
import type { HistoricalWeatherResult, HolidaysResult, PoiResult, ReverseGeocodeResult } from '../types/api';
import { useAPIFetch } from '../hooks/useAPIFetch';
import { inferMovement } from '../utils/insights';
import { dedupeByNameAndDistance, localizeCategoryKey } from '../utils/insightsCompact';
import { DataInsightsCompact, type RemoteStatus } from './DataInsightsCompact';
import { SectionHead } from './SectionHead';

interface ShockBlockProps {
  metadata: StructuredMetadata | null;
}

/** 4 decimals ≈ 11 m: enough for address / weather / POI lookups, too coarse to pin a doorstep. */
function roundCoord(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function statusOf(fetch: { loading: boolean; error: string | null; retryable: boolean; retry: () => void }): RemoteStatus {
  return { loading: fetch.loading, error: fetch.error, retryable: fetch.retryable, retry: fetch.retry };
}

function ShockBlockComponent({ metadata }: ShockBlockProps) {
  const t = useT();
  const gps = metadata?.gps;

  const coords = useMemo(() => (gps ? { lat: gps.lat, lon: gps.lon } : null), [gps]);
  // What actually leaves the device: rounded coordinates only.
  const requestCoords = useMemo(
    () => (coords ? { lat: roundCoord(coords.lat), lon: roundCoord(coords.lon) } : null),
    [coords]
  );
  const shotDate = metadata?.shotDate ?? null;
  const shotDateLocal = metadata?.shotDateLocal ?? null;

  // One consent per photo. The key is built from the data that would be sent (rounded
  // coordinates + capture time), so a language switch — which re-parses metadata into a new
  // object — keeps the choice, while a different photo asks again.
  const consentKey = requestCoords ? `${requestCoords.lat},${requestCoords.lon}|${shotDateLocal ?? ''}` : null;
  const [consentedKey, setConsentedKey] = useState<string | null>(null);
  const consented = consentKey != null && consentedKey === consentKey;
  const handleConsent = useCallback(() => setConsentedKey(consentKey), [consentKey]);

  const reverseFetch = useAPIFetch<ReverseGeocodeResult>();
  const weatherFetch = useAPIFetch<HistoricalWeatherResult>();
  const holidaysFetch = useAPIFetch<HolidaysResult>();
  const poiFetch = useAPIFetch<PoiResult[]>();
  const surveillanceFetch = useAPIFetch<PoiResult[]>();

  // Stable function references for the effects below.
  const { request: reverseRequest, reset: reverseReset } = reverseFetch;
  const { request: weatherRequest, reset: weatherReset } = weatherFetch;
  const { request: holidaysRequest, reset: holidaysReset } = holidaysFetch;
  const { request: poiRequest, reset: poiReset } = poiFetch;
  const { request: surveillanceRequest, reset: surveillanceReset } = surveillanceFetch;

  // A different photo → drop results that belong to the previous one and abort what is in flight.
  useEffect(() => {
    reverseReset();
    weatherReset();
    holidaysReset();
    poiReset();
    surveillanceReset();
  }, [consentKey, reverseReset, weatherReset, holidaysReset, poiReset, surveillanceReset]);

  useEffect(() => {
    if (!consented || !requestCoords) return;
    const params = new URLSearchParams({ lat: String(requestCoords.lat), lon: String(requestCoords.lon) });
    void reverseRequest(`/api/reverse-geocode?${params}`);
    void poiRequest(`/api/nearby-poi?${params}`);
    void surveillanceRequest(`/api/surveillance-candidates?${params}`);
  }, [consented, requestCoords, reverseRequest, poiRequest, surveillanceRequest]);

  useEffect(() => {
    if (!consented || !requestCoords || !shotDate) return;
    const params = new URLSearchParams({
      lat: String(requestCoords.lat),
      lon: String(requestCoords.lon),
      timestamp: shotDate
    });
    // The wall-clock lets the server pick the hour in the location's own zone when EXIF had no offset.
    if (shotDateLocal) params.set('local', shotDateLocal);
    void weatherRequest(`/api/historical-weather?${params}`);
  }, [consented, requestCoords, shotDate, shotDateLocal, weatherRequest]);

  const countryCode = reverseFetch.data?.countryCode?.toUpperCase() ?? null;
  const holidayDate = shotDateLocal ? shotDateLocal.slice(0, 10) : null;
  useEffect(() => {
    if (!consented || !countryCode || !holidayDate) return;
    const params = new URLSearchParams({ country: countryCode, date: holidayDate });
    void holidaysRequest(`/api/holidays?${params}`);
  }, [consented, countryCode, holidayDate, holidaysRequest]);

  const movement = useMemo(() => inferMovement(metadata), [metadata]);
  const reverseData = reverseFetch.data ?? null;

  const accuracyMeters = useMemo(() => {
    const candidates = [gps?.accuracy, reverseData?.precisionMeters].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
    );
    if (candidates.length === 0) {
      return null;
    }
    return Math.min(...candidates);
  }, [gps?.accuracy, reverseData?.precisionMeters]);

  const poiItems = useMemo(() => {
    if (!poiFetch.data) return [];
    return dedupeByNameAndDistance(poiFetch.data)
      .slice(0, 8)
      .map((poi) => ({
        ...poi,
        name: poi.name?.trim()?.length ? poi.name : localizeCategoryKey(poi.category, t)
      }));
  }, [poiFetch.data, t]);

  const surveillanceItems = useMemo(() => {
    if (!surveillanceFetch.data) return [];
    return dedupeByNameAndDistance(surveillanceFetch.data).slice(0, 8);
  }, [surveillanceFetch.data]);

  return (
    <section className="v4-section" aria-labelledby="sec-insights">
      <SectionHead num="04" title={t('shockBlockTitle')} id="sec-insights" />
      <div className="fy-card">
        <DataInsightsCompact
          consented={consented}
          onConsent={handleConsent}
          coords={coords}
          accuracyMeters={accuracyMeters}
          shotDateLocal={shotDateLocal ?? undefined}
          movement={movement}
          gpsHeading={gps?.heading}
          reverseData={reverseData}
          reverseStatus={statusOf(reverseFetch)}
          weather={weatherFetch.data ?? null}
          weatherStatus={statusOf(weatherFetch)}
          holidays={holidaysFetch.data ?? null}
          holidaysStatus={statusOf(holidaysFetch)}
          poiItems={poiItems}
          poiStatus={statusOf(poiFetch)}
          surveillanceItems={surveillanceItems}
          surveillanceStatus={statusOf(surveillanceFetch)}
        />
      </div>
    </section>
  );
}

export const ShockBlock = React.memo(ShockBlockComponent);
ShockBlock.displayName = 'ShockBlock';
