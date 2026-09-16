import React from 'react';
import { useT } from '../../i18n';
import type { RemoteStatus } from '../../hooks/useGeoContext';

/** «Повторить» for a failed lookup that may succeed on a second try; nothing otherwise. */
export const RetryButton: React.FC<{ status: RemoteStatus }> = ({ status }) => {
  const t = useT();
  if (!status.error || !status.retryable) return null;
  return (
    <button type="button" className="v4-btn fy-btn-sm" onClick={status.retry}>
      {t('retry')}
    </button>
  );
};
