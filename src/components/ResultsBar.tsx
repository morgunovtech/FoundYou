import React, { useMemo } from 'react';
import type { BasicFileInfo } from '../types/metadata';
import type { DigitalProfile } from '../utils/heuristics/digitalProfile';
import { useT } from '../i18n';
import { buildVerdict } from '../utils/story';

interface ResultsBarProps {
  fileInfo: BasicFileInfo;
  profile: DigitalProfile | null;
  onMakeSafeCopy: () => void;
}

/**
 * The strip right under the upload zone once a photo is loaded: the file name,
 * one line about what was found, and the primary action. The user path is
 * «opened the site, dropped a photo, made a safe copy»; the sections below
 * are for those who want to read what the file gives away.
 */
export const ResultsBar: React.FC<ResultsBarProps> = ({ fileInfo, profile, onMakeSafeCopy }) => {
  const t = useT();
  const verdict = useMemo(() => (profile ? buildVerdict(profile, t) : null), [profile, t]);
  const status = !verdict
    ? t('barAnalyzing')
    : verdict.reasons.length > 0
    ? t('barFound', { items: verdict.reasons.join(', ') })
    : t('barClean');
  return (
    <div className="fy-card fy-results-bar" data-level={verdict?.level ?? 'pending'}>
      <div className="fy-results-bar-text">
        <p className="fy-results-bar-file">{fileInfo.originalName ?? fileInfo.file.name}</p>
        <p className="fy-results-bar-status" role="status" aria-live="polite">
          {status}
        </p>
      </div>
      <div className="fy-actions">
        <button type="button" className="v4-btn v4-btn-primary" onClick={onMakeSafeCopy}>
          {t('verdictCta')}
        </button>
      </div>
    </div>
  );
};
