import type { MessageKey } from '../../i18n';
import type { CompassPoint, ElevationVerdict, InstantSource, RelativeDirection, SunPhase } from '../../utils/stance';
import type { AgeKind, DayKind, TimeOfDay } from '../../utils/timeProfile';
import type { CameraModule, DeviceSource } from '../../utils/deviceProfile';
import type { SceneMatchKind } from '../../utils/sceneText';
import type { QrKind } from '../../utils/qr';
import type { PiiKind } from '../../utils/pii';
import type { AppleCaptureType } from '../../utils/appleMakerNote';

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
