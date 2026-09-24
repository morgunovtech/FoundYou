import React from 'react';
import type { GeoContext } from '../../hooks/useGeoContext';
import type { StructuredMetadata } from '../../types/metadata';
import type { TimeProfile } from '../../utils/timeProfile';
import { formatOffset } from '../../utils/stance';
import { formatDetailedDate, formatMinutesDuration } from '../../utils/format';
import { useI18n, useT } from '../../i18n';
import { RetryButton } from './RetryButton';

interface TimeDetailsProps {
  timeProfile: TimeProfile;
  geo: GeoContext;
  metadata: StructuredMetadata | null;
  remote: boolean;
}

/**
 * «Когда сделан снимок» rows under the headline (age, date, weekday, day kind, time of day and
 * the clock — see `timeHeadline`): one time-zone row with the camera and the place and the
 * difference between the two with the local clock. The drift against GPS time is an
 * authenticity sign and lives in the file history. Facts only; what the owner was doing at
 * that hour is not inferred.
 */
export const TimeDetails: React.FC<TimeDetailsProps> = ({ timeProfile: tp, geo, metadata, remote }) => {
  const t = useT();
  const { lang } = useI18n();

  const placeZoneText = (() => {
    if (!metadata?.gps) return null;
    if (tp.place) return `${tp.place.timezone}, UTC${formatOffset(tp.place.offsetMinutes)}`;
    if (geo.weather.status.loading) return t('insightCompactLoading');
    return t('timePlaceZoneUnavailable');
  })();

  const diffText = (() => {
    if (!tp.clock) return null;
    if (tp.clock.match) return t('timeDiffMatch');
    const delta = formatMinutesDuration(tp.clock.differenceMinutes, t);
    const head = tp.clock.differenceMinutes > 0 ? t('timeDiffAhead', { delta }) : t('timeDiffBehind', { delta });
    const when = tp.clock.sameDay
      ? tp.clock.local.slice(11, 16)
      : (formatDetailedDate(tp.clock.local, lang) ?? tp.clock.local);
    return `${head}; ${t('timeLocalClock', { when })}`;
  })();

  return (
    <div className="fy-fact-details">
      <dl className="fy-spec fy-spec--tight">
        <dt>{t('timeZone')}</dt>
        <dd>
          <span className="fy-zone-part">
            <b>{t('timeZoneCamera')}</b>
            {tp.camera ? (
              <>
                <span className="fy-mono">{`UTC${formatOffset(tp.camera.offsetMinutes)}`}</span>
                <span className="fy-muted">
                  {tp.camera.source === 'exif-offset'
                    ? t('timeCameraZoneExif')
                    : tp.camera.assumed
                      ? t('timeCameraZoneAssumed')
                      : t('timeCameraZoneGps')}
                </span>
              </>
            ) : (
              <span>{t('timeCameraZoneUnknown')}</span>
            )}
          </span>
          {placeZoneText ? (
            <span className="fy-zone-part">
              <b>{t('timeZonePlace')}</b>
              <span>{placeZoneText}</span>
              {!tp.place && remote ? <RetryButton status={geo.weather.status} /> : null}
            </span>
          ) : null}
        </dd>
        {diffText ? (
          <>
            <dt>{t('timeDiff')}</dt>
            <dd>{diffText}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
};
