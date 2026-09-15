import React, { useMemo } from 'react';
import { useI18n, useT, type MessageKey } from '../i18n';
import type { BasicFileInfo, StructuredMetadata } from '../types/metadata';
import { formatBytes, formatDimensions, formatMegapixels, formatDetailedDate, describeFileType } from '../utils/format';
import { inferCameraPosition } from '../utils/insights';

interface MetadataPanelProps {
  fileInfo: BasicFileInfo;
  metadata: StructuredMetadata | null;
}

const MetadataPanelInner: React.FC<MetadataPanelProps> = ({ fileInfo, metadata }) => {
  const t = useT();
  const { lang } = useI18n();

  const displayMime = fileInfo.originalMimeType ?? fileInfo.mimeType;
  const { typeKey, format } = describeFileType(displayMime, fileInfo.originalName ?? fileInfo.file.name);
  const typeLabel = t(typeKey as MessageKey);
  const orientationKey = metadata?.orientation ? `orientation${capitalize(metadata.orientation)}` : 'orientationUnknown';

  const metadataFieldCount = useMemo(() => {
    if (!metadata) return 0;
    return ['exif', 'xmp', 'iptc', 'icc', 'png'].reduce((total, key) => {
      const group = metadata.groups[key as keyof typeof metadata.groups];
      return total + Object.keys(group ?? {}).length;
    }, 0);
  }, [metadata]);

  const formattedFieldCount = metadataFieldCount ? new Intl.NumberFormat(lang).format(metadataFieldCount) : t('emptyValue');

  const cameraSummary = useMemo(() => {
    if (!metadata) return null;
    const makeModel = [metadata.cameraMake, metadata.cameraModel].filter(Boolean).join(' ').trim();
    const position = inferCameraPosition(metadata);
    const positionKey =
      position === 'front' ? 'cameraPositionFrontShort' : position === 'rear' ? 'cameraPositionRearShort' : 'cameraPositionUnknownShort';
    const positionLabel = t(positionKey as MessageKey);
    const os = metadata.software ?? undefined;
    const parts = [makeModel || undefined, os, positionLabel].filter(
      (segment): segment is string => Boolean(segment && segment.length > 0)
    );

    return parts.length > 0 ? parts.join(', ') : null;
  }, [metadata, t]);

  const shotDate = metadata ? formatDetailedDate(metadata.shotDateLocal ?? metadata.shotDate, lang) : undefined;
  const basicsNotes = [
    t('basicInfoTimelineTip'),
    t('basicInfoFingerprintTip'),
    t('basicInfoDetailTip'),
    t('basicInfoMetadataCountTip'),
    t('basicInfoFormatSizeTip')
  ];

  const rows: Array<[string, string]> = [
    [t('nameLabelSource'), fileInfo.originalName ?? fileInfo.file.name],
    [t('typeLabel'), typeLabel],
    [t('formatLabelSource'), format],
    [t('sizeLabelSource'), formatBytes(fileInfo.originalSizeBytes ?? fileInfo.sizeBytes, lang)],
    [t('resolutionLabel'), formatDimensions(fileInfo.width, fileInfo.height)],
    [t('megapixelsLabel'), formatMegapixels(fileInfo.width, fileInfo.height)],
    [t('orientationLabel'), t(orientationKey as MessageKey)],
    [t('metadataFieldsLabel'), formattedFieldCount],
    [t('shotDate'), shotDate ?? t('emptyValue')],
    [t('cameraSummaryLabel'), cameraSummary ?? t('emptyValue')]
  ];

  return (
    <aside className="fy-card" aria-labelledby="basic-info-title">
      <h3 className="v4-h3" id="basic-info-title">
        {t('basicInfoTitle')}
      </h3>
      <p className="fy-hint">{t('basicInfoSubtitle')}</p>
      <dl className="fy-spec">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="fy-notes">
        <h4 className="v4-h3">{t('basicInfoNotesTitle')}</h4>
        <ul className="v4-list">
          {fileInfo.wasConverted ? <li>{t('basicInfoHeicNote')}</li> : null}
          {basicsNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
};

export const MetadataPanel = React.memo(MetadataPanelInner);
MetadataPanel.displayName = 'MetadataPanel';

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
