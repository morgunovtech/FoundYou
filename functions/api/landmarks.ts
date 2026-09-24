import { DAY, HOUR, UPSTREAM_TIMEOUT_MS, cacheKey, coordKey, defineHandler, fetchUpstream, json, parseCoord, round4, withCache } from './_geo';

/**
 * Wikipedia articles about places near the point.
 *
 * What this is for: a coordinate in a residential street and a coordinate at a landmark leak
 * very different things. The first says where someone probably lives; the second says they
 * visited somewhere thousands of other people visit, which is close to saying nothing. OSM
 * knows the objects, but not which of them are known — Wikipedia does, and an article is a
 * reasonable proxy for «a public place with a name people recognise».
 *
 * **This is a new external host, and that was a decision, not a config change.** It is the
 * fourth upstream after Nominatim, Open-Meteo, Overpass and Nager. What leaves the device does
 * not change: the same coordinates rounded to four decimals, sent to our own Function, which
 * asks Wikipedia. The browser never talks to Wikipedia, so no IP address of a reader reaches
 * it and the CSP stays as it is — the request is made from Cloudflare, like the others.
 *
 * The language edition follows the country, so a place in Uzbekistan is looked up in the
 * Uzbek and Russian Wikipedias rather than only the English one, where half the mahallas and
 * monuments of Tashkent do not exist.
 */

const TTL = 7 * DAY;
/**
 * An empty answer that is not the whole story — an edition unreachable, or never asked because
 * the budget ran out — is kept only this long, so an outage at Wikipedia does not become
 * «nothing here» for a week.
 */
const PARTIAL_TTL = HOUR;
/**
 * With less of the budget than this left, another edition is not worth asking: the request
 * would be aborted before Wikipedia can answer, and the abort itself still costs a connection.
 */
const MIN_ASK_MS = 500;
/** A landmark further than this is not «here» in any useful sense. */
const RADIUS_METERS = 1000;
const MAX_RESULTS = 5;

/** Country → the Wikipedia editions most likely to have the article, best first. */
const EDITIONS: Record<string, string[]> = {
  UZ: ['uz', 'ru', 'en'],
  KZ: ['kk', 'ru', 'en'],
  KG: ['ky', 'ru', 'en'],
  TJ: ['tg', 'ru', 'en'],
  RU: ['ru', 'en'],
  BY: ['ru', 'en'],
  UA: ['uk', 'en']
};
const DEFAULT_EDITIONS = ['en'];

/** Only these are allowed into a URL, so a country code can never steer the request elsewhere. */
const KNOWN_EDITIONS = new Set(['uz', 'ru', 'en', 'kk', 'ky', 'tg', 'uk']);

export const onRequest = defineHandler(async ({ url, context }) => {
  const lat = parseCoord(url.searchParams.get('lat'), 90);
  const lon = parseCoord(url.searchParams.get('lon'), 180);
  if (lat === null || lon === null) {
    return json({ ok: false, error: 'invalid-coordinates' }, 400);
  }
  const countryRaw = (url.searchParams.get('country') ?? '').trim().toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : '';
  const editions = (EDITIONS[country] ?? DEFAULT_EDITIONS).filter((code) => KNOWN_EDITIONS.has(code));
  const [lat4, lon4] = coordKey(round4(lat), round4(lon));

  return withCache(context, cacheKey('landmarks', lat4, lon4, editions.join('-')), TTL, async () => {
    // One deadline for the whole loop. Each edition used to get a fresh 8 s of its own, so three
    // of them could take 24 s against the page's 12 s timeout — the browser had given up on an
    // answer the Function then went on to compute and cache.
    const deadline = Date.now() + UPSTREAM_TIMEOUT_MS;
    let answered = false; // at least one edition gave a usable answer
    let complete = true; // every edition was asked and every one of them answered
    for (const edition of editions) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_ASK_MS) {
        complete = false;
        break;
      }
      const found = await askWikipedia(edition, lat4, lon4, remaining);
      if (found === null) {
        complete = false; // upstream problem: try the next edition rather than fail
        continue;
      }
      answered = true;
      if (found.length > 0) return json({ ok: true, data: found }, 200, undefined, TTL);
    }
    // No edition answered at all. That is an outage, not a place nobody has written about, and
    // it must not be cached as one; `withCache` never stores an error.
    if (!answered) return json({ ok: false, error: 'upstream-unavailable' }, 502);
    // At least one edition answered and none of those asked knows this place. That is an answer,
    // not a failure: it means the point is somewhere unremarkable, which is exactly what the card
    // reports. It is kept for the week only when every edition said so; when one was down or
    // never asked, the list may be missing the article that exists, so it is kept for an hour.
    return json({ ok: true, data: [] }, 200, undefined, complete ? TTL : PARTIAL_TTL);
  });
});

interface Landmark {
  title: string;
  distance: number;
  lang: string;
}

/** `null` when the edition could not be reached within `timeoutMs` or did not answer usefully. */
async function askWikipedia(edition: string, lat4: string, lon4: string, timeoutMs: number): Promise<Landmark[] | null> {
  const query =
    `https://${edition}.wikipedia.org/w/api.php?action=query&list=geosearch&format=json&origin=*` +
    `&gscoord=${lat4}%7C${lon4}&gsradius=${RADIUS_METERS}&gslimit=${MAX_RESULTS}`;
  const upstream = await fetchUpstream(query, {}, timeoutMs);
  if (!upstream.ok) return null;

  let payload: any;
  try {
    payload = JSON.parse(upstream.text);
  } catch {
    return null;
  }
  const rows = payload?.query?.geosearch;
  if (!Array.isArray(rows)) return null;

  return rows
    .filter((row: any) => typeof row?.title === 'string' && Number.isFinite(Number(row?.dist)))
    .map((row: any) => ({ title: String(row.title), distance: Math.round(Number(row.dist)), lang: edition }))
    .slice(0, MAX_RESULTS);
}
