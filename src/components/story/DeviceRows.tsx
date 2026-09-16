import React from 'react';
import type { StructuredMetadata } from '../../types/metadata';
import type { DeviceProfile } from '../../utils/deviceProfile';
import { mccCountry } from '../../utils/samsungTrailer';
import { formatBytes, formatMonthYear, formatMonthsAge, formatUptime, regionName } from '../../utils/format';
import { useI18n, useT } from '../../i18n';
import { CAMERA_MODULE_KEYS, CAPTURE_TYPE_KEYS, DEVICE_SOURCE_KEYS } from './storyKeys';

interface DeviceRowsProps {
  device: DeviceProfile;
  metadata: StructuredMetadata | null;
}

/** «f/1.78»: at most two decimals, a dot as in photographic notation. */
function formatAperture(aperture: number): string {
  return `f/${Number(aperture.toFixed(2))}`;
}

/**
 * Device rows of the «На что сделан снимок» card, under the headline that already names the
 * device and its system: maker, model, firmware build (Samsung), launch date and age of the
 * model, camera module, shot counter, then what the Apple MakerNote and the Samsung trailer
 * add (uptime, Live Photo, burst, capture mode; SIM country, Motion Photo). The source row
 * appears only when the device is a guess from the file name or the resolution.
 */
export const DeviceRows: React.FC<DeviceRowsProps> = ({ device: d, metadata }) => {
  const t = useT();
  const { lang } = useI18n();
  const rows: Array<[string, React.ReactNode]> = [];
  if (d.make) rows.push([t('deviceMake'), d.make]);
  rows.push([
    t('deviceModel'),
    <>
      <span>{d.model}</span>
      {d.modelCode ? <span className="fy-muted fy-mono">{t('deviceModelCode', { code: d.modelCode })}</span> : null}
    </>
  ]);
  if (d.firmware) {
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
        {d.ageAtShotMonths != null ? <span className="fy-muted">{t('deviceAgeAtShot', { age: formatMonthsAge(d.ageAtShotMonths, t) })}</span> : null}
        {d.ageNowMonths != null && d.ageNowMonths !== d.ageAtShotMonths ? (
          <span className="fy-muted">{t('deviceAgeNow', { age: formatMonthsAge(d.ageNowMonths, t) })}</span>
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
    if (d.camera.aperture) parts.push(t('cameraAperture', { f: formatAperture(d.camera.aperture) }));
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
  // Apple MakerNote: what the iPhone wrote about itself and the shot.
  const apple = metadata?.apple;
  if (apple) {
    if (apple.uptimeSeconds != null) {
      rows.push([
        t('deviceUptime'),
        <>
          <span>{formatUptime(apple.uptimeSeconds, t)}</span>
          <span className="fy-muted">{t('deviceUptimeHint')}</span>
        </>
      ]);
    }
    rows.push([t('deviceLivePhoto'), apple.livePhoto ? t('deviceLivePhotoYes') : t('answerNo')]);
    if (apple.burst) rows.push([t('deviceBurst'), t('answerYes')]);
    if (apple.captureType || apple.hdr) {
      const mode = [apple.captureType ? t(CAPTURE_TYPE_KEYS[apple.captureType]) : null, apple.hdr ? t('captureHdr') : null].filter(Boolean);
      rows.push([t('deviceCaptureMode'), mode.join(', ')]);
    }
  }
  // Samsung trailer after the end of the image: SIM country, hidden video.
  const samsung = metadata?.samsung;
  if (samsung) {
    if (samsung.mcc) {
      const country = mccCountry(samsung.mcc);
      rows.push([
        t('deviceSim'),
        <>
          <span>{country ? t('deviceSimCountry', { country: regionName(country, lang), mcc: samsung.mcc }) : t('deviceSimUnknown', { mcc: samsung.mcc })}</span>
          <span className="fy-muted">{t('deviceSimHint')}</span>
        </>
      ]);
    }
    if (samsung.motionPhotoBytes != null) {
      rows.push([t('deviceMotionPhoto'), t('deviceMotionPhotoYes', { size: formatBytes(samsung.motionPhotoBytes, lang) })]);
    }
    rows.push([
      t('deviceTrailer'),
      t('deviceTrailerValue', { size: formatBytes(samsung.bytes, lang), blocks: samsung.blocks.map((b) => b.name).join(', ') })
    ]);
  }
  if (d.source !== 'exif') rows.push([t('deviceSource'), t(DEVICE_SOURCE_KEYS[d.source])]);
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
};
