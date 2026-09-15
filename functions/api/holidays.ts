import { DAY, cacheControl, cacheKey, defineHandler, fetchUpstream, json, withCache } from './_geo';

const RAW_TTL = 30 * DAY; // Nager list per country+year
const MISS_TTL = DAY; // country unknown to Nager → empty list, retried daily
const RESPONSE_TTL = DAY;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const onRequest = defineHandler(async ({ url, context }) => {
  const countryRaw = (url.searchParams.get('country') ?? '').trim();
  const date = (url.searchParams.get('date') ?? '').trim();
  const year = parseYear(date);
  if (!/^[A-Za-z]{2}$/.test(countryRaw) || year === null) {
    return json({ ok: false, error: 'invalid-params' }, 400);
  }
  const country = countryRaw.toUpperCase();

  const raw = await withCache(context, cacheKey('holidays', country, year), RAW_TTL, () => produce(country, year));
  if (!raw.ok) return raw;
  const cache = raw.headers.get('X-Cache') ?? 'MISS';

  let entries: unknown;
  try {
    entries = await raw.json();
  } catch {
    return json({ ok: false, error: 'upstream-invalid' }, 502);
  }

  const holidays = (Array.isArray(entries) ? entries : [])
    .filter((entry: any) => entry?.date === date)
    .map((entry: any) => ({
      date: String(entry.date),
      localName: String(entry.localName ?? entry.name ?? ''),
      name: String(entry.name ?? entry.localName ?? ''),
      global: entry.global === true
    }));

  return json({ ok: true, data: { isHoliday: holidays.length > 0, holidays } }, 200, { 'X-Cache': cache }, RESPONSE_TTL);
});

/** Valid calendar date in YYYY-MM-DD within a range Nager can answer for; returns the year. */
function parseYear(date: string): number | null {
  const match = DATE_RE.exec(date);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return year;
}

/**
 * Fixed-date public holidays for countries Nager.Date does not cover.
 * Uzbekistan is the product's home market and Nager answers 204 for UZ, so the
 * state holidays are kept here (month-day → names). Movable religious holidays
 * (Ramazon hayit, Qurbon hayit) follow the lunar calendar and are not listed.
 */
const STATIC_HOLIDAYS: Record<string, Array<{ md: string; localName: string; name: string }>> = {
  UZ: [
    { md: '01-01', localName: 'Yangi yil', name: "New Year's Day" },
    { md: '03-08', localName: 'Xotin-qizlar kuni', name: "International Women's Day" },
    { md: '03-21', localName: 'Navroʻz bayrami', name: 'Navruz' },
    { md: '05-09', localName: 'Xotira va qadrlash kuni', name: 'Day of Memory and Honour' },
    { md: '09-01', localName: 'Mustaqillik kuni', name: 'Independence Day' },
    { md: '10-01', localName: 'Oʻqituvchi va murabbiylar kuni', name: "Teachers' Day" },
    { md: '12-08', localName: 'Konstitutsiya kuni', name: 'Constitution Day' }
  ]
};

function staticList(country: string, year: number): string {
  const entries = STATIC_HOLIDAYS[country] ?? [];
  return JSON.stringify(
    entries.map((entry) => ({ date: `${year}-${entry.md}`, localName: entry.localName, name: entry.name, global: true }))
  );
}

async function produce(country: string, year: number): Promise<Response> {
  const upstream = await fetchUpstream(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`);

  if (!upstream.ok) {
    // Nager answers 404 for a country it does not know: fall back to the static table (or "no holidays").
    if (upstream.status === 404) return rawList(staticList(country, year), STATIC_HOLIDAYS[country] ? RAW_TTL : MISS_TTL);
    return upstream.error;
  }
  // 204 = country not covered by Nager (UZ today): same fallback.
  if (upstream.status === 204) return rawList(staticList(country, year), STATIC_HOLIDAYS[country] ? RAW_TTL : MISS_TTL);

  const text = await upstream.response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'upstream-invalid' }, 502);
  }
  if (!Array.isArray(parsed)) return json({ ok: false, error: 'upstream-invalid' }, 502);
  return rawList(text, RAW_TTL);
}

function rawList(body: string, ttl: number): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl(true, ttl)
    }
  });
}
