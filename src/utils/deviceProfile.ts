import type { StructuredMetadata } from '../types/metadata';
import type { FilenameAnalysis } from './heuristics/filenameAnalyzer';
import type { ResolutionAnalysis } from './heuristics/resolutionAnalyzer';
import { cameraSide, type CameraSide } from './stance';

/*
 * «Device»: what the camera tags say about the phone itself — maker, marketing
 * name, system version, how old the model was when the photo was taken, which
 * camera module fired, and how many shots the counter had seen. Pure functions
 * over EXIF plus the filename/resolution guesses; the component maps the result
 * to text. Release dates are a static table: only the launch month, only for
 * lines whose codes are unambiguous. Nothing here needs the network.
 */

export type DeviceSource = 'exif' | 'filename' | 'resolution';
export type OsName = 'iOS' | 'iPadOS' | 'Android';
export type CameraModule = 'main' | 'ultrawide' | 'tele';

export interface DeviceProfile {
  source: DeviceSource;
  /** Display name of the maker («Apple», «Samsung»); null when only a guess names the device. */
  make: string | null;
  /** Marketing name when it can be told («Galaxy S23 Ultra»), otherwise the raw model tag. */
  model: string;
  /** The raw model code when it differs from the marketing name («SM-S918B»). */
  modelCode: string | null;
  os: {
    name: OsName;
    version: string;
    major: number;
    /** `YYYY-MM` the major version shipped, when the table knows it. */
    familyReleased: string | null;
    /** Newest major that had shipped a full month before the shot, when it is newer than this one. */
    newerAtShot: { name: OsName; major: number } | null;
  } | null;
  /** A firmware build string (Samsung, Huawei) — not an OS version, not an editor. */
  firmware: { build: string; built: string | null } | null;
  /** `YYYY-MM` the model launched, when the table knows it. */
  released: string | null;
  ageAtShotMonths: number | null;
  ageNowMonths: number | null;
  camera: {
    side: CameraSide;
    module: CameraModule | null;
    focalLength35mm: number | null;
    aperture: number | null;
  } | null;
  /** The shot counter from `IMG_NNNN`-style names. */
  shotIndex: number | null;
}

/* ── makers ─────────────────────────────────────────────── */

const MAKES: Array<[RegExp, string]> = [
  [/^apple/i, 'Apple'],
  [/^samsung/i, 'Samsung'],
  [/^google/i, 'Google'],
  [/^xiaomi/i, 'Xiaomi'],
  [/^redmi/i, 'Xiaomi'],
  [/^poco/i, 'Xiaomi'],
  [/^huawei/i, 'Huawei'],
  [/^honor/i, 'Honor'],
  [/^oneplus/i, 'OnePlus'],
  [/^oppo/i, 'OPPO'],
  [/^vivo/i, 'vivo'],
  [/^realme/i, 'realme'],
  [/^motorola/i, 'Motorola'],
  [/^nothing/i, 'Nothing'],
  [/^lge?\b/i, 'LG'],
  [/^asus/i, 'ASUS'],
  [/^sony/i, 'Sony'],
  [/^canon/i, 'Canon'],
  [/^nikon/i, 'Nikon'],
  [/^fujifilm/i, 'Fujifilm'],
  [/^olympus|^om digital/i, 'OM System'],
  [/^panasonic/i, 'Panasonic'],
  [/^leica/i, 'Leica'],
  [/^dji/i, 'DJI'],
  [/^gopro/i, 'GoPro']
];

export function displayMake(make: string | null | undefined): string | null {
  const raw = make?.trim();
  if (!raw) return null;
  for (const [pattern, name] of MAKES) {
    if (pattern.test(raw)) return name;
  }
  return raw;
}

/* ── release table ──────────────────────────────────────── */

