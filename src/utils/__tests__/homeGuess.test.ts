import { describe, expect, it } from 'vitest';
import { guessHome, type HomeGuessInput } from '../homeGuess';

const base: HomeGuessInput = { atThePoint: true, landmarkCount: 0 };

const ids = (signals: Array<{ id: string }>) => signals.map((s) => s.id);

describe('guessHome', () => {
  /*
   * Every part is already on the page and none of them says it alone. It is a guess and it is
   * marked as one; `undecided` is a real outcome and the common one.
   */

  it('says nothing about a photo with nothing to go on', () => {
    expect(guessHome(base).verdict).toBe('undecided');
  });

  it('a residential building in a residential area at night is likely home', () => {
    const guess = guessHome({
      ...base,
      landuse: 'residential',
      placeCategory: 'building',
      placeType: 'apartments',
      hour: 22,
      dayKind: 'weekend'
    });
    expect(guess.verdict).toBe('likely');
    expect(ids(guess.for)).toEqual(expect.arrayContaining(['landuseResidential', 'residentialBuilding', 'eveningOrNight']));
    expect(guess.against).toEqual([]);
  });

  it('a monument is not a home however residential the street around it', () => {
    const guess = guessHome({ ...base, landuse: 'residential', landmarkCount: 2, hour: 14, dayKind: 'weekend' });
    expect(ids(guess.against)).toContain('landmark');
    expect(guess.verdict).not.toBe('likely');
  });

  it('an industrial area in working hours on a weekday is unlikely', () => {
    const guess = guessHome({ ...base, landuse: 'industrial', dayKind: 'weekday', hour: 11 });
    expect(guess.verdict).toBe('unlikely');
    expect(ids(guess.against)).toEqual(expect.arrayContaining(['landuseNotResidential', 'workingHours']));
  });

  it('a point Nominatim could only answer for from far away is not an address', () => {
    const guess = guessHome({ ...base, atThePoint: false });
    expect(ids(guess.against)).toContain('noAddressHere');
  });

  it('a station at the door argues against, a school two streets away argues for', () => {
    const guess = guessHome({
      ...base,
      transport: [{ kind: 'railway:station', name: 'Вокзал', distance: 120 }],
      sensitive: [{ kind: 'school', name: 'Школа', distance: 300 }]
    });
    expect(ids(guess.against)).toContain('transportAtTheDoor');
    expect(ids(guess.for)).toContain('schoolNearby');
  });

  it('a station far enough away says nothing either way', () => {
    const guess = guessHome({ ...base, transport: [{ kind: 'railway:station', name: 'Вокзал', distance: 900 }] });
    expect(ids(guess.against)).not.toContain('transportAtTheDoor');
  });

  it('evening counts, the middle of a weekday does not', () => {
    expect(ids(guessHome({ ...base, hour: 23 }).for)).toContain('eveningOrNight');
    expect(ids(guessHome({ ...base, hour: 6 }).for)).toContain('eveningOrNight');
    expect(ids(guessHome({ ...base, hour: 13, dayKind: 'weekday' }).against)).toContain('workingHours');
    // On a day off the same hour is not evidence of being at work.
    expect(ids(guessHome({ ...base, hour: 13, dayKind: 'weekend' }).against)).not.toContain('workingHours');
  });

  it('reports every signal it used, for and against', () => {
    const guess = guessHome({
      ...base,
      landuse: 'residential',
      landmarkCount: 1,
      hour: 21
    });
    expect(ids(guess.for)).toEqual(expect.arrayContaining(['landuseResidential', 'eveningOrNight']));
    expect(ids(guess.against)).toEqual(['landmark']);
    // The score is exactly the sum: nothing is hidden from the reader.
    expect(guess.score).toBe([...guess.for, ...guess.against].reduce((sum, s) => sum + s.weight, 0));
  });

  it('a shop on the ground floor is not a residential building', () => {
    const guess = guessHome({ ...base, placeCategory: 'shop', placeType: 'supermarket', landuse: 'retail' });
    expect(ids(guess.for)).not.toContain('residentialBuilding');
    expect(ids(guess.against)).toContain('landuseNotResidential');
  });
});
