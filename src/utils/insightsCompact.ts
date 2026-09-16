import type { MessageKey } from '../i18n';
import type { ReverseGeocodeResult, PoiResult } from '../types/api';

const RU_PLACE_MAP: Record<string, string> = {
  "o'zbekiston": 'Узбекистан',
  uzbekistan: 'Узбекистан',
  "toshkent shahri": 'Ташкент',
  toshkent: 'Ташкент',
  tashkent: 'Ташкент',
  avtiasozlar: 'Авиасозлар',
  aviasozlar: 'Авиасозлар'
};


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

/** Dictionary key for an OSM venue type, or null when there is no dedicated label. */
export function categoryKey(category: string): MessageKey | null {
  return CATEGORY_KEYS[category.toLowerCase()] ?? null;
}

export function localizeCategoryKey(
  category: string,
  t: (key: MessageKey, params?: Record<string, string | number>) => string
): string {
  const normalized = category.toLowerCase();
  const key = CATEGORY_KEYS[normalized];
  if (key) {
    return t(key);
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

const CATEGORY_KEYS: Record<string, MessageKey> = {
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
  station: 'poiCategory_station',
  attraction: 'poiCategory_attraction',
  viewpoint: 'poiCategory_viewpoint',
  camp_site: 'poiCategory_camp_site',
  picnic_site: 'poiCategory_picnic_site',
  guest_house: 'poiCategory_guest_house',
  information: 'poiCategory_information',
  artwork: 'poiCategory_artwork',
  monument: 'poiCategory_monument',
  memorial: 'poiCategory_memorial',
  castle: 'poiCategory_castle',
  ruins: 'poiCategory_ruins',
  archaeological_site: 'poiCategory_archaeological_site',
  peak: 'poiCategory_peak',
  spring: 'poiCategory_spring',
  waterfall: 'poiCategory_waterfall',
  cave_entrance: 'poiCategory_cave_entrance',
  nature_reserve: 'poiCategory_nature_reserve',
  garden: 'poiCategory_garden',
  playground: 'poiCategory_playground',
  stadium: 'poiCategory_stadium',
  sports_centre: 'poiCategory_sports_centre',
  village: 'poiCategory_village',
  hamlet: 'poiCategory_hamlet',
  neighbourhood: 'poiCategory_neighbourhood',
  suburb: 'poiCategory_suburb',
  locality: 'poiCategory_locality',
  place_of_worship: 'poiCategory_place_of_worship',
  kindergarten: 'poiCategory_kindergarten',
  university: 'poiCategory_university',
  college: 'poiCategory_college',
  police: 'poiCategory_police',
  clinic: 'poiCategory_clinic',
  doctors: 'poiCategory_doctors',
  dentist: 'poiCategory_dentist',
  marketplace: 'poiCategory_marketplace',
  cinema: 'poiCategory_cinema',
  theatre: 'poiCategory_theatre',
  library: 'poiCategory_library',
  bench: 'poiCategory_bench',
  toilets: 'poiCategory_toilets',
  drinking_water: 'poiCategory_drinking_water',
  shelter: 'poiCategory_shelter'
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
