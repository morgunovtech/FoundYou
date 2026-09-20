import type { MessageKey } from '../../i18n';
import type { CompassPoint, ElevationVerdict, InstantSource, RelativeDirection, SunPhase } from '../../utils/stance';
import type { AgeKind, DayKind, TimeOfDay } from '../../utils/timeProfile';
import type { CameraModule, DeviceSource } from '../../utils/deviceProfile';
import type { SceneMatchKind } from '../../utils/sceneText';
import type { QrKind } from '../../utils/qr';
import type { PiiKind } from '../../utils/pii';
import type { AppleCaptureType } from '../../utils/appleMakerNote';
import type { ScreenshotLevel, ScreenshotReason } from '../../utils/screenshot';
import type { CompressionCode } from '../../utils/jpegQuant';
import type { LightVerdict } from '../../utils/lightCheck';
import type { DateFaultReason } from '../../utils/exifDateSanity';
import type { TimestampIssue } from '../../utils/timestampConsistency';
import type { FrameCheckStep } from '../../utils/frameChecks';

/*
 * Machine codes from the pure utilities → dictionary keys. The utilities never
 * produce translated strings; the cards map their codes through these tables.
 */

export const COMPASS_KEYS: Record<CompassPoint, MessageKey> = {
  N: 'compassN',
  NE: 'compassNE',
  E: 'compassE',
  SE: 'compassSE',
  S: 'compassS',
  SW: 'compassSW',
  W: 'compassW',
  NW: 'compassNW'
};

export const SUN_RELATIVE_KEYS: Record<RelativeDirection, MessageKey> = {
  front: 'stanceSunFront',
  right: 'stanceSunRight',
  behind: 'stanceSunBehind',
  left: 'stanceSunLeft'
};

export const SUN_PHASE_KEYS: Record<Exclude<SunPhase, 'night'>, MessageKey> = {
  twilight: 'stancePhaseTwilight',
  low: 'stancePhaseLow',
  day: 'stancePhaseDay'
};

export const TIME_SOURCE_KEYS: Record<InstantSource, MessageKey> = {
  'exif-offset': 'stanceTimeExif',
  'gps-time': 'stanceTimeGps',
  'place-zone': 'stanceTimePlace',
  longitude: 'stanceTimeLongitude'
};

export const TERRAIN_KEYS: Record<ElevationVerdict, MessageKey> = {
  ground: 'stanceTerrainGround',
  above: 'stanceTerrainAbove',
  high: 'stanceTerrainHigh',
  below: 'stanceTerrainBelow'
};

export const TIME_OF_DAY_KEYS: Record<TimeOfDay, MessageKey> = {
  night: 'todNight',
  earlyMorning: 'todEarlyMorning',
  morning: 'todMorning',
  lunch: 'todLunch',
  afternoon: 'todAfternoon',
  evening: 'todEvening',
  lateEvening: 'todLateEvening'
};

export const DAY_KIND_KEYS: Record<DayKind, MessageKey> = { weekend: 'dayWeekend', weekday: 'dayWeekday', holiday: 'dayHoliday' };

export const AGE_KEYS: Record<AgeKind, MessageKey> = {
  future: 'ageFuture',
  fresh: 'ageFresh',
  days: 'ageDays',
  months: 'ageMonths',
  years: 'ageYears'
};

export const CAMERA_MODULE_KEYS: Record<CameraModule, MessageKey> = {
  main: 'cameraModuleMain',
  ultrawide: 'cameraModuleUltrawide',
  tele: 'cameraModuleTele'
};

export const DEVICE_SOURCE_KEYS: Record<DeviceSource, MessageKey> = {
  exif: 'deviceSourceExif',
  filename: 'deviceSourceFilename',
  resolution: 'deviceSourceResolution'
};

export const SCENE_MATCH_KEYS: Record<SceneMatchKind, MessageKey> = {
  road: 'sceneMatchRoad',
  place: 'sceneMatchPlace',
  poi: 'sceneMatchPoi',
  house: 'sceneMatchHouse'
};

export const QR_KIND_KEYS: Record<QrKind, MessageKey> = {
  wifi: 'qrKind_wifi',
  contact: 'qrKind_contact',
  boarding: 'qrKind_boarding',
  payment: 'qrKind_payment',
  url: 'qrKind_url',
  phone: 'qrKind_phone',
  email: 'qrKind_email',
  sms: 'qrKind_sms',
  geo: 'qrKind_geo',
  text: 'qrKind_text'
};

export const PII_KIND_KEYS: Record<PiiKind, MessageKey> = {
  card: 'piiKind_card',
  iban: 'piiKind_iban',
  mrz: 'piiKind_mrz',
  phone: 'piiKind_phone',
  email: 'piiKind_email',
  handle: 'piiKind_handle',
  document: 'piiKind_document'
};

export const CAPTURE_TYPE_KEYS: Record<AppleCaptureType, MessageKey> = {
  proraw: 'captureProraw',
  portrait: 'capturePortrait',
  photo: 'capturePhoto',
  'manual-focus': 'captureManualFocus',
  scene: 'captureScene'
};

export type Severity = 'low' | 'medium' | 'high';

export const SEVERITY_KEYS: Record<Severity, MessageKey> = {
  low: 'severityLow',
  medium: 'severityMedium',
  high: 'severityHigh'
};

export const SCREENSHOT_LEVEL_KEYS: Record<ScreenshotLevel, MessageKey> = {
  unlikely: 'screenshotUnlikely',
  possible: 'screenshotPossible',
  likely: 'screenshotLikely',
  certain: 'screenshotCertain'
};

export const SCREENSHOT_REASON_KEYS: Record<ScreenshotReason, MessageKey> = {
  filename: 'screenshotReasonFilename',
  'screen-size': 'screenshotReasonScreenSize',
  'no-camera-exif': 'screenshotReasonNoCameraExif',
  png: 'screenshotReasonPng',
  'flat-pixels': 'screenshotReasonFlatPixels',
  'camera-exif': 'screenshotReasonCameraExif',
  'photo-pixels': 'screenshotReasonPhotoPixels'
};

export const COMPRESSION_KEYS: Record<CompressionCode, MessageKey> = {
  'standard-high': 'compressionStandardHigh',
  'standard-medium': 'compressionStandardMedium',
  'standard-low': 'compressionStandardLow',
  custom: 'compressionCustom'
};

export const LIGHT_KEYS: Record<LightVerdict, MessageKey> = {
  consistent: 'lightConsistent',
  'night-daylight-exposure': 'lightNightDaylight',
  'day-dark-exposure': 'lightDayDark',
  'no-exposure': 'lightNoExposure'
};

export const TIMESTAMP_ISSUE_KEYS: Record<TimestampIssue, MessageKey> = {
  'digitized-differs': 'timestampDigitized',
  'xmp-create-differs': 'timestampXmp',
  'modify-before-shot': 'timestampModifyBefore',
  'zone-differs': 'timestampZone',
  'signed-before-shot': 'timestampSigned',
  'disk-before-shot': 'timestampDisk'
};

export const FRAME_STEP_KEYS: Record<FrameCheckStep, MessageKey> = {
  decode: 'frameStepDecode',
  ela: 'frameStepEla',
  ghosts: 'frameStepGhosts',
  noise: 'frameStepNoise'
};

/** Why the capture-date tag is not a date. */
export const DATE_FAULT_KEYS: Record<DateFaultReason, MessageKey> = {
  'out-of-range': 'dateFaultOutOfRange',
  placeholder: 'dateFaultPlaceholder',
  unparsable: 'dateFaultUnparsable'
};
