import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { BasicFileInfo, MetadataGroups, StructuredMetadata } from '../types/metadata';
import { inferOrientation } from '../utils/orientation';
import { computeMetadataCompleteness } from '../utils/metadataScore';
import { extractMetadataFromOriginal } from '../utils/heic';
import { formatWallClock, parseWallClock, type WallClockParts } from '../utils/format';
import { parseAppleMakerNote } from '../utils/appleMakerNote';
import { readSamsungTrailer } from '../utils/samsungTrailer';
import { readEmbeddedThumbnail } from '../utils/heic';
import { findShotDateFault } from '../utils/exifDateSanity';
import type { EmbeddedThumbnail } from '../utils/fileHistory';

interface UseExifMetadataResult {
  metadata: StructuredMetadata | null;
  loading: boolean;
  error: string | null;
}

export function useExifMetadata(fileInfo: BasicFileInfo | null): UseExifMetadataResult {
  const t = useT();
  const [metadata, setMetadata] = useState<StructuredMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let thumbnailUrl: string | null = null;
    if (!fileInfo) {
      setMetadata(null);
      setError(null);
      return;
    }

    const parse = async () => {
      // A new file: the previous metadata (its coordinates, its thumbnail URL, which is revoked
      // below) must not be shown or hashed against this one while it is being read.
      setMetadata(null);
      setLoading(true);
      setError(null);
      try {
        const sourceFile = fileInfo.originalFile ?? fileInfo.file;
        const { exifData, xmpData, iptcData, iccData, pngData, gpsRaw, rawDates } =
          await extractMetadataFromOriginal(sourceFile);

        if (!active) return;

        const exifRecord = (exifData ?? {}) as Record<string, unknown>;
        const xmpRecord = (xmpData ?? {}) as Record<string, unknown>;
        const pngRecord = pngData as Record<string, unknown> | undefined;

        const orientationTag = pickFirst<number | string>(exifRecord, ['Orientation', 'orientation']);

        // Vendor blocks: the Apple MakerNote bytes (parsed, then dropped from the raw group so the
        // table does not print a byte array), the Samsung trailer after the JPEG EOI and the IFD1
        // thumbnail. Each is optional: a quirk in one of them must not cost the EXIF itself.
        let apple: ReturnType<typeof parseAppleMakerNote> = null;
        try {
          apple = parseAppleMakerNote(takeMakerNote(exifRecord));
        } catch (err) {
          console.warn('apple-makernote', err);
        }
        const [samsung, thumbnail] = await Promise.all([
          readSamsungTrailer(sourceFile).catch((err) => {
            console.warn('samsung-trailer', err);
            return null;
          }),
          readEmbeddedThumbnail(sourceFile, orientationTag).catch((err) => {
            console.warn('embedded-thumbnail', err);
            return null;
          })
        ]);
        if (!active) {
          if (thumbnail) URL.revokeObjectURL(thumbnail.url);
          return;
        }
        thumbnailUrl = thumbnail?.url ?? null;

        /*
         * The raw digits come first. When the tag the shot date would be read from is not a date —
         * `2031:02:30 25:61:61`, `0000:00:00 00:00:00` — `resolveShotDate` is not asked at all:
         * every consumer downstream (the headline, the weather and holiday lookups, the timestamp
         * comparison) would otherwise work on the moment JavaScript invented by rolling the
         * overflow forward, and print it as the time of the shot.
         */
        const dateFault = findShotDateFault(rawDates);
        const shot = dateFault
          ? undefined
          : resolveShotDate(
              pickFirstFromSources(
                [exifRecord, xmpRecord],
                ['DateTimeOriginal', 'dateTimeOriginal', 'CreateDate', 'createDate', 'DateTimeDigitized']
              ),
              pickFirst(exifRecord, ['OffsetTimeOriginal', 'offsetTimeOriginal', 'OffsetTime', 'OffsetTimeDigitized'])
            );
        const cameraMake = pickFirst<string>(exifRecord, ['Make', 'make']);
        const cameraModel = pickFirst<string>(exifRecord, ['Model', 'model']);
        const lensModel = pickFirst<string>(exifRecord, ['LensModel', 'lensModel']);
        const software = pickFirstFromSources<string>(
          [exifRecord, xmpRecord, pngRecord],
          ['Software', 'software', 'CreatorTool', 'creatorTool']
        );
        const rawExposure = pickFirst<string | number>(exifRecord, ['ExposureTime', 'exposureTime']);
        const exposureTime = formatExposure(rawExposure);
        const aperture = pickFirst<number>(exifRecord, ['FNumber', 'fNumber']);
        const iso = pickFirst<number>(exifRecord, ['ISO', 'iso']);
        const focalLength = pickFirst<number>(exifRecord, ['FocalLength', 'focalLength']);
        const focalLength35mm = pickFirst<number>(exifRecord, ['FocalLengthIn35mmFormat', 'focalLengthIn35MmFormat']);
        const gps = normalizeGps(exifRecord, gpsRaw as Record<string, unknown> | undefined);

        const groups: MetadataGroups = {
          exif: exifRecord,
          xmp: xmpRecord,
          iptc: (iptcData as Record<string, unknown>) ?? {},
          icc: (iccData as Record<string, unknown>) ?? {}
        };
        if (pngRecord && Object.keys(pngRecord).length > 0) {
          groups.png = pngRecord;
        }

        const structured: StructuredMetadata = {
          groups,
          shotDate: shot?.iso,
          shotDateLocal: shot?.local,
          utcOffset: shot ? shot.utcOffset : undefined,
          dateFault: dateFault ?? undefined,
          cameraMake,
          cameraModel,
          lensModel,
          software,
          exposureTime,
          aperture,
          iso,
          focalLength,
          focalLength35mm,
          gps,
          completeness: computeMetadataCompleteness({
            shotDate: shot?.iso,
            cameraMake,
            cameraModel,
            lensModel,
            exposureTime,
            aperture,
            iso,
            focalLength,
            gps
          }),
          // `fileInfo.width/height` are post-decode, so the tag must not be applied again — see orientation.ts.
          orientation: inferOrientation(fileInfo.width, fileInfo.height),
          apple: apple ?? undefined,
          samsung: samsung ?? undefined,
          thumbnail: (thumbnail as EmbeddedThumbnail | null) ?? undefined
        };

        setMetadata(structured);
      } catch (err) {
        console.error('metadata-parse', err);
        if (active) {
          setError(t('corruptedFile'));
          setMetadata(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    parse();

    return () => {
      active = false;
      // The thumbnail's blob URL belongs to this file; drop it when the file is replaced.
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    };
  }, [fileInfo, t]);

  return { metadata, loading, error };
}

export interface ResolvedShotDate {
  /** Wall-clock as the camera wrote it, `YYYY-MM-DDTHH:mm:ss`. This is what the UI shows. */
  local: string;
  /** `+05:00` when EXIF carried an offset tag (or the value itself was zoned); null when unknown. */
  utcOffset: string | null;
  /**
   * ISO-8601 instant (UTC). With a known offset this is the true moment of capture. Without one
   * the wall-clock is taken AS IF it were UTC — the real instant is unknowable from the file, and
   * this keeps `shotDate` deterministic regardless of the viewer's time zone. Do not display it.
   */
  iso: string;
}

/**
 * Turn an EXIF/XMP date value into wall-clock + offset + instant.
 *
 * - `string`: EXIF `YYYY:MM:DD HH:MM:SS` or ISO. A zone suffix on the string itself is honoured
 *   when no explicit `offsetValue` is given.
 * - `Date`: exifr revives EXIF dates via `new Date(y, m, d)` + `setHours(...)`, i.e. it stores the
 *   camera digits in the *local* fields — so the local getters give the wall-clock back exactly.
 */
export function resolveShotDate(value: unknown, offsetValue?: unknown): ResolvedShotDate | undefined {
  let parts: WallClockParts | null = null;
  let zone: string | null = normalizeOffset(offsetValue) ?? null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    parts = {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds()
    };
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    parts = parseWallClock(trimmed);
    if (!zone) {
      const zoneMatch = /(Z|[+-]\d{2}:?\d{2})$/i.exec(trimmed);
      if (zoneMatch) {
        zone = zoneMatch[1].toUpperCase() === 'Z' ? '+00:00' : normalizeOffset(zoneMatch[1]) ?? null;
      }
    }
  }

  if (!parts) return undefined;
  const local = formatWallClock(parts);
  const instant = new Date(`${local}${zone ?? 'Z'}`);
  if (Number.isNaN(instant.getTime())) return undefined;
  return { local, utcOffset: zone, iso: instant.toISOString() };
}

/** Removes the raw MakerNote from the EXIF record and returns its bytes (an empty array when absent). */
function takeMakerNote(exifRecord: Record<string, unknown>): Uint8Array {
  for (const key of ['MakerNote', 'makerNote']) {
    const value = exifRecord[key];
    if (value == null) continue;
    delete exifRecord[key];
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(0);
}

function pickFirst<T>(source: Record<string, unknown> | undefined, keys: string[]): T | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    if (key in source) {
      const value = source[key];
      if (value != null) {
        return value as T;
      }
    }
  }
  return undefined;
}

