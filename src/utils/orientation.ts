import type { StructuredMetadata } from '../types/metadata';

/*
 * Which way round the picture is — as the reader sees it.
 *
 * This used to take the EXIF `Orientation` tag as well and swap the sides for tags 5–8, which is
 * right only when the numbers handed in are the raw pixel dimensions. They are not: the only
 * caller passes `fileInfo.width` / `fileInfo.height`, which come from an `<img>` the browser has
 * already decoded, and every engine applies the tag while decoding (`image-orientation: from-image`
 * is the default for HTMLImageElement; measured in Chromium on a 990×747 JPEG with tag 6, which
 * reports 747×990 through both `naturalWidth` and `createImageBitmap`). The swap therefore ran a
 * second time and undid the browser's, so a portrait phone photo — 3024×4032 on screen, tag 6 —
 * was reported as «держал горизонтально», and `fieldOfView` in `stance.ts` measured it across the
 * long side and printed 74° instead of the narrower portrait figure.
 *
 * So the tag is not consulted at all. The dimensions after decoding are the orientation: they are
 * what the picture looks like, which is exactly what the card claims to describe. A HEIC goes
 * through the same door — it is re-encoded to a JPEG by canvas, which writes no tag, and its size
 * is likewise the decoded one.
 */
export function inferOrientation(
  /** Width after the browser applied any EXIF rotation — `fileInfo.width`, never `ExifImageWidth`. */
  width: number,
  /** Height after the browser applied any EXIF rotation — `fileInfo.height`. */
  height: number
): StructuredMetadata['orientation'] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'unknown';
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}