/** Launch month of each model (first retail availability), keyed by the EXIF Model tag. */
const APPLE_RELEASES: Record<string, string> = {
  'iphone 6': '2014-09',
  'iphone 6 plus': '2014-09',
  'iphone 6s': '2015-09',
  'iphone 6s plus': '2015-09',
  'iphone se': '2016-03',
  'iphone 7': '2016-09',
  'iphone 7 plus': '2016-09',
  'iphone 8': '2017-09',
  'iphone 8 plus': '2017-09',
  'iphone x': '2017-11',
  'iphone xs': '2018-09',
  'iphone xs max': '2018-09',
  'iphone xr': '2018-10',
  'iphone 11': '2019-09',
  'iphone 11 pro': '2019-09',
  'iphone 11 pro max': '2019-09',
  'iphone se (2nd generation)': '2020-04',
  'iphone 12': '2020-10',
  'iphone 12 pro': '2020-10',
  'iphone 12 mini': '2020-11',
  'iphone 12 pro max': '2020-11',
  'iphone 13': '2021-09',
  'iphone 13 mini': '2021-09',
  'iphone 13 pro': '2021-09',
  'iphone 13 pro max': '2021-09',
  'iphone se (3rd generation)': '2022-03',
  'iphone 14': '2022-09',
  'iphone 14 pro': '2022-09',
  'iphone 14 pro max': '2022-09',
  'iphone 14 plus': '2022-10',
  'iphone 15': '2023-09',
  'iphone 15 plus': '2023-09',
  'iphone 15 pro': '2023-09',
  'iphone 15 pro max': '2023-09',
  'iphone 16': '2024-09',
  'iphone 16 plus': '2024-09',
  'iphone 16 pro': '2024-09',
  'iphone 16 pro max': '2024-09',
  'iphone 16e': '2025-02',
  'iphone 17': '2025-09',
  'iphone 17 pro': '2025-09',
  'iphone 17 pro max': '2025-09',
  'iphone air': '2025-09'
};

const PIXEL_RELEASES: Record<string, string> = {
  pixel: '2016-10',
  'pixel xl': '2016-10',
  'pixel 2': '2017-10',
  'pixel 2 xl': '2017-10',
  'pixel 3': '2018-10',
  'pixel 3 xl': '2018-10',
  'pixel 3a': '2019-05',
  'pixel 3a xl': '2019-05',
  'pixel 4': '2019-10',
  'pixel 4 xl': '2019-10',
  'pixel 4a': '2020-08',
  'pixel 4a (5g)': '2020-10',
  'pixel 5': '2020-10',
  'pixel 5a': '2021-08',
  'pixel 6': '2021-10',
  'pixel 6 pro': '2021-10',
  'pixel 6a': '2022-07',
  'pixel 7': '2022-10',
  'pixel 7 pro': '2022-10',
  'pixel 7a': '2023-05',
  'pixel fold': '2023-06',
  'pixel 8': '2023-10',
  'pixel 8 pro': '2023-10',
  'pixel 8a': '2024-05',
  'pixel 9': '2024-08',
  'pixel 9 pro': '2024-08',
  'pixel 9 pro xl': '2024-08',
  'pixel 9 pro fold': '2024-08',
  'pixel 9a': '2025-04',
  'pixel 10': '2025-08',
  'pixel 10 pro': '2025-08',
  'pixel 10 pro xl': '2025-08',
  'pixel 10 pro fold': '2025-10'
};

