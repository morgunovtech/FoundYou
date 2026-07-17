import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { BasicFileInfo, StructuredMetadata } from '../types/metadata';
import { inferOrientation } from '../utils/orientation';
import { extractMetadataFromOriginal } from '../utils/heic';

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
    if (!fileInfo) {
      setMetadata(null);
      setError(null);
      return;
    }

    const parse = async () => {
      setLoading(true);
      setError(null);
      try {
        const sourceFile = fileInfo.originalFile ?? fileInfo.file;
        const { exifData, xmpData, iptcData, iccData, gpsRaw } = await extractMetadataFromOriginal(sourceFile);

        if (!active) return;

        const exifRecord = (exifData ?? {}) as Record<string, unknown>;
        const shotDateValue = normalizeDateValue(
          pickFirst(exifRecord, ['DateTimeOriginal', 'dateTimeOriginal', 'CreateDate', 'createDate']),
          pickFirst(exifRecord, ['OffsetTimeOriginal', 'offsetTimeOriginal', 'OffsetTime'])
        );
        const shotDateIso = shotDateValue?.iso;
        const cameraMake = pickFirst<string>(exifRecord, ['Make', 'make']);
        const cameraModel = pickFirst<string>(exifRecord, ['Model', 'model']);
        const lensModel = pickFirst<string>(exifRecord, ['LensModel', 'lensModel']);
        const software = pickFirstFromSources<string>(
          [exifRecord, xmpData as Record<string, unknown> | undefined],
          ['Software', 'software', 'CreatorTool', 'creatorTool']
        );
        const rawExposure = pickFirst<string | number>(exifRecord, ['ExposureTime', 'exposureTime']);
        const exposureTime = formatExposure(rawExposure);
        const aperture = pickFirst<number>(exifRecord, ['FNumber', 'fNumber']);
        const iso = pickFirst<number>(exifRecord, ['ISO', 'iso']);
        const focalLength = pickFirst<number>(exifRecord, ['FocalLength', 'focalLength']);
        const focalLength35mm = pickFirst<number>(exifRecord, ['FocalLengthIn35mmFormat', 'focalLengthIn35MmFormat']);
        const gps = normalizeGps(exifRecord, gpsRaw as Record<string, unknown> | undefined);

        const structured: StructuredMetadata = {
          groups: {
            exif: exifRecord,
            xmp: (xmpData as Record<string, unknown>) ?? {},
            iptc: (iptcData as Record<string, unknown>) ?? {},
            icc: (iccData as Record<string, unknown>) ?? {}
          },
          shotDate: shotDateIso,
          shotDateLocal: shotDateValue?.naive,
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
          orientation: inferOrientation(fileInfo.width, fileInfo.height)
        };

        setMetadata(structured);
      } catch (err) {
        console.error('metadata-parse', err);
        if (!active) return;
        setError(t('metadataUnavailable'));
        setMetadata(null);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    parse();

    return () => {
      active = false;
    };
  }, [fileInfo, t]);

  return { metadata, loading, error };
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

// iso — для отображения; naive — локальное время съёмки без пояса, как в EXIF
// (нужно погодному API: пересчёт через пояс браузера смещал час на чужой).
function normalizeDateValue(
  value: unknown,
  offsetValue?: unknown
): { iso: string; naive: string } | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    // exifr парсит наивную EXIF-строку в поясе браузера — локальные компоненты
    // восстанавливают исходное «время на часах» в месте съёмки.
    return { iso: value.toISOString(), naive: toNaiveString(value) };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const normalized = trimmed.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
    const offset = normalizeOffset(offsetValue);
    const candidate = offset ? `${normalized}${offset}` : normalized;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return { iso: parsed.toISOString(), naive: normalized.slice(0, 19) };
    }
  }
  return undefined;
}

function toNaiveString(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
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
  return {
    lat,
    lon,
    altitude,
    accuracy,
    heading
  };
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
    return numbers[0] + numbers[1] / 60;
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
