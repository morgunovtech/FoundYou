import React from 'react';
import type { Stance } from '../utils/stance';

interface ShotDiagramProps {
  stance: Stance;
  /** Accessible name of the drawing. */
  label: string;
  /** Compass letters in the current language. */
  points: { n: string; e: string; s: string; w: string };
}

const CENTRE = 100;
const RIM = 82;
const CONE = 74;

/** Polar → SVG, clockwise from north. */
function polar(radius: number, degrees: number): [number, number] {
  const rad = (degrees * Math.PI) / 180;
  return [CENTRE + radius * Math.sin(rad), CENTRE - radius * Math.cos(rad)];
}

const fmt = (value: number) => value.toFixed(1);

/**
 * Top-down sketch of the shot: north up, the phone at the centre turned the way
 * the camera looked, the field of view as a wedge, the sun on the rim (hollow
 * when it was below the horizon). Purely decorative; the list next to it
 * carries the same facts in words.
 */
export const ShotDiagram: React.FC<ShotDiagramProps> = ({ stance, label, points }) => {
  const heading = stance.heading?.degrees ?? 0;
  const half = stance.fovDegrees / 2;
  const [x1, y1] = polar(CONE, heading - half);
  const [x2, y2] = polar(CONE, heading + half);
  const cone = `M${CENTRE},${CENTRE} L${fmt(x1)},${fmt(y1)} A${CONE},${CONE} 0 ${stance.fovDegrees > 180 ? 1 : 0},1 ${fmt(x2)},${fmt(y2)} Z`;
  const phone =
    stance.orientation === 'landscape'
      ? { w: 24, h: 13 }
      : stance.orientation === 'square'
        ? { w: 18, h: 18 }
        : { w: 13, h: 24 };
  const sun = stance.sun ? polar(RIM, stance.sun.azimuth) : null;

  return (
    <svg className="fy-shot-diagram" viewBox="0 0 200 200" role="img" aria-label={label}>
      <circle cx={CENTRE} cy={CENTRE} r={RIM} className="fy-shot-rim" />
      <line x1={CENTRE} y1={CENTRE - RIM} x2={CENTRE} y2={CENTRE - RIM + 6} className="fy-shot-tick" />
      <line x1={CENTRE + RIM} y1={CENTRE} x2={CENTRE + RIM - 6} y2={CENTRE} className="fy-shot-tick" />
      <line x1={CENTRE} y1={CENTRE + RIM} x2={CENTRE} y2={CENTRE + RIM - 6} className="fy-shot-tick" />
      <line x1={CENTRE - RIM} y1={CENTRE} x2={CENTRE - RIM + 6} y2={CENTRE} className="fy-shot-tick" />
      <text x={CENTRE} y={CENTRE - RIM - 6} textAnchor="middle">
        {points.n}
      </text>
      <text x={CENTRE + RIM + 7} y={CENTRE + 3} textAnchor="start">
        {points.e}
      </text>
      <text x={CENTRE} y={CENTRE + RIM + 13} textAnchor="middle">
        {points.s}
      </text>
      <text x={CENTRE - RIM - 7} y={CENTRE + 3} textAnchor="end">
        {points.w}
      </text>

      {stance.heading ? <path d={cone} className="fy-shot-cone" /> : null}

      {sun ? (
        <>
          <line x1={CENTRE} y1={CENTRE} x2={fmt(sun[0])} y2={fmt(sun[1])} className="fy-shot-ray" />
          <circle
            cx={fmt(sun[0])}
            cy={fmt(sun[1])}
            r={6}
            className={stance.sun && stance.sun.altitude >= 0 ? 'fy-shot-sun' : 'fy-shot-sun fy-shot-sun--set'}
          />
        </>
      ) : null}

      <g transform={`rotate(${stance.heading ? heading : 0} ${CENTRE} ${CENTRE})`}>
        <rect
          x={CENTRE - phone.w / 2}
          y={CENTRE - phone.h / 2}
          width={phone.w}
          height={phone.h}
          className="fy-shot-phone"
        />
        {stance.heading ? (
          <line
            x1={CENTRE}
            y1={CENTRE - phone.h / 2}
            x2={CENTRE}
            y2={CENTRE - phone.h / 2 - 8}
            className="fy-shot-nose"
          />
        ) : null}
      </g>
    </svg>
  );
};
