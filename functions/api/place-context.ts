import { defineHandler, getPosition, haversine, json, parseCoord, round4 } from './_geo';
import { loadOverpassSets, type OverpassElement } from './_overpass';

/**
 * What kind of place this is, rather than what happens to be nearby.
 *
 * Three questions the «объекты рядом» list cannot answer. What the land is used for at the
 * point — residential, industrial, farmland — which separates «дома» from «на работе» from
 * «за городом». Which neighbours say something about a person whether or not they ever went
 * in: a school or a kindergarten means a child, a hospital or a clinic means treatment, a
 * place of worship means faith, a police station or a prison means something else again. And
 * how many people live in the nearest settlement, because a point in a city of three million
 * and a point in a village of eight hundred leak very different amounts about who was there.
 *
 * It costs no extra upstream request: `loadOverpassSets` serves all three endpoints from the
 * one cached Overpass answer, and only 4-decimal coordinates ever reach it.
 */

/** Sensitive neighbours are only reported this close; further away they say nothing about anyone. */
const SENSITIVE_RADIUS_METERS = 500;
/** How far a settlement may be and still be «the settlement this point is in». */
const PLACE_RADIUS_METERS = 1500;
const MAX_SENSITIVE = 5;
const MAX_TRANSPORT = 3;

export const onRequest = defineHandler(async ({ url, context }) => {
  const lat = parseCoord(url.searchParams.get('lat'), 90);
  const lon = parseCoord(url.searchParams.get('lon'), 180);
  if (lat === null || lon === null) {
    return json({ ok: false, error: 'invalid-coordinates' }, 400);
  }
  const rlat = round4(lat);
  const rlon = round4(lon);

  const result = await loadOverpassSets(context, rlat, rlon);
  if (!result.ok) return result.error;

  const sensitive: Array<{ kind: string; name: string; distance: number }> = [];
  const transport: Array<{ kind: string; name: string; distance: number }> = [];
  let landuse: string | undefined;
  let landuseDistance = Number.POSITIVE_INFINITY;

  for (const element of result.sets.context) {
    const tags = element.tags ?? {};
    const name = tags.name ?? '';
    const distance = distanceOf(element, rlat, rlon);

    // Land use: the closest polygon wins. A way with no `center` still counts — Overpass gives
    // one for `out center`, and without it the tag is still the land use around the point.
    if (tags.landuse) {
      if (distance <= landuseDistance) {
        landuse = tags.landuse;
        landuseDistance = distance;
      }
      continue;
    }

    if (tags.military) {
      sensitive.push({ kind: 'military', name, distance });
      continue;
    }
    if (tags.amenity && distance <= SENSITIVE_RADIUS_METERS) {
      sensitive.push({ kind: tags.amenity, name, distance });
      continue;
    }
    // A metro station is `railway=station` + `station=subway`; «вокзал» for the Tashkent metro was wrong.
    if (tags.railway === 'station' && tags.station === 'subway') transport.push({ kind: 'station:subway', name, distance });
    else if (tags.railway) transport.push({ kind: `railway:${tags.railway}`, name, distance });
    else if (tags.aeroway) transport.push({ kind: 'aerodrome', name, distance });
    else if (tags.public_transport) transport.push({ kind: 'public_transport', name, distance });
  }

  const data = {
    landuse,
    sensitive: byDistance(sensitive).slice(0, MAX_SENSITIVE),
    transport: byDistance(transport).slice(0, MAX_TRANSPORT),
    ...population(result.sets.poi, rlat, rlon)
  };

  // Built after the shared Overpass cache, so this is the browser's copy: no TTL, never on disk.
  return json({ ok: true, data }, 200, { 'X-Cache': result.cache });
});

function distanceOf(element: OverpassElement, lat: number, lon: number): number {
  const position = getPosition(element);
  // A polygon Overpass gave no centre for is treated as being at the point: it was matched by
  // `around`, so the point is inside or beside it either way.
  return position ? haversine(lat, lon, position.lat, position.lon) : 0;
}

function byDistance<T extends { distance: number }>(items: T[]): T[] {
  return items
    .sort((a, b) => a.distance - b.distance)
    .map((item) => ({ ...item, distance: Math.round(item.distance) }));
}

/**
 * The nearest settlement that records its own population, from the `place` nodes the POI set
 * already carries. OSM's `population` tag is an integer as a string, sometimes with spaces or
 * a stray suffix; anything that does not read as a plain count is left out rather than guessed.
 */
function population(poi: OverpassElement[], lat: number, lon: number): { placeName?: string; placeKind?: string; population?: number } {
  let best: { name: string; kind: string; population: number; distance: number } | null = null;
  for (const element of poi) {
    const tags = element.tags ?? {};
    if (!tags.place || !tags.population) continue;
    // OSM most often carries the spaced form («1 240»), with an ordinary space or a
    // non-breaking one; both are stripped before the value is read as a count.
    const count = Number(String(tags.population).replace(/[\s\u00A0]/g, ''));
    if (!Number.isFinite(count) || count <= 0 || count > 100_000_000) continue;
    const position = getPosition(element);
    if (!position) continue;
    const distance = haversine(lat, lon, position.lat, position.lon);
    if (distance > PLACE_RADIUS_METERS) continue;
    if (!best || distance < best.distance) {
      best = { name: tags.name ?? '', kind: tags.place, population: count, distance };
    }
  }
  return best ? { placeName: best.name, placeKind: best.kind, population: best.population } : {};
}