/** Samsung writes the model code; the marketing name and launch month come from its prefix. */
const SAMSUNG_CODES: Array<[RegExp, string, string]> = [
  [/^SM-G920/, 'Galaxy S6', '2015-04'],
  [/^SM-G925/, 'Galaxy S6 edge', '2015-04'],
  [/^SM-G930/, 'Galaxy S7', '2016-03'],
  [/^SM-G935/, 'Galaxy S7 edge', '2016-03'],
  [/^SM-G950/, 'Galaxy S8', '2017-04'],
  [/^SM-G955/, 'Galaxy S8+', '2017-04'],
  [/^SM-G960/, 'Galaxy S9', '2018-03'],
  [/^SM-G965/, 'Galaxy S9+', '2018-03'],
  [/^SM-G970/, 'Galaxy S10e', '2019-03'],
  [/^SM-G973/, 'Galaxy S10', '2019-03'],
  [/^SM-G975/, 'Galaxy S10+', '2019-03'],
  [/^SM-G977/, 'Galaxy S10 5G', '2019-04'],
  [/^SM-G98[01]/, 'Galaxy S20', '2020-03'],
  [/^SM-G98[56]/, 'Galaxy S20+', '2020-03'],
  [/^SM-G988/, 'Galaxy S20 Ultra', '2020-03'],
  [/^SM-G78[01]/, 'Galaxy S20 FE', '2020-10'],
  [/^SM-G991/, 'Galaxy S21', '2021-01'],
  [/^SM-G996/, 'Galaxy S21+', '2021-01'],
  [/^SM-G998/, 'Galaxy S21 Ultra', '2021-01'],
  [/^SM-G990/, 'Galaxy S21 FE', '2022-01'],
  [/^SM-S901/, 'Galaxy S22', '2022-02'],
  [/^SM-S906/, 'Galaxy S22+', '2022-02'],
  [/^SM-S908/, 'Galaxy S22 Ultra', '2022-02'],
  [/^SM-S911/, 'Galaxy S23', '2023-02'],
  [/^SM-S916/, 'Galaxy S23+', '2023-02'],
  [/^SM-S918/, 'Galaxy S23 Ultra', '2023-02'],
  [/^SM-S711/, 'Galaxy S23 FE', '2023-10'],
  [/^SM-S921/, 'Galaxy S24', '2024-01'],
  [/^SM-S926/, 'Galaxy S24+', '2024-01'],
  [/^SM-S928/, 'Galaxy S24 Ultra', '2024-01'],
  [/^SM-S721/, 'Galaxy S24 FE', '2024-10'],
  [/^SM-S931/, 'Galaxy S25', '2025-02'],
  [/^SM-S936/, 'Galaxy S25+', '2025-02'],
  [/^SM-S938/, 'Galaxy S25 Ultra', '2025-02'],
  [/^SM-S937/, 'Galaxy S25 Edge', '2025-05'],
  [/^SM-S731/, 'Galaxy S25 FE', '2025-09'],
  [/^SM-S941/, 'Galaxy S26', '2026-02'],
  [/^SM-S946/, 'Galaxy S26+', '2026-02'],
  [/^SM-S948/, 'Galaxy S26 Ultra', '2026-02'],
  [/^SM-N950/, 'Galaxy Note8', '2017-09'],
  [/^SM-N960/, 'Galaxy Note9', '2018-08'],
  [/^SM-N970/, 'Galaxy Note10', '2019-08'],
  [/^SM-N97[56]/, 'Galaxy Note10+', '2019-08'],
  [/^SM-N98[01]/, 'Galaxy Note20', '2020-08'],
  [/^SM-N98[56]/, 'Galaxy Note20 Ultra', '2020-08'],
  [/^SM-F900/, 'Galaxy Fold', '2019-09'],
  [/^SM-F916/, 'Galaxy Z Fold2', '2020-09'],
  [/^SM-F926/, 'Galaxy Z Fold3', '2021-08'],
  [/^SM-F936/, 'Galaxy Z Fold4', '2022-08'],
  [/^SM-F946/, 'Galaxy Z Fold5', '2023-08'],
  [/^SM-F956/, 'Galaxy Z Fold6', '2024-07'],
  [/^SM-F966/, 'Galaxy Z Fold7', '2025-07'],
  [/^SM-F700/, 'Galaxy Z Flip', '2020-02'],
  [/^SM-F707/, 'Galaxy Z Flip 5G', '2020-08'],
  [/^SM-F711/, 'Galaxy Z Flip3', '2021-08'],
  [/^SM-F721/, 'Galaxy Z Flip4', '2022-08'],
  [/^SM-F731/, 'Galaxy Z Flip5', '2023-08'],
  [/^SM-F741/, 'Galaxy Z Flip6', '2024-07'],
  [/^SM-F766/, 'Galaxy Z Flip7', '2025-07'],
  [/^SM-F761/, 'Galaxy Z Flip7 FE', '2025-07'],
  [/^SM-A505/, 'Galaxy A50', '2019-03'],
  [/^SM-A515/, 'Galaxy A51', '2019-12'],
  [/^SM-A525/, 'Galaxy A52', '2021-03'],
  [/^SM-A528/, 'Galaxy A52s', '2021-09'],
  [/^SM-A536/, 'Galaxy A53', '2022-03'],
  [/^SM-A546/, 'Galaxy A54', '2023-03'],
  [/^SM-A556/, 'Galaxy A55', '2024-03'],
  [/^SM-A566/, 'Galaxy A56', '2025-03'],
  [/^SM-A325/, 'Galaxy A32', '2021-02'],
  [/^SM-A336/, 'Galaxy A33', '2022-03'],
  [/^SM-A346/, 'Galaxy A34', '2023-03'],
  [/^SM-A356/, 'Galaxy A35', '2024-03'],
  [/^SM-A366/, 'Galaxy A36', '2025-03'],
  [/^SM-A715/, 'Galaxy A71', '2020-01'],
  [/^SM-A725/, 'Galaxy A72', '2021-03'],
  [/^SM-A736/, 'Galaxy A73', '2022-04']
];

