import type { CfRequestInit } from './_types';

export const UPSTREAM_TIMEOUT_MS = 10_000;

export interface Coordinates {
  lat: number;
  lon: number;
}

export function parseCoordinates(url: URL): Coordinates | null {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// Браузер не отправляет Origin на same-origin GET; если заголовок есть и хост
// чужой — это кросс-доменное использование функций как открытого прокси.
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function jsonResponse(
  payload: { ok: boolean; data?: unknown; error?: string },
  options?: { cacheSeconds?: number }
): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (payload.ok && options?.cacheSeconds) {
    headers['Cache-Control'] = `public, max-age=300, s-maxage=${options.cacheSeconds}`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(payload), { headers });
}

export function forbiddenResponse(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function fetchUpstream(url: string, init?: CfRequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  } as CfRequestInit & { signal: AbortSignal });
}

// Ошибки апстрима не должны утекать клиенту с внутренними деталями.
export function upstreamErrorResponse(error: unknown): Response {
  const timedOut = error instanceof Error && error.name === 'TimeoutError';
  return jsonResponse({ ok: false, error: timedOut ? 'upstream-timeout' : 'upstream-failure' });
}

export interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

// GET вместо POST: Cloudflare не кэширует POST, и cf.cacheTtl был бесполезен —
// каждый пользователь бил в бесплатный Overpass напрямую.
export async function queryOverpass(query: string, cacheTtl: number): Promise<OverpassElement[]> {
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  const response = await fetchUpstream(url, {
    cf: { cacheTtl, cacheEverything: true }
  });
  if (!response.ok) {
    throw new Error(`upstream-${response.status}`);
  }
  const result = (await response.json()) as { elements?: OverpassElement[] };
  return result.elements ?? [];
}

export function overpassPosition(element: OverpassElement): Coordinates | null {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { lat: element.lat, lon: element.lon };
  }
  if (element.center && typeof element.center.lat === 'number' && typeof element.center.lon === 'number') {
    return { lat: element.center.lat, lon: element.center.lon };
  }
  return null;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
