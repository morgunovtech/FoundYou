import React from 'react';
import type { GeoContext } from '../../hooks/useGeoContext';
import type { StructuredMetadata } from '../../types/metadata';
import { DRIFT_EXACT_SECONDS, type TimeProfile } from '../../utils/timeProfile';
import { formatOffset } from '../../utils/stance';
import { formatDetailedDate, formatMinutesDuration, formatSecondsDuration } from '../../utils/format';
import { useI18n, useT } from '../../i18n';
import { RetryButton } from './RetryButton';
import { AGE_KEYS, DAY_KIND_KEYS, TIME_OF_DAY_KEYS } from './storyKeys';

interface TimeDetailsProps {
  timeProfile: TimeProfile;
  geo: GeoContext;
  metadata: StructuredMetadata | null;
  remote: boolean;
}

/**
 * «Когда сделан снимок» rows: the day and the time of day, the camera zone, the place zone,
 * the difference between the two with the local clock, the drift against GPS time, the age.
 * Facts only; what the owner was doing at that hour is not inferred.
 */
export const TimeDetails: React.FC<TimeDetailsProps> = ({ timeProfile: tp, geo, metadata, remote }) => {
  const t = useT();
  const { lang } = useI18n();
  const dayText = `${
    tp.dayKind === 'holiday'
      ? t('dayHoliday', { names: tp.holidayNames.join(', ') })
      : tp.dayKind === 'weekday' && tp.workingHours
      ? t('dayWorkingHours')
      : t(DAY_KIND_KEYS[tp.dayKind])
  }, ${t(TIME_OF_DAY_KEYS[tp.timeOfDay])}`;

  const placeZoneText = (() => {
    if (!metadata?.gps) return null;
    if (!geo.enabled) return t('timePlaceZoneOff');
    if (tp.place) return `${tp.place.timezone}, UTC${formatOffset(tp.place.offsetMinutes)}`;
    if (geo.weather.status.loading) return t('insightCompactLoading');
    return t('timePlaceZoneUnavailable');
  })();

  const diffText = (() => {
    if (!tp.clock) return null;
    if (tp.clock.match) return t('timeDiffMatch');
    const delta = formatMinutesDuration(tp.clock.differenceMinutes, t);
    const head = tp.clock.differenceMinutes > 0 ? t('timeDiffAhead', { delta }) : t('timeDiffBehind', { delta });
    const when = tp.clock.sameDay ? tp.clock.local.slice(11, 16) : formatDetailedDate(tp.clock.local, lang) ?? tp.clock.local;
    return `${head}; ${t('timeLocalClock', { when })}`;
  })();

  return (
    <div className="fy-fact-details">
      <dl className="fy-spec fy-spec--tight">
        <dt>{t('timeDay')}</dt>
        <dd>{dayText}</dd>
        <dt>{t('timeCameraZone')}</dt>
        <dd>
          {tp.camera ? (
            <>
              <span className="fy-mono">{`UTC${formatOffset(tp.camera.offsetMinutes)}`}</span>
              <span className="fy-muted">{tp.camera.source === 'exif-offset' ? t('timeCameraZoneExif') : t('timeCameraZoneGps')}</span>
            </>
          ) : (
            <span>{t('timeCameraZoneUnknown')}</span>
          )}
        </dd>
        {placeZoneText ? (
          <>
            <dt>{t('timePlaceZone')}</dt>
            <dd>
              <span>{placeZoneText}</span>
              {!tp.place && remote ? <RetryButton status={geo.weather.status} /> : null}
            </dd>
          </>
        ) : null}
        {diffText ? (
          <>
            <dt>{t('timeDiff')}</dt>
            <dd>{diffText}</dd>
          </>
        ) : null}
        {tp.driftSeconds != null ? (
          <>
            <dt>{t('timeDrift')}</dt>
            <dd>
              <span>
                {Math.abs(tp.driftSeconds) <= DRIFT_EXACT_SECONDS
                  ? t('driftExact', { seconds: DRIFT_EXACT_SECONDS })
                  : tp.driftSeconds > 0
                  ? t('driftAhead', { delta: formatSecondsDuration(tp.driftSeconds, t) })
                  : t('driftBehind', { delta: formatSecondsDuration(-tp.driftSeconds, t) })}
              </span>
              <span className="fy-muted">{t('driftHint')}</span>
            </dd>
          </>
        ) : null}
        <dt>{t('timeAge')}</dt>
        <dd>{t(AGE_KEYS[tp.age.kind], { count: tp.age.value })}</dd>
      </dl>
    </div>
  );
};
