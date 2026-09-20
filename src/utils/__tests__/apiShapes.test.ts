import { describe, it, expect } from 'vitest';
import { isElevation, isHistoricalWeather, isHolidays, isPoiList, isReverseGeocode } from '../apiShapes';

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
  });

  it('rejects an answer whose coordinates or address are not there', () => {
    expect(isReverseGeocode({ ...REVERSE, lat: 'north' })).toBe(false);
    expect(isReverseGeocode({ ...REVERSE, address: undefined })).toBe(false);
    expect(isReverseGeocode([REVERSE])).toBe(false);
    expect(isReverseGeocode(null)).toBe(false);
  });

  it('rejects a field the page would print as text but is not', () => {
    expect(isReverseGeocode({ ...REVERSE, city: { name: 'Tashkent' } })).toBe(false);
    expect(isReverseGeocode({ ...REVERSE, distanceMeters: 'far' })).toBe(false);
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
