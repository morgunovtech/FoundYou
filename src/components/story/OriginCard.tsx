import React, { useMemo } from 'react';
import type { BasicFileInfo, StructuredMetadata } from '../../types/metadata';
import type { ProData } from '../../App';
import type { ProfileSection, ProfileSectionKind } from '../../utils/heuristics/digitalProfile';
import { ORIGIN_KINDS } from '../../utils/heuristics/digitalProfile';
import type { ContentCredentialsState } from '../../hooks/useContentCredentials';
import type { DeviceProfile } from '../../utils/deviceProfile';
import { buildFileHistory, type FileEvent } from '../../utils/fileHistory';
import { formatCompactDate, formatDetailedDate, formatDimensions, formatSecondsDuration } from '../../utils/format';
import { DRIFT_SUSPICIOUS_SECONDS, type TimeProfile } from '../../utils/timeProfile';
import type { Stance } from '../../utils/stance';
import type { JpegSignals } from '../../utils/jpegQuant';
import { judgeCompression } from '../../utils/jpegQuant';
import type { FrameStats } from '../../hooks/useFrameStats';
import { checkLight } from '../../utils/lightCheck';
import { checkTimestamps } from '../../utils/timestampConsistency';
import { scoreScreenshot } from '../../utils/screenshot';
import { wallClockOf } from '../../utils/fileHistory';
import { COMPRESSION_KEYS, LIGHT_KEYS, SCREENSHOT_LEVEL_KEYS, SCREENSHOT_REASON_KEYS, TIMESTAMP_ISSUE_KEYS } from './storyKeys';
import { useI18n, useT } from '../../i18n';
import { matchMessengerSize } from '../../utils/messengerFootprint';
import { FactRow } from './FactRow';
import { DeviceRows } from './DeviceRows';

