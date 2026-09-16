import { describe, expect, it } from 'vitest';
import type { StructuredMetadata } from '../../types/metadata';
import {
  buildStance,
  cameraSide,
  compassPoint,
  elevationVerdict,
  fieldOfView,
  formatOffset,
  movement,
  parseOffsetMinutes,
  relativeDirection,
  resolveShotInstant,
  sunPhase,
  zoneOffsetMinutes
} from '../stance';

const base = (over: Partial<StructuredMetadata> = {}): StructuredMetadata => ({
  groups: { exif: {}, xmp: {}, iptc: {}, icc: {} },
  completeness: 0,
  ...over
});

describe('compassPoint', () => {
  it('rounds to eight points and wraps', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(22)).toBe('N');
    expect(compassPoint(23)).toBe('NE');
    expect(compassPoint(312)).toBe('NW');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
  });
});

describe('cameraSide', () => {
  it('reads the lens name', () => {
    expect(cameraSide('iPhone 15 Pro front camera 2.69mm f/1.9')).toBe('front');
    expect(cameraSide('iPhone 15 Pro back triple camera 6.765mm f/1.78')).toBe('rear');
    expect(cameraSide('Samsung Front Camera')).toBe('front');
    expect(cameraSide('EF24-70mm f/2.8L II USM')).toBe('unknown');
    expect(cameraSide(undefined)).toBe('unknown');
  });
});

describe('fieldOfView', () => {
  it('derives the horizontal angle from the 35 mm focal length and the frame side', () => {
    expect(fieldOfView(24, 'landscape', 'rear')).toBe(74);
    expect(fieldOfView(24, 'portrait', 'rear')).toBe(53);
    expect(fieldOfView(77, 'landscape', 'rear')).toBe(26);
  });
  it('falls back to phone defaults', () => {
    expect(fieldOfView(undefined, 'portrait', 'rear')).toBe(70);
    expect(fieldOfView(undefined, 'portrait', 'front')).toBe(75);
  });
});

describe('movement / sunPhase / relativeDirection / elevationVerdict', () => {
  it('bands speed, altitude, relative bearing and height difference', () => {
    expect(movement(0)).toBe('still');
    expect(movement(5)).toBe('walking');
    expect(movement(45)).toBe('vehicle');
    expect(sunPhase(-10)).toBe('night');
    expect(sunPhase(-3)).toBe('twilight');
    expect(sunPhase(5)).toBe('low');
    expect(sunPhase(40)).toBe('day');
    expect(relativeDirection(0, 10)).toBe('front');
    expect(relativeDirection(0, 350)).toBe('front');
    expect(relativeDirection(0, 90)).toBe('right');
    expect(relativeDirection(0, 180)).toBe('behind');
    expect(relativeDirection(0, 270)).toBe('left');
    expect(relativeDirection(312, 200)).toBe('left');
    expect(elevationVerdict(1287, 1270)).toEqual({ difference: 17, verdict: 'ground' });
    expect(elevationVerdict(1350, 1270)).toEqual({ difference: 80, verdict: 'above' });
    expect(elevationVerdict(1500, 1270)).toEqual({ difference: 230, verdict: 'high' });
    expect(elevationVerdict(1200, 1270)).toEqual({ difference: -70, verdict: 'below' });
  });
});

describe('offsets', () => {
  it('parses and formats EXIF offsets', () => {
    expect(parseOffsetMinutes('+05:00')).toBe(300);
    expect(parseOffsetMinutes('-03:30')).toBe(-210);
    expect(parseOffsetMinutes('+0530')).toBe(330);
    expect(parseOffsetMinutes('junk')).toBeNull();
    expect(formatOffset(300)).toBe('+05:00');
    expect(formatOffset(-210)).toBe('-03:30');
    expect(formatOffset(0)).toBe('+00:00');
  });

  it('reads a zone offset at an instant, including DST and UTC', () => {
    expect(zoneOffsetMinutes('Asia/Tashkent', new Date('2026-09-14T08:00:00Z'))).toBe(300);
    expect(zoneOffsetMinutes('Europe/Berlin', new Date('2026-07-01T12:00:00Z'))).toBe(120);
    expect(zoneOffsetMinutes('Europe/Berlin', new Date('2026-01-01T12:00:00Z'))).toBe(60);
    expect(zoneOffsetMinutes('UTC', new Date('2026-01-01T12:00:00Z'))).toBe(0);
    expect(zoneOffsetMinutes('Not/AZone', new Date())).toBeNull();
  });
});

