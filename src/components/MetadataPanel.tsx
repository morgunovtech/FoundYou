import React, { useMemo } from 'react';
import { useI18n, useT, type MessageKey } from '../i18n';
import type { BasicFileInfo, StructuredMetadata } from '../types/metadata';
import { formatBytes, formatDimensions, formatMegapixels, formatDetailedDate, describeFileType } from '../utils/format';
import { inferCameraPosition } from '../utils/insights';

interface MetadataPanelProps {
  fileInfo: BasicFileInfo;
  metadata: StructuredMetadata | null;
}

export const MetadataPanel: React.FC<MetadataPanelProps> = ({ fileInfo, metadata }) => {
  const t = useT();
  const { lang } = useI18n();

  const displayMime = fileInfo.originalMimeType ?? fileInfo.mimeType;
  const { typeKey, format } = describeFileType(displayMime, fileInfo.originalName ?? fileInfo.file.name);
  const typeLabel = t(typeKey as MessageKey);
  const orientationKey = metadata?.orientation
    ? `orientation${capitalize(metadata.orientation)}`
    : 'orientationUnknown';

  const metadataFieldCount = useMemo(() => {
    if (!metadata) return 0;
    return ['exif', 'xmp', 'iptc', 'icc'].reduce((total, key) => {
      const group = metadata.groups[key as keyof typeof metadata.groups];
      return total + Object.keys(group ?? {}).length;
    }, 0);
  }, [metadata]);

  const formattedFieldCount = metadataFieldCount
    ? new Intl.NumberFormat(lang).format(metadataFieldCount)
    : t('emptyValue');

  const cameraSummary = useMemo(() => {
    if (!metadata) return null;
    const makeModel = [metadata.cameraMake, metadata.cameraModel].filter(Boolean).join(' ').trim();
    const position = inferCameraPosition(metadata);
    const positionKey =
      position === 'front'
        ? 'cameraPositionFrontShort'
        : position === 'rear'
        ? 'cameraPositionRearShort'
        : 'cameraPositionUnknownShort';
    const positionLabel = t(positionKey as MessageKey);
    const os = metadata.software ?? undefined;
    const parts = [makeModel || undefined, os, positionLabel].filter(
      (segment): segment is string => Boolean(segment && segment.length > 0)
    );

    return parts.length > 0 ? parts.join(', ') : null;
  }, [metadata, t]);

  const shotDate = metadata ? formatDetailedDate(metadata.shotDate, lang) : undefined;
  const basicsNotes = [
    t('basicInfoTimelineTip'),
    t('basicInfoFingerprintTip'),
    t('basicInfoDetailTip'),
    t('basicInfoMetadataCountTip'),
    t('basicInfoFormatSizeTip')
  ];

  return (
    <aside className="panel" aria-label={t('basicInfoTitle')}>
      <h2 className="section-title">{t('basicInfoTitle')}</h2>
      <p className="section-subtitle">{t('basicInfoSubtitle')}</p>
      <div className="metadata-grid">
        <MetadataItem label={t('nameLabelSource')} value={fileInfo.originalName ?? fileInfo.file.name} />
        <MetadataItem label={t('typeLabel')} value={typeLabel} />
        <MetadataItem label={t('formatLabelSource')} value={format} />
        <MetadataItem
          label={t('sizeLabelSource')}
          value={formatBytes(fileInfo.originalSizeBytes ?? fileInfo.sizeBytes)}
        />
        <MetadataItem
          label={t('resolutionLabel')}
          value={formatDimensions(fileInfo.originalWidth ?? fileInfo.width, fileInfo.originalHeight ?? fileInfo.height)}
        />
        <MetadataItem
          label={t('megapixelsLabel')}
          value={formatMegapixels(fileInfo.originalWidth ?? fileInfo.width, fileInfo.originalHeight ?? fileInfo.height)}
        />
        <MetadataItem label={t('orientationLabel')} value={t(orientationKey as MessageKey)} />
        <MetadataItem label={t('metadataFieldsLabel')} value={formattedFieldCount} />
        <MetadataItem label={t('shotDate')} value={shotDate ?? t('emptyValue')} />
        <MetadataItem label={t('cameraSummaryLabel')} value={cameraSummary ?? t('emptyValue')} />
      </div>
      <div className="metadata-notes" aria-label={t('basicInfoNotesTitle')}>
        <p className="metadata-notes__title">{t('basicInfoNotesTitle')}</p>
        <ul>
          {fileInfo.wasConverted ? <li>{t('basicInfoHeicNote')}</li> : null}
          {basicsNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
};

const MetadataItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="metadata-item">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
