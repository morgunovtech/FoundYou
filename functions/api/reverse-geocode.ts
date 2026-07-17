import type { PagesEventContext } from './_types';
import {
  fetchUpstream,
  forbiddenResponse,
  jsonResponse,
  originAllowed,
  parseCoordinates,
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

  try {
    const apiUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
    const response = await fetchUpstream(apiUrl, {
      headers: {
        // Политика Nominatim требует идентификацию с рабочим контактом
        'User-Agent': 'meta-data-insight/1.0 (contact: morgunovsvl@gmail.com)'
      },
      cf: { cacheTtl: 900, cacheEverything: true }
    });

    if (!response.ok) {
      return jsonResponse({ ok: false, error: `upstream-${response.status}` });
    }

    const result = (await response.json()) as any;
    // Nominatim отвечает 200 с полем error, если точка не геокодируется
    if (result?.error || !result?.display_name) {
      return jsonResponse({ ok: false, error: 'no-address' });
    }

    const boundingBox = (result.boundingbox ?? []).map((value: string) => Number(value));
    const precision = estimatePrecision(boundingBox);
    const data = {
      address: result.display_name,
      country: result.address?.country ?? 'Unknown',
      countryCode: result.address?.country_code?.toUpperCase(),
      city: result.address?.city ?? result.address?.town ?? result.address?.village,
      state: result.address?.state,
      district: result.address?.suburb ?? result.address?.county ?? result.address?.state_district,
      road: result.address?.road ?? result.address?.pedestrian ?? result.address?.footway,
      houseNumber: result.address?.house_number,
      precisionMeters: precision,
      lat,
      lon
    };

    return jsonResponse({ ok: true, data }, { cacheSeconds: 900 });
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}

function estimatePrecision(boundingBox: number[]): number | undefined {
  if (boundingBox.length !== 4) return undefined;
  const [latMin, latMax, lonMin, lonMax] = boundingBox;
  const latDelta = Math.abs(latMax - latMin);
  const lonDelta = Math.abs(lonMax - lonMin);
  const maxDelta = Math.max(latDelta, lonDelta);
  if (!Number.isFinite(maxDelta)) return undefined;
  return maxDelta * 111_139; // approx meters per degree
}
