import React, { useMemo, useState } from 'react';
import type { DigitalProfile } from '../utils/heuristics/digitalProfile';
import { generateReport } from '../utils/heuristics/digitalProfile';
import type { StructuredMetadata, BasicFileInfo } from '../types/metadata';
import type { BoundingBox } from '../types/detection';
import type { OCRResult } from '../hooks/useOCR';
import type { ProData } from '../App';
import { useT } from '../i18n';
import { SectionHead } from './SectionHead';

interface ProfileBlockProps {
  profile: DigitalProfile | null;
  lang: 'ru' | 'en' | 'uz';
  metadata: StructuredMetadata | null;
  proData: ProData | null;
  fileInfo: BasicFileInfo | null;
  detections: BoundingBox[];
  ocrResult: OCRResult | null;
}

type Row = [string, string];

/** Raw XMP/ICC dumps can run to thousands of rows; render this many and offer the rest on demand. */
const PRO_ROW_CAP = 200;

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

function flattenEntries(obj: Record<string, unknown>, prefix = ''): Row[] {
  const rows: Row[] = [];
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

function buildProGroups(
  profile: DigitalProfile,
  metadata: StructuredMetadata | null,
  proData: ProData | null,
  fileInfo: BasicFileInfo | null,
  detections: BoundingBox[],
  ocrResult: OCRResult | null,
  lang: string
): Array<{ group: string; rows: Row[] }> {
  const groups: Array<{ group: string; rows: Row[] }> = [];

  // 1. Leak score + profile sections
  const profileRows: Row[] = [
    ['Leak Score', `${profile.leakScore}/100 (${profile.leakLevel.label})`],
    ...profile.sections.map(
      (s) =>
        [
          s.title,
          `${s.text}${s.subtext ? ` — ${s.subtext}` : ''}${s.threatScenario ? ` [${s.threatScenario}]` : ''}`
        ] as Row
    )
  ];
  groups.push({ group: lang === 'ru' ? 'Профиль' : 'Profile', rows: profileRows });

  // 2. File info
  if (fileInfo) {
    const fileRows: Row[] = [
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
    groups.push({ group: lang === 'ru' ? 'Файл' : 'File', rows: fileRows });
  }

  // 3. Filename heuristics
  if (proData?.filename) {
    const fn = proData.filename;
    const rows: Row[] = [
      ['platform', fn.platform ?? '—'],
      ['device', fn.device || '—'],
      ['confidence', fn.confidence > 0 ? `${(fn.confidence * 100).toFixed(0)}%` : '—']
    ];
    if (fn.photoIndex != null) rows.push(['photoIndex', String(fn.photoIndex)]);
    if (fn.estimatedMonths != null) rows.push(['estimatedMonthsOfUse', String(fn.estimatedMonths)]);
    groups.push({ group: lang === 'ru' ? 'Эвристика: имя файла' : 'Heuristic: filename', rows });
  }

  // 4. Resolution heuristics
  if (proData?.resolution) {
    const res = proData.resolution;
    const rows: Row[] = [
      ['possibleDevices', res.possibleDevices.length > 0 ? res.possibleDevices.join(', ') : '—'],
      ['contentType', res.contentType],
      ['contentHint', res.contentHint || '—'],
      ['isScreenshot', String(res.isScreenshot)]
    ];
    groups.push({ group: lang === 'ru' ? 'Эвристика: разрешение' : 'Heuristic: resolution', rows });
  }

  // 5. Stripped detection
  if (proData?.stripped) {
    const st = proData.stripped;
    const rows: Row[] = [
      ['stripped', String(st.stripped)],
      ['strippedBy', st.strippedBy ?? '—'],
      ['confidence', st.confidence > 0 ? `${(st.confidence * 100).toFixed(0)}%` : '—']
    ];
    for (let i = 0; i < st.evidence.length; i++) {
      rows.push([`evidence[${i}]`, st.evidence[i]]);
    }
    groups.push({ group: lang === 'ru' ? 'Эвристика: стрипнутые метаданные' : 'Heuristic: stripped metadata', rows });
  }

  // 6. Editing history
  if (proData?.editing) {
    const ed = proData.editing;
    const rows: Row[] = [
      ['edited', String(ed.edited)],
      ['editingLevel', ed.editingLevel],
      ['software', ed.software.length > 0 ? ed.software.join(', ') : '—'],
      ['isAiGenerated', String(ed.isAiGenerated)],
      ['aiTool', ed.aiTool ?? '—']
    ];
    for (let i = 0; i < ed.hints.length; i++) {
      rows.push([`hint[${i}]`, ed.hints[i]]);
    }
    groups.push({ group: lang === 'ru' ? 'Эвристика: редактирование' : 'Heuristic: editing', rows });
  }

  // 7. Temporal analysis
  if (proData?.temporal && proData.temporal.length > 0) {
    const rows: Row[] = proData.temporal.map((t, i) => [
      `[${i}] ${t.severity}`,
      `${t.fact}${t.inference ? ` — ${t.inference}` : ''}`
    ]);
    groups.push({ group: lang === 'ru' ? 'Эвристика: время' : 'Heuristic: temporal', rows });
  }

  // 8. Hash
  if (proData?.hash) {
    groups.push({ group: 'SHA-256', rows: [['sha256', proData.hash.sha256]] });
  }

  // 9. Serial numbers
  if (profile.serialNumbers.length > 0) {
    groups.push({
      group: lang === 'ru' ? 'Серийные номера' : 'Serial Numbers',
      rows: profile.serialNumbers.map((s) => {
        const idx = s.indexOf(': ');
        return idx >= 0 ? [s.slice(0, idx), s.slice(idx + 2)] : [s, ''];
      })
    });
  }

  // 10. Object detections
  if (detections.length > 0) {
    const rows: Row[] = detections.map((d, i) => [
      `[${i}] ${d.label}`,
      `score=${d.score.toFixed(2)} x=${Math.round(d.x)} y=${Math.round(d.y)} w=${Math.round(d.width)} h=${Math.round(d.height)}`
    ]);
    groups.push({ group: lang === 'ru' ? 'Детекции объектов' : 'Object detections', rows });
  }

  // 11. OCR
  if (ocrResult) {
    const rows: Row[] = [
      ['regions', String(ocrResult.regions.length)],
      ['fullText', ocrResult.fullText.length > 500 ? ocrResult.fullText.slice(0, 500) + '...' : ocrResult.fullText]
    ];
    groups.push({ group: 'OCR', rows });
  }

  // 12. Structured metadata fields
  if (metadata) {
    const structured: Row[] = [];
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
    }
    // completeness is a 0..1 ratio (metadataScore.ts) — show it as a percentage.
    structured.push(['completeness', `${Math.round(metadata.completeness * 100)}/100`]);
    if (metadata.orientation) structured.push(['orientation', metadata.orientation]);
    if (structured.length > 0) {
      groups.push({ group: lang === 'ru' ? 'Структурированные поля' : 'Structured Fields', rows: structured });
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

const ProfileBlockInner: React.FC<ProfileBlockProps> = ({ profile, lang, metadata, proData, fileInfo, detections, ocrResult }) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [proMode, setProMode] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const proGroups = useMemo(
    () => (proMode && profile ? buildProGroups(profile, metadata, proData, fileInfo, detections, ocrResult, lang) : []),
    [proMode, profile, metadata, proData, fileInfo, detections, ocrResult, lang]
  );

  if (!profile || profile.sections.length === 0) return null;

  const handleCopy = () => {
    const report = generateReport(profile, lang);
    navigator.clipboard
      .writeText(report)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard API denied (iframe, permissions policy) — nothing else to fall back to here.
        console.warn('clipboard-write-denied');
      });
  };

  const handleDownload = () => {
    const report = generateReport(profile, lang);
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'foundyou-report.txt';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(link);
    }, 1000);
  };

  const scorePercent = Math.min(100, Math.max(0, profile.leakScore));

  return (
    <section className="v4-section" aria-labelledby="sec-profile">
      <SectionHead num="03" title={t('profileTitle')} id="sec-profile">
        <button type="button" className="v4-btn fy-btn-sm" aria-pressed={proMode} onClick={() => setProMode(!proMode)}>
          {t('proMode')}
        </button>
      </SectionHead>
      <div className="fy-card">
        {proMode ? (
          <div className="fy-pro">
            {proGroups.map((group) => {
              const expanded = Boolean(expandedGroups[group.group]);
              const visibleRows = expanded ? group.rows : group.rows.slice(0, PRO_ROW_CAP);
              const hiddenCount = group.rows.length - visibleRows.length;
              return (
                <div key={group.group} className="fy-pro-group">
                  <h3 className="v4-h3">{group.group}</h3>
                  <div className="fy-table-scroll">
                    <table className="fy-pro-table">
                      <tbody>
                        {visibleRows.map(([key, value], ri) => (
                          <tr key={`${key}-${ri}`}>
                            <td>{key}</td>
                            <td>{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {hiddenCount > 0 ? (
                    <button
                      type="button"
                      className="v4-btn fy-btn-sm"
                      onClick={() => setExpandedGroups((prev) => ({ ...prev, [group.group]: true }))}
                    >
                      {t('showMore', { count: hiddenCount })}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div className="fy-score" data-level={profile.leakLevel.level}>
              <div className="fy-score-bar">
                <div className="fy-score-fill" style={{ width: `${scorePercent}%` }} />
              </div>
              <div className="fy-score-label">
                <span className="fy-score-value">{profile.leakScore}/100</span>
                <span className="fy-score-level">{profile.leakLevel.label}</span>
              </div>
              <p className="fy-score-desc">{profile.leakLevel.description}</p>
            </div>

            <div className="fy-findings">
              {profile.sections.map((section, idx) => {
                const expandable = Boolean(section.threatScenario);
                const expanded = expandedIdx === idx;
                return (
                  <button
                    type="button"
                    key={`${section.title}-${idx}`}
                    className="fy-finding"
                    data-severity={section.severity}
                    aria-expanded={expandable ? expanded : undefined}
                    onClick={() => (expandable ? setExpandedIdx(expanded ? null : idx) : undefined)}
                  >
                    <div className="fy-finding-head">
                      <span className="fy-finding-title">{section.title}</span>
                      {section.leakPoints > 0 ? <span className="fy-finding-points">+{section.leakPoints}</span> : null}
                    </div>
                    <div className="fy-finding-text">{section.text}</div>
                    {section.subtext ? <div className="fy-finding-sub">{section.subtext}</div> : null}
                    {expanded && section.threatScenario ? <div className="fy-finding-threat">{section.threatScenario}</div> : null}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="fy-actions">
          <button type="button" className="v4-btn fy-btn-sm" onClick={handleCopy}>
            {copied ? t('copied') : t('copyReport')}
          </button>
          <button type="button" className="v4-btn fy-btn-sm" onClick={handleDownload}>
            {t('downloadTxt')}
          </button>
        </div>
      </div>
    </section>
  );
};

export const ProfileBlock = React.memo(ProfileBlockInner);
ProfileBlock.displayName = 'ProfileBlock';
