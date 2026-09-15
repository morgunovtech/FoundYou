import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { HistoricalWeatherResult, HolidaysResult, PoiResult, ReverseGeocodeResult } from '../types/api';
import type { MovementInsight } from '../utils/insights';
import { useI18n, useT } from '../i18n';
import { MapBlock } from './MapBlock';
import {
  formatCoords,
  formatDateTime,
  formatDistance,
  formatWeatherLine,
  localizeCategoryKey,
  localizePlaceParts
} from '../utils/insightsCompact';
import { googleMapsLink, streetViewLink } from '../utils/mapLinks';

/** Lifecycle of one server lookup, as exposed by `useAPIFetch`. */
export interface RemoteStatus {
  loading: boolean;
  error: string | null;
  /** True when the failure was transient (429 / 5xx / timeout / network) and a retry may succeed. */
  retryable: boolean;
  retry: () => void;
}

interface DataInsightsCompactProps {
  /** The user agreed to send rounded coordinates + capture time for this photo. */
  consented: boolean;
  onConsent: () => void;
  coords: { lat: number; lon: number } | null;
  accuracyMeters: number | null;
  /** Wall-clock as the camera wrote it (`YYYY-MM-DDTHH:mm:ss`). */
  shotDateLocal: string | undefined;
  movement: MovementInsight | null;
  gpsHeading?: number;
  reverseData: ReverseGeocodeResult | null;
  reverseStatus: RemoteStatus;
  weather: HistoricalWeatherResult | null;
  weatherStatus: RemoteStatus;
  holidays: HolidaysResult | null;
  holidaysStatus: RemoteStatus;
  poiItems: PoiResult[];
  poiStatus: RemoteStatus;
  surveillanceItems: PoiResult[];
  surveillanceStatus: RemoteStatus;
}

