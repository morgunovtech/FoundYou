import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoContext, RemoteStatus } from '../../hooks/useGeoContext';
import type { StructuredMetadata } from '../../types/metadata';
import type { OCRResult } from '../../hooks/useOCR';
import type { PoiResult } from '../../types/api';
import { useI18n, useT, type MessageKey } from '../../i18n';
import { formatCoords, localizeCategoryKey, localizePlaceParts } from '../../utils/insightsCompact';
import { capitalize, describeWeather } from '../../utils/weather';
import { matchSceneText } from '../../utils/sceneText';
import { placeTypeLabel } from '../../utils/placeType';
import { geotagTipKey } from '../../utils/geotagTips';
import { googleMapsLink, streetViewLink } from '../../utils/mapLinks';
import { MapBlock } from '../MapBlock';
import { RetryButton } from './RetryButton';
import { SCENE_MATCH_KEYS } from './storyKeys';

interface LocationDetailsProps {
  geo: GeoContext;
  metadata: StructuredMetadata | null;
  ocrResult: OCRResult | null;
  /** Filename platform (iOS / Android / …) for the geotag recipe. */
  platform: string | null | undefined;
  /** Lookups allowed and coordinates present: the remote rows and the map are shown. */
  remote: boolean;
  accuracyLabel: string | null;
}

/**
 * The «Местоположение» card body: the address and the place type, the coordinates, the
 * weather and the holiday at that hour, the map and its links, the places and cameras nearby,
 * the device-specific tip on switching geotags off, and the disclosure of what was sent.
 */
