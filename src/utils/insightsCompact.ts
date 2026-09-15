import type { MessageKey } from '../i18n';
import type { ReverseGeocodeResult, HistoricalWeatherResult, PoiResult } from '../types/api';
import { hasZoneDesignator, parseWallClock, wallClockAsUtcDate } from './format';

const RU_PLACE_MAP: Record<string, string> = {
  "o'zbekiston": 'Узбекистан',
  uzbekistan: 'Узбекистан',
  "toshkent shahri": 'Ташкент',
  toshkent: 'Ташкент',
  tashkent: 'Ташкент',
  avtiasozlar: 'Авиасозлар',
  aviasozlar: 'Авиасозлар'
};

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
};

/**
 * Short date/time for the "When" row.
 * Pass `shotDateLocal` (wall-clock, no zone) and it is rendered digit-for-digit — the time the
 * camera wrote, independent of the viewer's zone. A `Date`/zoned ISO string is treated as an
 * instant and rendered in the viewer's zone (legacy path).
 */
export function formatDateTime(value: string | Date | undefined, locale: string): string | undefined {
  if (!value) return undefined;
  const resolvedLocale = locale === 'ru' ? 'ru-RU' : 'en-GB';
  if (typeof value === 'string' && !hasZoneDesignator(value)) {
    const parts = parseWallClock(value);
    if (!parts) return undefined;
    return new Intl.DateTimeFormat(resolvedLocale, { ...DATE_TIME_OPTIONS, timeZone: 'UTC' }).format(wallClockAsUtcDate(parts));
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(resolvedLocale, DATE_TIME_OPTIONS).format(date);
}

export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function formatDistance(value?: number, locale?: string): string {
  if (value == null || !Number.isFinite(value)) return '';
  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'meter',
      unitDisplay: 'narrow',
      maximumFractionDigits: value < 100 ? 1 : 0
    }).format(value);
    return `± ${formatted}`;
  } catch {
    return `± ${Math.round(value)} m`;
  }
}

export function localizePlaceParts(
  reverseData: ReverseGeocodeResult | null | undefined,
  locale: string
): { place: string; accuracy: string | null } {
  if (!reverseData) {
    return { place: '', accuracy: null };
  }
  const parts = [reverseData.country, reverseData.city, reverseData.district ?? reverseData.state]
    .map((part) => toLocalizedPlace(part ?? '', locale))
    .filter(Boolean);
  const place = parts.join(', ');
  const accuracy = reverseData.precisionMeters != null ? formatDistance(reverseData.precisionMeters, locale) : null;
  return { place, accuracy };
}

export function localizeCategoryKey(
  category: string,
  t: (key: MessageKey, params?: Record<string, string | number>) => string
): string {
  const normalized = category.toLowerCase();
  const key = CATEGORY_KEYS[normalized];
  if (key) {
    return t(key as MessageKey);
  }
  return t('poiCategory_other', { category: toReadableCategory(normalized) });
}

export function dedupeByNameAndDistance(items: PoiResult[]): PoiResult[] {
  const seen = new Set<string>();
  return items.filter((poi) => {
    const id = (poi as { id?: string | number }).id;
    const name = poi.name?.trim().toLowerCase() ?? '';
    const distance = Number.isFinite(poi.distance) ? Math.round(poi.distance) : 0;
    const key = id ? `id-${id}` : `${name || poi.category.toLowerCase()}-${distance}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function formatWeatherLine(weather: HistoricalWeatherResult | null | undefined, locale: string): string | null {
  if (!weather) return null;
  if (weather.temperature == null) return null;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const windUnit = locale === 'en' ? 'km/h' : locale === 'uz' ? 'km/s' : 'км/ч';
  const pressureUnit = locale === 'en' ? 'hPa' : locale === 'uz' ? 'gPa' : 'гПа';
  const parts: string[] = [`${number.format(Math.round(weather.temperature))}°C`];
  if (weather.cloudCover != null) parts.push(`${number.format(Math.round(weather.cloudCover))}%`);
  if (weather.windSpeed != null) parts.push(`${number.format(Math.round(weather.windSpeed))} ${windUnit}`);
  if (weather.pressure != null) parts.push(`${number.format(Math.round(weather.pressure))} ${pressureUnit}`);
  return parts.join(' · ');
}

const CATEGORY_KEYS: Record<string, string> = {
  cafe: 'poiCategory_cafe',
  restaurant: 'poiCategory_restaurant',
  bank: 'poiCategory_bank',
  atm: 'poiCategory_atm',
  mall: 'poiCategory_mall',
  museum: 'poiCategory_museum',
  parking: 'poiCategory_parking',
  fuel: 'poiCategory_fuel',
  gas_station: 'poiCategory_fuel',
  supermarket: 'poiCategory_supermarket',
  pharmacy: 'poiCategory_pharmacy',
  fast_food: 'poiCategory_fast_food',
  convenience: 'poiCategory_convenience',
  clothes: 'poiCategory_clothes',
  bar: 'poiCategory_bar',
  hotel: 'poiCategory_hotel',
  school: 'poiCategory_school',
  park: 'poiCategory_park',
  hospital: 'poiCategory_hospital',
  bus_stop: 'poiCategory_bus_stop',
  subway_entrance: 'poiCategory_subway',
  station: 'poiCategory_station'
};

function toLocalizedPlace(value: string, locale: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (locale !== 'ru') {
    return trimmed;
  }
  const normalized = trimmed.toLowerCase();
  return RU_PLACE_MAP[normalized] ?? trimmed;
}

function toReadableCategory(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
