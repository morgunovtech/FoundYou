import type { MessageKey } from '../i18n';
import type { ReverseGeocodeResult } from '../types/api';
import { categoryKey } from './insightsCompact';

export interface PlaceTypeLabel {
  key: MessageKey;
  params?: Record<string, string | number>;
}

const HOUSE = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'villa', 'cabin', 'farm']);
const APARTMENTS = new Set(['apartments', 'residential', 'dormitory']);
const COMMERCIAL = new Set(['office', 'commercial', 'retail', 'supermarket', 'kiosk', 'shop']);
const INDUSTRIAL = new Set(['industrial', 'warehouse', 'factory', 'manufacture']);
const VENUE_CATEGORIES = new Set(['amenity', 'shop', 'tourism', 'leisure', 'historic', 'natural', 'office', 'craft']);

/**
 * What Nominatim's `category` / `type` / `addresstype` say the point is. A home
 * address and a hotel carry very different risks, so the type is shown next to
 * the address. Returns null when the object type says nothing useful.
 */
export function placeTypeLabel(
  result: Pick<ReverseGeocodeResult, 'category' | 'type' | 'addressType'> | null | undefined
): PlaceTypeLabel | null {
  if (!result) return null;
  const category = result.category?.toLowerCase() ?? '';
  const type = result.type?.toLowerCase() ?? '';
  const addressType = result.addressType?.toLowerCase() ?? '';
  if (!category && !type) return null;

  if (category === 'building' || addressType === 'building') {
    if (HOUSE.has(type)) return { key: 'placeType_house' };
    if (APARTMENTS.has(type)) return { key: 'placeType_apartments' };
    if (COMMERCIAL.has(type)) return { key: 'placeType_commercial' };
    if (INDUSTRIAL.has(type)) return { key: 'placeType_industrial' };
    const venue = categoryKey(type);
    return venue ? { key: venue } : { key: 'placeType_building' };
  }
  if (category === 'place' && HOUSE.has(type)) return { key: 'placeType_house' };
  if (category === 'highway') return { key: 'placeType_road' };
  if (category === 'landuse' && type === 'residential') return { key: 'placeType_residential' };
  if (VENUE_CATEGORIES.has(category)) {
    const venue = categoryKey(type);
    return venue ? { key: venue } : { key: 'poiCategory_other', params: { category: type.replace(/[_-]+/g, ' ') } };
  }
  return null;
}
