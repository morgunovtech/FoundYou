import type { StructuredMetadata } from '../types/metadata';
import type { EditingAnalysis } from './heuristics/editingHistory';
import type { StrippedAnalysis } from './heuristics/strippedDetector';
import type { ContentCredentials } from './contentCredentials';
import { formatWallClock, parseWallClock, wallClockAsUtcDate } from './format';
import { hammingDistance, PHASH_SAME_PICTURE } from './phash';

/*
 * «История файла»: what happened to the file after the shutter, as a list of
 * events with dates. Everything here is derived from tags and bytes the file
 * already carries: ModifyDate against DateTimeOriginal, the Software tag, the
 * EXIF picture size against the real pixels, the messenger signs, the C2PA
 * signature, the file's own modification time on disk, and the embedded
 * thumbnail, which keeps the frame as it was before a crop or a retouch.
 * Pure; the component maps events to text.
 */

export type FileEventKind = 'shot' | 'modified' | 'resized' | 'messenger' | 'stripped' | 'signed' | 'ai' | 'disk' | 'thumbnail';

export interface FileEvent {
  kind: FileEventKind;
  /** Wall-clock `YYYY-MM-DDTHH:mm:ss` or ISO instant when the event has a time. */
  at: string | null;
  /** Software / platform / signer / tool name, when the event has one. */
  agent: string | null;
  /** «resized»: the size the camera wrote and the size the file has now. */
  from?: { width: number; height: number };
  to?: { width: number; height: number };
  /** «thumbnail»: whether the embedded thumbnail still shows the same frame; null when it could not be compared. */
  same?: boolean | null;
  /** «thumbnail»: Hamming distance between the thumbnail and the frame; null when either hash is missing. */
  distance?: number | null;
  /** «stripped»: the first sign the detector quoted. */
  evidence?: string | null;
}

export interface EmbeddedThumbnail {
  url: string;
  width: number;
  height: number;
  bytes: number;
  /** Perceptual hash of the thumbnail; null when the browser could not decode it. */
  phash: string | null;
}

export interface FileHistoryInput {
  metadata: StructuredMetadata | null;
  editing: EditingAnalysis | null;
  stripped: StrippedAnalysis | null;
  credentials: ContentCredentials | null;
  /** `File.lastModified` of the uploaded file, ms since the epoch. */
  lastModified: number | null;
  /** Real pixel size of the picture. */
  width: number;
  height: number;
  /** Perceptual hash of the picture, to compare with the thumbnail's. */
  phash: string | null;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** ModifyDate as a wall clock: exifr revives EXIF dates into local-field `Date`s, XMP dates are ISO. */
export function wallClockOf(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatWallClock({
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds()
    });
  }
  if (typeof value === 'string') {
    const parts = parseWallClock(value);
    return parts ? formatWallClock(parts) : null;
  }
  return null;
}

function pickTag<T = unknown>(source: Record<string, unknown> | undefined, keys: string[]): T | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value != null) return value as T;
  }
  return undefined;
}

const toInt = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

export function buildFileHistory(input: FileHistoryInput): FileEvent[] {
  const { metadata, editing, stripped, credentials, lastModified, width, height, phash } = input;
  const events: FileEvent[] = [];
  const exif = metadata?.groups.exif;
  const xmp = metadata?.groups.xmp;
  const shot = metadata?.shotDateLocal ?? null;
  const shotMs = shot ? wallClockAsUtcDate(parseWallClock(shot)!).getTime() : null;

  // 1. Shot: the camera wall clock and the device.
  const device = [metadata?.cameraMake, metadata?.cameraModel].filter(Boolean).join(' ').trim() || null;
  if (shot || device) events.push({ kind: 'shot', at: shot, agent: device });

  // 2. Modified: ModifyDate later than DateTimeOriginal means the file was written again.
  const modified = wallClockOf(pickTag(exif, ['ModifyDate', 'modifyDate'])) ?? wallClockOf(pickTag(xmp, ['ModifyDate', 'MetadataDate']));
  const software = editing?.software.length ? editing.software.join(', ') : null;
  if (modified) {
    const modifiedMs = wallClockAsUtcDate(parseWallClock(modified)!).getTime();
    if (shotMs == null || modifiedMs - shotMs >= MINUTE_MS) {
      events.push({ kind: 'modified', at: modified, agent: software });
    } else if (software && editing?.edited) {
      events.push({ kind: 'modified', at: null, agent: software });
    }
  } else if (software && editing?.edited) {
    events.push({ kind: 'modified', at: null, agent: software });
  }

  // 3. Resized: the camera wrote its pixel size; a smaller picture was scaled or cropped later.
  const exifWidth = toInt(pickTag(exif, ['ExifImageWidth', 'PixelXDimension', 'ImageWidth']));
  const exifHeight = toInt(pickTag(exif, ['ExifImageHeight', 'PixelYDimension', 'ImageHeight']));
  if (exifWidth && exifHeight && width > 0 && height > 0) {
    const exifPixels = exifWidth * exifHeight;
    const pixels = width * height;
    // Orientation may swap the sides; compare the area with a 2 % tolerance.
    if (pixels < exifPixels * 0.98) {
      events.push({ kind: 'resized', at: null, agent: null, from: { width: exifWidth, height: exifHeight }, to: { width, height } });
    }
  }

  // 4. Messenger / stripped.
  if (stripped?.stripped) {
    events.push(
      stripped.strippedBy
        ? { kind: 'messenger', at: null, agent: stripped.strippedBy, evidence: stripped.evidence[0] ?? null }
        : { kind: 'stripped', at: null, agent: null, evidence: stripped.evidence[0] ?? null }
    );
  }

  // 5. Provenance: a signed manifest, or an AI marker.
  if (credentials) {
    const signer = credentials.issuer ?? credentials.generator ?? 'C2PA';
    if (credentials.generative !== 'none') {
      events.push({ kind: 'ai', at: credentials.signedAt ?? null, agent: credentials.generativeAgents[0] ?? credentials.generator ?? signer });
    }
    events.push({ kind: 'signed', at: credentials.signedAt ?? null, agent: signer });
  } else if (editing?.isAiGenerated) {
    events.push({ kind: 'ai', at: null, agent: editing.aiTool ?? 'AI' });
  }

  // 6. On disk: the OS modification time, when it is not simply the capture moment.
  if (lastModified != null && Number.isFinite(lastModified) && lastModified > 0) {
    if (shotMs == null || Math.abs(lastModified - shotMs) > DAY_MS) {
      events.push({ kind: 'disk', at: new Date(lastModified).toISOString(), agent: null });
    }
  }

  // 7. Embedded thumbnail: the frame as the camera saw it.
  const thumbnail = metadata?.thumbnail;
  if (thumbnail) {
    const distance = thumbnail.phash && phash ? hammingDistance(thumbnail.phash, phash) : null;
    const thumbRatio = thumbnail.width / Math.max(1, thumbnail.height);
    const ratio = width / Math.max(1, height);
    const ratioMatches = Math.abs(thumbRatio - ratio) / Math.max(ratio, thumbRatio) <= 0.06 || Math.abs(thumbRatio - 1 / ratio) / Math.max(1 / ratio, thumbRatio) <= 0.06;
    // A different aspect ratio is a crop whatever the hashes say; with matching proportions the
    // hashes decide, and without them the comparison is reported as not made, not as a match.
    const same = !ratioMatches ? false : distance == null ? null : distance <= PHASH_SAME_PICTURE;
    events.push({ kind: 'thumbnail', at: null, agent: null, same, distance });
  }

  return events;
}
