import { DAY, cacheControl, cacheKey, defineHandler, fetchUpstream, json, withCache } from './_geo';

const RAW_TTL = 30 * DAY; // Nager list per country+year
const MISS_TTL = DAY; // country unknown to Nager → empty list, retried daily
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
      global: entry.global === true,
      // Present only when true: an ordinary fixed holiday carries no flag, so the payload and
      // the endpoint's tests stay about what is actually being said.
      ...(entry.approximate === true ? { approximate: true } : {})
    }));

  // The per-day answer is built after the cache, so it is the browser's copy and carries no TTL:
  // only the raw per-year list is cached, at the edge. A country and a date say less than a
  // coordinate, but they are still the reader's photograph, and `/api/*` is never kept on disk.
  return json({ ok: true, data: { isHoliday: holidays.length > 0, holidays } }, 200, { 'X-Cache': cache });
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
 * state holidays are kept here (month-day → names). The two movable religious
 * holidays follow the lunar calendar and are handled by `movableList` below.
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

/**
 * Ramazon hayit and Qurbon hayit, the two movable holidays of Uzbekistan.
 *
 * They follow the lunar calendar, and the calendar alone does not decide them: the exact day is
 * announced by the Muslim Board of Uzbekistan, and a public holiday exists because it was
 * announced, not because a formula produced it. So announced dates are listed here verbatim and
 * anything else is computed from the tabular (Kuwaiti) Islamic calendar and marked `approximate`,
 * which the card then says out loud. Measured against the announcements: the table reproduces
 * 2026 exactly (Ramazon 20 March, Qurbon 27 May) and misses Ramazon 2027 by one day (it computes
 * 10 March against the announced 9 March) — which is the error to expect, and why a computed date
 * is never presented as a fact.
 *
 * Sources for the announced entries: kun.uz, «Официально: Рамазан хайит будет отмечаться 20 марта»
 * (2026-03-18); gazeta.uz, «Какие дни будут выходными в Узбекистане в 2026 году» (2025-12-25).
 */
const ANNOUNCED_UZ: Record<string, string> = {
  // <year>-<eid>: the announced Gregorian date.
  '2026-fitr': '2026-03-20',
  '2026-adha': '2026-05-27',
  '2027-fitr': '2027-03-09'
};

const MOVABLE_UZ = {
  fitr: { month: 10, day: 1, localName: 'Ramazon hayit', name: 'Eid al-Fitr' },
  adha: { month: 12, day: 10, localName: 'Qurbon hayit', name: 'Eid al-Adha' }
} as const;

/** Tabular (Kuwaiti) Islamic calendar → Julian day number. */
function hijriToJdn(year: number, month: number, day: number): number {
  return Math.floor((11 * year + 3) / 30) + 354 * year + 30 * month - Math.floor((month - 1) / 2) + day + 1948440 - 385;
}

function jdnToIsoDate(jdn: number): string {
  return new Date((jdn - 2440588) * 86_400_000).toISOString().slice(0, 10);
}

/** The two movable holidays that fall inside the given Gregorian year, announced or computed. */
function movableList(country: string, year: number): Array<{ date: string; localName: string; name: string; approximate?: boolean }> {
  if (country !== 'UZ') return [];
  const out: Array<{ date: string; localName: string; name: string; approximate?: boolean }> = [];
  for (const [id, holiday] of Object.entries(MOVABLE_UZ)) {
    const announced = ANNOUNCED_UZ[`${year}-${id}`];
    if (announced) {
      out.push({ date: announced, localName: holiday.localName, name: holiday.name });
      continue;
    }
    // A Gregorian year overlaps two Hijri years; take whichever occurrence lands inside it.
    for (const hijriYear of hijriYearsFor(year)) {
      const date = jdnToIsoDate(hijriToJdn(hijriYear, holiday.month, holiday.day));
      if (date.startsWith(String(year))) {
        out.push({ date, localName: holiday.localName, name: holiday.name, approximate: true });
      }
    }
  }
  return out;
}

/** The Hijri years that can overlap a Gregorian one, from the ~33-year ratio between them. */
function hijriYearsFor(gregorianYear: number): number[] {
  const base = Math.floor((gregorianYear - 622) * (33 / 32));
  return [base - 1, base, base + 1];
}

function staticList(country: string, year: number): string {
  const entries = STATIC_HOLIDAYS[country] ?? [];
  return JSON.stringify([
    ...entries.map((entry) => ({ date: `${year}-${entry.md}`, localName: entry.localName, name: entry.name, global: true })),
    ...movableList(country, year).map((entry) => ({ ...entry, global: true }))
  ]);
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

  const text = upstream.text;
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
