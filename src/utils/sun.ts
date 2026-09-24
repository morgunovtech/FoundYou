/**
 * Solar position by the NOAA Solar Calculator algorithm (Meeus, simplified):
 * accurate to well under a degree, which is all a «sun was there» check needs.
 * Azimuth is clockwise from north; altitude ignores refraction (≤ 0.6° at the
 * horizon).
 */
export interface SunPosition {
  /** Degrees above the horizon; negative at night. */
  altitude: number;
  /** Degrees clockwise from north, 0–360. */
  azimuth: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const jc = (jd - 2_451_545) / 36_525;

  const meanLong = mod360(280.46646 + jc * (36_000.76983 + jc * 0.0003032));
  const meanAnom = 357.52911 + jc * (35_999.05029 - 0.0001537 * jc);
  const eccent = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const centre =
    Math.sin(meanAnom * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * meanAnom * RAD) * 0.000289;
  const trueLong = meanLong + centre;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * jc) * RAD);
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos((125.04 - 1934.136 * jc) * RAD);
  const declination = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD));

  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * meanLong * RAD) -
      2 * eccent * Math.sin(meanAnom * RAD) +
      4 * eccent * y * Math.sin(meanAnom * RAD) * Math.cos(2 * meanLong * RAD) -
      0.5 * y * y * Math.sin(4 * meanLong * RAD) -
      1.25 * eccent * eccent * Math.sin(2 * meanAnom * RAD));

  const minutesUtc = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolar = mod(minutesUtc + eqTime + 4 * lon, 1440);
  // `mod` keeps the true solar time in 0…1440, so the hour angle is always this branch.
  const hourAngle = trueSolar / 4 - 180;

  const latR = lat * RAD;
  const cosZenith =
    Math.sin(latR) * Math.sin(declination) + Math.cos(latR) * Math.cos(declination) * Math.cos(hourAngle * RAD);
  const zenith = Math.acos(clamp(cosZenith, -1, 1));
  const altitude = 90 - zenith * DEG;

  const denominator = Math.cos(latR) * Math.sin(zenith);
  let azimuth: number;
  if (Math.abs(denominator) < 1e-9) {
    azimuth = lat >= 0 ? 180 : 0;
  } else {
    const cosAz = clamp((Math.sin(latR) * Math.cos(zenith) - Math.sin(declination)) / denominator, -1, 1);
    const az = Math.acos(cosAz) * DEG;
    azimuth = hourAngle > 0 ? mod360(az + 180) : mod360(540 - az);
  }
  return { altitude, azimuth };
}

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

function mod360(value: number): number {
  return mod(value, 360);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
