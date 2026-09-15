import { DAY, cacheKey, coordKey, defineHandler, fetchUpstream, json, parseCoord, round4, withCache } from './_geo';

const TTL = DAY;
const ARCHIVE_START_UTC = Date.UTC(1940, 0, 1);
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const HOURLY = 'temperature_2m,precipitation,cloudcover,wind_speed_10m,pressure_msl';

interface Target {
  date: string; // YYYY-MM-DD
  hour: number; // 0–23
  mode: 'local' | 'utc';
}

export const onRequest = defineHandler(async ({ url, context }) => {
  const lat = parseCoord(url.searchParams.get('lat'), 90);
  const lon = parseCoord(url.searchParams.get('lon'), 180);
  if (lat === null || lon === null) {
    return json({ ok: false, error: 'invalid-coordinates' }, 400);
  }

  const target = resolveTarget(url.searchParams.get('local'), url.searchParams.get('timestamp'));
  if (typeof target === 'string') {
    return json({ ok: false, error: target }, 400);
  }

  const rlat = round4(lat);
  const rlon = round4(lon);
  const [lat4, lon4] = coordKey(rlat, rlon);
  const hh = pad(target.hour);
  const key = cacheKey('historical-weather', lat4, lon4, target.date, hh, target.mode);

  return withCache(context, key, TTL, async () => {
    const apiUrl =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat4}&longitude=${lon4}` +
      `&start_date=${target.date}&end_date=${target.date}` +
      `&hourly=${HOURLY}&timezone=${target.mode === 'local' ? 'auto' : 'UTC'}`;
    const upstream = await fetchUpstream(apiUrl);
    if (!upstream.ok) return upstream.error;

    let payload: any;
    try {
      payload = await upstream.response.json();
    } catch {
      return json({ ok: false, error: 'upstream-invalid' }, 502);
    }

    const times: string[] = Array.isArray(payload?.hourly?.time) ? payload.hourly.time : [];
    const index = times.indexOf(`${target.date}T${hh}:00`);
    if (index === -1) {
      return json({ ok: false, error: 'no-hourly-data' }, 404);
    }

    const hourly = payload.hourly;
    const pick = (series: unknown): number | null => {
      const value = Array.isArray(series) ? series[index] : null;
      return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
    };

    return json(
      {
        ok: true,
        data: {
          temperature: pick(hourly.temperature_2m),
          precipitation: pick(hourly.precipitation),
          cloudCover: pick(hourly.cloudcover),
          windSpeed: pick(hourly.wind_speed_10m),
          pressure: pick(hourly.pressure_msl),
          timezone: typeof payload.timezone === 'string' ? payload.timezone : undefined
        }
      },
      200,
      undefined,
      TTL
    );
  });
});

/**
 * `local` (EXIF wall-clock, no zone) wins over `timestamp` (UTC instant).
 * Returns the error code to answer with 400 when the input is unusable.
 */
function resolveTarget(local: string | null, timestamp: string | null): Target | 'invalid-timestamp' | 'invalid-parameters' {
  if (local) {
    const match = LOCAL_RE.exec(local.trim());
    if (!match) return 'invalid-timestamp';
    const [year, month, day, hour, minute, second] = match.slice(1).map((part) => (part == null ? 0 : Number(part)));
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
      return 'invalid-timestamp';
    }
    const dayUtc = Date.UTC(year, month - 1, day);
    const check = new Date(dayUtc);
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return 'invalid-timestamp';
    if (!withinArchive(dayUtc)) return 'invalid-timestamp';
    return { date: `${pad(year, 4)}-${pad(month)}-${pad(day)}`, hour, mode: 'local' };
  }

  if (!timestamp) return 'invalid-parameters';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return 'invalid-timestamp';
  const dayUtc = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  if (!withinArchive(dayUtc)) return 'invalid-timestamp';
  return { date: parsed.toISOString().slice(0, 10), hour: parsed.getUTCHours(), mode: 'utc' };
}

/** Open-Meteo's archive starts 1940-01-01; anything past tomorrow (UTC) is a bogus EXIF date. */
function withinArchive(dayUtc: number): boolean {
  const now = new Date();
  const maxUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return dayUtc >= ARCHIVE_START_UTC && dayUtc <= maxUtc;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}
