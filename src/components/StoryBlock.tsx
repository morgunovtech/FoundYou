import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DigitalProfile, ProfileSection, ProfileSectionKind } from '../utils/heuristics/digitalProfile';
import type { StructuredMetadata, BasicFileInfo } from '../types/metadata';
import type { BoundingBox } from '../types/detection';
import type { OCRResult } from '../hooks/useOCR';
import type { ProData } from '../App';
import { useI18n, useT, type MessageKey } from '../i18n';
import { useGeoContext, type RemoteStatus } from '../hooks/useGeoContext';
import { buildStory, buildVerdict } from '../utils/story';
import { buildProGroups } from '../utils/proTable';
import { geotagTipKey } from '../utils/geotagTips';
import type { PlateCandidate } from '../utils/plates';
import type { ContentCredentialsState } from '../hooks/useContentCredentials';
import { formatCoords, formatDistance, localizeCategoryKey, localizePlaceParts } from '../utils/insightsCompact';
import { capitalize, describeWeather } from '../utils/weather';
import { buildStance, formatOffset, type CompassPoint, type ElevationVerdict, type RelativeDirection, type SunPhase, type InstantSource } from '../utils/stance';
import { buildTimeProfile, type AgeKind, type DayKind, type TimeOfDay } from '../utils/timeProfile';
import { buildDeviceProfile, type CameraModule, type DeviceSource } from '../utils/deviceProfile';
import { placeTypeLabel } from '../utils/placeType';
import { ShotDiagram } from './ShotDiagram';
import { formatBytes, formatDetailedDate, formatDimensions, formatMegapixels, describeFileType } from '../utils/format';
import { googleMapsLink, streetViewLink } from '../utils/mapLinks';
import type { PoiResult } from '../types/api';
import { SectionHead } from './SectionHead';
import { MapBlock } from './MapBlock';

interface StoryBlockProps {
  fileInfo: BasicFileInfo;
  metadata: StructuredMetadata | null;
  profile: DigitalProfile | null;
  proData: ProData | null;
  detections: BoundingBox[];
  ocrResult: OCRResult | null;
  ocrLoading: boolean;
  ocrError: string | null;
  ocrProgressLabel: string | null;
  onMakeSafeCopy: () => void;
  credentials: ContentCredentialsState;
  plates: PlateCandidate[];
}

const PRO_ROW_CAP = 200;

const COMPASS_KEYS: Record<CompassPoint, MessageKey> = {
  N: 'compassN',
  NE: 'compassNE',
  E: 'compassE',
  SE: 'compassSE',
  S: 'compassS',
  SW: 'compassSW',
  W: 'compassW',
  NW: 'compassNW'
};
const SUN_RELATIVE_KEYS: Record<RelativeDirection, MessageKey> = {
  front: 'stanceSunFront',
  right: 'stanceSunRight',
  behind: 'stanceSunBehind',
  left: 'stanceSunLeft'
};
const SUN_PHASE_KEYS: Record<Exclude<SunPhase, 'night'>, MessageKey> = { twilight: 'stancePhaseTwilight', low: 'stancePhaseLow', day: 'stancePhaseDay' };
const TIME_SOURCE_KEYS: Record<InstantSource, MessageKey> = {
  'exif-offset': 'stanceTimeExif',
  'gps-time': 'stanceTimeGps',
  'place-zone': 'stanceTimePlace',
  longitude: 'stanceTimeLongitude'
};
const TERRAIN_KEYS: Record<ElevationVerdict, MessageKey> = {
  ground: 'stanceTerrainGround',
  above: 'stanceTerrainAbove',
  high: 'stanceTerrainHigh',
  below: 'stanceTerrainBelow'
};
const TIME_OF_DAY_KEYS: Record<TimeOfDay, MessageKey> = {
  night: 'todNight',
  earlyMorning: 'todEarlyMorning',
  morning: 'todMorning',
  lunch: 'todLunch',
  afternoon: 'todAfternoon',
  evening: 'todEvening',
  lateEvening: 'todLateEvening'
};
const DAY_KIND_KEYS: Record<DayKind, MessageKey> = { weekend: 'dayWeekend', weekday: 'dayWeekday', holiday: 'dayHoliday' };
const AGE_KEYS: Record<AgeKind, MessageKey> = { future: 'ageFuture', fresh: 'ageFresh', days: 'ageDays', months: 'ageMonths', years: 'ageYears' };
const CAMERA_MODULE_KEYS: Record<CameraModule, MessageKey> = { main: 'cameraModuleMain', ultrawide: 'cameraModuleUltrawide', tele: 'cameraModuleTele' };
const DEVICE_SOURCE_KEYS: Record<DeviceSource, MessageKey> = { exif: 'deviceSourceExif', filename: 'deviceSourceFilename', resolution: 'deviceSourceResolution' };

