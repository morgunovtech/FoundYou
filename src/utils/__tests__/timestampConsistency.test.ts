import { describe, it, expect } from 'vitest';
import { checkTimestamps, type TimestampInput } from '../timestampConsistency';

const base: TimestampInput = {
  shotLocal: '2026-06-14T18:30:12',
  digitizedLocal: '2026-06-14T18:30:12',
  modifyLocal: '2026-06-14T18:30:12',
  xmpCreate: '2026-06-14T18:30:12',
  cameraOffsetMinutes: 300,
  placeOffsetMinutes: 300,
  signedAt: null,
  lastModified: Date.UTC(2026, 5, 20, 12, 0, 0)
};

describe('checkTimestamps', () => {
  it('counts every comparison and finds nothing wrong with a consistent file', () => {
    expect(checkTimestamps(base)).toEqual({ checked: 5, issues: [] });
  });

  it('accepts an XMP instant with a zone that is the same moment as the camera wall clock', () => {
    expect(checkTimestamps({ ...base, xmpCreate: '2026-06-14T13:30:12Z' }).issues).toEqual([]);
    expect(checkTimestamps({ ...base, xmpCreate: '2026-06-14T18:30:12+05:00' }).issues).toEqual([]);
  });

  it('flags a digitized date, an XMP date and a modify date that disagree with the shot', () => {
    expect(checkTimestamps({ ...base, digitizedLocal: '2026-06-15T09:00:00' }).issues).toEqual(['digitized-differs']);
    expect(checkTimestamps({ ...base, xmpCreate: '2026-06-01T10:00:00' }).issues).toEqual(['xmp-create-differs']);
    expect(checkTimestamps({ ...base, modifyLocal: '2026-06-14T17:00:00' }).issues).toEqual(['modify-before-shot']);
    // A later modify date is the normal «saved again» case, reported by the file history, not here.
    expect(checkTimestamps({ ...base, modifyLocal: '2026-06-20T17:00:00' }).issues).toEqual([]);
  });

  it('flags a camera zone that differs from the place zone', () => {
    expect(checkTimestamps({ ...base, placeOffsetMinutes: 180 }).issues).toEqual(['zone-differs']);
    expect(checkTimestamps({ ...base, placeOffsetMinutes: null }).checked).toBe(4);
  });

  it('flags a signature and a disk time that precede the shot by more than a day', () => {
    expect(checkTimestamps({ ...base, signedAt: '2026-06-10T00:00:00Z' }).issues).toEqual(['signed-before-shot']);
    expect(checkTimestamps({ ...base, signedAt: '2026-06-14T12:00:00Z' }).issues).toEqual([]);
    expect(checkTimestamps({ ...base, lastModified: Date.UTC(2026, 5, 1) }).issues).toEqual(['disk-before-shot']);
  });

  it('gives an unknown camera zone 14 hours of slack before calling a clock early', () => {
    const noZone = { ...base, cameraOffsetMinutes: null, placeOffsetMinutes: null };
    // 30 h before the wall clock: inside one day plus the 14 h slack. 66 h: outside it.
    expect(checkTimestamps({ ...noZone, lastModified: Date.UTC(2026, 5, 13, 12, 0, 0) }).issues).toEqual([]);
    expect(checkTimestamps({ ...noZone, lastModified: Date.UTC(2026, 5, 12, 0, 0, 0) }).issues).toEqual([
      'disk-before-shot'
    ]);
  });

  it('checks nothing without a shot date except the zones', () => {
    expect(checkTimestamps({ ...base, shotLocal: null })).toEqual({ checked: 1, issues: [] });
  });
});
