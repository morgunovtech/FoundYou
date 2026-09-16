import { describe, it, expect } from 'vitest';
import { checkLight, ev100 } from '../lightCheck';

describe('ev100', () => {
  it('matches the textbook: f/16 at 1/125 ISO 100 is EV 15 (sunny 16)', () => {
    expect(ev100(1 / 125, 16, 100)).toBeCloseTo(14.97, 1);
    expect(ev100(1 / 30, 1.8, 3200)).toBeCloseTo(1.6, 1);
  });
});

describe('checkLight', () => {
  it('is null without the sun and «no-exposure» without the settings', () => {
    expect(
      checkLight({ sunAltitude: null, exposureSeconds: 0.01, fNumber: 2, iso: 100, flashFired: false })
    ).toBeNull();
    expect(checkLight({ sunAltitude: 30, exposureSeconds: null, fNumber: 2, iso: 100, flashFired: false })).toEqual({
      verdict: 'no-exposure',
      ev: null
    });
  });

  it('accepts a daylight exposure by day and a dark one at night', () => {
    expect(
      checkLight({ sunAltitude: 40, exposureSeconds: 1 / 500, fNumber: 5.6, iso: 100, flashFired: false })
    ).toEqual({
      verdict: 'consistent',
      ev: 13.9
    });
    expect(
      checkLight({ sunAltitude: -20, exposureSeconds: 1 / 15, fNumber: 1.8, iso: 1600, flashFired: false })?.verdict
    ).toBe('consistent');
  });

  it('flags daylight settings at night and dark settings by day, unless the flash fired', () => {
    expect(
      checkLight({ sunAltitude: -20, exposureSeconds: 1 / 500, fNumber: 5.6, iso: 100, flashFired: false })?.verdict
    ).toBe('night-daylight-exposure');
    expect(
      checkLight({ sunAltitude: -20, exposureSeconds: 1 / 500, fNumber: 5.6, iso: 100, flashFired: true })?.verdict
    ).toBe('consistent');
    expect(
      checkLight({ sunAltitude: 40, exposureSeconds: 1 / 15, fNumber: 1.8, iso: 3200, flashFired: false })?.verdict
    ).toBe('day-dark-exposure');
    // Twilight and low sun are judged consistent either way.
    expect(
      checkLight({ sunAltitude: -3, exposureSeconds: 1 / 500, fNumber: 5.6, iso: 100, flashFired: false })?.verdict
    ).toBe('consistent');
  });
});
