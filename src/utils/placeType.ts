import type { MessageKey } from '../i18n';
import type { ReverseGeocodeResult } from '../types/api';
import { categoryKey } from './insightsCompact';

export interface PlaceTypeLabel {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/**
 * Past this distance the matched object is not «what is here» any more. Nominatim answers with
 * the nearest addressable thing, so a point in a field, a marsh or a forest resolves to the road
 * that runs past it — the page said «Что здесь: улица» about a marsh. The request is rounded to
 * four decimals (≈11 m), so the bar sits well above that slack.
 */
export const HERE_RADIUS_METERS = 60;

/**
 * Whether the matched object can be called «what is here». A road never can: a point on it would
 * be the road itself, and everywhere else it is merely the nearest line on the map. Anything
 * further than {@link HERE_RADIUS_METERS} cannot either, whatever it is.
 */
export function isAtThePoint(
  result: Pick<ReverseGeocodeResult, 'category' | 'distanceMeters'> | null | undefined
): boolean {
  if (!result) return false;
  if (result.category?.toLowerCase() === 'highway') return false;
  return result.distanceMeters == null || result.distanceMeters <= HERE_RADIUS_METERS;
}

const HOUSE = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'villa', 'cabin', 'farm']);
const APARTMENTS = new Set(['apartments', 'residential', 'dormitory']);
const COMMERCIAL = new Set(['office', 'commercial', 'retail', 'supermarket', 'kiosk', 'shop']);
const INDUSTRIAL = new Set(['industrial', 'warehouse', 'factory', 'manufacture']);
const VENUE_CATEGORIES = new Set(['amenity', 'shop', 'tourism', 'leisure', 'historic', 'natural', 'office', 'craft']);
const STATION_TYPES = new Set(['station', 'halt', 'stop', 'stop_position', 'platform', 'subway_entrance', 'tram_stop', 'bus_station']);

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

  // A station is a place people pass through, and a common one to stand at: the live answer for
  // a point in central Tashkent was `railway/station` (the metro), which used to map to nothing
  // and left the row without a type at all (checked against Nominatim on 2026-09-24).
  if ((category === 'railway' || category === 'public_transport') && STATION_TYPES.has(type)) {
    return { key: 'placeType_station' };
  }
  if (category === 'aeroway' && (type === 'aerodrome' || type === 'terminal')) {
    return { key: 'placeType_aerodrome' };
  }

  if (category === 'building' || addressType === 'building') {
    if (HOUSE.has(type)) return { key: 'placeType_house' };
    if (APARTMENTS.has(type)) return { key: 'placeType_apartments' };
    if (COMMERCIAL.has(type)) return { key: 'placeType_commercial' };
    if (INDUSTRIAL.has(type)) return { key: 'placeType_industrial' };
    const venue = categoryKey(type);
    return venue ? { key: venue } : { key: 'placeType_building' };
  }
  // Nominatim's `place=house` is an address point (a house number without a building tag): a
  // shop entrance or an office door as often as a home, so it is not called a private house.
  if (category === 'place' && HOUSE.has(type)) return { key: 'placeType_address' };
  if (category === 'highway') return { key: 'placeType_road' };
  if (category === 'landuse' && type === 'residential') return { key: 'placeType_residential' };
  if (VENUE_CATEGORIES.has(category)) {
    // `tourism=yes` / `shop=yes` name the category, not the venue: label by the category.
    const venue = categoryKey(type === 'yes' ? category : type);
    if (venue) return { key: venue };
    if (type === 'yes') return { key: 'placeType_building' };
    return { key: 'poiCategory_other', params: { category: type.replace(/[_-]+/g, ' ') } };
  }
  return null;
}
