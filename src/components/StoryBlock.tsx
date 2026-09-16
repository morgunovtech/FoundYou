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
import { formatDetailedDate } from '../utils/format';
import { SectionHead } from './SectionHead';
import { FactRow } from './story/FactRow';
import { ProTable } from './story/ProTable';
import { LocationDetails } from './story/LocationDetails';
import { StanceFact } from './story/StanceFact';
import { TimeDetails } from './story/TimeDetails';
import { TextDetails } from './story/TextDetails';
import { OriginCard } from './story/OriginCard';
import { PII_KIND_KEYS, QR_KIND_KEYS } from './story/storyKeys';

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
  qrCodes: QrCode[];
  pii: PiiFinding[];
}

/** The facts in the order they are shown; the origin card follows them. */
const FACT_ORDER: ProfileSectionKind[] = ['location', 'time', 'people', 'text', 'plates', 'qr', 'documents'];

/**
 * Section 02 — what the photo says about you: one card per fact (location, when it was
 * taken, how it was taken, people, text, plates, QR codes, documents, where the file comes
 * from), each with its data and how an attacker uses it, the «make a safe copy» button and
 * the raw data table behind a plainly named button at the end. Place context is fetched from
 * our own Functions with rounded coordinates only; the user can switch it off here. The
 * picture itself is section 01 (SceneBlock). The cards live in `./story/`.
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
  qrCodes,
  pii
}) => {
  const t = useT();
  const { lang } = useI18n();
  const geo = useGeoContext(metadata);
  const [rawData, setRawData] = useState(false);

  const remote = geo.enabled && Boolean(geo.coords);
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

  const timeDetails = timeProfile ? <TimeDetails timeProfile={timeProfile} geo={geo} metadata={metadata} remote={remote} /> : null;

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

  /* ── fact order ───────────────────────────────────────── */

  const renderFact = (kind: ProfileSectionKind) => {
    const section = sectionsByKind.get(kind);
    if (!section) {
      // Text is worth a row even before the profile knows about it (OCR is still running).
      if (kind === 'text' && (ocrLoading || ocrError)) {
        return (
          <FactRow key={kind} title={t('ocrTitle')} severity="low" value={null} sub={null} soWhat={null}>
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
    // Time: the camera wall-clock is the headline, the rows below read it with the place.
    const shotDate = kind === 'time' && timeProfile ? formatDetailedDate(timeProfile.wallClock, lang) ?? null : null;
    const value = kind === 'location' ? null : shotDate ?? section.text;
    const sub = kind === 'location' || shotDate ? null : section.subtext;
    return (
      <FactRow key={kind} title={section.title} severity={section.severity} value={value} sub={sub} soWhat={section.threatScenario}>
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
        {FACT_ORDER.map((kind) => (kind === 'location' ? [renderFact(kind), stanceRow] : renderFact(kind)))}
        {profile ? (
          <OriginCard
            sectionsByKind={sectionsByKind}
            device={deviceProfile}
            fileInfo={fileInfo}
            metadata={metadata}
            proData={proData}
            credentials={credentials}
          />
        ) : null}
      </div>

      {profile ? (
        <div className="fy-actions fy-facts-cta">
          <button type="button" className="v4-btn v4-btn-primary" onClick={onMakeSafeCopy}>
            {t('safeCopyCta')}
          </button>
        </div>
      ) : null}

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
