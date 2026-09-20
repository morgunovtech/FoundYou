import { describe, expect, it } from 'vitest';
import { bearingOffset, placesInFrame, HEADING_SLACK_DEGREES, MAX_FRAMED_DISTANCE_METERS } from '../inFrame';
import type { PoiResult } from '../../types/api';

const place = (name: string, bearing: number, distance = 100): PoiResult => ({
  name,
  category: 'cafe',
  distance,
  bearing
});

describe('bearingOffset', () => {
  it('is zero dead ahead and signed either side', () => {
    expect(bearingOffset(90, 90)).toBe(0);
    expect(bearingOffset(90, 120)).toBe(30);
    expect(bearingOffset(90, 60)).toBe(-30);
  });

  it('takes the short way round north', () => {
    // The case a plain subtraction gets wrong: 350° and 10° are 20° apart, not 340°.
    expect(bearingOffset(350, 10)).toBe(20);
    expect(bearingOffset(10, 350)).toBe(-20);
  });

  it('stays inside (−180, 180]', () => {
    for (const [from, to] of [[0, 180], [0, 181], [270, 89], [45, 225]]) {
      const offset = bearingOffset(from, to);
      expect(offset).toBeGreaterThan(-181);
      expect(offset).toBeLessThanOrEqual(180);
    }
  });
});

describe('placesInFrame', () => {
  /*
   * The question the «объекты рядом» list cannot answer: not what was near, but what was in the
   * picture. A café fifty metres behind the photographer is in that list and was never in frame.
   */

  it('keeps what the camera faced and drops what was behind it', () => {
    const found = placesInFrame([place('Впереди', 90), place('Позади', 270)], 90, 60);
    expect(found.map((p) => p.name)).toEqual(['Впереди']);
  });

  it('says nothing at all without a heading — most Android photos', () => {
    // Without a direction there is no way to tell the front of the frame from the back, and
    // guessing would be worse than an empty list.
    expect(placesInFrame([place('Кафе', 90)], null, 60)).toEqual([]);
    expect(placesInFrame([place('Кафе', 90)], undefined, 60)).toEqual([]);
    expect(placesInFrame([place('Кафе', 90)], Number.NaN, 60)).toEqual([]);
  });

  it('uses the lens angle: a wide lens frames what a long one misses', () => {
    const off = [place('Сбоку', 130)];
    // 40° off centre: inside a 100° cone (50 + slack), outside a 30° one (15 + slack).
    expect(placesInFrame(off, 90, 100)).toHaveLength(1);
    expect(placesInFrame(off, 90, 30)).toHaveLength(0);
  });

  it('widens the cone, because the compass and the fallback angle are both rough', () => {
    // Exactly on the edge of a 60° lens plus the slack: still in. One degree further: out.
    const edge = 30 + HEADING_SLACK_DEGREES;
    expect(placesInFrame([place('Край', 90 + edge)], 90, 60)).toHaveLength(1);
    expect(placesInFrame([place('За краем', 90 + edge + 1)], 90, 60)).toHaveLength(0);
  });

  it('falls back to a typical lens when the file gives no focal length', () => {
    // 70° assumed → half cone 35 + slack 10 = 45.
    expect(placesInFrame([place('В кадре', 90 + 44)], 90, null)).toHaveLength(1);
    expect(placesInFrame([place('Вне кадра', 90 + 46)], 90, null)).toHaveLength(0);
  });

  it('drops what is too far to read in a photograph', () => {
    expect(placesInFrame([place('Далеко', 90, MAX_FRAMED_DISTANCE_METERS + 1)], 90, 60)).toHaveLength(0);
    expect(placesInFrame([place('Ещё видно', 90, MAX_FRAMED_DISTANCE_METERS)], 90, 60)).toHaveLength(1);
  });

  it('ignores a place the endpoint gave no bearing for', () => {
    const noBearing: PoiResult = { name: 'Без азимута', category: 'shop', distance: 50 };
    expect(placesInFrame([noBearing], 90, 60)).toEqual([]);
  });

  it('works across north, where a naive comparison fails', () => {
    // Facing 350°, an object at 5° is 15° to the right and plainly in frame.
    const found = placesInFrame([place('Через север', 5)], 350, 60);
    expect(found).toHaveLength(1);
    expect(found[0].offset).toBe(15);
  });

  it('orders by distance, nearest first', () => {
    const found = placesInFrame([place('Дальше', 92, 300), place('Ближе', 88, 60)], 90, 60);
    expect(found.map((p) => p.name)).toEqual(['Ближе', 'Дальше']);
  });
});