function pickFirstFromSources<T>(
  sources: Array<Record<string, unknown> | undefined>,
  keys: string[]
): T | undefined {
  for (const source of sources) {
    const value = pickFirst<T>(source, keys);
    if (value != null) {
      return value;
    }
  }
  return undefined;
}

function formatExposure(value: string | number | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    return value;
  }
  if (value <= 0) return undefined;
  if (value >= 1) {
    return value.toFixed(2);
  }
  const reciprocal = Math.round(1 / value);
  return `1/${reciprocal}`;
}

function normalizeGps(
  exifRecord: Record<string, unknown>,
  gpsRecordRaw?: Record<string, unknown>
): StructuredMetadata['gps'] | undefined {
  const inlineGps = (exifRecord.gps as Record<string, unknown> | undefined) ?? {};
  const gpsRecord = gpsRecordRaw ?? {};
  const sources = [inlineGps, gpsRecord, exifRecord];

  const latRef = pickFirstFromSources<string>(sources, [
    'latRef',
    'latitudeRef',
    'LatitudeRef',
    'GPSLatitudeRef'
  ]);
  const lonRef = pickFirstFromSources<string>(sources, [
    'lonRef',
    'longitudeRef',
    'LongitudeRef',
    'GPSLongitudeRef'
  ]);

  const rawLat = pickFirstFromSources(sources, [
    'lat',
    'latitude',
    'Lat',
    'Latitude',
    'GPSLatitude'
  ]);
  const rawLon = pickFirstFromSources(sources, [
    'lon',
    'longitude',
    'Lon',
    'Longitude',
    'GPSLongitude'
  ]);
  const lat = toCoordinate(rawLat, latRef);
  const lon = toCoordinate(rawLon, lonRef);
  if (lat == null || lon == null) {
    return undefined;
  }
  const altitude = toNumber(
    pickFirstFromSources(sources, ['altitude', 'Altitude', 'gpsAltitude', 'GPSAltitude'])
  );
  const accuracy =
    toNumber(
      pickFirstFromSources(sources, [
        'accuracy',
        'gpsAccuracy',
        'gpsHPositioningError',
        'GPSHPositioningError',
        'gpsDop',
        'GPSDOP',
        'dop'
      ])
    ) ?? undefined;
  const heading =
    toNumber(
      pickFirstFromSources(sources, ['heading', 'gpsImgDirection', 'GPSImgDirection', 'imgDirection'])
    ) ?? undefined;
  const speed = gpsSpeedKmh(
    toNumber(pickFirstFromSources(sources, ['speed', 'gpsSpeed', 'GPSSpeed'])),
    pickFirstFromSources<string>(sources, ['speedRef', 'gpsSpeedRef', 'GPSSpeedRef'])
  );
  const timestampUtc = gpsInstant(
    pickFirstFromSources(sources, ['GPSDateStamp', 'gpsDateStamp', 'dateStamp']),
    pickFirstFromSources(sources, ['GPSTimeStamp', 'gpsTimeStamp', 'timeStamp'])
  );
  return {
    lat,
    lon,
    altitude,
    accuracy,
    heading,
    speed,
    timestampUtc
  };
}