export const LocationDetails: React.FC<LocationDetailsProps> = ({ geo, metadata, ocrResult, platform, remote, accuracyLabel }) => {
  const t = useT();
  const { lang } = useI18n();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const placeInfo = useMemo(() => localizePlaceParts(geo.reverse.data, lang), [geo.reverse.data, lang]);
  const weatherLine = useMemo(
    () => (remote && geo.weather.data ? describeWeather(geo.weather.data, t, lang) : null),
    [remote, geo.weather.data, t, lang]
  );
  const holidayNames = useMemo(() => {
    if (!remote || !geo.holidays.data?.isHoliday) return null;
    const names = Array.from(new Set(geo.holidays.data.holidays.map((h) => h.localName || h.name).filter(Boolean)));
    return names.length > 0 ? names.join(', ') : null;
  }, [remote, geo.holidays.data]);
  const placeType = useMemo(() => (remote ? placeTypeLabel(geo.reverse.data) : null), [remote, geo.reverse.data]);

  // Does the text in the picture agree with the place? Compared on the device over data already here.
  const sceneMatches = useMemo(
    () =>
      remote && ocrResult && geo.reverse.data
        ? matchSceneText({
            text: ocrResult.fullText,
            road: geo.reverse.data.road,
            houseNumber: geo.reverse.data.houseNumber,
            placeName: geo.reverse.data.name,
            poiNames: geo.poi.items.map((poi) => poi.name).filter(Boolean)
          })
        : [],
    [remote, ocrResult, geo.reverse.data, geo.poi.items]
  );

  const handleCopyCoords = useCallback(async () => {
    if (!geo.coords) return;
    const value = formatCoords(geo.coords.lat, geo.coords.lon);
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard denied (permissions policy) — nothing to fall back to without a text field.
    } finally {
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    }
  }, [geo.coords]);

  // Natural features and settlements can be a kilometre away; metres stop reading well past 1 km.
  const formatPoiDistance = (metres: number) =>
    metres >= 1000
      ? t('insightPoiDistanceKm', { distance: new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(metres / 1000) })
      : t('insightPoiDistance', { distance: Math.round(metres) });

  const renderList = (
    status: RemoteStatus,
    items: PoiResult[],
    errorKey: MessageKey,
    emptyKey: MessageKey,
    labelOf: (poi: PoiResult) => string
  ) => {
    if (status.loading)
      return (
        <p className="fy-hint" role="status">
          {t('insightCompactLoading')}
        </p>
      );
    if (status.error) {
      return (
        <p className="fy-hint">
          {t(errorKey)} <RetryButton status={status} />
        </p>
      );
    }
    if (items.length === 0) return <p className="fy-hint">{t(emptyKey)}</p>;
    return (
      <ul className="fy-rows">
        {items.map((poi, index) => (
          <li key={`${poi.name}-${index}`}>
            <span>{labelOf(poi)}</span>
            <span className="fy-mono">{formatPoiDistance(poi.distance)}</span>
          </li>
        ))}
      </ul>
    );
  };

  if (!geo.coords) return null;
  const coords = geo.coords;

  return (
    <div className="fy-fact-details">
      <div className={remote ? 'fy-insights' : 'fy-insights fy-insights--single'}>
        <dl className="fy-spec fy-spec--tight">
          {remote ? (
            <>
              <dt>{t('insightCompactLocation')}</dt>
              <dd>
                <span>
                  {geo.reverse.status.loading
                    ? t('insightCompactLoading')
                    : geo.reverse.status.error
                    ? t('insightCompactLocationUnavailable')
                    : placeInfo.place || t('insightCompactLocationUnknown')}
                </span>
                {accuracyLabel ? <span className="fy-muted">{accuracyLabel}</span> : null}
                <RetryButton status={geo.reverse.status} />
              </dd>
            </>
          ) : null}
          {placeType ? (
            <>
              <dt>{t('insightCompactPlaceType')}</dt>
              <dd>
                <span>
                  {geo.reverse.data?.name
                    ? t('placeTypeNamed', { type: t(placeType.key, placeType.params), name: geo.reverse.data.name })
                    : t(placeType.key, placeType.params)}
                  {geo.reverse.data?.houseNumber ? `, ${t('placeTypeHouseNumber', { number: geo.reverse.data.houseNumber })}` : ''}
                </span>
              </dd>
            </>
          ) : null}
          <dt>{t('insightCompactCoordinates')}</dt>
          <dd>
            <span className="fy-mono">{formatCoords(coords.lat, coords.lon)}</span>
            {!remote && accuracyLabel ? <span className="fy-muted">{accuracyLabel}</span> : null}
          </dd>
          {sceneMatches.length > 0 ? (
            <>
              <dt>{t('sceneMatchTitle')}</dt>
              <dd>
                <span>
                  {sceneMatches.map((match) => t(SCENE_MATCH_KEYS[match.kind], { token: match.token, name: match.name })).join('; ')}
                </span>
              </dd>
            </>
          ) : null}
          {metadata?.gps?.altitude != null ? (
            <>
              <dt>{t('insightCompactAltitude')}</dt>
              <dd>{`${Math.round(metadata.gps.altitude)} ${t('metersShort')}`}</dd>
            </>
          ) : null}
          {remote ? (
            <>
              <dt>{t('insightCompactWeather')}</dt>
              <dd>
                <span>
                  {geo.weather.status.loading
                    ? t('insightCompactLoading')
                    : geo.weather.status.error
                    ? t('insightCompactWeatherUnavailable')
                    : weatherLine
                    ? capitalize(weatherLine)
                    : t('insightCompactWeatherUnavailable')}
                </span>
                <RetryButton status={geo.weather.status} />
              </dd>
              {holidayNames ? (
                <>
                  <dt>{t('insightCompactHoliday')}</dt>
                  <dd>{holidayNames}</dd>
                </>
              ) : null}
            </>
          ) : null}
        </dl>
        <div>
          {remote ? <MapBlock lat={coords.lat} lon={coords.lon} accuracy={geo.accuracyMeters ?? undefined} /> : null}
          <div className="fy-map-actions">
            <button type="button" className="v4-btn fy-btn-sm" onClick={handleCopyCoords}>
              {copied ? t('coordinatesCopied') : t('insightCompactCopyCoordinates')}
            </button>
            <span className="sr-only" role="status">
              {copied ? t('coordinatesCopied') : ''}
            </span>
            <a className="v4-btn fy-btn-sm" href={googleMapsLink(coords.lat, coords.lon)} target="_blank" rel="noreferrer">
              {t('openMaps')}
            </a>
            <a className="v4-btn fy-btn-sm" href={streetViewLink(coords.lat, coords.lon, metadata?.gps?.heading)} target="_blank" rel="noreferrer">
              {t('openStreetView')}
            </a>
          </div>
        </div>
      </div>
      {remote ? (
        <div className="fy-lists">
          <div>
            <h4 className="v4-h3">{t('insightPoiTitle')}</h4>
            {renderList(geo.poi.status, geo.poi.items, 'insightPoiError', 'insightPoiEmpty', (poi) =>
              poi.name?.trim() ? poi.name : localizeCategoryKey(poi.category, t)
            )}
          </div>
          <div>
            <h4 className="v4-h3">{t('insightSurveillanceTitle')}</h4>
            {geo.surveillance.items.length > 0 ? <p className="fy-hint">{t('insightSurveillanceHelper')}</p> : null}
            {renderList(geo.surveillance.status, geo.surveillance.items, 'insightSurveillanceError', 'insightSurveillanceEmpty', (poi) =>
              localizeCategoryKey(poi.category, t)
            )}
          </div>
        </div>
      ) : null}
      <details className="fy-tip">
        <summary data-more={t('showAction')} data-less={t('hideAction')}>
          {t('geotagTipTitle')}
        </summary>
        <p>{t(geotagTipKey(metadata?.cameraMake, metadata?.cameraModel, platform))}</p>
      </details>
      <p className="fy-geo-note">
        <span>{geo.enabled ? t('geoDisclosure') : t('geoDisabledNote')}</span>
        <button type="button" className="fy-link-btn" onClick={() => geo.setEnabled(!geo.enabled)}>
          {geo.enabled ? t('geoDisable') : t('geoEnable')}
        </button>
      </p>
    </div>
  );
};
