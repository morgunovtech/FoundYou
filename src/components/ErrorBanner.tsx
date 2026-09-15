import React from 'react';
import { useT } from '../i18n';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onRetry, onDismiss }) => {
  const t = useT();
  return (
    <div className="fy-error" role="alert">
      <span>{message}</span>
      {onRetry || onDismiss ? (
        <div className="fy-error-actions">
          {onRetry ? (
            <button type="button" className="v4-btn fy-btn-sm" onClick={onRetry}>
              {t('retry')}
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="v4-btn fy-btn-sm" onClick={onDismiss} aria-label={t('dismiss')}>
              &times;
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