/** Huawei writes a code too; only the well-known flagship lines are listed. */
const HUAWEI_CODES: Array<[RegExp, string, string]> = [
  [/^EML-/, 'P20', '2018-03'],
  [/^CLT-/, 'P20 Pro', '2018-03'],
  [/^ELE-/, 'P30', '2019-03'],
  [/^VOG-/, 'P30 Pro', '2019-03'],
  [/^MAR-/, 'P30 lite', '2019-04'],
  [/^ANA-/, 'P40', '2020-03'],
  [/^ELS-/, 'P40 Pro', '2020-03'],
  [/^JNY-/, 'P40 lite', '2020-03'],
  [/^ABR-/, 'P50', '2021-07'],
  [/^JAD-/, 'P50 Pro', '2021-07'],
  [/^HMA-/, 'Mate 20', '2018-10'],
  [/^LYA-/, 'Mate 20 Pro', '2018-10'],
  [/^TAS-/, 'Mate 30', '2019-09'],
  [/^LIO-/, 'Mate 30 Pro', '2019-09'],
  [/^OCE-/, 'Mate 40', '2020-10'],
  [/^NOH-/, 'Mate 40 Pro', '2020-10'],
  [/^BRA-/, 'Mate 60', '2023-08'],
  [/^ALN-/, 'Mate 60 Pro', '2023-08']
];

/** First public release of each iOS major. iOS 18 was followed by iOS 26 (year-based numbering). */
const IOS_MAJORS: Array<[number, string]> = [
  [10, '2016-09'],
  [11, '2017-09'],
  [12, '2018-09'],
  [13, '2019-09'],
  [14, '2020-09'],
  [15, '2021-09'],
  [16, '2022-09'],
  [17, '2023-09'],
  [18, '2024-09'],
  [26, '2025-09'],
  [27, '2026-09']
];

const ANDROID_MAJORS: Array<[number, string]> = [
  [8, '2017-08'],
  [9, '2018-08'],
  [10, '2019-09'],
  [11, '2020-09'],
  [12, '2021-10'],
  [13, '2022-08'],
  [14, '2023-10'],
  [15, '2024-10'],
  [16, '2025-06'],
  [17, '2026-06']
];

const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

interface ModelMatch {
  name: string;
  released: string | null;
}

