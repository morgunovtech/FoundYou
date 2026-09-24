import { DAY, UPSTREAM_TIMEOUT_MS, USER_AGENT, cacheControl, cacheKey, defineHandler, json, withCache } from '../_geo';

/*
 * The map tiles, through this project's own origin.
 *
 * The map used to be the one thing on the page that talked to a third party directly: maplibre
 * fetched raster tiles from tile.openstreetmap.org, so OSM saw the reader's IP address and which
 * squares of the map they asked for — roughly the place the photograph was taken, learned by
 * someone who is not us. That was why the map sat behind a button (2026-09-20). Now the browser
 * asks this Function, and OSM sees Cloudflare's address and this project's User-Agent; what a tile
 * says about the reader (a z/x/y square, 1.2 km across at zoom 15) is no more than the rounded
 * coordinates every other endpoint already receives.
 *
 * Tiles are cached at the edge for a week under a synthetic key, like every other answer, and
 * reach the browser with `no-store` (`defineHandler`): a tile cache on the device would be a
 * history of places. OSM's tile usage policy asks for a valid identifying User-Agent and no bulk
 * downloading; a proxy for one small site that caches at the edge is within it. Only PNG tiles
 * of the standard layer, zoom 0–19, are served — the path is parsed, never forwarded.
 */

const TILE_TTL = 7 * DAY;
const MAX_ZOOM = 19;
const TILE_HOST = 'https://tile.openstreetmap.org';

export interface TileAddress {
  z: number;
  x: number;
  y: number;
}

/** `z/x/y.png` with every part an integer inside the zoom level's grid; anything else is refused. */
export function parseTilePath(path: string | string[] | undefined): TileAddress | null {
  const parts = Array.isArray(path) ? path : typeof path === 'string' ? path.split('/') : [];
  if (parts.length !== 3) return null;
  const [zs, xs, ys] = parts;
  if (!/^\d{1,2}$/.test(zs) || !/^\d{1,7}$/.test(xs) || !/^\d{1,7}\.png$/.test(ys)) return null;
  const z = Number(zs);
  const x = Number(xs);
  const y = Number(ys.slice(0, -4));
  if (z > MAX_ZOOM) return null;
  const side = 2 ** z;
  if (x >= side || y >= side) return null;
  return { z, x, y };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes);
  return view.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => view[index] === value);
}

export const onRequest = defineHandler(async ({ context }) => {
  const tile = parseTilePath(context.params.path);
  if (!tile) return json({ ok: false, error: 'invalid-tile' }, 400);

  return withCache(context, cacheKey('tile', tile.z, tile.x, tile.y), TILE_TTL, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await fetch(`${TILE_HOST}/${tile.z}/${tile.x}/${tile.y}.png`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/png' },
        signal: controller.signal
      });
      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => undefined);
        if (upstream.status === 404) return json({ ok: false, error: 'tile-not-found' }, 404);
        return json({ ok: false, error: `upstream-${upstream.status}` }, upstream.status === 429 ? 429 : 502);
      }
      // A real fetch body rejects with AbortError when the timer fires, so the read is under the deadline too.
      const bytes = await upstream.arrayBuffer();
      if (!isPng(bytes)) return json({ ok: false, error: 'upstream-invalid' }, 502);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'X-Content-Type-Options': 'nosniff',
          'X-Robots-Tag': 'noindex',
          'Cache-Control': cacheControl(true, TILE_TTL)
        }
      });
    } catch (error) {
      const aborted = controller.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError';
      return json({ ok: false, error: aborted ? 'upstream-timeout' : 'upstream-unavailable' }, aborted ? 504 : 502);
    } finally {
      clearTimeout(timer);
    }
  });
});
