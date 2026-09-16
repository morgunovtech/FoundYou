import React, { useState } from 'react';
import type { OCRResult } from '../../hooks/useOCR';
import { useT } from '../../i18n';

interface TextDetailsProps {
  ocrResult: OCRResult | null;
  ocrLoading: boolean;
  ocrError: string | null;
  ocrProgressLabel: string | null;
}

/** «Текст на снимке» rows: the OCR progress or error, else the recognised text with an expand button. */
export const TextDetails: React.FC<TextDetailsProps> = ({ ocrResult, ocrLoading, ocrError, ocrProgressLabel }) => {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  if (ocrLoading) {
    return (
      <p className="fy-hint" role="status">
        {ocrProgressLabel ?? t('factTextLoading')}
      </p>
    );
  }
  if (ocrError) {
    return (
      <p className="fy-hint" role="alert">
        {ocrError}
      </p>
    );
  }
  if (!ocrResult || ocrResult.regions.length < 2 || ocrResult.fullText.trim().length === 0) {
    return <p className="fy-hint">{t('factTextNone')}</p>;
  }
  return (
    <div className="fy-fact-details">
      <p className="fy-hint">{t('ocrBlurHint')}</p>
      <div className="fy-ocr-text">
        <pre className={`fy-ocr-pre ${expanded ? 'is-expanded' : ''}`}>{ocrResult.fullText}</pre>
        {ocrResult.fullText.length > 200 && !expanded ? (
          <button type="button" className="v4-btn fy-btn-sm fy-ocr-more" aria-label={t('showAction')} onClick={() => setExpanded(true)}>
            …
          </button>
        ) : null}
      </div>
    </div>
  );
};
