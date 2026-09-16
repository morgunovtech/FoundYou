/**
 * A realistic Overpass answer for the combined query in `functions/api/_overpass.ts`:
 * `.poi out center; .poi out count; .cctv out center;` — the `{type:"count"}` element
 * is the separator between the two named sets.
 */
import { haversine } from '../../../functions/api/_geo';

export const TASHKENT = { lat: '41.311158', lon: '69.279737' };
/** What the handlers round the caller's point to (4 decimals). */
export const CELL = { lat: 41.3112, lon: 69.2797 };

export interface FakeElement {
  type: 'node' | 'way' | 'relation' | 'count';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export const POI_ELEMENTS: FakeElement[] = [
  { type: 'node', id: 1, lat: 41.3113, lon: 69.2798, tags: { amenity: 'cafe', name: 'Cafe Uno', cuisine: 'coffee_shop' } },
  { type: 'way', id: 2, center: { lat: 41.312, lon: 69.28 }, tags: { shop: 'supermarket', name: 'Korzinka', building: 'retail' } },
  { type: 'node', id: 3, lat: 41.3105, lon: 69.279, tags: { tourism: 'museum' } }, // nameless
  { type: 'relation', id: 4, tags: { amenity: 'parking', name: 'Underground parking' } }, // no position → skipped
  { type: 'node', id: 5, lat: 41.313, lon: 69.281, tags: { shop: 'clothes', brand: 'Zara' } }, // farthest → cut by top-5
  { type: 'node', id: 6, lat: 41.3125, lon: 69.2805, tags: { leisure: 'park', name: 'Central Park' } },
  { type: 'node', id: 7, lat: 41.3116, lon: 69.2799, tags: { amenity: 'pharmacy', name: 'Dorixona 24' } },
  { type: 'node', id: 8, lat: 41.32, lon: 69.2797, tags: { natural: 'peak', name: 'Kichik Chimyon', ele: '1300' } }, // ~980 m → cut by top-5
  { type: 'node', id: 9, lat: 41.3112, lon: 69.29, tags: { place: 'hamlet', name: 'Teshiktosh' } } // ~860 m → cut by top-5
];

export const COUNT_SEPARATOR: FakeElement = {
  type: 'count',
  id: 0,
  tags: { nodes: '5', ways: '1', relations: '1', total: '7' }
};

export const SURVEILLANCE_ELEMENTS: FakeElement[] = [
  { type: 'node', id: 10, lat: 41.3113, lon: 69.2796, tags: { man_made: 'surveillance', surveillance: 'public', 'surveillance:type': 'camera' } },
  { type: 'node', id: 11, lat: 41.3115, lon: 69.2801, tags: { amenity: 'atm', name: 'Kapitalbank ATM', operator: 'Kapitalbank' } },
  { type: 'way', id: 12, center: { lat: 41.3118, lon: 69.2793 }, tags: { amenity: 'bank', brand: 'NBU' } },
  { type: 'node', id: 2, lat: 41.312, lon: 69.28, tags: { shop: 'supermarket', name: 'Korzinka' } }, // also in .poi
  { type: 'way', id: 14, tags: { man_made: 'surveillance' } }, // no center → skipped
  { type: 'node', id: 15, lat: 41.3109, lon: 69.2795, tags: { man_made: 'surveillance' } }
];

export function overpassPayload(elements: FakeElement[] = [...POI_ELEMENTS, COUNT_SEPARATOR, ...SURVEILLANCE_ELEMENTS]) {
  return {
    version: 0.6,
    generator: 'Overpass API 0.7.62.4 2390de5a',
    osm3s: { timestamp_osm_base: '2026-09-15T10:00:00Z', copyright: 'The data included in this document is from www.openstreetmap.org.' },
    elements
  };
}

/** Distance in metres from the rounded cell, as the handler computes it. */
export function distanceFromCell(element: FakeElement): number {
  const lat = element.lat ?? element.center?.lat ?? NaN;
  const lon = element.lon ?? element.center?.lon ?? NaN;
  return Math.round(haversine(CELL.lat, CELL.lon, lat, lon));
}

/** The Overpass QL text from the `data=` form body the handler posts. */
export function decodeQuery(init: RequestInit | undefined): string {
  const body = String(init?.body ?? '');
  return decodeURIComponent(body.replace(/^data=/, ''));
}