/** Marketing name and launch month for a make/model pair, the raw model when unknown. */
export function resolveModel(make: string | null, model: string, lensModel?: string | null): ModelMatch {
  const raw = model.trim().replace(/\s+/g, ' ');
  const key = normalise(raw);
  if (make === 'Apple') {
    return { name: raw, released: APPLE_RELEASES[key] ?? null };
  }
  if (make === 'Google') {
    return { name: raw, released: PIXEL_RELEASES[key] ?? null };
  }
  if (make === 'Samsung') {
    const code = SAMSUNG_CODES.find(([pattern]) => pattern.test(raw.toUpperCase()));
    // The lens tag spells the marketing name out («Samsung Galaxy S23 Ultra Rear Camera»).
    const fromLens = /Galaxy\s+([A-Za-z0-9+ ]+?)\s+(?:Rear|Front)\s+Camera/i.exec(lensModel ?? '');
    const name = code?.[1] ?? (fromLens ? `Galaxy ${fromLens[1].trim()}` : raw);
    return { name, released: code?.[2] ?? null };
  }
  if (make === 'Huawei') {
    const code = HUAWEI_CODES.find(([pattern]) => pattern.test(raw.toUpperCase()));
    return code ? { name: code[1], released: code[2] } : { name: raw, released: null };
  }
  return { name: raw, released: null };
}

/* ── system version ─────────────────────────────────────── */

const APPLE_VERSION = /^(?:i(?:Pad)?OS\s+)?(\d{1,2})(?:\.\d+){0,2}$/i;
const ANDROID_VERSION = /\bAndroid\s?(\d{1,2})(?:\.\d+)*/i;

/** The newest major that had shipped a full month before `ym`; conservative around launch month. */
function newestMajorBefore(table: Array<[number, string]>, ym: string): number | null {
  let newest: number | null = null;
  for (const [major, released] of table) {
    if (released < ym && (newest == null || major > newest)) newest = major;
  }
  return newest;
}

export function detectOs(
  make: string | null,
  model: string,
  software: string | null | undefined,
  shotYm: string | null
): DeviceProfile['os'] {
  const value = software?.trim() ?? '';
  if (!value) return null;

  if (make === 'Apple') {
    const match = APPLE_VERSION.exec(value);
    if (!match) return null;
    const name: OsName = /ipad/i.test(model) ? 'iPadOS' : 'iOS';
    const major = Number(match[1]);
    const familyReleased = IOS_MAJORS.find(([m]) => m === major)?.[1] ?? null;
    const newest = shotYm ? newestMajorBefore(IOS_MAJORS, shotYm) : null;
    return {
      name,
      version: value.replace(/^i(?:Pad)?OS\s+/i, ''),
      major,
      familyReleased,
      newerAtShot: newest != null && newest > major ? { name, major: newest } : null
    };
  }

  const android = ANDROID_VERSION.exec(value);
  if (android) {
    const major = Number(android[1]);
    const newest = shotYm ? newestMajorBefore(ANDROID_MAJORS, shotYm) : null;
    return {
      name: 'Android',
      version: android[0].replace(/^Android\s?/i, ''),
      major,
      familyReleased: ANDROID_MAJORS.find(([m]) => m === major)?.[1] ?? null,
      newerAtShot: newest != null && newest > major ? { name: 'Android', major: newest } : null
    };
  }
  return null;
}

/* ── firmware builds ────────────────────────────────────── */

/**
 * Samsung build ids end with the build date: «S918BXXS4BXA1» → year X (2024), month A (January).
 * Year letters run N = 2014 … Z = 2026; months A–L.
 */
const SAMSUNG_BUILD = /^[A-Z]\d{3}[A-Z0-9]{0,2}[A-Z]{2,3}[US]\d[A-Z]([N-Z])([A-L])[A-Z0-9]$/;
/** Huawei: «ELS-NX9 10.1.0.155(C10E4R3P3)». */
const HUAWEI_BUILD = /^[A-Z]{3}-[A-Z0-9]+\s+\d+\.\d+\.\d+(?:\.\d+)?/;

