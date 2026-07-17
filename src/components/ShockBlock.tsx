import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import type { StructuredMetadata, ManualCoordinates } from '../types/metadata';
import type { ReverseGeocodeResult, HistoricalWeatherResult, PoiResult } from '../types/api';
import { useAPIFetch } from '../hooks/useAPIFetch';
import { inferMovement } from '../utils/insights';
import { dedupeByNameAndDistance, localizeCategoryKey } from '../utils/insightsCompact';
import { DataInsightsCompact } from './DataInsightsCompact';

interface ShockBlockProps {
  metadata: StructuredMetadata | null;
  manualCoords: ManualCoordinates | null;
  onManualCoordsChange: (coords: ManualCoordinates | null) => void;
}

export const ShockBlock: React.FC<ShockBlockProps> = ({ metadata, manualCoords, onManualCoordsChange }) => {
  const t = useT();
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const gpsHeading = metadata?.gps?.heading;
  const gpsLat = metadata?.gps?.lat;
  const gpsLon = metadata?.gps?.lon;

  useEffect(() => {
    if (manualCoords) {
      setLatInput(manualCoords.lat.toFixed(5));
      setLonInput(manualCoords.lon.toFixed(5));
    } else if (gpsLat != null && gpsLon != null) {
      setLatInput(gpsLat.toFixed(5));
      setLonInput(gpsLon.toFixed(5));
    } else {
      setLatInput('');
      setLonInput('');
    }
  }, [manualCoords, gpsLat, gpsLon]);

  const coords = useMemo(() => {
    if (manualCoords) return manualCoords;
    if (gpsLat != null && gpsLon != null) {
      return { lat: gpsLat, lon: gpsLon };
    }
    return null;
  }, [manualCoords, gpsLat, gpsLon]);

  // Без даты съёмки историческую погоду не запрашиваем: подстановка «сейчас»
  // выдавала сегодняшнюю погоду за данные снимка. Наивное локальное время
  // (shotDateLocal) позволяет серверу сопоставить час в поясе места съёмки.
  const timestamp = metadata?.shotDateLocal ?? metadata?.shotDate;

  const reverseFetch = useAPIFetch<ReverseGeocodeResult>();
  const weatherFetch = useAPIFetch<HistoricalWeatherResult>();
  const poiFetch = useAPIFetch<PoiResult[]>();
  const surveillanceFetch = useAPIFetch<PoiResult[]>();
  const { request: requestReverse } = reverseFetch;
  const { request: requestWeather } = weatherFetch;
  const { request: requestPoi } = poiFetch;
  const { request: requestSurveillance } = surveillanceFetch;

  useEffect(() => {
    if (!coords) return;
    requestReverse(`/api/reverse-geocode?lat=${coords.lat}&lon=${coords.lon}`);
  }, [coords, requestReverse]);

  useEffect(() => {
    if (!coords || !timestamp) return;
    requestWeather(`/api/historical-weather?lat=${coords.lat}&lon=${coords.lon}&timestamp=${encodeURIComponent(timestamp)}`);
  }, [coords, timestamp, requestWeather]);

  useEffect(() => {
    if (!coords) return;
    requestPoi(`/api/nearby-poi?lat=${coords.lat}&lon=${coords.lon}`);
    requestSurveillance(`/api/surveillance-candidates?lat=${coords.lat}&lon=${coords.lon}`);
  }, [coords, requestPoi, requestSurveillance]);

  const movement = useMemo(() => inferMovement(metadata), [metadata]);
  const weatherSummary = weatherFetch.data ?? null;
  const reverseData = reverseFetch.data ?? null;

  const accuracyMeters = useMemo(() => {
    const candidates = [metadata?.gps?.accuracy, reverseData?.precisionMeters]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    if (candidates.length === 0) {
      return null;
    }
    return Math.min(...candidates);
  }, [metadata?.gps?.accuracy, reverseData?.precisionMeters]);

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
    <section className="panel insights-panel">
      <DataInsightsCompact
        reverseData={reverseData}
        reverseLoading={reverseFetch.loading}
        reverseError={reverseFetch.error != null}
        coords={coords}
        accuracyMeters={accuracyMeters}
        shotDate={metadata?.shotDate}
        movement={movement}
        weather={weatherSummary}
        weatherLoading={weatherFetch.loading}
        weatherError={weatherFetch.error != null}
        poiItems={poiItems}
        poiLoading={poiFetch.loading}
        poiError={poiFetch.error != null}
        surveillanceItems={surveillanceItems}
        surveillanceLoading={surveillanceFetch.loading}
        surveillanceError={surveillanceFetch.error != null}
        gpsHeading={gpsHeading}
      />

      {!metadata?.gps && !manualCoords ? (
        <div className="manual-coords">
          <p>{t('mapMissing')}</p>
          <div className="controls-row">
            <input
              type="number"
              value={latInput}
              placeholder={t('manualLat')}
              onChange={(event) => setLatInput(event.target.value)}
            />
            <input
              type="number"
              value={lonInput}
              placeholder={t('manualLon')}
              onChange={(event) => setLonInput(event.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                const lat = Number(latInput);
                const lon = Number(lonInput);
                if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
                  onManualCoordsChange({ lat, lon });
                }
              }}
            >
              {t('applyManual')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
};
