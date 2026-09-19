import { DAY, cacheKey, coordKey, defineHandler, fetchUpstream, json, parseCoord, round4, withCache } from './_geo';

const TTL = DAY;

export const onRequest = defineHandler(async ({ url, context }) => {
  const lat = parseCoord(url.searchParams.get('lat'), 90);
  const lon = parseCoord(url.searchParams.get('lon'), 180);
  if (lat === null || lon === null) {
    return json({ ok: false, error: 'invalid-coordinates' }, 400);
  }
  const rlat = round4(lat);
  const rlon = round4(lon);
  const [lat4, lon4] = coordKey(rlat, rlon);

  return withCache(context, cacheKey('reverse-geocode', lat4, lon4), TTL, async () => {
    const upstream = await fetchUpstream(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat4}&lon=${lon4}`
    );
    if (!upstream.ok) return upstream.error;

    let result: any;
    try {
      result = await upstream.response.json();
    } catch {
      return json({ ok: false, error: 'upstream-invalid' }, 502);
    }

    const boundingBox = (Array.isArray(result?.boundingbox) ? result.boundingbox : []).map((value: string) => Number(value));
    const address = result?.address ?? {};
    const countryCode = typeof address.country_code === 'string' ? address.country_code.toUpperCase() : undefined;
    const data = {
      address: result?.display_name ?? 'Unknown address',
      country: address.country ?? 'Unknown',
      countryCode,
      city: address.city ?? address.town ?? address.village,
      state: address.state,
      district: address.suburb ?? address.county ?? address.state_district,
      road: address.road ?? address.pedestrian ?? address.footway,
      houseNumber: address.house_number,
      // What the point resolved to (hotel, house, road…): the sensitivity of an address depends on it.
      category: asString(result?.category),
      type: asString(result?.type),
      addressType: asString(result?.addresstype),
      name: asString(result?.name),
      precisionMeters: estimatePrecision(boundingBox),
      // How far the matched object is from the point asked about. Nominatim answers with the
      // nearest addressable thing, which in open country is a road a few hundred metres away —
      // without this the page would present it as «what is here».
      distanceMeters: distanceTo(rlat, rlon, Number(result?.lat), Number(result?.lon)),
      // The answer is shared by every request that rounds to the same cell,
      // so it must describe the rounded point, not the caller's exact one.
      lat: rlat,
      lon: rlon
    };

    return json({ ok: true, data }, 200, undefined, TTL);
  });
});

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Great-circle distance in metres; undefined when the upstream gave no usable coordinates. */
function distanceTo(lat: number, lon: number, targetLat: number, targetLon: number): number | undefined {
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return undefined;
  const toRad = Math.PI / 180;
  const meanLat = ((lat + targetLat) / 2) * toRad;
  const dLat = (targetLat - lat) * toRad * 6_371_000;
  const dLon = (targetLon - lon) * toRad * 6_371_000 * Math.cos(meanLat);
  return Math.round(Math.hypot(dLat, dLon));
}

function estimatePrecision(boundingBox: number[]): number | undefined {
  if (boundingBox.length !== 4) return undefined;
  const [latMin, latMax, lonMin, lonMax] = boundingBox;
  const latDelta = Math.abs(latMax - latMin);
  const lonDelta = Math.abs(lonMax - lonMin);
  const maxDelta = Math.max(latDelta, lonDelta);
  if (!Number.isFinite(maxDelta)) return undefined;
  return maxDelta * 111_139;
}
