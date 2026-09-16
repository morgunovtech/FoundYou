import React, { useMemo } from 'react';
import type { BasicFileInfo, StructuredMetadata } from '../../types/metadata';
import type { ProData } from '../../App';
import type { ProfileSection, ProfileSectionKind } from '../../utils/heuristics/digitalProfile';
import { ORIGIN_KINDS } from '../../utils/heuristics/digitalProfile';
import type { ContentCredentialsState } from '../../hooks/useContentCredentials';
import type { DeviceProfile } from '../../utils/deviceProfile';
import { buildFileHistory, type FileEvent } from '../../utils/fileHistory';
import { formatCompactDate, formatDetailedDate, formatDimensions, formatSecondsDuration } from '../../utils/format';
import { DRIFT_SUSPICIOUS_SECONDS } from '../../utils/timeProfile';
import { useI18n, useT } from '../../i18n';
import { FactRow } from './FactRow';
import { DeviceRows } from './DeviceRows';

interface OriginCardProps {
  sectionsByKind: Map<ProfileSectionKind, ProfileSection>;
  device: DeviceProfile | null;
  fileInfo: BasicFileInfo;
  metadata: StructuredMetadata | null;
  proData: ProData | null;
  credentials: ContentCredentialsState;
  /** Camera clock minus GPS time, seconds (`TimeProfile.driftSeconds`); null without a GPS stamp. */
  driftSeconds: number | null;
}

/** Content Credentials, when the file carries them: who signed, with what, and whether it held. */
const CredentialsDetails: React.FC<{ credentials: ContentCredentialsState }> = ({ credentials }) => {
  const t = useT();
  const { lang } = useI18n();
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
};

const withEvidence = (text: string, evidence: string | null | undefined) => (evidence ? `${text} (${evidence})` : text);

/**
 * «На что сделан снимок»: the device and its system in the headline, the device rows, the
 * file history as two dates (created from the camera clock, with the clock drift against the GPS
 * stamp under it when it exceeds a minute; edited from ModifyDate / Software,
 * «not edited» when nothing points to a later save, otherwise the signs: a smaller picture
 * than the camera wrote, a messenger re-encode, an embedded thumbnail that differs) and the
 * authenticity rows (AI, serial numbers, Content Credentials) in one card.
 */
