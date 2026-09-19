import { describe, it, expect } from 'vitest';
import type { PoiResult } from '../../types/api';
import {
  formatCoords,
  formatDistance,
  dedupeByNameAndDistance,
  localizeCategoryKey, withoutPlaceEchoes } from '../insightsCompact';

describe('formatCoords', () => {
  it('formats coordinates', () => {
    expect(formatCoords(41.0082, 28.9784)).toBe('41.00820, 28.97840');
  });

  it('formats zero coordinates', () => {
    expect(formatCoords(0, 0)).toBe('0.00000, 0.00000');
  });
});

describe('formatDistance', () => {
  it('returns empty for undefined', () => {
    expect(formatDistance(undefined)).toBe('');
  });

  it('formats small distances', () => {
    const result = formatDistance(50, 'en');
    expect(result).toContain('50');
  });
});

describe('dedupeByNameAndDistance', () => {
  it('removes duplicates by name and distance', () => {
    const items = [
      { name: 'Cafe A', category: 'cafe', distance: 100 },
      { name: 'Cafe A', category: 'cafe', distance: 100 },
      { name: 'Shop B', category: 'shop', distance: 200 }
    ];
    expect(dedupeByNameAndDistance(items)).toHaveLength(2);
  });

  it('keeps items with same name but different distance', () => {
    const items = [
      { name: 'Cafe A', category: 'cafe', distance: 100 },
      { name: 'Cafe A', category: 'cafe', distance: 200 }
    ];
    expect(dedupeByNameAndDistance(items)).toHaveLength(2);
  });

  it('keeps the first occurrence and the original order', () => {
    const items = [
      { name: 'Shop B', category: 'shop', distance: 200 },
      { name: 'Cafe A', category: 'cafe', distance: 100 },
      { name: 'Shop B', category: 'shop', distance: 200 }
    ];
    expect(dedupeByNameAndDistance(items)).toEqual([items[0], items[1]]);
  });

  it('rounds distances before comparing', () => {
    const items = [
      { name: 'Cafe A', category: 'cafe', distance: 100.4 },
      { name: 'Cafe A', category: 'cafe', distance: 99.6 },
      { name: 'Cafe A', category: 'cafe', distance: 100.6 }
    ];
    expect(dedupeByNameAndDistance(items)).toHaveLength(2);
  });

  it('ignores case and surrounding whitespace in names', () => {
    const items = [
      { name: '  Cafe A ', category: 'cafe', distance: 100 },
      { name: 'cafe a', category: 'cafe', distance: 100 }
    ];
    expect(dedupeByNameAndDistance(items)).toHaveLength(1);
  });

  it('falls back to the category for nameless items', () => {
    const items = [
      { name: '', category: 'cafe', distance: 100 },
      { name: '', category: 'Cafe', distance: 100 },
      { name: '', category: 'bank', distance: 100 },
      { name: '', category: 'bank', distance: 120 }
    ];
    expect(dedupeByNameAndDistance(items)).toEqual([items[0], items[2], items[3]]);
  });

  it('prefers an id when the item carries one', () => {
    const items = [
      { id: 7, name: 'Cafe A', category: 'cafe', distance: 100 },
      { id: 7, name: 'Cafe A (renamed)', category: 'cafe', distance: 250 },
      { id: 8, name: 'Cafe A', category: 'cafe', distance: 100 }
    ] as unknown as PoiResult[];
    expect(dedupeByNameAndDistance(items)).toEqual([items[0], items[2]]);
  });

  it('treats a non-finite distance as 0', () => {
    const items = [
      { name: 'X', category: 'cafe', distance: Number.NaN },
      { name: 'X', category: 'cafe', distance: 0 },
      { name: 'X', category: 'cafe', distance: Number.POSITIVE_INFINITY }
    ];
    expect(dedupeByNameAndDistance(items)).toHaveLength(1);
  });

  it('returns an empty list for empty input', () => {
    expect(dedupeByNameAndDistance([])).toEqual([]);
  });
});

describe('localizeCategoryKey', () => {
  /** Echoes the key plus its params (`key[a=1]`) so assertions target keys, not copy. */
  const t = (key: string, params?: Record<string, string | number>) => {
    if (!params) return key;
    const rendered = Object.entries(params)
      .map(([paramKey, paramValue]) => `${paramKey}=${paramValue}`)
      .join(',');
    return `${key}[${rendered}]`;
  };

  it('maps a known OSM category to its i18n key', () => {
    expect(localizeCategoryKey('fast_food', t)).toBe('poiCategory_fast_food');
  });

  it('is case-insensitive', () => {
    expect(localizeCategoryKey('Fast_Food', t)).toBe('poiCategory_fast_food');
  });

  it('falls back to the generic key and passes the readable category along', () => {
    expect(localizeCategoryKey('unknown_type', t)).toMatch(/^poiCategory_other\[category=/);
  });

  it('resolves OSM aliases to the shared key', () => {
    expect(localizeCategoryKey('gas_station', t)).toBe('poiCategory_fuel');
    expect(localizeCategoryKey('fuel', t)).toBe('poiCategory_fuel');
    expect(localizeCategoryKey('subway_entrance', t)).toBe('poiCategory_subway');
  });

  it.each(['cafe', 'restaurant', 'bank', 'atm', 'mall', 'museum', 'parking', 'supermarket', 'pharmacy', 'convenience', 'clothes', 'bar', 'hotel', 'school', 'park', 'hospital', 'bus_stop', 'station'])(
    'known category %s maps to poiCategory_%s',
    (category) => {
      expect(localizeCategoryKey(category, t)).toBe(`poiCategory_${category}`);
    }
  );

  it('makes the fallback category readable: underscores and dashes become single spaces', () => {
    expect(localizeCategoryKey('fast-food__kiosk', t)).toBe('poiCategory_other[category=fast food kiosk]');
    expect(localizeCategoryKey('Bike_Rental', t)).toBe('poiCategory_other[category=bike rental]');
    expect(localizeCategoryKey('  spaced   out ', t)).toBe('poiCategory_other[category=spaced out]');
  });

  it('returns whatever the translator returns', () => {
    expect(localizeCategoryKey('cafe', () => 'Кафе')).toBe('Кафе');
  });
});

describe('withoutPlaceEchoes', () => {
  const poi = (name: string, distance = 85) => ({ name, category: 'place', distance });

  it('drops a «place nearby» that only repeats the address line above it', () => {
    const items = [poi('Tashmehleshoz'), poi('Чайхана «Пскент»', 320)];
    const kept = withoutPlaceEchoes(items, { city: 'Tashmehleshoz', district: 'Piskent Tumani', country: 'O‘zbekiston' });
    expect(kept.map((item) => item.name)).toEqual(['Чайхана «Пскент»']);
  });

  it('matches regardless of case and padding, and keeps everything else', () => {
    const items = [poi('  piskent tumani  '), poi('Аптека')];
    const kept = withoutPlaceEchoes(items, { district: 'Piskent Tumani', country: '' });
    expect(kept.map((item) => item.name)).toEqual(['Аптека']);
  });

  it('returns the list untouched when there is no address to compare with', () => {
    const items = [poi('Tashmehleshoz')];
    expect(withoutPlaceEchoes(items, null)).toEqual(items);
    expect(withoutPlaceEchoes(items, { country: '' })).toEqual(items);
  });
});
