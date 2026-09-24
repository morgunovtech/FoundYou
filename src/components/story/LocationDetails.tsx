import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoContext, RemoteStatus } from '../../hooks/useGeoContext';
import type { StructuredMetadata } from '../../types/metadata';
import type { OCRResult } from '../../hooks/useOCR';
import type { PoiResult } from '../../types/api';
import { useI18n, useT, type MessageKey } from '../../i18n';
import { formatCoords, localizeCategoryKey, localizePlaceParts, withoutPlaceEchoes } from '../../utils/insightsCompact';
import { capitalize, describeWeather } from '../../utils/weather';
import { matchSceneText } from '../../utils/sceneText';
import { isAtThePoint, placeTypeLabel } from '../../utils/placeType';
import { geotagTipKey } from '../../utils/geotagTips';
import { checkGeoPlausibility } from '../../utils/geoPlausibility';
import { googleMapsLink, streetViewLink } from '../../utils/mapLinks';
import { MapBlock } from '../MapBlock';
import { RetryButton } from './RetryButton';
import { SCENE_MATCH_KEYS } from './storyKeys';
import { Claim } from '../Claim';
import { Explainer } from '../Explainer';
import { guessHome, type HomeVerdict } from '../../utils/homeGuess';

const HOME_KEYS: Record<HomeVerdict, MessageKey> = {
  likely: 'home_likely',
  possible: 'home_possible',
  unlikely: 'home_unlikely',
  undecided: 'home_undecided'
};

/**
 * Above this many people a point says little about anyone in particular; below it, the
 * coordinates narrow the circle down to a handful of households. The number is a threshold for
 * wording, not a claim of anonymity, which is why both sentences are about degree.
 */
const CROWD_THRESHOLD = 100_000;

/**
 * OSM values → dictionary keys. A value with no key of its own is printed verbatim rather than
 * dropped: OSM has hundreds of `landuse` values and an unknown one still tells the reader
 * something, as long as it is marked as OSM's own word for it.
 */
function kindLabel(prefix: string, kind: string, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  const key = `${prefix}${kind}` as MessageKey;
  const label = t(key);
  return label === key ? kind : label;
}

function landuseLabel(value: string, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  const key = `landuse_${value}` as MessageKey;
  const label = t(key);
  return label === key ? t('landuse_other', { value }) : label;
}

/** Thousands separated, so «2 900 000» does not read as a phone number. */
function formatPopulation(count: number, lang: string): string {
  // `Intl` takes the BCP-47 tag directly; the dictionary's two-letter codes are valid ones.
  return new Intl.NumberFormat(lang).format(count);
}

interface LocationDetailsProps {
  geo: GeoContext;
  metadata: StructuredMetadata | null;
  ocrResult: OCRResult | null;
  /** Filename platform (iOS / Android / …) for the geotag recipe. */
  platform: string | null | undefined;
  /** Lookups allowed and coordinates present: the remote rows and the map are shown. */
  remote: boolean;
  accuracyLabel: string | null;
  /** Weekday / weekend / holiday and the capture hour, for the «is this where you live» guess. */
  dayKind?: 'weekday' | 'weekend' | 'holiday';
  hour?: number;
  /** Camera heading and field of view from the stance, for the cone on the map. */
  heading?: number | null;
  fieldOfView?: number | null;
}

/**
 * The «Местоположение» card body: the address and the place type, the coordinates, the
 * weather and the holiday at that hour, the map and its links, the places and cameras nearby,
 * the device-specific tip on switching geotags off, and the disclosure of what was sent.
 */