export const OriginCard: React.FC<OriginCardProps> = ({ sectionsByKind, device, fileInfo, metadata, proData, credentials, driftSeconds }) => {
  const t = useT();
  const { lang } = useI18n();

  const history = useMemo(
    () =>
      buildFileHistory({
        metadata,
        editing: proData?.editing ?? null,
        stripped: proData?.stripped ?? null,
        credentials: credentials.data ?? null,
        lastModified: (fileInfo.originalFile ?? fileInfo.file).lastModified || null,
        width: fileInfo.originalWidth ?? fileInfo.width,
        height: fileInfo.originalHeight ?? fileInfo.height,
        phash: proData?.hash?.phash ?? null
      }),
    [metadata, proData, credentials.data, fileInfo]
  );

  const parts = Array.from(ORIGIN_KINDS)
    .map((kind) => sectionsByKind.get(kind))
    .filter((section): section is ProfileSection => Boolean(section));
  if (parts.length === 0) return null;

  const severity = parts.some((p) => p.severity === 'high') ? 'high' : parts.some((p) => p.severity === 'medium') ? 'medium' : 'low';
  const ai = sectionsByKind.get('ai');
  const serial = sectionsByKind.get('serial');
  const headline = device
    ? [[device.make, device.model].filter(Boolean).join(' '), device.os ? `${device.os.name} ${device.os.version}` : null]
        .filter(Boolean)
        .join(', ')
    : sectionsByKind.get('origin')?.text ?? null;

  // Two dates and the evidence: the camera clock, then ModifyDate / Software or the signs of a
  // later save (smaller than the camera wrote, a messenger re-encode, a thumbnail that differs).
  const shot = history.find((event) => event.kind === 'shot') ?? null;
  const modified = history.find((event) => event.kind === 'modified') ?? null;
  const signs = history.filter(
    (event) =>
      event.kind === 'resized' ||
      event.kind === 'messenger' ||
      event.kind === 'stripped' ||
      (event.kind === 'thumbnail' && event.same === false)
  );
  const createdText = shot?.at ? formatCompactDate(shot.at, lang) ?? shot.at : t('historyDateUnknown');
  const editedText = modified?.at
    ? formatCompactDate(modified.at, lang) ?? modified.at
    : modified || signs.length > 0
    ? t('historyDateUnknown')
    : t('historyNotEdited');
  const editedNote = modified?.agent ? t('historyModifiedWith', { software: modified.agent }) : null;
  // A clock a minute or more off the GPS stamp was set by hand or edited; seconds are noise.
  const driftNote =
    driftSeconds != null && Math.abs(driftSeconds) >= DRIFT_SUSPICIOUS_SECONDS
      ? t('historyClockDrift', {
          drift:
            driftSeconds > 0
              ? t('driftAhead', { delta: formatSecondsDuration(driftSeconds, t) })
              : t('driftBehind', { delta: formatSecondsDuration(-driftSeconds, t) })
        })
      : null;
  const signText = (event: FileEvent): string => {
    switch (event.kind) {
      case 'resized':
        return t('historyResized', {
          from: formatDimensions(event.from?.width ?? 0, event.from?.height ?? 0),
          to: formatDimensions(event.to?.width ?? 0, event.to?.height ?? 0)
        });
      case 'messenger':
        return withEvidence(t('historyMessenger', { platform: event.agent ?? '' }), event.evidence);
      case 'stripped':
        return withEvidence(t('historyStripped'), event.evidence);
      case 'thumbnail':
        return metadata?.thumbnail
          ? `${t('historyThumbDiffers')}. ${t('historyThumbWhy', { w: metadata.thumbnail.width, h: metadata.thumbnail.height })}`
          : t('historyThumbDiffers');
      default:
        return '';
    }
  };

  return (
    <FactRow title={t('factOriginTitle')} severity={severity} value={headline} sub={null}>
      <div className="fy-fact-details fy-origin">
        {device ? <DeviceRows device={device} metadata={metadata} /> : null}
        <h4 className="v4-h3">{t('historyTitle')}</h4>
        <dl className="fy-spec fy-spec--tight">
          <dt>{t('historyCreated')}</dt>
          <dd>
            <span>{createdText}</span>
            {driftNote ? <span className="fy-muted">{driftNote}</span> : null}
          </dd>
          <dt>{t('historyEdited')}</dt>
          <dd>
            <span>{editedText}</span>
            {editedNote ? <span className="fy-muted">{editedNote}</span> : null}
            {signs.map((event, index) => (
              <span key={`${event.kind}-${index}`} className="fy-history-sign">
                {event.kind === 'thumbnail' && metadata?.thumbnail ? <img src={metadata.thumbnail.url} alt="" width={96} /> : null}
                <span className="fy-muted">{signText(event)}</span>
              </span>
            ))}
          </dd>
        </dl>
        {ai || serial ? (
          <>
            <h4 className="v4-h3">{t('authenticityTitle')}</h4>
            <dl className="fy-spec fy-spec--tight">
              {ai ? (
                <>
                  <dt>{ai.title}</dt>
                  <dd>
                    <span>{ai.text}</span>
                    {ai.subtext ? <span className="fy-muted">{ai.subtext}</span> : null}
                  </dd>
                </>
              ) : null}
              {serial ? (
                <>
                  <dt>{serial.title}</dt>
                  <dd className="fy-mono">{serial.text}</dd>
                </>
              ) : null}
            </dl>
            <CredentialsDetails credentials={credentials} />
          </>
        ) : null}
      </div>
    </FactRow>
  );
};
