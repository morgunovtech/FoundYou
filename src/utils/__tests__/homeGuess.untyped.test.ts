import { describe, expect, it } from 'vitest';
import { guessHome, type HomeGuessInput } from '../homeGuess';

const base: HomeGuessInput = { atThePoint: true, landmarkCount: 0 };

describe('guessHome and the untyped building', () => {
  it('does not call a bare building=yes a residential building', () => {
    /*
     * `yes` is the most common building value and says only that a building was mapped; the
     * signal's copy reads «точка попадает в жилой дом». A corner shop drawn as a bare polygon in
     * a residential block, on a weekend evening, scored 9 → «likely» for being a home it is not.
     */
    const guess = guessHome({ ...base, landuse: 'residential', placeCategory: 'building', placeType: 'yes', hour: 20, dayKind: 'weekend' });
    expect(guess.for.map((s) => s.id)).not.toContain('residentialBuilding');
    const typed = guessHome({ ...base, landuse: 'residential', placeCategory: 'building', placeType: 'house', hour: 20, dayKind: 'weekend' });
    expect(guess.score).toBeLessThan(typed.score);
  });

  it('still counts a typed residential building', () => {
    const guess = guessHome({ ...base, landuse: 'residential', placeCategory: 'building', placeType: 'house', hour: 20, dayKind: 'weekend' });
    expect(guess.for.map((s) => s.id)).toContain('residentialBuilding');
  });
});
