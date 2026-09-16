/*
 * Does the exposure agree with the sun? The sun's height above the horizon at the moment and
 * place of the shot is known (`stance.sun`); the camera settings say how much light there was.
 * EV100 = log2(N² / t) − log2(ISO / 100): full daylight sits at 12–16, a lit room at 5–8,
 * a night street at 0–4. A «night» shot exposed like daylight (no flash) has the wrong time,
 * place or zone in its EXIF. Pure.
 */

export interface LightInput {
  /** Degrees above the horizon; negative at night. */
  sunAltitude: number | null;
  /** ExposureTime in seconds. */
  exposureSeconds: number | null;
  fNumber: number | null;
  iso: number | null;
  flashFired: boolean | null;
}

export type LightVerdict = 'night-daylight-exposure' | 'day-dark-exposure' | 'consistent' | 'no-exposure';

export interface LightCheck {
  verdict: LightVerdict;
  /** EV at ISO 100, rounded to one decimal; null without the three settings. */
  ev: number | null;
}

/** Civil twilight ends at −6°: below it there is no daylight to expose for. */
const NIGHT_ALTITUDE = -6;
/** Above this the sun lights an outdoor scene fully. */
const DAY_ALTITUDE = 10;
/** Daylight exposure: EV100 of a sunny or bright overcast scene. */
const DAYLIGHT_EV = 11;
/** Darker than a dim room. */
const DARK_EV = 3;

export function ev100(exposureSeconds: number, fNumber: number, iso: number): number {
  return Math.log2((fNumber * fNumber) / exposureSeconds) - Math.log2(iso / 100);
}

export function checkLight(input: LightInput): LightCheck | null {
  if (input.sunAltitude == null) return null;
  const { exposureSeconds, fNumber, iso } = input;
  if (!exposureSeconds || !fNumber || !iso || exposureSeconds <= 0 || fNumber <= 0 || iso <= 0) {
    return { verdict: 'no-exposure', ev: null };
  }
  const ev = Math.round(ev100(exposureSeconds, fNumber, iso) * 10) / 10;
  if (input.flashFired) return { verdict: 'consistent', ev };
  if (input.sunAltitude < NIGHT_ALTITUDE && ev >= DAYLIGHT_EV) return { verdict: 'night-daylight-exposure', ev };
  if (input.sunAltitude >= DAY_ALTITUDE && ev <= DARK_EV) return { verdict: 'day-dark-exposure', ev };
  return { verdict: 'consistent', ev };
}
