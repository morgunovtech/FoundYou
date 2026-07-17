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
  node["man_made"="surveillance"](around:300,${lat},${lon});
  node["surveillance"](around:300,${lat},${lon});
  node["amenity"~"bank|atm|bureau_de_change"](around:300,${lat},${lon});
  node["shop"~"mall|supermarket|convenience"](around:300,${lat},${lon});
  way["man_made"="surveillance"](around:300,${lat},${lon});
  way["amenity"~"bank|atm"](around:300,${lat},${lon});
  relation["man_made"="surveillance"](around:300,${lat},${lon});
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
      const category = tags.surveillance || tags.man_made || tags.amenity || tags.shop || 'surveillance';
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
