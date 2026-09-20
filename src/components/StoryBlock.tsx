import React, { useMemo, useState } from 'react';
import { type DigitalProfile, type ProfileSection, type ProfileSectionKind } from '../utils/heuristics/digitalProfile';
import type { StructuredMetadata, BasicFileInfo } from '../types/metadata';
import type { BoundingBox } from '../types/detection';
import type { OCRResult } from '../hooks/useOCR';
import type { ProData } from '../App';
import { useI18n, useT } from '../i18n';
import { useGeoContext } from '../hooks/useGeoContext';
import { buildProGroups } from '../utils/proTable';
import type { QrCode } from '../utils/qr';
import type { PiiFinding } from '../utils/pii';
import type { ContentCredentialsState } from '../hooks/useContentCredentials';
import { formatDistance } from '../utils/insightsCompact';
import { buildStance } from '../utils/stance';
import { buildTimeProfile } from '../utils/timeProfile';
import { buildDeviceProfile } from '../utils/deviceProfile';
import { SectionHead } from './SectionHead';
import { FactRow } from './story/FactRow';
import { ProTable } from './story/ProTable';
import { LocationDetails } from './story/LocationDetails';
import { StanceFact } from './story/StanceFact';
import { TimeDetails } from './story/TimeDetails';
import { TextDetails } from './story/TextDetails';
import { OriginCard } from './story/OriginCard';
import { FrameChecksCard } from './story/FrameChecksCard';
import { DATE_FAULT_KEYS, PII_KIND_KEYS, QR_KIND_KEYS } from './story/storyKeys';
import { timeHeadline } from './story/timeHeadline';
import { Explainer } from './Explainer';
import { findAuthorship, type AuthorshipKind } from '../utils/authorship';
import { findWrittenPlace } from '../utils/placeFromMetadata';
import { useContainerSignals } from '../hooks/useContainerSignals';
import { useFrameStats } from '../hooks/useFrameStats';

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
  credentials: ContentCredentialsState;
  qrCodes: QrCode[];
  pii: PiiFinding[];
}

/** The facts in the order they are shown; people are counted in section 01, the origin card follows these. */
const FACT_ORDER: ProfileSectionKind[] = ['location', 'time', 'text', 'plates', 'qr', 'documents'];

