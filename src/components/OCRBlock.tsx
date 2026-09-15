import React, { useState } from 'react';
import { useT } from '../i18n';
import type { OCRResult } from '../hooks/useOCR';
import { SectionHead } from './SectionHead';

interface OCRBlockProps {
  result: OCRResult | null;
  loading: boolean;
  error: string | null;
  progress: { label: string; value: number } | null;
}

export const OCRBlock: React.FC<OCRBlockProps> = ({ result, loading, error, progress }) => {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  if (!loading && !error && !result) return null;

  return (
    <section className="v4-section" aria-labelledby="sec-ocr">
      <SectionHead num="02" title={t('ocrTitle')} id="sec-ocr" />
      <div className="fy-card">
        {loading && progress ? (
          <div className="fy-progress" aria-live="polite">
            <div className="fy-progress-text">{progress.label}</div>
            <div
              className="fy-progress-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.value * 100)}
            >
              <span style={{ width: `${Math.min(100, Math.max(0, progress.value * 100))}%` }} />
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="fy-hint" role="alert">
            {error}
          </p>
        ) : null}

        {result && !loading ? (
          result.fullText.length === 0 ? (
            <p className="fy-hint">{t('ocrEmpty')}</p>
          ) : (
            <>
              <p className="fy-hint">
                {t('ocrFound', { count: result.regions.length })} {t('ocrBlurHint')}
              </p>
              <div className="fy-ocr-text">
                <pre className={`fy-ocr-pre ${expanded ? 'is-expanded' : ''}`}>{result.fullText}</pre>
                {result.fullText.length > 200 && !expanded ? (
                  <button type="button" className="v4-btn fy-btn-sm fy-ocr-more" onClick={() => setExpanded(true)}>
                    …
                  </button>
                ) : null}
              </div>
            </>
          )
        ) : null}
      </div>
    </section>
  );
};