/** `YYYY-MM` → «сентябрь 2023 г.» in the UI language. */
function formatMonthYear(ym: string, locale: string): string {
  const date = new Date(`${ym}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return ym;
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/**
 * Section 02 — what the photo says about you: the verdict (share / clean first / do not
 * share), the portrait a stranger could write from this one file, the facts with what each
 * of them gives away, and the raw data table behind a plainly named button at the end.
 * Place context is fetched from our own Functions with rounded coordinates only; the user
 * can switch it off here. The picture itself is section 01 (SceneBlock).
 */
const StoryBlockInner: React.FC<StoryBlockProps> = ({
  fileInfo,
  metadata,
  profile,
  proData,
  detections,
  ocrResult,
  ocrLoading,
  ocrError,
  ocrProgressLabel,
  onMakeSafeCopy,
  credentials,
  plates
}) => {
  const t = useT();
  const { lang } = useI18n();
  const geo = useGeoContext(metadata);
  const [rawData, setRawData] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const remote = geo.enabled && Boolean(geo.coords);
  const placeInfo = useMemo(() => localizePlaceParts(geo.reverse.data, lang), [geo.reverse.data, lang]);
  const place = remote && !geo.reverse.status.loading && !geo.reverse.status.error ? placeInfo.place || null : null;
  const accuracyLabel = geo.accuracyMeters != null ? formatDistance(geo.accuracyMeters, lang) : null;
  const weatherLine = useMemo(
    () => (remote && geo.weather.data ? describeWeather(geo.weather.data, t, lang) : null),
    [remote, geo.weather.data, t, lang]
  );
  const holidayNames = useMemo(() => {
    if (!remote || !geo.holidays.data?.isHoliday) return null;
    const names = Array.from(new Set(geo.holidays.data.holidays.map((h) => h.localName || h.name).filter(Boolean)));
    return names.length > 0 ? names.join(', ') : null;
  }, [remote, geo.holidays.data]);

  // «How the photo was taken»: derived from GPS, time and camera tags; the place zone and the
  // terrain height come from the lookups when they are allowed and have answered.
  const stance = useMemo(
    () =>
      metadata?.gps
        ? buildStance({
            metadata,
            placeTimezone: remote ? geo.weather.data?.timezone ?? null : null,
            terrainElevation: remote ? geo.elevation.data?.elevation ?? null : null
          })
        : null,
    [metadata, remote, geo.weather.data?.timezone, geo.elevation.data?.elevation]
  );
  const placeType = useMemo(() => (remote ? placeTypeLabel(geo.reverse.data) : null), [remote, geo.reverse.data]);

  // «Time and habits»: the camera clock read together with the place zone and the holidays.
  const timeProfile = useMemo(
    () =>
      buildTimeProfile({
        metadata,
        placeTimezone: remote ? geo.weather.data?.timezone ?? null : null,
        holiday: remote ? geo.holidays.data : null,
        place: remote ? geo.reverse.data : null
      }),
    [metadata, remote, geo.weather.data?.timezone, geo.holidays.data, geo.reverse.data]
  );
  const travel = timeProfile?.travel.zone ? 'zone' : timeProfile?.travel.leisure ? 'leisure' : null;

  // «Device»: maker, marketing name, system, age of the model, camera module, shot counter.
  const deviceProfile = useMemo(
    () => buildDeviceProfile({ metadata, filename: proData?.filename ?? null, resolution: proData?.resolution ?? null }),
    [metadata, proData?.filename, proData?.resolution]
  );

  const verdict = useMemo(() => (profile ? buildVerdict(profile, t) : null), [profile, t]);
  const story = useMemo(
    () =>
      buildStory({
        t,
        lang,
        metadata,
        profile,
        temporal: proData?.temporal ?? [],
        editing: proData?.editing ?? null,
        stripped: proData?.stripped ?? null,
        detections,
        ocrResult,
        place,
        accuracyLabel,
        weatherLine,
        holidayNames,
        travel,
        plates,
        credentials: credentials.data
      }),
    [t, lang, metadata, profile, proData, detections, ocrResult, place, accuracyLabel, weatherLine, holidayNames, travel, plates, credentials.data]
  );

  const proGroups = useMemo(
    () => (rawData && profile ? buildProGroups(profile, metadata, proData, fileInfo, detections, ocrResult, lang) : []),
    [rawData, profile, metadata, proData, fileInfo, detections, ocrResult, lang]
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

  const sectionsByKind = useMemo(() => {
    const map = new Map<ProfileSectionKind, ProfileSection>();
    profile?.sections.forEach((section) => map.set(section.kind, section));
    return map;
  }, [profile]);

  const retryButton = (status: RemoteStatus) =>
    status.error && status.retryable ? (
      <button type="button" className="v4-btn fy-btn-sm" onClick={status.retry}>
        {t('retry')}
      </button>
    ) : null;

  // Natural features and settlements can be a kilometre away; metres stop reading well past 1 km.
  const formatPoiDistance = (metres: number) =>
    metres >= 1000
      ? t('insightPoiDistanceKm', { distance: new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(metres / 1000) })
      : t('insightPoiDistance', { distance: Math.round(metres) });

  const renderRows = (items: PoiResult[], labelOf: (poi: PoiResult) => string) => (
    <ul className="fy-rows">
      {items.map((poi, index) => (
        <li key={`${poi.name}-${index}`}>
          <span>{labelOf(poi)}</span>
          <span className="fy-mono">{formatPoiDistance(poi.distance)}</span>
        </li>
      ))}
    </ul>
  );

  const renderList = (
    status: RemoteStatus,
    items: PoiResult[],
    errorKey: MessageKey,
    emptyKey: MessageKey,
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

  /* ── per-fact details ─────────────────────────────────── */

  const locationDetails = geo.coords ? (
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
                {retryButton(geo.reverse.status)}
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
            <span className="fy-mono">{formatCoords(geo.coords.lat, geo.coords.lon)}</span>
            {!remote && accuracyLabel ? <span className="fy-muted">{accuracyLabel}</span> : null}
          </dd>
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
                {retryButton(geo.weather.status)}
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
          {remote ? <MapBlock lat={geo.coords.lat} lon={geo.coords.lon} accuracy={geo.accuracyMeters ?? undefined} /> : null}
          <div className="fy-map-actions">
            <button type="button" className="v4-btn fy-btn-sm" onClick={handleCopyCoords} aria-live="polite">
              {copied ? t('coordinatesCopied') : t('insightCompactCopyCoordinates')}
            </button>
            <a className="v4-btn fy-btn-sm" href={googleMapsLink(geo.coords.lat, geo.coords.lon)} target="_blank" rel="noreferrer">
              {t('openMaps')}
            </a>
            <a
              className="v4-btn fy-btn-sm"
              href={streetViewLink(geo.coords.lat, geo.coords.lon, metadata?.gps?.heading)}
              target="_blank"
              rel="noreferrer"
            >
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
        <summary data-more={t('showAction')} data-less={t('hideAction')}>{t('geotagTipTitle')}</summary>
        <p>{t(geotagTipKey(metadata?.cameraMake, metadata?.cameraModel, proData?.filename.platform))}</p>
      </details>
      <p className="fy-geo-note">
        <span>{geo.enabled ? t('geoDisclosure') : t('geoDisabledNote')}</span>
        <button type="button" className="fy-link-btn" onClick={() => geo.setEnabled(!geo.enabled)}>
          {geo.enabled ? t('geoDisable') : t('geoEnable')}
        </button>
      </p>
    </div>
  ) : null;

  const stanceRow = (() => {
    if (!stance || !geo.coords) return null;
    const held =
      stance.orientation === 'landscape'
        ? t('stanceHeldLandscape')
        : stance.orientation === 'square'
        ? t('stanceHeldSquare')
        : stance.orientation === 'portrait'
        ? t('stanceHeldPortrait')
        : t('stanceHeldUnknown');
    const camera = stance.cameraSide === 'front' ? t('stanceCameraFront') : stance.cameraSide === 'rear' ? t('stanceCameraRear') : t('stanceCameraUnknown');
    const sunText = (() => {
      if (!stance.sun || !stance.instant) return t('stanceSunUnknown');
      const source = t(TIME_SOURCE_KEYS[stance.instant.source]);
      if (stance.sun.phase === 'night') return `${t('stancePhaseNight', { altitude: stance.sun.altitude })} (${source})`;
      const relative = stance.sun.relative ? `${t(SUN_RELATIVE_KEYS[stance.sun.relative])}, ` : '';
      return `${relative}${t('stanceSunAltitude', { altitude: stance.sun.altitude })}, ${t(SUN_PHASE_KEYS[stance.sun.phase])} (${source})`;
    })();
    const speedText =
      stance.speedKmh == null || stance.movement == null
        ? t('stanceSpeedUnknown')
        : stance.movement === 'still'
        ? t('stanceStill')
        : stance.movement === 'walking'
        ? t('stanceWalking', { speed: stance.speedKmh })
        : t('stanceVehicle', { speed: stance.speedKmh });
    const terrainText = (() => {
      if (stance.elevation) {
        return t(TERRAIN_KEYS[stance.elevation.verdict], {
          gps: stance.elevation.gps,
          terrain: stance.elevation.terrain,
          diff: Math.abs(stance.elevation.difference)
        });
      }
      if (metadata?.gps?.altitude == null) return t('stanceTerrainNoGps');
      if (!remote) return t('stanceTerrainPending');
      if (geo.elevation.status.loading) return t('insightCompactLoading');
      if (geo.elevation.status.error) return t('stanceTerrainUnavailable');
      return t('stanceTerrainPending');
    })();
    return (
      <FactRow key="stance" title={t('stanceTitle')} severity="low" points={0} value={null} sub={null} soWhat={t('stanceSoWhat')}>
        <div className="fy-fact-details fy-shot">
          <ShotDiagram
            stance={stance}
            label={t('stanceDiagramLabel')}
            points={{ n: t('compassShortN'), e: t('compassShortE'), s: t('compassShortS'), w: t('compassShortW') }}
          />
          <dl className="fy-spec fy-spec--tight">
            <dt>{t('stanceStood')}</dt>
            <dd>
              <span className="fy-mono">{formatCoords(geo.coords.lat, geo.coords.lon)}</span>
              {accuracyLabel ? <span className="fy-muted">{accuracyLabel}</span> : null}
            </dd>
            <dt>{t('stanceLooked')}</dt>
            <dd>{stance.heading ? t('stanceHeading', { point: t(COMPASS_KEYS[stance.heading.point]), degrees: stance.heading.degrees }) : t('stanceHeadingUnknown')}</dd>
            <dt>{t('stanceHeld')}</dt>
            <dd>{`${held}, ${camera}, ${t('stanceFov', { fov: stance.fovDegrees })}`}</dd>
            <dt>{t('stanceSun')}</dt>
            <dd>{sunText}</dd>
            <dt>{t('stanceSpeed')}</dt>
            <dd>{speedText}</dd>
            <dt>{t('stanceTerrain')}</dt>
            <dd>
              <span>{terrainText}</span>
              {!stance.elevation && remote ? retryButton(geo.elevation.status) : null}
            </dd>
          </dl>
        </div>
      </FactRow>
    );
  })();

  /** «2 ч 30 мин» / «45 мин» for a clock difference. */
  const formatMinutes = (minutes: number) => {
    const abs = Math.abs(minutes);
    const hours = Math.floor(abs / 60);
    const rest = abs % 60;
    const parts: string[] = [];
    if (hours > 0) parts.push(t('durationHoursShort', { count: hours }));
    if (rest > 0 || hours === 0) parts.push(t('durationMinutesShort', { count: rest }));
    return parts.join(' ');
  };
  /** «2 г. 11 мес.» for an age in months. */
  const formatMonthsAge = (months: number) => {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const parts: string[] = [];
    if (years > 0) parts.push(t('durationYearsShort', { count: years }));
    if (rest > 0) parts.push(t('durationMonthsShort', { count: rest }));
    return parts.length > 0 ? parts.join(' ') : t('durationLessThanMonth');
  };

  // «Time and habits»: what the clock says once it is read together with the place.
  const timeDetails = (() => {
    if (!timeProfile) return null;
    const tp = timeProfile;
    const dayText = `${
      tp.dayKind === 'holiday'
        ? t('dayHoliday', { names: tp.holidayNames.join(', ') })
        : tp.dayKind === 'weekday' && tp.workingHours
        ? t('dayWorkingHours')
        : t(DAY_KIND_KEYS[tp.dayKind])
    }, ${t(TIME_OF_DAY_KEYS[tp.timeOfDay])}`;

    const placeZoneText = (() => {
      if (!metadata?.gps) return null;
      if (!geo.enabled) return t('timePlaceZoneOff');
      if (tp.place) return `${tp.place.timezone}, UTC${formatOffset(tp.place.offsetMinutes)}`;
      if (geo.weather.status.loading) return t('insightCompactLoading');
      return t('timePlaceZoneUnavailable');
    })();

    const diffText = (() => {
      if (!tp.clock) return null;
      if (tp.clock.match) return t('timeDiffMatch');
      const delta = formatMinutes(tp.clock.differenceMinutes);
      const head = tp.clock.differenceMinutes > 0 ? t('timeDiffAhead', { delta }) : t('timeDiffBehind', { delta });
      const when = tp.clock.sameDay ? tp.clock.local.slice(11, 16) : formatDetailedDate(tp.clock.local, lang) ?? tp.clock.local;
      return `${head}; ${t('timeLocalClock', { when })}`;
    })();

    const inferences: string[] = [];
    if (tp.dayKind === 'holiday') inferences.push(t('inferHoliday'));
    else if (tp.dayKind === 'weekend') inferences.push(t('inferWeekend'));
    else if (tp.workingHours) inferences.push(t('inferWorking'));
    if (tp.timeOfDay === 'night') inferences.push(t('inferNight'));
    else if (tp.timeOfDay === 'earlyMorning') inferences.push(t('inferEarly'));
    else if (tp.timeOfDay === 'lunch') inferences.push(t('inferLunch'));
    if (tp.travel.zone && tp.camera && tp.place) {
      inferences.push(t('inferTravelZone', { camera: formatOffset(tp.camera.offsetMinutes), place: formatOffset(tp.place.offsetMinutes) }));
    } else if (tp.travel.leisure && placeType) {
      inferences.push(t('inferTravelLeisure', { type: t(placeType.key, placeType.params) }));
    }
    if (tp.age.kind === 'fresh') inferences.push(t('inferFresh'));

    return (
      <div className="fy-fact-details">
        <dl className="fy-spec fy-spec--tight">
          <dt>{t('timeDay')}</dt>
          <dd>{dayText}</dd>
          <dt>{t('timeCameraZone')}</dt>
          <dd>
            {tp.camera ? (
              <>
                <span className="fy-mono">{`UTC${formatOffset(tp.camera.offsetMinutes)}`}</span>
                <span className="fy-muted">{tp.camera.source === 'exif-offset' ? t('timeCameraZoneExif') : t('timeCameraZoneGps')}</span>
              </>
            ) : (
              <span>{t('timeCameraZoneUnknown')}</span>
            )}
          </dd>
          {placeZoneText ? (
            <>
              <dt>{t('timePlaceZone')}</dt>
              <dd>
                <span>{placeZoneText}</span>
                {!tp.place && remote ? retryButton(geo.weather.status) : null}
              </dd>
            </>
          ) : null}
          {diffText ? (
            <>
              <dt>{t('timeDiff')}</dt>
              <dd>{diffText}</dd>
            </>
          ) : null}
          <dt>{t('timeAge')}</dt>
          <dd>{t(AGE_KEYS[tp.age.kind], { count: tp.age.value })}</dd>
          {inferences.length > 0 ? (
            <>
              <dt>{t('timeInference')}</dt>
              <dd>{inferences.join(' ')}</dd>
            </>
          ) : null}
        </dl>
      </div>
    );
  })();

  // «Device»: the structured rows behind the maker/model headline.
  const deviceDetails = (() => {
    if (!deviceProfile) return null;
    const d = deviceProfile;
    const rows: Array<[string, React.ReactNode]> = [];
    if (d.make) rows.push([t('deviceMake'), d.make]);
    rows.push([
      t('deviceModel'),
      <>
        <span>{d.model}</span>
        {d.modelCode ? <span className="fy-muted fy-mono">{t('deviceModelCode', { code: d.modelCode })}</span> : null}
      </>
    ]);
    if (d.os) {
      const note = d.os.newerAtShot
        ? t('deviceOsBehind', { latest: `${d.os.newerAtShot.name} ${d.os.newerAtShot.major}` })
        : d.os.familyReleased
        ? `${t('deviceOsFamily', { name: d.os.name, major: d.os.major, when: formatMonthYear(d.os.familyReleased, lang) })}${
            d.os.newerAtShot === null && metadata?.shotDateLocal ? `; ${t('deviceOsCurrent')}` : ''
          }`
        : null;
      rows.push([
        t('deviceOs'),
        <>
          <span>{`${d.os.name} ${d.os.version}`}</span>
          {note ? <span className="fy-muted">{note}</span> : null}
        </>
      ]);
    } else if (d.firmware) {
      rows.push([
        t('deviceFirmware'),
        <>
          <span className="fy-mono">{d.firmware.build}</span>
          {d.firmware.built ? <span className="fy-muted">{t('deviceFirmwareBuilt', { when: formatMonthYear(d.firmware.built, lang) })}</span> : null}
        </>
      ]);
    }
    if (d.released) {
      rows.push([
        t('deviceReleased'),
        <>
          <span>{formatMonthYear(d.released, lang)}</span>
          {d.ageAtShotMonths != null ? <span className="fy-muted">{t('deviceAgeAtShot', { age: formatMonthsAge(d.ageAtShotMonths) })}</span> : null}
          {d.ageNowMonths != null && d.ageNowMonths !== d.ageAtShotMonths ? (
            <span className="fy-muted">{t('deviceAgeNow', { age: formatMonthsAge(d.ageNowMonths) })}</span>
          ) : null}
        </>
      ]);
    }
    if (d.camera) {
      const parts: string[] = [];
      if (d.camera.side === 'front') parts.push(t('cameraModuleFront'));
      else if (d.camera.module) parts.push(`${t('cameraModuleRear')}, ${t(CAMERA_MODULE_KEYS[d.camera.module])}`);
      else if (d.camera.side === 'rear') parts.push(t('cameraModuleRear'));
      if (d.camera.focalLength35mm) parts.push(t('cameraFocal', { mm: d.camera.focalLength35mm }));
      if (d.camera.aperture) parts.push(`f/${d.camera.aperture}`);
      if (parts.length > 0) rows.push([t('deviceCamera'), parts.join(' · ')]);
    }
    if (d.shotIndex != null) {
      rows.push([
        t('deviceShotCounter'),
        <>
          <span className="fy-mono">{new Intl.NumberFormat(lang).format(d.shotIndex)}</span>
          <span className="fy-muted">{t('deviceShotCounterHint')}</span>
        </>
      ]);
    }
    rows.push([t('deviceSource'), t(DEVICE_SOURCE_KEYS[d.source])]);
    return (
      <dl className="fy-spec fy-spec--tight">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
    );
  })();

  const textDetails = (() => {
    if (ocrLoading) {
      return <p className="fy-hint">{ocrProgressLabel ?? t('factTextLoading')}</p>;
    }
    if (ocrError) {
      return (
        <p className="fy-hint" role="alert">
          {ocrError}
        </p>
      );
    }
    if (!ocrResult || ocrResult.regions.length < 2 || ocrResult.fullText.trim().length === 0) {
      return <p className="fy-hint">{t('factTextNone')}</p>;
    }
    return (
      <div className="fy-fact-details">
        <p className="fy-hint">{t('ocrBlurHint')}</p>
        <div className="fy-ocr-text">
          <pre className={`fy-ocr-pre ${textExpanded ? 'is-expanded' : ''}`}>{ocrResult.fullText}</pre>
          {ocrResult.fullText.length > 200 && !textExpanded ? (
            <button type="button" className="v4-btn fy-btn-sm fy-ocr-more" onClick={() => setTextExpanded(true)}>
              …
            </button>
          ) : null}
        </div>
      </div>
    );
  })();

  // Content Credentials, when the file carries them: who signed, with what, and whether it held.
  const credentialsDetails = (() => {
    if (credentials.status !== 'found' || !credentials.data) return null;
    const c = credentials.data;
    const rows: Array<[string, string]> = [];
    if (c.generator) rows.push([t('credGenerator'), c.generator]);
    if (c.producer) rows.push([t('credProducer'), c.producer]);
    if (c.issuer) rows.push([t('credIssuer'), c.issuer]);
    if (c.signedAt) rows.push([t('credSignedAt'), formatDetailedDate(c.signedAt, lang) ?? c.signedAt]);
    if (c.actions.length > 0) rows.push([t('credActions'), c.actions.map((a) => a.replace(/^c2pa\./, '')).join(', ')]);
    if (c.ingredients > 0) rows.push([t('credIngredients'), String(c.ingredients)]);
    return (
      <div className="fy-fact-details fy-cred">
        <dl className="fy-spec fy-spec--tight">
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="fy-hint" role={c.valid ? undefined : 'alert'}>
          {c.valid ? t('credValid') : t('credInvalid', { codes: c.failures.join(', ') })}
        </p>
      </div>
    );
  })();

  const displayMime = fileInfo.originalMimeType ?? fileInfo.mimeType;
  const { typeKey, format } = describeFileType(displayMime, fileInfo.originalName ?? fileInfo.file.name);
  const metadataFieldCount = useMemo(() => {
    if (!metadata) return 0;
    return (['exif', 'xmp', 'iptc', 'icc', 'png'] as const).reduce(
      (total, key) => total + Object.keys((metadata.groups as unknown as Record<string, Record<string, unknown> | undefined>)[key] ?? {}).length,
      0
    );
  }, [metadata]);
  const fileRows: Array<[string, string]> = [
    [t('nameLabelSource'), fileInfo.originalName ?? fileInfo.file.name],
    [t('typeLabel'), t(typeKey as MessageKey)],
    [t('formatLabelSource'), format],
    [t('sizeLabelSource'), formatBytes(fileInfo.originalSizeBytes ?? fileInfo.sizeBytes, lang)],
    [t('resolutionLabel'), `${formatDimensions(fileInfo.width, fileInfo.height)} · ${formatMegapixels(fileInfo.width, fileInfo.height, lang)} Mp`],
    [t('metadataFieldsLabel'), metadataFieldCount ? new Intl.NumberFormat(lang).format(metadataFieldCount) : t('emptyValue')]
  ];
  // The filename pattern names a platform; its device guess only matters when EXIF has no model.
  const fileFactSub = proData?.filename.platform
    ? `${proData.filename.platform}${!metadata?.cameraModel && proData.filename.device ? ` · ${proData.filename.device}` : ''}`
    : null;

  /* ── fact order and extras ────────────────────────────── */

  // The SHA-256 fingerprint stays in the raw data table (it still counts in the score).
  const factOrder: ProfileSectionKind[] = ['location', 'time', 'device', 'people', 'text', 'plates', 'serial', 'origin', 'editing', 'ai', 'content'];

  const renderFact = (kind: ProfileSectionKind) => {
    const section = sectionsByKind.get(kind);
    if (!section) {
      // Text is worth a row even before the profile knows about it (OCR is still running).
      if (kind === 'text' && (ocrLoading || ocrError)) {
        return (
          <FactRow key={kind} title={t('ocrTitle')} severity="low" points={0} value={null} sub={null} soWhat={null}>
            {textDetails}
          </FactRow>
        );
      }
      return null;
    }
    const details =
      kind === 'location'
        ? locationDetails
        : kind === 'time'
        ? timeDetails
        : kind === 'device'
        ? deviceDetails
        : kind === 'text'
        ? textDetails
        : kind === 'ai'
        ? credentialsDetails
        : null;
    // Time: the camera wall-clock is the headline, the rows below read it with the place.
    // Device: the rows carry maker/model/system, so the headline and subtext are dropped.
    const shotDate = kind === 'time' && timeProfile ? formatDetailedDate(timeProfile.wallClock, lang) ?? null : null;
    const value = kind === 'location' || (kind === 'device' && deviceDetails) ? null : shotDate ?? section.text;
    const sub = kind === 'location' || (kind === 'device' && deviceDetails) || shotDate ? null : section.subtext;
    return (
      <FactRow
        key={kind}
        title={section.title}
        severity={section.severity}
        points={section.leakPoints}
        value={value}
        sub={sub}
        soWhat={section.threatScenario}
      >
        {details}
      </FactRow>
    );
  };

  return (
    <section className="v4-section" aria-labelledby="sec-story">
      <SectionHead num="02" title={t('storyTitle')} id="sec-story" />

      <div className="fy-grid-2 fy-grid-2--lead">
        <div className="fy-card fy-verdict" data-level={verdict?.level ?? 'pending'} aria-live="polite">
          {verdict && profile ? (
            <>
              <h3 className="fy-verdict-title">{verdict.title}</h3>
              <p className="fy-verdict-why">{verdict.why}</p>
              {verdict.reasons.length > 0 ? (
                <p className="fy-verdict-reasons">
                  {t('verdictReasons', { items: '' }).replace(/\s*$/, '')} <b>{verdict.reasons.join(', ')}</b>
                </p>
              ) : null}
              <div className="fy-actions">
                <button type="button" className={verdict.level === 'low' ? 'v4-btn' : 'v4-btn v4-btn-primary'} onClick={onMakeSafeCopy}>
                  {t(verdict.ctaKey)}
                </button>
              </div>
              <p className="fy-verdict-index">{t('leakIndex', { score: profile.leakScore })}</p>
            </>
          ) : (
            <p className="fy-hint">{t('verdictPending')}</p>
          )}
        </div>
        {profile ? (
          <div className="fy-card fy-story">
            <h3 className="v4-h3">{t('storyHeading')}</h3>
            <p>{story.sentences.join(' ')}</p>
            {story.conclusion ? <p className="fy-story-conclusion">{story.conclusion}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="fy-facts">
        {factOrder.map((kind) => (kind === 'location' ? [renderFact(kind), stanceRow] : renderFact(kind)))}
        <FactRow title={t('factFile')} severity="low" points={0} value={null} sub={fileFactSub} soWhat={t('factFileSoWhat')}>
          <dl className="fy-spec fy-spec--tight">
            {fileRows.map(([label, value]) => (
              <React.Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </FactRow>
      </div>

      {profile ? (
        <div className="fy-raw">
          <button
            type="button"
            className="v4-btn fy-btn-sm"
            aria-expanded={rawData}
            aria-controls="raw-data"
            onClick={() => setRawData((v) => !v)}
          >
            {rawData ? t('rawDataHide') : t('rawDataShow')}
          </button>
          {rawData ? (
            <div id="raw-data" className="fy-card fy-raw-table">
              <ProTable groups={proGroups} showMoreLabel={(count) => t('showMore', { count })} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

/* ── fact row ─────────────────────────────────────────────── */

interface FactRowProps {
  title: string;
  severity: 'low' | 'medium' | 'high';
  points: number;
  value: string | null;
  sub: string | null;
  /** The "so what": what a stranger gains from this fact. */
  soWhat: string | null;
  children?: React.ReactNode;
}

const FactRow: React.FC<FactRowProps> = ({ title, severity, points, value, sub, soWhat, children }) => {
  const t = useT();
  return (
    <article className="fy-fact" data-severity={severity}>
      <div className="fy-fact-head">
        <h3 className="fy-fact-title">{title}</h3>
        {points > 0 ? <span className="fy-fact-points">+{points}</span> : null}
      </div>
      {value ? <p className="fy-fact-value">{value}</p> : null}
      {sub ? <p className="fy-fact-sub">{sub}</p> : null}
      {children}
      {soWhat ? (
        <p className="fy-fact-so">
          <b>{t('factSoWhat')}</b>
          <span>{soWhat}</span>
        </p>
      ) : null}
    </article>
  );
};

/* ── pro table ────────────────────────────────────────────── */

const ProTable: React.FC<{ groups: ReturnType<typeof buildProGroups>; showMoreLabel: (count: number) => string }> = ({
  groups,
  showMoreLabel
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className="fy-pro">
      {groups.map((group) => {
        const rows = expanded[group.group] ? group.rows : group.rows.slice(0, PRO_ROW_CAP);
        const hidden = group.rows.length - rows.length;
        return (
          <div key={group.group} className="fy-pro-group">
            <h3 className="v4-h3">{group.group}</h3>
            <div className="fy-table-scroll">
              <table className="fy-pro-table">
                <tbody>
                  {rows.map(([key, value], index) => (
                    <tr key={`${key}-${index}`}>
                      <td>{key}</td>
                      <td>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hidden > 0 ? (
              <button type="button" className="v4-btn fy-btn-sm" onClick={() => setExpanded((prev) => ({ ...prev, [group.group]: true }))}>
                {showMoreLabel(hidden)}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export const StoryBlock = React.memo(StoryBlockInner);
StoryBlock.displayName = 'StoryBlock';
