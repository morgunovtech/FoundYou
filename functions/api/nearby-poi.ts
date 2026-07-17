import type { PagesEventContext } from './_types';
import {
  forbiddenResponse,
  haversineMeters,
  jsonResponse,
  originAllowed,
  overpassPosition,
  parseCoordinates,
  queryOverpass,
  upstreamErrorResponse
} from './_shared';

export async function onRequest({ request }: PagesEventContext): Promise<Response> {
  if (!originAllowed(request)) {
    return forbiddenResponse();
  }
  const coords = parseCoordinates(new URL(request.url));
  if (!coords) {
    return jsonResponse({ ok: false, error: 'invalid-coordinates' });
  }
  const { lat, lon } = coords;

  const query = `
[out:json][timeout:10];
(
  node["amenity"](around:250,${lat},${lon});
  node["shop"](around:250,${lat},${lon});
  node["tourism"](around:250,${lat},${lon});
  node["leisure"](around:250,${lat},${lon});
  way["amenity"](around:250,${lat},${lon});
  way["shop"](around:250,${lat},${lon});
  relation["amenity"](around:250,${lat},${lon});
);
out center;`;

  try {
    const elements = await queryOverpass(query, 600);
    const items: Array<{ name: string; category: string; distance: number }> = [];
    for (const element of elements) {
      const position = overpassPosition(element);
      if (!position) continue;
      const distance = haversineMeters(lat, lon, position.lat, position.lon);
      const tags = element.tags ?? {};
      const name = tags.name ?? tags.brand ?? '';
      const category =
        tags.amenity ||
        tags.shop ||
        tags.tourism ||
        tags.leisure ||
        tags.man_made ||
        'poi';
      items.push({ name, category, distance });
    }

    const data = items
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5)
      .map((item) => ({ ...item, distance: Math.round(item.distance) }));

    return jsonResponse({ ok: true, data }, { cacheSeconds: 600 });
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}