/**
 * Section 02 — what the photo says about you: one card per fact (where it was taken, when,
 * how, text, plates, QR codes, documents, what it was taken on), each with its data only, and
 * the raw data table behind a plainly named button at the end. Place context is fetched from
 * our own Functions with rounded coordinates only, automatically, with a disclosure under the
 * card. People are shown in section 01 (SceneBlock) together with the picture. The cards live
 * in `./story/`.
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
  credentials,
  qrCodes,
  pii
}) => {
  const t = useT();
  const { lang } = useI18n();
  const geo = useGeoContext(metadata);
  // Authenticity inputs read once per file: the JPEG tables from the bytes, the flat-pixel share from the pixels.
  const jpeg = useContainerSignals(fileInfo);
  const frame = useFrameStats(fileInfo);
  const [rawData, setRawData] = useState(false);

  const remote = Boolean(geo.coords);
  const accuracyLabel = geo.accuracyMeters != null ? formatDistance(geo.accuracyMeters, lang) : null;

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

  // «When the photo was taken»: the camera clock read together with the place zone and the holidays.
  const timeProfile = useMemo(
    () =>
      buildTimeProfile({
        metadata,
        placeTimezone: remote ? geo.weather.data?.timezone ?? null : null,
        holiday: remote ? geo.holidays.data : null
      }),
    [metadata, remote, geo.weather.data?.timezone, geo.holidays.data]
  );

  // «Device»: maker, marketing name, system, age of the model, camera module, shot counter.
  const deviceProfile = useMemo(
    () => buildDeviceProfile({ metadata, filename: proData?.filename ?? null, resolution: proData?.resolution ?? null }),
    [metadata, proData?.filename, proData?.resolution]
  );

  const proGroups = useMemo(
    () => (rawData && profile ? buildProGroups(profile, metadata, proData, fileInfo, detections, ocrResult, t, { qrCodes, pii, stance }) : []),
    [rawData, profile, metadata, proData, fileInfo, detections, ocrResult, t, qrCodes, pii, stance]
  );

  const sectionsByKind = useMemo(() => {
    const map = new Map<ProfileSectionKind, ProfileSection>();
    profile?.sections.forEach((section) => map.set(section.kind, section));
    return map;
  }, [profile]);

  /* ── per-fact details ─────────────────────────────────── */

  const locationDetails = (
    <LocationDetails
      geo={geo}
      metadata={metadata}
      ocrResult={ocrResult}
      platform={proData?.filename.platform}
      remote={remote}
      accuracyLabel={accuracyLabel}
    />
  );

  const stanceRow = stance ? (
    <StanceFact key="stance" stance={stance} geo={geo} metadata={metadata} remote={remote} accuracyLabel={accuracyLabel} />
  ) : null;

  /*
   * A capture date the file cannot actually hold. The card keeps the row — the tag is there, and
   * that it is broken is itself a finding — but shows the raw characters instead of the moment a
   * `Date` would have rolled them into.
   */
  const dateFault = metadata?.dateFault ?? null;
  const dateFaultDetails = dateFault ? (
    <div className="fy-fact-details">
      <dl className="fy-spec fy-spec--tight">
        <dt>{t('dateFaultRawLabel')}</dt>
        <dd className="fy-mono">{dateFault.raw}</dd>
      </dl>
      <Explainer title={t('dateFaultExplainTitle')}>
        <p>{t(DATE_FAULT_KEYS[dateFault.reason])}</p>
        <p>{t('dateFaultWhyHidden')}</p>
      </Explainer>
    </div>
  ) : null;

  const timeDetails = dateFault
    ? dateFaultDetails
    : timeProfile
    ? <TimeDetails timeProfile={timeProfile} geo={geo} metadata={metadata} remote={remote} />
    : null;

  const textDetails = <TextDetails ocrResult={ocrResult} ocrLoading={ocrLoading} ocrError={ocrError} ocrProgressLabel={ocrProgressLabel} />;

  // «QR-коды»: one row per code, the kind and a masked summary; the raw text stays in the raw data.
  const qrDetails =
    qrCodes.length > 0 ? (
      <dl className="fy-spec fy-spec--tight">
        {qrCodes.map((code, index) => (
          <React.Fragment key={`${code.kind}-${index}`}>
            <dt>{t(QR_KIND_KEYS[code.kind])}</dt>
            <dd>{code.summary || t('emptyValue')}</dd>
          </React.Fragment>
        ))}
      </dl>
    ) : null;

  // «Документы и контакты»: the kind and a masked sample per finding.
  const documentDetails =
    pii.length > 0 ? (
      <dl className="fy-spec fy-spec--tight">
        {pii.map((finding, index) => (
          <React.Fragment key={`${finding.kind}-${index}`}>
            <dt>{t(PII_KIND_KEYS[finding.kind])}</dt>
            <dd className="fy-mono">{finding.sample}</dd>
          </React.Fragment>
        ))}
      </dl>
    ) : null;

  /* ── author, contacts and a place written in words ────── */

  /**
   * Two facts the file carries that nobody checks, because both survive the advice people are
   * actually given. The author block is written by settings rather than by the camera and has
   * nothing to do with geotags; the written place is what is left of the location after the
   * coordinates are gone. Neither is sent anywhere — the values come out of the groups exifr
   * already parsed, and the place text is deliberately never geocoded.
   */
  const authorship = useMemo(() => findAuthorship(metadata?.groups), [metadata?.groups]);
  const writtenPlace = useMemo(() => findWrittenPlace(metadata?.groups), [metadata?.groups]);

  const AUTHOR_LABELS: Record<AuthorshipKind, 'authorPersonLabel' | 'authorContactLabel' | 'authorRightsLabel'> = {
    person: 'authorPersonLabel',
    contact: 'authorContactLabel',
    rights: 'authorRightsLabel'
  };

  const authorCard = authorship ? (
    <FactRow
      key="author"
      title={t('authorTitle')}
      // A name or a way to reach someone identifies a person; a licence line on its own does not.
      severity={authorship.people.length > 0 || authorship.contacts.length > 0 ? 'high' : 'low'}
      value={authorship.people.join(', ') || null}
      sub={null}
    >
      <dl className="fy-spec fy-spec--tight">
        {authorship.findings.map((finding) => (
          <React.Fragment key={`${finding.tag}-${finding.value}`}>
            <dt>{t(AUTHOR_LABELS[finding.kind])}</dt>
            <dd>
              {finding.value} <span className="fy-mono">{finding.tag}</span>
            </dd>
          </React.Fragment>
        ))}
      </dl>
      <Explainer title={t('authorExplainTitle')}>
        <p>{t('authorExplainBody')}</p>
        <p>{t('authorExplainRisk')}</p>
      </Explainer>
    </FactRow>
  ) : null;

  // Only without coordinates: with GPS the location card already answers the question better.
  const writtenPlaceCard =
    writtenPlace && !metadata?.gps ? (
      <FactRow key="written-place" title={t('writtenPlaceTitle')} severity="medium" value={writtenPlace.line} sub={t('writtenPlaceSub')}>
        <dl className="fy-spec fy-spec--tight">
          <dt>{t('writtenPlaceTagsLabel')}</dt>
          <dd className="fy-mono">{writtenPlace.tags.join(', ')}</dd>
        </dl>
        <Explainer title={t('writtenPlaceExplainTitle')}>
          <p>{t('writtenPlaceExplainBody')}</p>
          <p>{t('writtenPlaceNotGeocoded')}</p>
        </Explainer>
      </FactRow>
    ) : null;

  /* ── fact order ───────────────────────────────────────── */

  const renderFact = (kind: ProfileSectionKind) => {
    const section = sectionsByKind.get(kind);
    if (!section) {
      // Text is worth a row even before the profile knows about it (OCR is still running).
      if (kind === 'text' && (ocrLoading || ocrError)) {
        return (
          <FactRow key={kind} title={t('ocrTitle')} severity="low" value={null} sub={null}>
            {textDetails}
          </FactRow>
        );
      }
      return null;
    }
    // Device, AI, editing, origin and content are not in FACT_ORDER: they render inside the «Откуда файл» card.
    const details =
      kind === 'location'
        ? locationDetails
        : kind === 'qr'
        ? qrDetails
        : kind === 'documents'
        ? documentDetails
        : kind === 'time'
        ? timeDetails
        : kind === 'text'
        ? textDetails
        : null;
    // Time: age, date, weekday, day kind, time of day and the clock make the headline; the rows place it.
    const shotDate =
      kind === 'time' ? (dateFault ? t('dateFaultHeadline') : timeProfile ? timeHeadline(timeProfile, lang, t) : null) : null;
    const value = kind === 'location' ? null : shotDate ?? section.text;
    const sub = kind === 'location' || shotDate ? null : section.subtext;
    return (
      <FactRow key={kind} title={section.title} severity={section.severity} value={value} sub={sub}>
        {details}
      </FactRow>
    );
  };

  return (
    <section className="v4-section" aria-labelledby="sec-story">
      <SectionHead num="02" title={t('factsTitle')} id="sec-story" />

      {!profile ? (
        <p className="fy-hint" role="status">
          {t('factsPending')}
        </p>
      ) : null}

      <div className="fy-facts">
        {FACT_ORDER.map((kind) => (kind === 'location' ? [renderFact(kind), writtenPlaceCard, stanceRow] : renderFact(kind)))}
        {authorCard}
        {profile ? (
          <OriginCard
            sectionsByKind={sectionsByKind}
            device={deviceProfile}
            fileInfo={fileInfo}
            metadata={metadata}
            proData={proData}
            credentials={credentials}
            jpeg={jpeg}
            frame={frame}
            stance={stance}
            timeProfile={timeProfile}
          />
        ) : null}
        {profile ? <FrameChecksCard fileInfo={fileInfo} jpeg={jpeg} /> : null}
      </div>

      {profile ? (
        <div className="fy-raw">
          <button type="button" className="v4-btn fy-btn-sm" aria-expanded={rawData} aria-controls="raw-data" onClick={() => setRawData((v) => !v)}>
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

export const StoryBlock = React.memo(StoryBlockInner);
StoryBlock.displayName = 'StoryBlock';
