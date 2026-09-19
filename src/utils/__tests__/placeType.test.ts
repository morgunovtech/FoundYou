import { describe, expect, it } from 'vitest';
import { isAtThePoint, placeTypeLabel } from '../placeType';

describe('placeTypeLabel', () => {
  it('names homes, blocks of flats, offices and industry from building types', () => {
    expect(placeTypeLabel({ category: 'building', type: 'house' })).toEqual({ key: 'placeType_house' });
    expect(placeTypeLabel({ category: 'building', type: 'apartments' })).toEqual({ key: 'placeType_apartments' });
    expect(placeTypeLabel({ category: 'building', type: 'office' })).toEqual({ key: 'placeType_commercial' });
    expect(placeTypeLabel({ category: 'building', type: 'warehouse' })).toEqual({ key: 'placeType_industrial' });
    expect(placeTypeLabel({ category: 'building', type: 'yes' })).toEqual({ key: 'placeType_building' });
    expect(placeTypeLabel({ category: 'building', type: 'hotel' })).toEqual({ key: 'poiCategory_hotel' });
    // Nominatim's place=house is any address point (a shop door as often as a home), not a private house.
    expect(placeTypeLabel({ category: 'place', type: 'house', addressType: 'house' })).toEqual({
      key: 'placeType_address'
    });
    // `<category>=yes` names the category, not the venue.
    expect(placeTypeLabel({ category: 'tourism', type: 'yes' })).toEqual({ key: 'placeType_building' });
  });

  it('uses the venue vocabulary for amenities and sights, with a readable fallback', () => {
    expect(placeTypeLabel({ category: 'tourism', type: 'hotel', addressType: 'tourism' })).toEqual({
      key: 'poiCategory_hotel'
    });
    expect(placeTypeLabel({ category: 'amenity', type: 'kindergarten' })).toEqual({ key: 'poiCategory_kindergarten' });
    expect(placeTypeLabel({ category: 'amenity', type: 'car_wash' })).toEqual({
      key: 'poiCategory_other',
      params: { category: 'car wash' }
    });
  });

  it('tells a road or a residential area from a building and stays silent otherwise', () => {
    expect(placeTypeLabel({ category: 'highway', type: 'residential' })).toEqual({ key: 'placeType_road' });
    expect(placeTypeLabel({ category: 'landuse', type: 'residential' })).toEqual({ key: 'placeType_residential' });
    expect(placeTypeLabel({ category: 'boundary', type: 'administrative' })).toBeNull();
    expect(placeTypeLabel({})).toBeNull();
    expect(placeTypeLabel(null)).toBeNull();
  });
});

describe('isAtThePoint', () => {
  it('never calls a road «what is here»: a point on open ground resolves to the nearest one', () => {
    expect(isAtThePoint({ category: 'highway', distanceMeters: 5 })).toBe(false);
    expect(isAtThePoint({ category: 'highway' })).toBe(false);
  });

  it('accepts an object at the point and rejects the same object far away', () => {
    expect(isAtThePoint({ category: 'tourism', distanceMeters: 12 })).toBe(true);
    expect(isAtThePoint({ category: 'tourism', distanceMeters: 60 })).toBe(true);
    expect(isAtThePoint({ category: 'tourism', distanceMeters: 61 })).toBe(false);
    expect(isAtThePoint({ category: 'building', distanceMeters: 400 })).toBe(false);
  });

  it('keeps the old behaviour when the upstream gave no distance', () => {
    expect(isAtThePoint({ category: 'building' })).toBe(true);
    expect(isAtThePoint(null)).toBe(false);
  });
});