describe('resolveShotInstant', () => {
  const local = '2026-09-14T13:20:00';
  it('trusts the EXIF offset first', () => {
    const r = resolveShotInstant(
      { shotDateLocal: local, utcOffset: '+05:00', gps: { lon: 69.9, timestampUtc: '2026-09-14T08:20:03Z' } },
      'Asia/Tashkent'
    );
    expect(r?.source).toBe('exif-offset');
    expect(r?.utc.toISOString()).toBe('2026-09-14T08:20:00.000Z');
    expect(r?.cameraOffsetMinutes).toBe(300);
  });
  it('uses the GPS stamp and derives the camera zone from the wall clock', () => {
    const r = resolveShotInstant({
      shotDateLocal: local,
      utcOffset: null,
      gps: { lon: 69.9, timestampUtc: '2026-09-14T10:20:03Z' }
    });
    expect(r?.source).toBe('gps-time');
    expect(r?.utc.toISOString()).toBe('2026-09-14T10:20:03.000Z');
    expect(r?.cameraOffsetMinutes).toBe(180); // camera still on Moscow time
  });
  it('ignores a stale GPS stamp from another day', () => {
    const r = resolveShotInstant(
      { shotDateLocal: local, utcOffset: null, gps: { lon: 69.9, timestampUtc: '2026-09-10T10:20:03Z' } },
      'Asia/Tashkent'
    );
    expect(r?.source).toBe('place-zone');
    expect(r?.utc.toISOString()).toBe('2026-09-14T08:20:00.000Z');
    expect(r?.cameraOffsetMinutes).toBeNull();
  });
  it('falls back to the longitude when nothing else is known', () => {
    const r = resolveShotInstant({ shotDateLocal: local, utcOffset: null, gps: { lon: 69.9 } });
    expect(r?.source).toBe('longitude');
    expect(r?.utc.toISOString()).toBe('2026-09-14T08:20:00.000Z');
  });
  it('returns null without any wall clock or GPS time', () => {
    expect(resolveShotInstant({ gps: { lon: 69.9 } })).toBeNull();
  });
});

describe('buildStance', () => {
  const tashkent = base({
    shotDateLocal: '2026-09-14T13:20:00',
    utcOffset: '+03:00',
    lensModel: 'iPhone 15 Pro back triple camera 6.765mm f/1.78',
    focalLength35mm: 24,
    orientation: 'portrait',
    gps: { lat: 41.36123, lon: 69.92395, altitude: 1287, accuracy: 14, heading: 312, speed: 0.4 }
  });

  it('assembles heading, camera, sun, clock mismatch and terrain', () => {
    const stance = buildStance({ metadata: tashkent, placeTimezone: 'Asia/Tashkent', terrainElevation: 1270 });
    expect(stance.heading).toEqual({ degrees: 312, point: 'NW' });
    expect(stance.cameraSide).toBe('rear');
    expect(stance.fovDegrees).toBe(53);
    expect(stance.movement).toBe('still');
    expect(stance.instant?.source).toBe('exif-offset');
    // 13:20 on a +03:00 clock is 10:20 UTC = 15:20 in Tashkent: sun high, south-west-ish.
    expect(stance.sun?.phase).toBe('day');
    expect(stance.sun?.azimuth).toBeGreaterThan(180);
    expect(stance.sun?.azimuth).toBeLessThan(260);
    expect(stance.sun?.relative).toBe('left');
    expect(stance.clock).toEqual({
      cameraOffsetMinutes: 180,
      placeOffsetMinutes: 300,
      placeTimezone: 'Asia/Tashkent',
      mismatch: true
    });
    expect(stance.elevation).toEqual({ gps: 1287, terrain: 1270, difference: 17, verdict: 'ground' });
  });

  it('degrades gracefully: no heading, no time, no terrain', () => {
    const stance = buildStance({ metadata: base({ gps: { lat: 41.3, lon: 69.3 } }) });
    expect(stance.heading).toBeNull();
    expect(stance.sun).toBeNull();
    expect(stance.clock).toBeNull();
    expect(stance.elevation).toBeNull();
    expect(stance.movement).toBeNull();
    expect(stance.fovDegrees).toBe(70);
  });
});
