import { DAY, cacheKey, coordKey, defineHandler, fetchUpstream, json, parseCoord, round4, withCache } from './_geo';

/** Terrain does not move: a month in the edge cache. */
const TTL = 30 * DAY;
/** Open-Meteo serves the Copernicus GLO-90 digital elevation model (90 m cells). */
const RESOLUTION_METERS = 90;

export const onRequest = defineHandler(async ({ url, context }) => {
  const lat = parseCoord(url.searchParams.get('lat'), 90);
  const lon = parseCoord(url.searchParams.get('lon'), 180);
  if (lat === null || lon === null) {
    return json({ ok: false, error: 'invalid-coordinates' }, 400);
  }
  const [lat4, lon4] = coordKey(round4(lat), round4(lon));

  return withCache(context, cacheKey('elevation', lat4, lon4), TTL, async () => {
    const upstream = await fetchUpstream(`https://api.open-meteo.com/v1/elevation?latitude=${lat4}&longitude=${lon4}`);
    if (!upstream.ok) return upstream.error;

    let payload: any;
    try {
      payload = await upstream.response.json();
    } catch {
      return json({ ok: false, error: 'upstream-invalid' }, 502);
    }

    const value = Array.isArray(payload?.elevation) ? Number(payload.elevation[0]) : NaN;
    if (!Number.isFinite(value)) {
      return json({ ok: false, error: 'upstream-invalid' }, 502);
    }
    return json({ ok: true, data: { elevation: value, resolutionMeters: RESOLUTION_METERS } }, 200, undefined, TTL);
  });
});
