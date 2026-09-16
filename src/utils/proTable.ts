import type { DigitalProfile } from './heuristics/digitalProfile';
import type { StructuredMetadata, BasicFileInfo } from '../types/metadata';
import type { BoundingBox } from '../types/detection';
import type { OCRResult } from '../hooks/useOCR';
import type { ProData } from '../App';
import type { MessageKey } from '../i18n';
import type { QrCode } from './qr';
import type { PiiFinding } from './pii';
import type { Stance } from './stance';
import { formatOffset } from './stance';

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Recognition results and the stance, when the page has them; each adds its own group. */
export interface ProExtras {
  qrCodes?: QrCode[];
  pii?: PiiFinding[];
  stance?: Stance | null;
}

/**
 * Pro mode: every raw value the analysis produced, grouped for a mono table.
 * Pure — the component only decides how many rows to show.
 */
export type ProRow = [string, string];
export interface ProGroup {
  group: string;
  rows: ProRow[];
}



function formatValue(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function flattenEntries(obj: Record<string, unknown>, prefix = ''): ProRow[] {
  const rows: ProRow[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      rows.push(...flattenEntries(value as Record<string, unknown>, fullKey));
    } else {
      rows.push([fullKey, formatValue(value)]);
    }
  }
  return rows;
}

export function buildProGroups(
  profile: DigitalProfile,
  metadata: StructuredMetadata | null,
  proData: ProData | null,
  fileInfo: BasicFileInfo | null,
  detections: BoundingBox[],
  ocrResult: OCRResult | null,
  t: Translate,
  extras: ProExtras = {}
): Array<{ group: string; rows: ProRow[] }> {
  const groups: Array<{ group: string; rows: ProRow[] }> = [];

  // 1. Leak score + profile sections
  const profileRows: ProRow[] = [
    ['Leak Score', `${profile.leakScore}/100 (${profile.leakLevel.label})`],
    ...profile.sections.map(
      (s) =>
        [
          s.title,
          `${s.text}${s.subtext ? ` — ${s.subtext}` : ''}`
        ] as ProRow
    )
  ];
  groups.push({ group: t('proGroupProfile'), rows: profileRows });

  // 2. File info
  if (fileInfo) {
    const fileRows: ProRow[] = [
      ['filename', fileInfo.originalName ?? fileInfo.file.name],
      ['mimeType', fileInfo.mimeType],
      ['size', `${(fileInfo.sizeBytes / 1024).toFixed(1)} KB`],
      ['dimensions', `${fileInfo.width} x ${fileInfo.height}`],
      ['aspectRatio', fileInfo.aspectRatio.toFixed(3)],
      ['megapixels', ((fileInfo.width * fileInfo.height) / 1_000_000).toFixed(1)]
    ];
    if (fileInfo.wasConverted) {
      fileRows.push(['originalMimeType', fileInfo.originalMimeType ?? '']);
      if (fileInfo.originalSizeBytes) fileRows.push(['originalSize', `${(fileInfo.originalSizeBytes / 1024).toFixed(1)} KB`]);
    }
    groups.push({ group: t('proGroupFile'), rows: fileRows });
  }

  // 3. Filename heuristics
  if (proData?.filename) {
    const fn = proData.filename;
    const rows: ProRow[] = [
      ['platform', fn.platform ?? '—'],
      ['device', fn.device || '—'],
      ['confidence', fn.confidence > 0 ? `${(fn.confidence * 100).toFixed(0)}%` : '—']
    ];
    if (fn.photoIndex != null) rows.push(['photoIndex', String(fn.photoIndex)]);
    if (fn.estimatedMonths != null) rows.push(['estimatedMonthsOfUse', String(fn.estimatedMonths)]);
    groups.push({ group: t('proGroupFilename'), rows });
  }

  // 4. Resolution heuristics
  if (proData?.resolution) {
    const res = proData.resolution;
    const rows: ProRow[] = [
      ['possibleDevices', res.possibleDevices.length > 0 ? res.possibleDevices.join(', ') : '—'],
      ['contentType', res.contentType],
      ['contentHint', res.contentHint || '—'],
      ['isScreenshot', String(res.isScreenshot)]
    ];
    groups.push({ group: t('proGroupResolution'), rows });
  }

  // 5. Stripped detection
  if (proData?.stripped) {
    const st = proData.stripped;
    const rows: ProRow[] = [
      ['stripped', String(st.stripped)],
      ['strippedBy', st.strippedBy ?? '—'],
      ['confidence', st.confidence > 0 ? `${(st.confidence * 100).toFixed(0)}%` : '—']
    ];
    for (let i = 0; i < st.evidence.length; i++) {
      rows.push([`evidence[${i}]`, st.evidence[i]]);
    }
    groups.push({ group: t('proGroupStripped'), rows });
  }

  // 6. Editing history
  if (proData?.editing) {
    const ed = proData.editing;
    const rows: ProRow[] = [
      ['edited', String(ed.edited)],
      ['editingLevel', ed.editingLevel],
      ['software', ed.software.length > 0 ? ed.software.join(', ') : '—'],
      ['isAiGenerated', String(ed.isAiGenerated)],
      ['aiTool', ed.aiTool ?? '—']
    ];
    for (let i = 0; i < ed.hints.length; i++) {
      rows.push([`hint[${i}]`, ed.hints[i]]);
    }
    groups.push({ group: t('proGroupEditing'), rows });
  }

  // 7. Temporal analysis
  if (proData?.temporal && proData.temporal.length > 0) {
    const rows: ProRow[] = proData.temporal.map((insight, i) => [
      `[${i}] ${insight.severity}`,
      `${insight.fact}${insight.inference ? ` — ${insight.inference}` : ''}`
    ]);
    groups.push({ group: t('proGroupTemporal'), rows });
  }

  // 8. Fingerprints: the byte hash (exact copies) and the perceptual hash (what image search matches on)
  if (proData?.hash) {
    const rows: ProRow[] = [['sha256', proData.hash.sha256]];
    if (proData.hash.phash) rows.push(['phash', proData.hash.phash]);
    groups.push({ group: t('proGroupFingerprints'), rows });
  }

  // 8a. Vendor blocks
  if (metadata?.apple) {
    const a = metadata.apple;
    const rows: ProRow[] = [
      ['uptimeSeconds', a.uptimeSeconds != null ? String(Math.round(a.uptimeSeconds)) : '—'],
      ['livePhoto', String(a.livePhoto)],
      ['burst', String(a.burst)],
      ['captureType', a.captureType ?? '—'],
      ['hdr', a.hdr == null ? '—' : String(a.hdr)],
      ['cameraType', a.cameraType ?? '—'],
      ['tags', a.tags.map((tag) => '0x' + tag.toString(16).padStart(4, '0')).join(', ')]
    ];
    groups.push({ group: 'Apple MakerNote', rows });
  }
  if (metadata?.samsung) {
    const sm = metadata.samsung;
    const rows: ProRow[] = [
      ['trailerBytes', String(sm.bytes)],
      ['mcc', sm.mcc ?? '—'],
      ['imageUtc', sm.imageUtc ?? '—'],
      ['motionPhotoBytes', sm.motionPhotoBytes != null ? String(sm.motionPhotoBytes) : '—'],
      ['blocks', sm.blocks.map((b) => `${b.name} (${b.size})`).join(', ')]
    ];
    groups.push({ group: t('proGroupSamsung'), rows });
  }

  // 9. Serial numbers
  if (profile.serialNumbers.length > 0) {
    groups.push({
      group: t('proGroupSerials'),
      rows: profile.serialNumbers.map((s) => {
        const idx = s.indexOf(': ');
        return idx >= 0 ? [s.slice(0, idx), s.slice(idx + 2)] : [s, ''];
      })
    });
  }

  // 10. Object detections
  if (detections.length > 0) {
    const rows: ProRow[] = detections.map((d, i) => [
      `[${i}] ${d.label}`,
      `score=${d.score.toFixed(2)} x=${Math.round(d.x)} y=${Math.round(d.y)} w=${Math.round(d.width)} h=${Math.round(d.height)}`
    ]);
    groups.push({ group: t('proGroupDetections'), rows });
  }

  // 10a. QR codes and documents: the raw payload and the masked finding, as recognised.
  if (extras.qrCodes && extras.qrCodes.length > 0) {
    const rows: ProRow[] = extras.qrCodes.map((code, i) => [
      `[${i}] ${code.kind}`,
      `${code.raw} @ x=${Math.round(code.x)} y=${Math.round(code.y)} w=${Math.round(code.width)} h=${Math.round(code.height)}`
    ]);
    groups.push({ group: t('proGroupQr'), rows });
  }
  if (extras.pii && extras.pii.length > 0) {
    const rows: ProRow[] = extras.pii.map((finding, i) => [`[${i}] ${finding.kind}`, `${finding.sample} (regions ${finding.regions.join(', ') || '—'})`]);
    groups.push({ group: t('proGroupDocuments'), rows });
  }

  // 10b. The shot: heading, speed, GPS time, the clock offsets, the sun and the terrain.
  const stance = extras.stance;
  if (stance) {
    const rows: ProRow[] = [];
    if (stance.heading) rows.push(['heading', `${stance.heading.degrees}° (${stance.heading.point})`]);
    if (stance.speedKmh != null) rows.push(['speedKmh', `${stance.speedKmh} (${stance.movement ?? '—'})`]);
    rows.push(['orientation', stance.orientation ?? '—']);
    rows.push(['cameraSide', stance.cameraSide]);
    rows.push(['fovDegrees', String(stance.fovDegrees)]);
    if (stance.instant) {
      rows.push(['instantUtc', stance.instant.utc.toISOString()]);
      rows.push(['instantSource', stance.instant.source]);
      if (stance.instant.cameraOffsetMinutes != null) rows.push(['cameraOffset', `UTC${formatOffset(stance.instant.cameraOffsetMinutes)}`]);
    }
    if (stance.sun) rows.push(['sun', `altitude=${stance.sun.altitude}° azimuth=${stance.sun.azimuth}° ${stance.sun.phase}${stance.sun.relative ? ` relative=${stance.sun.relative}` : ''}`]);
    if (stance.elevation) rows.push(['terrain', `gps=${stance.elevation.gps}m terrain=${stance.elevation.terrain}m diff=${stance.elevation.difference}m (${stance.elevation.verdict})`]);
    groups.push({ group: t('proGroupShot'), rows });
  }

  // 11. OCR
  if (ocrResult) {
    const rows: ProRow[] = [
      ['regions', String(ocrResult.regions.length)],
      ['fullText', ocrResult.fullText.length > 500 ? ocrResult.fullText.slice(0, 500) + '...' : ocrResult.fullText]
    ];
    groups.push({ group: 'OCR', rows });
  }

  // 12. Structured metadata fields
  if (metadata) {
    const structured: ProRow[] = [];
    if (metadata.shotDate) structured.push(['shotDate', metadata.shotDate]);
    if (metadata.cameraMake) structured.push(['cameraMake', metadata.cameraMake]);
    if (metadata.cameraModel) structured.push(['cameraModel', metadata.cameraModel]);
    if (metadata.lensModel) structured.push(['lensModel', metadata.lensModel]);
    if (metadata.software) structured.push(['software', metadata.software]);
    if (metadata.exposureTime) structured.push(['exposureTime', metadata.exposureTime]);
    if (metadata.aperture != null) structured.push(['aperture', `f/${metadata.aperture}`]);
    if (metadata.iso != null) structured.push(['iso', String(metadata.iso)]);
    if (metadata.focalLength != null) structured.push(['focalLength', `${metadata.focalLength}mm`]);
    if (metadata.focalLength35mm != null) structured.push(['focalLength35mm', `${metadata.focalLength35mm}mm`]);
    if (metadata.gps) {
      structured.push(['gps.lat', String(metadata.gps.lat)]);
      structured.push(['gps.lon', String(metadata.gps.lon)]);
      if (metadata.gps.altitude != null) structured.push(['gps.altitude', `${metadata.gps.altitude}m`]);
      if (metadata.gps.accuracy != null) structured.push(['gps.accuracy', `±${metadata.gps.accuracy}m`]);
      if (metadata.gps.heading != null) structured.push(['gps.heading', `${metadata.gps.heading}°`]);
      if (metadata.gps.speed != null) structured.push(['gps.speed', `${metadata.gps.speed} km/h`]);
      if (metadata.gps.timestampUtc) structured.push(['gps.timestampUtc', metadata.gps.timestampUtc]);
    }
    // completeness is a 0..1 ratio (metadataScore.ts) — show it as a percentage.
    structured.push(['completeness', `${Math.round(metadata.completeness * 100)}/100`]);
    if (metadata.orientation) structured.push(['orientation', metadata.orientation]);
    if (structured.length > 0) {
      groups.push({ group: t('proGroupStructured'), rows: structured });
    }
  }

  // 13-16. Raw EXIF, XMP, IPTC, ICC
  if (metadata) {
    for (const [groupName, groupData] of Object.entries(metadata.groups)) {
      const data = groupData as Record<string, unknown>;
      if (!data || Object.keys(data).length === 0) continue;
      const entries = flattenEntries(data);
      if (entries.length > 0) {
        groups.push({ group: `Raw ${groupName.toUpperCase()}`, rows: entries });
      }
    }
  }


  return groups;
}
