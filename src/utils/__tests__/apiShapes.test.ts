import { describe, it, expect } from 'vitest';
import { isElevation, isHistoricalWeather, isHolidays, isPlaceContext, isPoiList, isReverseGeocode } from '../apiShapes';

const POI = { name: 'Чайхана «Пскент»', category: 'cafe', distance: 320 };
const REVERSE = {
  address: 'Пскентский, Piskent Tumani, O‘zbekiston',
  country: 'O‘zbekiston',
  countryCode: 'UZ',
  city: 'Tashmehleshoz',
  category: 'highway',
  type: 'residential',
  name: 'Пскентский',
  precisionMeters: 2.1,
  distanceMeters: 250,
  lat: 40.9386,
  lon: 69.3615
};
const WEATHER = { temperature: 30, precipitation: 0, cloudCover: 5, windSpeed: 13, pressure: 1011 };

describe('isPoiList', () => {
  it('accepts the list the endpoint sends, with or without a name', () => {
    expect(isPoiList([POI])).toBe(true);
    expect(isPoiList([{ category: 'bench', distance: 12 }])).toBe(true);
    expect(isPoiList([])).toBe(true);
  });

  it('rejects the wrong container — the shape that used to blank the whole section', () => {
    expect(isPoiList({ items: [POI] })).toBe(false);
    expect(isPoiList(null)).toBe(false);
    expect(isPoiList('nearby')).toBe(false);
  });

  it('rejects an entry the list would throw on', () => {
    expect(isPoiList([POI, { category: 'cafe', distance: 'far' }])).toBe(false);
    expect(isPoiList([{ name: 42, category: 'cafe', distance: 10 }])).toBe(false);
    expect(isPoiList([null])).toBe(false);
  });
});

describe('isReverseGeocode', () => {
  it('accepts the endpoint answer, with the optional fields missing', () => {
    expect(isReverseGeocode(REVERSE)).toBe(true);
    expect(isReverseGeocode({ address: 'x', country: 'y', lat: 1, lon: 2 })).toBe(true);
    expect(
      isReverseGeocode({ ...REVERSE, neighbourhood: 'Мирзо Улугбек МФЙ', localName: 'Amir Temur xiyoboni', placeRank: 30, buildingLevels: 9 })
    ).toBe(true);
  });

  it('accepts the answer for a point Nominatim cannot geocode: coordinates and nothing invented', () => {
    // Open sea, the poles: the endpoint no longer fills in «Unknown address» / «Unknown», so the
    // page can fall back to its own dictionary instead of printing English in a Russian card.
    expect(isReverseGeocode({ lat: 41.3112, lon: 69.2797 })).toBe(true);
    expect(isReverseGeocode({ ...REVERSE, address: undefined, country: undefined })).toBe(true);
  });

  it('rejects an answer whose coordinates are not there', () => {
    expect(isReverseGeocode({ ...REVERSE, lat: 'north' })).toBe(false);
    expect(isReverseGeocode({ ...REVERSE, lon: undefined })).toBe(false);
    expect(isReverseGeocode([REVERSE])).toBe(false);
    expect(isReverseGeocode(null)).toBe(false);
  });

  it('rejects a field the page would print as text but is not', () => {
    expect(isReverseGeocode({ ...REVERSE, address: 42 })).toBe(false);
    expect(isReverseGeocode({ ...REVERSE, country: ['Uzbekistan'] })).toBe(false);
    expect(isReverseGeocode({ ...REVERSE, city: { name: 'Tashkent' } })).toBe(false);
    // Rendered as JSX children: an object in either throws inside React and blanks section 02.
    expect(isReverseGeocode({ ...REVERSE, neighbourhood: { name: 'МФЙ' } })).toBe(false);
    expect(isReverseGeocode({ ...REVERSE, localName: 7 })).toBe(false);
  });

  it('rejects a field the page would read as a number but is not', () => {
    expect(isReverseGeocode({ ...REVERSE, distanceMeters: 'far' })).toBe(false);
    expect(isReverseGeocode({ ...REVERSE, placeRank: 'high' })).toBe(false);
    expect(isReverseGeocode({ ...REVERSE, buildingLevels: '9' })).toBe(false);
  });
});

describe('isPlaceContext', () => {
  const ITEM = { kind: 'school', name: 'Школа № 50', distance: 180 };
  const CONTEXT = { landuse: 'residential', sensitive: [ITEM], transport: [], placeName: 'Ташкент', placeKind: 'city', population: 2_860_000 };

  it('accepts the endpoint answer, with everything OSM did not have left out', () => {
    expect(isPlaceContext(CONTEXT)).toBe(true);
    expect(isPlaceContext({ sensitive: [], transport: [] })).toBe(true);
  });

  it('rejects the wrong container and a list entry the card would throw on', () => {
    expect(isPlaceContext([CONTEXT])).toBe(false);
    expect(isPlaceContext({ ...CONTEXT, sensitive: { items: [ITEM] } })).toBe(false);
    expect(isPlaceContext({ ...CONTEXT, transport: [{ kind: 'railway:station', distance: 400 }] })).toBe(false);
    expect(isPlaceContext({ ...CONTEXT, sensitive: [{ ...ITEM, distance: 'near' }] })).toBe(false);
  });

  it('rejects a field the card prints or formats but that is the wrong kind of thing', () => {
    expect(isPlaceContext({ ...CONTEXT, landuse: { osm: 'residential' } })).toBe(false);
    expect(isPlaceContext({ ...CONTEXT, placeName: ['Ташкент'] })).toBe(false);
    expect(isPlaceContext({ ...CONTEXT, placeKind: 4 })).toBe(false);
    expect(isPlaceContext({ ...CONTEXT, population: '2 860 000' })).toBe(false);
  });
});

describe('isHistoricalWeather / isElevation / isHolidays', () => {
  it('accepts the answers as the endpoints build them', () => {
    expect(isHistoricalWeather(WEATHER)).toBe(true);
    expect(isHistoricalWeather({ ...WEATHER, weatherCode: null, timezone: 'Asia/Tashkent' })).toBe(true);
    expect(isElevation({ elevation: 392, resolutionMeters: 90 })).toBe(true);
    expect(isHolidays({ isHoliday: false, holidays: [] })).toBe(true);
    expect(
      isHolidays({ isHoliday: true, holidays: [{ date: '2026-09-01', localName: 'Mustaqillik kuni', name: 'Independence Day', global: true }] })
    ).toBe(true);
  });

  it('rejects what the cards would read as numbers and dates', () => {
    expect(isHistoricalWeather({ ...WEATHER, temperature: '30°' })).toBe(false);
    expect(isHistoricalWeather({ ...WEATHER, pressure: NaN })).toBe(false);
    expect(isElevation({ elevation: 392 })).toBe(false);
    expect(isElevation({ elevation: null, resolutionMeters: 90 })).toBe(false);
    expect(isHolidays({ isHoliday: 'yes', holidays: [] })).toBe(false);
    expect(isHolidays({ isHoliday: true, holidays: { date: '2026-09-01' } })).toBe(false);
    expect(isHolidays({ isHoliday: true, holidays: [{ date: 20260901, localName: 'x', name: 'y' }] })).toBe(false);
  });
});