interface OriginCardProps {
  sectionsByKind: Map<ProfileSectionKind, ProfileSection>;
  device: DeviceProfile | null;
  fileInfo: BasicFileInfo;
  metadata: StructuredMetadata | null;
  proData: ProData | null;
  credentials: ContentCredentialsState;
  /** JPEG quantization tables and subsampling of the original file; null for other containers. */
  jpeg: JpegSignals | null;
  /** Pixel statistics (flat interface colours) for the screenshot score. */
  frame: FrameStats | null;
  /** The shot geometry, for the sun's height at the moment of capture. */
  stance: Stance | null;
  /** The camera and place zones and the GPS drift. */
  timeProfile: TimeProfile | null;
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
 * authenticity rows in one card: AI markers (with the model and the prompt a generator left in
 * a PNG), the screenshot score, the JPEG quantization tables against the camera in EXIF, the
 * exposure against the sun, the timestamps against each other, the Live / Motion Photo as a
 * sign of an untouched original, serial numbers and Content Credentials.
 */
export const OriginCard: React.FC<OriginCardProps> = ({ sectionsByKind, device, fileInfo, metadata, proData, credentials, jpeg, frame, stance, timeProfile }) => {
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
  const exif = metadata?.groups.exif ?? {};
  const xmp = metadata?.groups.xmp ?? {};
  const aiDetails = proData?.editing.aiDetails ?? null;
  const aiDetailLine = aiDetails
    ? [
        aiDetails.model ? t('aiModel', { model: aiDetails.model }) : null,
        aiDetails.prompt ? t('aiPrompt', { prompt: aiDetails.prompt }) : null,
        t('aiChunk', { chunk: aiDetails.chunk })
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  // Authenticity signals, each a pure check over what the file and the lookups already gave us.
  const screenshot = proData
    ? scoreScreenshot({
        filenameScreenshot: proData.filename.isScreenshot,
        knownScreenSize: proData.resolution.isScreenshot,
        hasCameraExif: Boolean(metadata?.cameraMake || metadata?.cameraModel),
        hasShotDate: Boolean(metadata?.shotDateLocal),
        mimeType: fileInfo.originalMimeType ?? fileInfo.mimeType,
        flatRatio: frame?.flatRatio ?? null
      })
    : null;
  const compression = jpeg ? judgeCompression(jpeg, metadata?.cameraMake) : null;
  const flash = exif.Flash;
  const light = stance?.sun
    ? checkLight({
        sunAltitude: stance.sun.altitude,
        exposureSeconds: typeof exif.ExposureTime === 'number' ? exif.ExposureTime : null,
        fNumber: metadata?.aperture ?? null,
        iso: metadata?.iso ?? null,
        flashFired: typeof flash === 'number' ? (flash & 1) === 1 : null
      })
    : null;
  // exifr names EXIF DateTimeDigitized «CreateDate» and the metadata splitter files it under xmp,
  // where a real xmp:CreateDate would land too; the un-merged `xmp.xmp` namespace is XMP for sure.
  const xmpNamespace = xmp.xmp && typeof xmp.xmp === 'object' ? (xmp.xmp as Record<string, unknown>) : null;
  const xmpCreate = xmpNamespace?.CreateDate ?? null;
  const timestamps = checkTimestamps({
    shotLocal: metadata?.shotDateLocal ?? null,
    digitizedLocal: wallClockOf(exif.DateTimeDigitized ?? exif.CreateDate ?? xmp.CreateDate),
    modifyLocal: wallClockOf(exif.ModifyDate),
    xmpCreate: typeof xmpCreate === 'string' ? xmpCreate : wallClockOf(xmpCreate),
    cameraOffsetMinutes: timeProfile?.camera?.offsetMinutes ?? null,
    placeOffsetMinutes: timeProfile?.place?.offsetMinutes ?? null,
    signedAt: credentials.data?.signedAt ?? null,
    lastModified: (fileInfo.originalFile ?? fileInfo.file).lastModified || null
  });
  const originalSign = metadata?.apple?.livePhoto
    ? t('originalLivePhoto')
    : metadata?.samsung?.motionPhotoBytes != null
      ? t('originalMotionPhoto')
      : null;
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
      // A generative patch means the frame was written again after the shutter, whatever the dates say.
      (event.kind === 'ai' && event.scope === 'edited') ||
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
  const driftSeconds = timeProfile?.driftSeconds ?? null;
  const driftNote =
    driftSeconds != null && Math.abs(driftSeconds) >= DRIFT_SUSPICIOUS_SECONDS
      ? t('historyClockDrift', {
          drift:
            driftSeconds > 0
              ? t('driftAhead', { delta: formatSecondsDuration(driftSeconds, t) })
              : t('driftBehind', { delta: formatSecondsDuration(-driftSeconds, t) })
        })
      : null;
  /*
   * The size a service left behind. `strippedDetector` already says «looks like social media
   * re-compression» for anything under 1600 px, which fires on every downscaled photograph and
   * names nobody. Sitting exactly on a known cap is narrower, and it is shown as a hint with
   * every service that shares the number — never one, because 1280 is Telegram's and Viber's
   * alike and the caps change between app versions.
   */
  const messengerSize = matchMessengerSize(fileInfo.width, fileInfo.height);

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
      case 'ai':
        return t('historyAiEdit', { tool: event.agent ?? 'AI' });
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
            {messengerSize ? (
              <span className="fy-muted">
                {t('historyMessengerSize', { size: messengerSize.cap, platforms: messengerSize.platforms.join(', ') })}
              </span>
            ) : null}
          </dd>
        </dl>
        <h4 className="v4-h3">{t('authenticityTitle')}</h4>
        <dl className="fy-spec fy-spec--tight">
          {ai ? (
            <>
              <dt>{ai.title}</dt>
              <dd>
                <span>{ai.text}</span>
                {aiDetailLine ? <span className="fy-muted">{aiDetailLine}</span> : null}
                {ai.subtext ? <span className="fy-muted">{ai.subtext}</span> : null}
              </dd>
            </>
          ) : null}
          {screenshot ? (
            <>
              <dt>{t('screenshotTitle')}</dt>
              <dd>
                <span>{t(SCREENSHOT_LEVEL_KEYS[screenshot.level], { percent: Math.round(screenshot.probability * 100) })}</span>
                {screenshot.reasons.length > 0 ? (
                  <span className="fy-muted">{screenshot.reasons.map((reason) => t(SCREENSHOT_REASON_KEYS[reason])).join(', ')}</span>
                ) : null}
              </dd>
            </>
          ) : null}
          {compression ? (
            <>
              <dt>{t('compressionTitle')}</dt>
              <dd>
                <span>
                  {t(COMPRESSION_KEYS[compression.code], { quality: compression.quality })}
                  {compression.subsampling !== 'unknown' ? `; ${t('compressionSubsampling', { subsampling: compression.subsampling })}` : ''}
                </span>
                {compression.conflict === 'apple-standard' ? <span className="fy-muted">{t('compressionConflictApple')}</span> : null}
                {compression.conflict === 'android-low' ? (
                  <span className="fy-muted">{t('compressionConflictAndroid', { make: device?.make ?? metadata?.cameraMake ?? '', quality: compression.quality })}</span>
                ) : null}
              </dd>
            </>
          ) : null}
          {light && stance?.sun ? (
            <>
              <dt>{t('lightTitle')}</dt>
              <dd>{t(LIGHT_KEYS[light.verdict], { ev: light.ev ?? '', altitude: Math.round(stance.sun.altitude) })}</dd>
            </>
          ) : null}
          {timestamps.checked > 0 ? (
            <>
              <dt>{t('timestampsTitle')}</dt>
              <dd>
                {timestamps.issues.length === 0
                  ? t('timestampsOk', { count: timestamps.checked })
                  : timestamps.issues.map((issue) => t(TIMESTAMP_ISSUE_KEYS[issue])).join('; ')}
              </dd>
            </>
          ) : null}
          {originalSign ? (
            <>
              <dt>{t('originalTitle')}</dt>
              <dd>{originalSign}</dd>
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
      </div>
    </FactRow>
  );
};