/** GPSSpeed with its GPSSpeedRef unit (K km/h, M mph, N knots) → km/h, one decimal. */
export function gpsSpeedKmh(value: number | undefined, ref: unknown): number | undefined {
  if (value == null || !Number.isFinite(value) || value < 0) return undefined;
  const unit = typeof ref === 'string' ? ref.trim().toUpperCase() : 'K';
  const kmh = unit === 'M' ? value * 1.609344 : unit === 'N' ? value * 1.852 : value;
  return Math.round(kmh * 10) / 10;
}

/**
 * GPSDateStamp («2026:09:14») + GPSTimeStamp ([13, 20, 0], «13:20:00» or a Date) →
 * ISO instant. The receiver writes UTC, so this is the true moment of the fix.
 */
export function gpsInstant(dateStamp: unknown, timeStamp: unknown): string | undefined {
  let date: string | undefined;
  if (dateStamp instanceof Date && !Number.isNaN(dateStamp.getTime())) {
    date = dateStamp.toISOString().slice(0, 10);
  } else if (typeof dateStamp === 'string') {
    const match = /^(\d{4})[:-](\d{2})[:-](\d{2})/.exec(dateStamp.trim());
    if (match) date = `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (!date) return undefined;

  let parts: number[] | undefined;
  if (Array.isArray(timeStamp)) {
    parts = timeStamp.map((part) => toNumber(part) ?? NaN);
  } else if (typeof timeStamp === 'string') {
    parts = timeStamp.trim().split(':').map((part) => Number(part));
  } else if (timeStamp instanceof Date && !Number.isNaN(timeStamp.getTime())) {
    parts = [timeStamp.getUTCHours(), timeStamp.getUTCMinutes(), timeStamp.getUTCSeconds()];
  }
  if (!parts || parts.length < 2 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return undefined;
  const [h, m, s = 0] = parts;
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s >= 60) return undefined;
  const iso = `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}Z`;
  return Number.isNaN(new Date(iso).getTime()) ? undefined : iso;
}

function normalizeOffset(offset: unknown): string | undefined {
  if (typeof offset !== 'string') return undefined;
  const trimmed = offset.trim();
  if (!/^[-+]\d{2}:?\d{2}$/.test(trimmed)) return undefined;
  const normalized = trimmed.includes(':') ? trimmed : `${trimmed.slice(0, 3)}:${trimmed.slice(3)}`;
  return normalized;
}

function toCoordinate(value: unknown, ref?: string | null): number | undefined {
  const numeric = toNumber(value);
  if (numeric == null) return undefined;
  if (!ref) return numeric;
  const upper = ref.toUpperCase();
  if (upper === 'S' || upper === 'W') {
    return -Math.abs(numeric);
  }
  return Math.abs(numeric);
}

function toNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return undefined;
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const dmsMatch = trimmed.match(
      /^(-?\d+)[^\d]+(\d+)[^\d]+(\d+(?:\.\d+)?)/
    );
    if (dmsMatch) {
      const [, deg, min, sec] = dmsMatch;
      const degrees = Number.parseFloat(deg);
      const minutes = Number.parseFloat(min);
      const seconds = Number.parseFloat(sec);
      if ([degrees, minutes, seconds].every((entry) => Number.isFinite(entry))) {
        const sign = degrees < 0 ? -1 : 1;
        const absDeg = Math.abs(degrees);
        return sign * (absDeg + minutes / 60 + seconds / 3600);
      }
    }
    const parsed = Number.parseFloat(trimmed.replace(',', '.'));
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (Array.isArray(value)) {
    const numbers = value.map((entry) => rationalToNumber(entry)).filter((entry): entry is number => entry != null);
    if (numbers.length === 0) return undefined;
    if (numbers.length === 1) return numbers[0];
    if (numbers.length >= 3) {
      return numbers[0] + numbers[1] / 60 + numbers[2] / 3600;
    }
    return numbers.reduce((acc, item) => acc + item, 0);
  }
  if (typeof value === 'object') {
    const result = rationalToNumber(value);
    if (result != null) {
      return result;
    }
    const maybe = value as { degrees?: number; minutes?: number; seconds?: number };
    if (
      typeof maybe.degrees === 'number' &&
      typeof maybe.minutes === 'number' &&
      typeof maybe.seconds === 'number'
    ) {
      const sign = maybe.degrees < 0 ? -1 : 1;
      const absDeg = Math.abs(maybe.degrees);
      return sign * (absDeg + maybe.minutes / 60 + maybe.seconds / 3600);
    }
  }
  return undefined;
}

function rationalToNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') {
    return Number.isNaN(value) ? undefined : value;
  }
  if (typeof value === 'object' && 'numerator' in (value as any) && 'denominator' in (value as any)) {
    const numerator = Number((value as any).numerator);
    const denominator = Number((value as any).denominator);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return undefined;
    }
    return numerator / denominator;
  }
  return undefined;
}
