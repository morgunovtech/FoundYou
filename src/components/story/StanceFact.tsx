import React from 'react';
import type { GeoContext } from '../../hooks/useGeoContext';
import type { StructuredMetadata } from '../../types/metadata';
import type { Stance } from '../../utils/stance';
import { useT } from '../../i18n';
import { formatCoords } from '../../utils/insightsCompact';
import { ShotDiagram } from '../ShotDiagram';
import { FactRow } from './FactRow';
import { RetryButton } from './RetryButton';
import { COMPASS_KEYS, SUN_PHASE_KEYS, SUN_RELATIVE_KEYS, TERRAIN_KEYS, TIME_SOURCE_KEYS } from './storyKeys';

interface StanceFactProps {
  stance: Stance;
  geo: GeoContext;
  metadata: StructuredMetadata | null;
  remote: boolean;
  accuracyLabel: string | null;
}

/**
 * «Как был сделан снимок»: where the photographer stood, where the camera looked, how the
 * phone was held, where the sun was, whether they moved, and the GPS altitude against the
 * terrain, next to the top-down sketch.
 */
export const StanceFact: React.FC<StanceFactProps> = ({ stance, geo, metadata, remote, accuracyLabel }) => {
  const t = useT();
  if (!geo.coords) return null;
  const held =
    stance.orientation === 'landscape'
      ? t('stanceHeldLandscape')
      : stance.orientation === 'square'
      ? t('stanceHeldSquare')
      : stance.orientation === 'portrait'
      ? t('stanceHeldPortrait')
      : t('stanceHeldUnknown');
  const camera =
    stance.cameraSide === 'front' ? t('stanceCameraFront') : stance.cameraSide === 'rear' ? t('stanceCameraRear') : t('stanceCameraUnknown');
  const sunText = (() => {
    if (!stance.sun || !stance.instant) return t('stanceSunUnknown');
    const source = t(TIME_SOURCE_KEYS[stance.instant.source]);
    if (stance.sun.phase === 'night') return `${t('stancePhaseNight', { altitude: stance.sun.altitude })} (${source})`;
    const relative = stance.sun.relative ? `${t(SUN_RELATIVE_KEYS[stance.sun.relative])}, ` : '';
    return `${relative}${t('stanceSunAltitude', { altitude: stance.sun.altitude })}, ${t(SUN_PHASE_KEYS[stance.sun.phase])} (${source})`;
  })();
  const speedText =
    stance.speedKmh == null || stance.movement == null
      ? t('stanceSpeedUnknown')
      : stance.movement === 'still'
      ? t('stanceStill')
      : stance.movement === 'walking'
      ? t('stanceWalking', { speed: stance.speedKmh })
      : t('stanceVehicle', { speed: stance.speedKmh });
  const terrainText = (() => {
    if (stance.elevation) {
      return t(TERRAIN_KEYS[stance.elevation.verdict], {
        gps: stance.elevation.gps,
        terrain: stance.elevation.terrain,
        diff: Math.abs(stance.elevation.difference)
      });
    }
    if (metadata?.gps?.altitude == null) return t('stanceTerrainNoGps');
    if (!remote) return t('stanceTerrainPending');
    if (geo.elevation.status.loading) return t('insightCompactLoading');
    if (geo.elevation.status.error) return t('stanceTerrainUnavailable');
    return t('stanceTerrainPending');
  })();
  return (
    <FactRow title={t('stanceTitle')} severity="low" value={null} sub={null} soWhat={t('stanceSoWhat')}>
      <div className="fy-fact-details fy-shot">
        <ShotDiagram
          stance={stance}
          label={t('stanceDiagramLabel')}
          points={{ n: t('compassShortN'), e: t('compassShortE'), s: t('compassShortS'), w: t('compassShortW') }}
        />
        <dl className="fy-spec fy-spec--tight">
          <dt>{t('stanceStood')}</dt>
          <dd>
            <span className="fy-mono">{formatCoords(geo.coords.lat, geo.coords.lon)}</span>
            {accuracyLabel ? <span className="fy-muted">{accuracyLabel}</span> : null}
          </dd>
          <dt>{t('stanceLooked')}</dt>
          <dd>
            {stance.heading
              ? t('stanceHeading', { point: t(COMPASS_KEYS[stance.heading.point]), degrees: stance.heading.degrees })
              : t('stanceHeadingUnknown')}
          </dd>
          <dt>{t('stanceHeld')}</dt>
          <dd>{`${held}, ${camera}, ${t('stanceFov', { fov: stance.fovDegrees })}`}</dd>
          <dt>{t('stanceSun')}</dt>
          <dd>{sunText}</dd>
          <dt>{t('stanceSpeed')}</dt>
          <dd>{speedText}</dd>
          <dt>{t('stanceTerrain')}</dt>
          <dd>
            <span>{terrainText}</span>
            {!stance.elevation && remote ? <RetryButton status={geo.elevation.status} /> : null}
          </dd>
        </dl>
      </div>
    </FactRow>
  );
};
