/*
 * What this device can be asked to do with a picture.
 *
 * The numbers differ per platform because the constraint does. On Android and on the desktop the
 * limit is decode time and memory, and both are generous: measured in Chromium, a 200 MP JPEG
 * decodes in ~2 s and its 720 px thumbnail takes ~3 s. On an iPhone the constraint is Safari's
 * canvas: past roughly 16 MP a canvas stops being drawable, which is why the export is capped
 * separately and lower there. iPhones themselves shoot 12–48 MP, so a 60 MP ceiling covers every
 * photo the device can take, while the 50, 64 and 108 MP files come off Android phones and are
 * opened on them.
 */

/** iPhone / iPad, including an iPad that reports itself as a Mac. */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/** Upload ceiling in pixels: what the browser will still decode and thumbnail. */
export function maxUploadPixels(): number {
  return isAppleMobile() ? 60_000_000 : 120_000_000;
}

/** Export ceiling in pixels: what `toBlob` will still produce, which is the stricter limit. */
export function maxExportPixels(): number {
  return isAppleMobile() ? 16_000_000 : 40_000_000;
}

/** The same ceilings in megapixels, for the messages that quote them. */
export const megapixels = (pixels: number): number => Math.round(pixels / 1_000_000);
