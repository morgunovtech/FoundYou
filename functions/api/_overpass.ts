import { DAY, cacheControl, cacheKey, coordKey, fetchUpstream, json, withCache, type CacheContext } from './_geo';

export const OVERPASS_TTL = DAY;
const ENDPOINT = 'https://overpass-api.de/api/interpreter';

export interface OverpassElement {
  type: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OverpassSets {
  poi: OverpassElement[];
  surveillance: OverpassElement[];
  /** What kind of place this is: land use at the point, sensitive neighbours, transport. */
  context: OverpassElement[];
}

export type OverpassResult =
  | { ok: true; sets: OverpassSets; cache: 'HIT' | 'MISS' }
  | { ok: false; error: Response };

/**
 * One query for all three endpoints, as three named sets; each `out count;` emits a single
 * `{type:"count"}` element that we use as the separator between the sets in the output stream.
 *
 * `.poi`: venues (amenity, shop) within 250 m, where density is high; sights,
 * history and parks within 0.5–1 km; named natural features (peaks, springs,
 * waterfalls, caves) and settlements within 1.5 km, so a photo in the hills
 * still gets a landmark. Ways and relations come with `out center`.
 *
 * `.ctx`: what kind of place this is rather than what is nearby. Land use at the point
 * (residential, industrial, farmland — the difference between «дома» and «на работе»); the
 * neighbours that say something about a person whether or not they went in (a school or a
 * kindergarten means a child, a hospital or a clinic means treatment, a place of worship means
 * faith, a police station or a prison means something else again); and the transport that
 * explains a stranger being at the point at all. Radii are deliberately tight — the query
 * shares one `[timeout:6]` with the other two sets, and Overpass is a public server that
 * already refuses work in dense centres.
 */
export function buildQuery(lat: string, lon: string): string {
  const at = (radius: number) => `(around:${radius},${lat},${lon})`;
  return `
[out:json][timeout:6];
(
  node["amenity"]${at(250)};
  node["shop"]${at(250)};
  way["amenity"]${at(250)};
  way["shop"]${at(250)};
  relation["amenity"]${at(250)};
  nwr["tourism"]["tourism"!="yes"]${at(1000)};
  nwr["historic"]["historic"!="yes"]${at(1000)};
  nwr["leisure"~"^(park|garden|nature_reserve|playground|stadium|sports_centre|swimming_pool|beach_resort|marina|golf_course|water_park|track|pitch)$"]${at(500)};
  nwr["natural"~"^(peak|spring|hot_spring|waterfall|cave_entrance|glacier|volcano|saddle|arch|cliff|beach|bay|geyser|dune)$"]${at(1500)};
  node["place"~"^(city|town|village|hamlet|suburb|neighbourhood|quarter|locality|isolated_dwelling)$"]${at(1500)};
)->.poi;
(
  node["man_made"="surveillance"]${at(300)};
  node["surveillance"]${at(300)};
  node["amenity"~"bank|atm|bureau_de_change"]${at(300)};
  node["shop"~"mall|supermarket|convenience"]${at(300)};
  way["man_made"="surveillance"]${at(300)};
  way["amenity"~"bank|atm"]${at(300)};
  relation["man_made"="surveillance"]${at(300)};
)->.cctv;
(
  way["landuse"]${at(200)};
  relation["landuse"]${at(200)};
  nwr["amenity"~"^(school|kindergarten|college|university|hospital|clinic|doctors|police|prison|place_of_worship)$"]${at(500)};
  nwr["military"]${at(1000)};
  nwr["railway"~"^(station|halt)$"]${at(1000)};
  nwr["aeroway"="aerodrome"]${at(3000)};
  node["public_transport"="station"]${at(700)};
)->.ctx;
.poi out center;
.poi out count;
.cctv out center;
.cctv out count;
.ctx out center;`;
}

interface Shared {
  status: number;
  headers: Headers;
  text: string;
}

/** Concurrent callers for the same key (both endpoints fire together on a fresh photo) share one upstream call. */
const inflight = new Map<string, Promise<Shared>>();

export async function loadOverpassSets(context: CacheContext, lat: number, lon: number): Promise<OverpassResult> {
  const [lat4, lon4] = coordKey(lat, lon);
  // The version suffix changes whenever the query does, so cells cached under the old query are not served.
  const key = cacheKey('overpass-v3', lat4, lon4);

  let pending = inflight.get(key);
  if (!pending) {
    pending = withCache(context, key, OVERPASS_TTL, () => produce(lat4, lon4)).then(async (response) => ({
      status: response.status,
      headers: new Headers(response.headers),
      text: await response.text()
    }));
    inflight.set(key, pending);
    void pending.finally(() => inflight.delete(key)).catch(() => undefined);
  }

  const shared = await pending;
  if (shared.status !== 200) {
    return { ok: false, error: new Response(shared.text, { status: shared.status, headers: shared.headers }) };
  }

  let payload: any;
  try {
    payload = JSON.parse(shared.text);
  } catch {
    return { ok: false, error: json({ ok: false, error: 'upstream-invalid' }, 502) };
  }

  const cache = shared.headers.get('X-Cache') === 'HIT' ? 'HIT' : 'MISS';
  return { ok: true, sets: splitSets(Array.isArray(payload?.elements) ? payload.elements : []), cache };
}

async function produce(lat4: string, lon4: string): Promise<Response> {
  const upstream = await fetchUpstream(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(buildQuery(lat4, lon4))}`
  });
  if (!upstream.ok) return upstream.error;

  const text = await upstream.response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'upstream-invalid' }, 502);
  }

  // Overpass reports its own `[timeout:6]` / memory limit as HTTP 200 + `remark`
  // with an empty element list; that must not be cached as a real answer.
  const remark = typeof parsed?.remark === 'string' ? parsed.remark : '';
  if (/timed out|runtime error/i.test(remark)) {
    return json({ ok: false, error: 'upstream-timeout' }, 504);
  }
  if (!Array.isArray(parsed?.elements)) {
    return json({ ok: false, error: 'upstream-invalid' }, 502);
  }

  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl(true, OVERPASS_TTL)
    }
  });
}

function splitSets(elements: any[]): OverpassSets {
  // Three sets, separated by the two `out count` markers the query emits between them.
  const buckets: OverpassElement[][] = [[], [], []];
  let bucket = 0;
  for (const element of elements) {
    if (element?.type === 'count') {
      bucket = Math.min(bucket + 1, buckets.length - 1);
      continue;
    }
    buckets[bucket].push(element);
  }
  if (bucket > 0) return { poi: buckets[0], surveillance: buckets[1], context: buckets[2] };

  // Defensive fallback for a mirror that does not emit `out count`: split by tags.
  console.warn('overpass-missing-separator');
  const all = buckets[0];
  return {
    poi: all.filter(isPoiCandidate),
    surveillance: all.filter(isSurveillanceCandidate),
    context: all.filter(isContextCandidate)
  };
}

function isPoiCandidate(element: OverpassElement): boolean {
  const tags = element.tags ?? {};
  return !!(tags.amenity || tags.shop || tags.tourism || tags.historic || tags.leisure || tags.natural || tags.place);
}

function isContextCandidate(element: OverpassElement): boolean {
  const tags = element.tags ?? {};
  return !!(
    tags.landuse ||
    tags.military ||
    tags.railway ||
    tags.aeroway ||
    tags.public_transport ||
    /^(school|kindergarten|college|university|hospital|clinic|doctors|police|prison|place_of_worship)$/.test(tags.amenity ?? '')
  );
}

function isSurveillanceCandidate(element: OverpassElement): boolean {
  const tags = element.tags ?? {};
  const cctv = tags.man_made === 'surveillance';
  if (element.type === 'node') {
    return cctv || !!tags.surveillance || /bank|atm|bureau_de_change/.test(tags.amenity ?? '') || /mall|supermarket|convenience/.test(tags.shop ?? '');
  }
  if (element.type === 'way') return cctv || /bank|atm/.test(tags.amenity ?? '');
  if (element.type === 'relation') return cctv;
  return false;
}
