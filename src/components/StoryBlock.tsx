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
        plates,
        credentials: credentials.data
      }),
    [t, lang, metadata, profile, proData, detections, ocrResult, place, accuracyLabel, weatherLine, holidayNames, plates, credentials.data]
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
  if (metadata?.shotDateLocal) {
    fileRows.push([t('shotDate'), formatDetailedDate(metadata.shotDateLocal, lang) ?? t('emptyValue')]);
  }
  // The filename pattern names a platform; its device guess only matters when EXIF has no model.
  const fileFactSub = proData?.filename.platform
    ? `${proData.filename.platform}${!metadata?.cameraModel && proData.filename.device ? ` · ${proData.filename.device}` : ''}`
    : null;

  /* ── fact order and extras ────────────────────────────── */

  const factOrder: ProfileSectionKind[] = ['location', 'time', 'device', 'people', 'text', 'plates', 'serial', 'hash', 'origin', 'editing', 'ai', 'content'];

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
    const details = kind === 'location' ? locationDetails : kind === 'text' ? textDetails : kind === 'ai' ? credentialsDetails : null;
    return (
      <FactRow
        key={kind}
        title={section.title}
        severity={section.severity}
        points={section.leakPoints}
        value={kind === 'location' ? null : section.text}
        sub={kind === 'location' ? null : section.subtext}
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
        {factOrder.map(renderFact)}
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
