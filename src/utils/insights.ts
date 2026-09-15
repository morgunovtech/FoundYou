import type { StructuredMetadata } from '../types/metadata';

type CameraPosition = 'front' | 'rear' | 'unknown';

export interface MovementInsight {
  moving: boolean;
  speedKmh?: number;
}

export function inferCameraPosition(metadata: StructuredMetadata | null): CameraPosition {
  if (!metadata) return 'unknown';
  const descriptors: string[] = [];
  const push = (value: unknown) => {
    const clean = toCleanString(value);
    if (clean) descriptors.push(clean.toLowerCase());
  };

  push(metadata.lensModel);
  push(metadata.groups.exif?.LensModel);
  push(metadata.groups.exif?.lensModel);
  push(metadata.groups.exif?.LensSpecification);
  push(metadata.groups.exif?.lensSpecification);

  if (descriptors.some((entry) => /front|truedepth|selfie|face.?time/.test(entry))) {
    return 'front';
  }
  if (descriptors.some((entry) => /rear|back|wide|tele|main|ultra/.test(entry))) {
    return 'rear';
  }
  return 'unknown';
}

export function inferMovement(metadata: StructuredMetadata | null): MovementInsight | null {
  if (!metadata) return null;
  const exif = metadata.groups.exif ?? {};
  const speedCandidates: unknown[] = [
    (exif as Record<string, unknown>).GPSSpeed,
    (exif as Record<string, unknown>).gpsSpeed,
    (exif as Record<string, unknown>).Speed,
    (exif as Record<string, unknown>).GPSSpeedRaw,
    (exif as Record<string, unknown>).speed
  ];

  let speed = speedCandidates
    .map((candidate) => toNumber(candidate))
    .find((value): value is number => value != null);

  if (speed == null) {
    return null;
  }

  const ref = toCleanString((exif as Record<string, unknown>).GPSSpeedRef ?? (exif as Record<string, unknown>).gpsSpeedRef);
  if (ref) {
    const normalized = ref.toUpperCase();
    if (normalized === 'M') {
      speed *= 1.60934;
    } else if (normalized === 'N') {
      speed *= 1.852;
    }
  }

  // Some devices record speed in meters/second without a ref tag.
  if (!ref && speed < 20) {
    // Assume m/s → km/h.
    speed *= 3.6;
  }

  if (!Number.isFinite(speed)) {
    return null;
  }

  return { moving: speed >= 3, speedKmh: speed };
}

function toCleanString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (Array.isArray(value)) {
    const numbers = value
      .map((entry) => toNumber(entry))
      .filter((entry): entry is number => entry != null);
    if (numbers.length === 0) {
      return undefined;
    }
    return numbers.reduce((acc, item) => acc + item, 0) / numbers.length;
  }
  if (typeof value === 'object') {
    const maybe = value as { numerator?: number; denominator?: number };
    if (
      typeof maybe.numerator === 'number' &&
      typeof maybe.denominator === 'number' &&
      maybe.denominator !== 0
    ) {
      return maybe.numerator / maybe.denominator;
    }
  }
  return undefined;
}
