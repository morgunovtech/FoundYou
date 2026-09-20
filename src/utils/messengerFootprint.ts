/**
 * Which service a picture was probably squeezed through, read from its size alone.
 *
 * `strippedDetector` had one rule for this: a JPEG whose longest side is 1600 px or less «looks
 * like social media re-compression». That is true and almost useless — it fires on every
 * downscaled photograph and names nobody. The services do not pick arbitrary sizes: each caps
 * the longest side at a fixed number, and a file sitting exactly on one of those numbers is a
 * far narrower statement than «somebody resized this».
 *
 * It is a hint and is shown as one. Two services share 1280, the caps change between app
 * versions, and a person can resize a picture to 1600 px by hand — so the card lists every
 * service the size fits, never one, and says what the match is worth. Sources for the caps as
 * of September 2026: Telegram compresses a photo to 1280 px on the longest side (2560 px for
 * larger uploads), WhatsApp to about 1600 px, Instagram to 1080 px wide.
 */

export interface MessengerMatch {
  /** Every service whose cap this size fits. Never one when several share the number. */
  platforms: string[];
  /** The cap that matched, in pixels of the longest side. */
  cap: number;
}

/**
 * Longest-side caps → the services known to use them.
 *
 * Only services that scale the longest side to a fixed number are listed. Instagram is not
 * here on purpose: its 1080 is a cap on the *width*, so a portrait post comes out 1080×1350
 * with a longest side of 1350, and folding that into the same table would make the check claim
 * things it cannot support. A rule with two different meanings of «cap» is worse than one
 * platform fewer.
 */
const CAPS: Array<{ cap: number; platforms: string[] }> = [
  { cap: 1280, platforms: ['Telegram', 'Viber'] },
  { cap: 1600, platforms: ['WhatsApp'] },
  { cap: 2560, platforms: ['Telegram'] },
  { cap: 4096, platforms: ['WhatsApp'] }
];

/**
 * How far from the cap still counts. A service scales the whole picture to fit, so the longest
 * side lands on the cap exactly; the short side is whatever the aspect ratio makes it. One pixel
 * of slack covers the rounding, and nothing wider is allowed — the point of the check is that a
 * size *on* the cap says something and a size *near* it does not.
 */
const TOLERANCE = 1;

/**
 * The services whose cap this picture's longest side sits on, or `null`. A picture smaller than
 * every cap never matches: it was resized to something else, or never resized at all.
 */
export function matchMessengerSize(width: number, height: number): MessengerMatch | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const longest = Math.max(width, height);
  const found = CAPS.filter((entry) => Math.abs(longest - entry.cap) <= TOLERANCE);
  if (found.length === 0) return null;
  const platforms = [...new Set(found.flatMap((entry) => entry.platforms))];
  return { platforms, cap: found[0].cap };
}
