import React, { useMemo } from 'react';
import type { BasicFileInfo, StructuredMetadata } from '../../types/metadata';
import type { ProData } from '../../App';
import type { ProfileSection, ProfileSectionKind } from '../../utils/heuristics/digitalProfile';
import { ORIGIN_KINDS } from '../../utils/heuristics/digitalProfile';
import type { ContentCredentialsState } from '../../hooks/useContentCredentials';
import type { DeviceProfile } from '../../utils/deviceProfile';
import { buildFileHistory, type FileEvent } from '../../utils/fileHistory';
import { countMetadataFields } from '../../utils/metadataFields';
import { describeFileType, formatBytes, formatCompactDate, formatDetailedDate, formatDimensions, formatMegapixels } from '../../utils/format';
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

/**
 * «Откуда файл»: the device rows, the file history (the events derived from tags and bytes,
 * in the order they happened, with the embedded thumbnail) and the authenticity rows (AI,
 * serial numbers, Content Credentials) in one card.
 */
export const OriginCard: React.FC<OriginCardProps> = ({ sectionsByKind, device, fileInfo, metadata, proData, credentials }) => {
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
  const metadataFieldCount = useMemo(() => countMetadataFields(metadata), [metadata]);

  const parts = Array.from(ORIGIN_KINDS)
    .map((kind) => sectionsByKind.get(kind))
    .filter((section): section is ProfileSection => Boolean(section));
  if (parts.length === 0) return null;

  const severity = parts.some((p) => p.severity === 'high') ? 'high' : parts.some((p) => p.severity === 'medium') ? 'medium' : 'low';
  const ai = sectionsByKind.get('ai');
  const serial = sectionsByKind.get('serial');
  const headline = device ? [device.make, device.model].filter(Boolean).join(' ') : sectionsByKind.get('origin')?.text ?? null;
  const { format } = describeFileType(fileInfo.originalMimeType ?? fileInfo.mimeType, fileInfo.originalName ?? fileInfo.file.name);
  const fileLine = t('historyFile', {
    name: fileInfo.originalName ?? fileInfo.file.name,
    format,
    size: formatBytes(fileInfo.originalSizeBytes ?? fileInfo.sizeBytes, lang),
    mp: formatMegapixels(fileInfo.width, fileInfo.height, lang)
  });

  const eventText = (event: FileEvent): { text: string; why?: string } => {
    switch (event.kind) {
      case 'shot':
        return { text: event.agent ? t('historyShot', { device: event.agent }) : t('historyShotUnknownDevice') };
      case 'modified':
        return { text: event.agent ? t('historyModifiedWith', { software: event.agent }) : t('historyModified') };
      case 'resized':
        return {
          text: t('historyResized', {
            from: formatDimensions(event.from?.width ?? 0, event.from?.height ?? 0),
            to: formatDimensions(event.to?.width ?? 0, event.to?.height ?? 0)
          })
        };
      case 'messenger':
        return { text: t('historyMessenger', { platform: event.agent ?? '' }), why: event.evidence ?? undefined };
      case 'stripped':
        return { text: t('historyStripped'), why: event.evidence ?? undefined };
      case 'signed':
        return { text: t('historySigned', { signer: event.agent ?? 'C2PA' }) };
      case 'ai':
        return { text: t('historyAi', { tool: event.agent ?? 'AI' }) };
      case 'disk':
        return { text: t('historyDisk') };
      case 'thumbnail':
        return {
          text: event.same == null ? t('historyThumbUnknown') : event.same ? t('historyThumbSame') : t('historyThumbDiffers'),
          why: metadata?.thumbnail ? t('historyThumbWhy', { w: metadata.thumbnail.width, h: metadata.thumbnail.height }) : undefined
        };
      default:
        return { text: '' };
    }
  };

  return (
    <FactRow title={t('factOriginTitle')} severity={severity} value={headline} sub={null} soWhat={t('originSoWhat')}>
      <div className="fy-fact-details fy-origin">
        {device ? (
          <>
            <h4 className="v4-h3">{t('deviceSubTitle')}</h4>
            <DeviceRows device={device} metadata={metadata} />
          </>
        ) : null}
        <h4 className="v4-h3">{t('historyTitle')}</h4>
        <ol className="fy-timeline">
          <li>
            <span className="fy-timeline-when">{t('factFile')}</span>
            <span className="fy-timeline-body">
              <span>{fileLine}</span>
              <span className="fy-muted">
                {metadataFieldCount ? t('historyFields', { count: new Intl.NumberFormat(lang).format(metadataFieldCount) }) : t('metadataFieldsLabel') + ': 0'}
              </span>
            </span>
          </li>
          {history.map((event, index) => {
            const { text, why } = eventText(event);
            const when = event.at ? formatCompactDate(event.at, lang) ?? event.at : t('historyWhenUnknown');
            const thumb = event.kind === 'thumbnail' ? metadata?.thumbnail : null;
            return (
              <li key={`${event.kind}-${index}`}>
                <span className="fy-timeline-when">{when}</span>
                <span className="fy-timeline-body">
                  {thumb ? (
                    <span className="fy-timeline-thumb">
                      <img src={thumb.url} alt="" width={96} />
                      <span>{text}</span>
                    </span>
                  ) : (
                    <span>{text}</span>
                  )}
                  {why ? <span className="fy-muted">{why}</span> : null}
                </span>
              </li>
            );
          })}
          {history.every((event) => event.kind === 'shot') ? (
            <li>
              <span className="fy-timeline-when">{t('historyWhenUnknown')}</span>
              <span className="fy-timeline-body">{t('historyNone')}</span>
            </li>
          ) : null}
        </ol>
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