export function samsungBuildDate(build: string): string | null {
  const match = SAMSUNG_BUILD.exec(build.trim().toUpperCase());
  if (!match) return null;
  const year = 2014 + (match[1].charCodeAt(0) - 'N'.charCodeAt(0));
  const month = match[2].charCodeAt(0) - 'A'.charCodeAt(0) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function detectFirmware(make: string | null, software: string | null | undefined): DeviceProfile['firmware'] {
  const value = software?.trim() ?? '';
  if (!value) return null;
  if (make === 'Samsung' && SAMSUNG_BUILD.test(value.toUpperCase())) {
    return { build: value, built: samsungBuildDate(value) };
  }
  if (make === 'Huawei' && HUAWEI_BUILD.test(value)) {
    return { build: value, built: null };
  }
  return null;
}

/* ── camera module ──────────────────────────────────────── */

/** Which module fired, from the 35 mm-equivalent focal length (phones: ~13 ultra-wide, 24–28 main, 48+ tele). */
export function cameraModule(
  side: CameraSide,
  focalLength35mm: number | null | undefined,
  lensModel?: string | null
): CameraModule | null {
  if (side === 'front') return null;
  if (focalLength35mm && focalLength35mm > 0) {
    if (focalLength35mm < 20) return 'ultrawide';
    if (focalLength35mm <= 40) return 'main';
    return 'tele';
  }
  if (lensModel) {
    if (/ultra.?wide/i.test(lensModel)) return 'ultrawide';
    if (/tele/i.test(lensModel)) return 'tele';
    if (/\b(wide|main|back|rear)\b/i.test(lensModel)) return 'main';
  }
  return null;
}

/* ── ages ───────────────────────────────────────────────── */

/** Whole months from a `YYYY-MM` launch month to a date; null when the date precedes the launch. */
export function monthsSince(ym: string, at: Date): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) return null;
  const months = (at.getUTCFullYear() - Number(match[1])) * 12 + (at.getUTCMonth() + 1 - Number(match[2]));
  return months < 0 ? null : months;
}

/* ── main ───────────────────────────────────────────────── */

export interface DeviceProfileInput {
  metadata: Pick<
    StructuredMetadata,
    'cameraMake' | 'cameraModel' | 'lensModel' | 'software' | 'focalLength35mm' | 'aperture' | 'shotDateLocal'
  > | null;
  filename: FilenameAnalysis | null;
  resolution: ResolutionAnalysis | null;
  now?: Date;
}

export function buildDeviceProfile(input: DeviceProfileInput): DeviceProfile | null {
  const { metadata, filename, resolution } = input;
  const now = input.now ?? new Date();
  const shotYm = metadata?.shotDateLocal?.slice(0, 7) ?? null;
  const shotIndex = filename?.photoIndex ?? null;

  const rawModel = metadata?.cameraModel?.trim();
  if (rawModel) {
    const make = displayMake(metadata?.cameraMake);
    const resolved = resolveModel(make, rawModel, metadata?.lensModel);
    const side = cameraSide(metadata?.lensModel);
    const shotAt = metadata?.shotDateLocal ? new Date(`${metadata.shotDateLocal}Z`) : null;
    return {
      source: 'exif',
      make,
      model: resolved.name,
      modelCode: resolved.name.toLowerCase() === rawModel.toLowerCase() ? null : rawModel,
      os: detectOs(make, rawModel, metadata?.software, shotYm),
      firmware: detectFirmware(make, metadata?.software),
      released: resolved.released,
      ageAtShotMonths:
        resolved.released && shotAt && !Number.isNaN(shotAt.getTime()) ? monthsSince(resolved.released, shotAt) : null,
      ageNowMonths: resolved.released ? monthsSince(resolved.released, now) : null,
      camera:
        metadata?.lensModel || metadata?.focalLength35mm || metadata?.aperture
          ? {
              side,
              module: cameraModule(side, metadata?.focalLength35mm, metadata?.lensModel),
              focalLength35mm: metadata?.focalLength35mm ?? null,
              aperture: metadata?.aperture ?? null
            }
          : null,
      shotIndex
    };
  }

  const guess = filename?.device || resolution?.possibleDevices[0] || null;
  if (!guess) return null;
  return {
    source: filename?.device ? 'filename' : 'resolution',
    make: null,
    model: guess,
    modelCode: null,
    os: null,
    firmware: null,
    released: null,
    ageAtShotMonths: null,
    ageNowMonths: null,
    camera: null,
    shotIndex
  };
}
