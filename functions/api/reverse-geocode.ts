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
      // `extratags` carries the building's own tags (storeys, operator, opening hours);
      // `namedetails` carries the local-language names. Both are the same request to the same
      // upstream with the same rounded coordinates — only the answer is richer.
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&extratags=1&namedetails=1&lat=${lat4}&lon=${lon4}`
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
      // The finest administrative level OSM has for the point. In Tashkent that is the mahalla,
      // which is a far smaller circle around someone than «Чиланзарский район».
      neighbourhood: asString(address.neighbourhood ?? address.quarter ?? address.residential ?? address.city_block),
      // How specific Nominatim itself considers the match (30 = country … 30+ = house). A high
      // rank with a small distance is «this exact building»; a low one is «somewhere in this city».
      placeRank: Number.isFinite(Number(result?.place_rank)) ? Number(result.place_rank) : undefined,
      // Storeys of the building the point falls in, when OSM records them.
      buildingLevels: levelsOf(result?.extratags),
      // The name in the local language, when it differs from the one Nominatim chose.
      localName: localNameOf(result?.namedetails, countryCode),
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

/** `building:levels` from the object's own OSM tags, when it is a plain number of storeys. */
function levelsOf(extratags: unknown): number | undefined {
  if (!extratags || typeof extratags !== 'object') return undefined;
  const raw = (extratags as Record<string, unknown>)['building:levels'];
  // An empty or blank tag is not «0 storeys»: `Number('')` is 0, and printing that as a fact
  // would invent a value OSM does not hold. Caught by the endpoint's own test.
  const text = typeof raw === 'string' ? raw.trim() : raw;
  if (text === '' || text == null) return undefined;
  const levels = Number(text);
  // 0 is a legal OSM value for a structure with no storeys, and above ~200 it is vandalism.
  return Number.isFinite(levels) && levels >= 0 && levels <= 200 ? levels : undefined;
}

/**
 * The name written in the language of the country the point is in — `name:uz` in Uzbekistan,
 * `name:ru` where Russian is official — when it differs from the name Nominatim returned.
 * Only names OSM already holds; nothing is translated and nothing extra is requested.
 */
const LOCAL_NAME_KEYS: Record<string, string[]> = {
  UZ: ['name:uz', 'name:ru'],
  KZ: ['name:kk', 'name:ru'],
  KG: ['name:ky', 'name:ru'],
  TJ: ['name:tg', 'name:ru'],
  RU: ['name:ru']
};

function localNameOf(namedetails: unknown, countryCode: string | undefined): string | undefined {
  if (!namedetails || typeof namedetails !== 'object' || !countryCode) return undefined;
  const names = namedetails as Record<string, unknown>;
  const base = asString(names.name);
  for (const key of LOCAL_NAME_KEYS[countryCode] ?? []) {
    const value = asString(names[key]);
    if (value && value !== base) return value;
  }
  return undefined;
}

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