export const LocationDetails: React.FC<LocationDetailsProps> = ({ geo, metadata, ocrResult, platform, remote, accuracyLabel, dayKind, hour, heading, fieldOfView }) => {
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
  const placeCtx = remote ? geo.placeContext.data : null;
  // A lunar holiday whose day was computed rather than announced must not read as a fact.
  const holidayApproximate = useMemo(
    () => Boolean(remote && geo.holidays.data?.holidays.some((h) => h.approximate)),
    [remote, geo.holidays.data]
  );
  const placeType = useMemo(() => (remote ? placeTypeLabel(geo.reverse.data) : null), [remote, geo.reverse.data]);
  // A road, or anything far enough away, is the nearest object on the map — not what is here.
  const placeIsHere = useMemo(() => isAtThePoint(geo.reverse.data), [geo.reverse.data]);
  const placeDistance = geo.reverse.data?.distanceMeters ?? null;
  /*
   * The one question a stranger opens someone else's coordinates for. Every part of the answer
   * is already on this card; none of them says it alone. It is a guess and it is labelled one,
   * with every signal listed for and against — see `utils/homeGuess.ts`.
   */
  const home = useMemo(
    () =>
      remote
        ? guessHome({
            landuse: placeCtx?.landuse,
            placeCategory: geo.reverse.data?.category,
            placeType: geo.reverse.data?.type,
            atThePoint: placeIsHere,
            landmarkCount: geo.landmarks.items.length,
            dayKind,
            hour,
            transport: placeCtx?.transport,
            sensitive: placeCtx?.sensitive
          })
        : null,
    [remote, placeCtx, geo.reverse.data, placeIsHere, geo.landmarks.items.length, dayKind, hour]
  );
  // Numbers a receiver can write but nobody could have stood in: «0, 0», a pole, Everest+.
  const geoDoubts = useMemo(
    () => checkGeoPlausibility(geo.coords, metadata?.gps?.altitude ?? null),
    [geo.coords, metadata?.gps?.altitude]
  );
  // The settlement the point sits in is not a «place nearby»: it is the address line above.
  const poiItems = useMemo(() => withoutPlaceEchoes(geo.poi.items, geo.reverse.data), [geo.poi.items, geo.reverse.data]);

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
              <dt>{placeIsHere ? t('insightCompactPlaceType') : t('insightCompactNearestObject')}</dt>
              <dd>
                <span>
                  {geo.reverse.data?.name
                    ? t('placeTypeNamed', { type: t(placeType.key, placeType.params), name: geo.reverse.data.name })
                    : t(placeType.key, placeType.params)}
                  {geo.reverse.data?.houseNumber ? `, ${t('placeTypeHouseNumber', { number: geo.reverse.data.houseNumber })}` : ''}
                </span>
                {!placeIsHere ? (
                  <span className="fy-muted">
                    {placeDistance != null
                      ? t('placeTypeNearestHint', { distance: formatPoiDistance(placeDistance) })
                      : t('placeTypeNearestHintNoDistance')}
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
          {remote && geo.reverse.data?.neighbourhood ? (
            <>
              <dt>{t('insightCompactNeighbourhood')}</dt>
              <dd>
                <span>{geo.reverse.data.neighbourhood}</span>
                <span className="fy-muted">{t('neighbourhoodHint')}</span>
              </dd>
            </>
          ) : null}
          {remote && geo.reverse.data?.buildingLevels != null ? (
            <>
              <dt>{t('insightCompactBuildingLevels')}</dt>
              <dd>
                <span>{t('buildingLevelsValue', { levels: geo.reverse.data.buildingLevels })}</span>
              </dd>
            </>
          ) : null}
          {remote && geo.reverse.data?.localName ? (
            <>
              <dt>{t('insightCompactLocalName')}</dt>
              <dd>
                <span>{geo.reverse.data.localName}</span>
              </dd>
            </>
          ) : null}
          {placeCtx?.landuse ? (
            <>
              <dt>{t('insightCompactLanduse')}</dt>
              <dd>
                <span>{landuseLabel(placeCtx.landuse, t)}</span>
              </dd>
            </>
          ) : null}
          {placeCtx && placeCtx.sensitive.length > 0 ? (
            <>
              <dt>{t('insightCompactSensitive')}</dt>
              <dd>
                <span>
                  {placeCtx.sensitive
                    .map((item) => `${kindLabel('sensitive_', item.kind, t)}${item.name ? ` «${item.name}»` : ''} — ${formatPoiDistance(item.distance)}`)
                    .join('; ')}
                </span>
                <span className="fy-muted">{t('sensitiveHint')}</span>
              </dd>
            </>
          ) : null}
          {placeCtx && placeCtx.transport.length > 0 ? (
            <>
              <dt>{t('insightCompactTransport')}</dt>
              <dd>
                <span>
                  {placeCtx.transport
                    .map((item) => `${kindLabel('transport_', item.kind, t)}${item.name ? ` «${item.name}»` : ''} — ${formatPoiDistance(item.distance)}`)
                    .join('; ')}
                </span>
                <span className="fy-muted">{t('transportHint')}</span>
              </dd>
            </>
          ) : null}
          {remote && geo.landmarks.items.length > 0 ? (
            <>
              <dt>{t('insightCompactLandmarks')}</dt>
              <dd>
                <span>
                  {geo.landmarks.items.map((item) => `${item.title} — ${formatPoiDistance(item.distance)}`).join('; ')}
                </span>
                <span className="fy-muted">{t('landmarksHint')}</span>
              </dd>
            </>
          ) : null}
          {placeCtx?.population != null ? (
            <>
              <dt>{t('insightCompactPopulation')}</dt>
              <dd>
                <span>{t('populationValue', { name: placeCtx.placeName || t('emptyValue'), count: formatPopulation(placeCtx.population, lang) })}</span>
                <span className="fy-muted">
                  {placeCtx.population >= CROWD_THRESHOLD ? t('populationCrowd') : t('populationSparse')}
                </span>
              </dd>
            </>
          ) : null}
          <dt>{t('insightCompactCoordinates')}</dt>
          <dd>
            <span className="fy-mono">{formatCoords(coords.lat, coords.lon)}</span>
            {!remote && accuracyLabel ? <span className="fy-muted">{accuracyLabel}</span> : null}
            {geoDoubts.map((doubt) => (
              <span key={doubt.kind} className="fy-muted">
                {t(doubt.key, doubt.params)}
              </span>
            ))}
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
                  <dd>
                    {holidayNames}
                    {holidayApproximate ? <span className="fy-hint"> {t('holidayApproximate')}</span> : null}
                  </dd>
                </>
              ) : null}
            </>
          ) : null}
        </dl>
        {home ? (
          <div className="fy-home">
            <h4 className="v4-h3">
              {t('homeTitle')}{' '}
              <Claim kind="hypothesis" />
            </h4>
            <p className="fy-setting-value">{t(HOME_KEYS[home.verdict])}</p>
            {home.for.length > 0 ? (
              <p className="fy-hint">
                {t('homeFor')}: {home.for.map((signal) => t(`homeSignal_${signal.id}` as MessageKey)).join('; ')}
              </p>
            ) : null}
            {home.against.length > 0 ? (
              <p className="fy-hint">
                {t('homeAgainst')}: {home.against.map((signal) => t(`homeSignal_${signal.id}` as MessageKey)).join('; ')}
              </p>
            ) : null}
            <Explainer title={t('homeExplainTitle')}>
              <p>{t('homeExplainBody')}</p>
              <p>{t('homeExplainWhy')}</p>
            </Explainer>
          </div>
        ) : null}
        <div>
          {remote ? (
            <MapBlock lat={coords.lat} lon={coords.lon} accuracy={geo.accuracyMeters ?? undefined} heading={heading} fieldOfView={fieldOfView} />
          ) : null}
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
            {/* The map is behind a gate that explains what OSM would learn; the Google links deserve the same one line. */}
            <p className="fy-hint">{t('mapLinksNote')}</p>
          </div>
        </div>
      </div>
      {remote ? (
        <div className="fy-lists">
          <div>
            <h4 className="v4-h3">{t('insightPoiTitle')}</h4>
            {renderList(geo.poi.status, poiItems, 'insightPoiError', 'insightPoiEmpty', (poi) =>
              poi.name?.trim() ? poi.name : localizeCategoryKey(poi.category, t)
            )}
          </div>
          {/* Only cameras someone mapped, and only when there are any: a list of shops «that may
              have a camera» answered no question, and an empty block is noise. */}
          {geo.surveillance.items.length > 0 ? (
            <div>
              <h4 className="v4-h3">{t('insightSurveillanceTitle')}</h4>
              <p className="fy-hint">{t('insightSurveillanceHelper')}</p>
              <ul className="fy-rows">
                {geo.surveillance.items.map((poi, index) => (
                  <li key={`${poi.category}-${poi.distance}-${index}`}>
                    <span>{poi.name?.trim() ? poi.name : localizeCategoryKey(poi.category, t)}</span>
                    <span className="fy-mono">{formatPoiDistance(poi.distance)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      <details className="fy-tip">
        <summary data-more={t('showAction')} data-less={t('hideAction')}>
          {t('geotagTipTitle')}
        </summary>
        <p>{t(geotagTipKey(metadata?.cameraMake, metadata?.cameraModel, platform))}</p>
      </details>
      <p className="fy-geo-note">{t('geoDisclosure')}</p>
    </div>
  );
};