export const DataInsightsCompact: React.FC<DataInsightsCompactProps> = ({
  consented,
  onConsent,
  coords,
  accuracyMeters,
  shotDateLocal,
  movement,
  gpsHeading,
  reverseData,
  reverseStatus,
  weather,
  weatherStatus,
  holidays,
  holidaysStatus,
  poiItems,
  poiStatus,
  surveillanceItems,
  surveillanceStatus
}) => {
  const t = useT();
  const { lang } = useI18n();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Network-backed rows exist only once there are coordinates to send and the user said yes.
  const remote = Boolean(coords) && consented;
  const showOptIn = Boolean(coords) && !consented;

  const placeInfo = useMemo(() => localizePlaceParts(reverseData, lang), [reverseData, lang]);
  const dateLabel = useMemo(() => formatDateTime(shotDateLocal, lang), [shotDateLocal, lang]);
  const coordsLabel = coords ? formatCoords(coords.lat, coords.lon) : null;
  const accuracyLabel = accuracyMeters != null ? formatDistance(accuracyMeters, lang) : null;
  const weatherLine = useMemo(() => formatWeatherLine(weather, lang), [weather, lang]);

  const holidayNames = useMemo(() => {
    if (!holidays?.isHoliday) return null;
    const names = Array.from(new Set(holidays.holidays.map((entry) => entry.localName || entry.name).filter(Boolean)));
    return names.length > 0 ? names.join(', ') : null;
  }, [holidays]);

  const movementLabel = useMemo(() => {
    if (!movement) return t('insightCompactMovementUnknown');
    if (movement.moving && movement.speedKmh) {
      return t('insightCompactMovementMoving', { speed: Math.round(movement.speedKmh) });
    }
    return t('insightCompactMovementStill');
  }, [movement, t]);

  const handleCopy = async () => {
    if (!coords) return;
    const value = formatCoords(coords.lat, coords.lon);
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } finally {
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    }
  };

  const retryButton = (status: RemoteStatus) =>
    status.error && status.retryable ? (
      <button type="button" className="v4-btn fy-btn-sm" onClick={status.retry}>
        {t('retry')}
      </button>
    ) : null;

  const locationLine = !remote
    ? t('insightCompactLocationUnknown')
    : reverseStatus.loading
    ? t('insightCompactLoading')
    : reverseStatus.error
    ? t('insightCompactLocationUnavailable')
    : placeInfo.place || t('insightCompactLocationUnknown');

  const weatherLineOrState = !remote
    ? t('insightCompactWeatherUnavailable')
    : weatherStatus.loading
    ? t('insightCompactLoading')
    : weatherStatus.error
    ? t('insightCompactWeatherUnavailable')
    : weatherLine ?? t('insightCompactWeatherUnavailable');

  const renderRows = (items: PoiResult[], labelOf: (poi: PoiResult) => string) => (
    <ul className="fy-rows">
      {items.map((poi, index) => (
        <li key={`${poi.name}-${index}`}>
          <span>{labelOf(poi)}</span>
          <span className="fy-mono">{t('insightPoiDistance', { distance: Math.round(poi.distance) })}</span>
        </li>
      ))}
    </ul>
  );

  const renderList = (
    status: RemoteStatus,
    items: PoiResult[],
    errorKey: 'insightPoiError' | 'insightSurveillanceError',
    emptyKey: 'insightPoiEmpty' | 'insightSurveillanceEmpty',
    labelOf: (poi: PoiResult) => string
  ) => {
    if (status.loading) return <p className="fy-hint">{t('insightCompactLoading')}</p>;
    if (status.error) {
      return (
        <p className="fy-hint">
          {t(errorKey)} {retryButton(status)}
        </p>
      );
    }
    if (items.length === 0) return <p className="fy-hint">{t(emptyKey)}</p>;
    return renderRows(items, labelOf);
  };

  return (
    <>
      <p className="fy-hint">{t('insightDisclaimer')}</p>
      <div className={clsx('fy-insights', { 'fy-insights--single': !coords })}>
        <dl className="fy-spec fy-spec--tight">
          {!showOptIn ? (
            <>
              <dt>{t('insightCompactLocation')}</dt>
              <dd>
                <span>{locationLine}</span>
                {remote && accuracyLabel ? <span className="fy-muted">{accuracyLabel}</span> : null}
                {remote ? retryButton(reverseStatus) : null}
              </dd>
            </>
          ) : null}
          <dt>{t('insightCompactCoordinates')}</dt>
          <dd>
            <span className="fy-mono">{coordsLabel ?? t('emptyValue')}</span>
            {coords ? (
              <button
                type="button"
                className="v4-btn fy-btn-sm"
                onClick={handleCopy}
                aria-label={t('insightCompactCopyCoordinates')}
                title={t('insightCompactCopyCoordinates')}
              >
                {copied ? t('coordinatesCopied') : t('copyAction')}
              </button>
            ) : null}
          </dd>
          <dt>{t('insightCompactTime')}</dt>
          <dd>{dateLabel ?? t('insightTimeMissing')}</dd>
          <dt>{t('insightCompactMovement')}</dt>
          <dd>{movementLabel}</dd>
          {!showOptIn ? (
            <>
              <dt>{t('insightCompactWeather')}</dt>
              <dd>
                <span>{weatherLineOrState}</span>
                {remote ? retryButton(weatherStatus) : null}
              </dd>
            </>
          ) : null}
          {remote && !holidaysStatus.loading && !holidaysStatus.error && holidayNames ? (
            <>
              <dt>{t('insightCompactHoliday')}</dt>
              <dd>{holidayNames}</dd>
            </>
          ) : null}
        </dl>
        {coords ? (
          remote ? (
            <div>
              <MapBlock lat={coords.lat} lon={coords.lon} accuracy={accuracyMeters ?? undefined} />
              <div className="fy-map-actions">
                <a
                  className="v4-btn fy-btn-sm"
                  href={googleMapsLink(coords.lat, coords.lon)}
                  target="_blank"
                  rel="noreferrer"
                  title={t('openMaps')}
                >
                  {t('openMaps')}
                </a>
                <a
                  className="v4-btn fy-btn-sm"
                  href={streetViewLink(coords.lat, coords.lon, gpsHeading)}
                  target="_blank"
                  rel="noreferrer"
                  title={t('openStreetView')}
                >
                  {t('openStreetView')}
                </a>
              </div>
            </div>
          ) : (
            <div className="fy-optin" role="region" aria-labelledby="insight-optin-title">
              <h3 className="v4-h3" id="insight-optin-title">
                {t('insightOptInTitle')}
              </h3>
              <p className="fy-hint">{t('insightOptInText')}</p>
              <button type="button" className="v4-btn v4-btn-primary" onClick={onConsent}>
                {t('insightOptInButton')}
              </button>
            </div>
          )
        ) : null}
      </div>
      {remote ? (
        <div className="fy-lists">
          <div>
            <h3 className="v4-h3">{t('insightPoiTitle')}</h3>
            {renderList(poiStatus, poiItems, 'insightPoiError', 'insightPoiEmpty', (poi) => poi.name)}
          </div>
          <div>
            <h3 className="v4-h3">{t('insightSurveillanceTitle')}</h3>
            <p className="fy-hint">{t('insightSurveillanceHelper')}</p>
            {renderList(surveillanceStatus, surveillanceItems, 'insightSurveillanceError', 'insightSurveillanceEmpty', (poi) =>
              localizeCategoryKey(poi.category, t)
            )}
          </div>
        </div>
      ) : null}
    </>
  );
};
