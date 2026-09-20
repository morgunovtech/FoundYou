import { bearing, defineHandler, getPosition, haversine, json, parseCoord, round4 } from './_geo';
import { OVERPASS_TTL, loadOverpassSets } from './_overpass';

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

  const items: Array<{ name: string; category: string; distance: number; bearing: number }> = [];
  for (const element of result.sets.poi) {
    const position = getPosition(element);
    if (!position) continue;
    const distance = haversine(rlat, rlon, position.lat, position.lon);
    const tags = element.tags ?? {};
    const name = tags.name ?? tags.brand ?? '';
    const category =
      tags.amenity ||
      tags.shop ||
      tags.tourism ||
      tags.historic ||
      tags.leisure ||
      tags.natural ||
      tags.place ||
      tags.man_made ||
      'poi';
    // The direction from the point to the object, so the page can say what the camera was
    // pointed at. A bearing and a distance say strictly less than the object's coordinates,
    // which is why they are computed here and the coordinates are not returned.
    items.push({ name, category, distance, bearing: bearing(rlat, rlon, position.lat, position.lon) });
  }

  const data = items
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map((item) => ({ ...item, distance: Math.round(item.distance), bearing: Math.round(item.bearing) }));

  return json({ ok: true, data }, 200, { 'X-Cache': result.cache }, OVERPASS_TTL);
});
