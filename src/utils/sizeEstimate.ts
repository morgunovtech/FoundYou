/*
 * How big the exported file will be, without encoding the whole picture.
 *
 * The preview is rendered at `PREVIEW_MAX_DIMENSION`, so for a 12 MP photo it is a 2.8× smaller
 * picture than the export — and JPEG bytes do not scale with area. Downscaling concentrates
 * detail, so the preview spends more bytes per pixel than the export will, and multiplying the
 * preview's size by the area ratio overshoots: measured on one photo at +11 % for a 1.6× preview,
 * +22 % at 2.1× and +30 % at 3.2×, which is how «medium quality» came out larger than the
 * original file.
 *
 * So the bytes per pixel are measured where they will apply — on windows of the picture rendered
 * at the export scale — and only then multiplied by the export's pixel count. Measured against a
 * full encode: −2 % on a landscape, −9 % on a group photo, +17 % on a screenshot (flat areas make
 * any sampling optimistic). When the preview already is the export size, nothing is estimated:
 * its own byte count is the answer.
 */

export interface SampleWindow {
  sx: number;
  sy: number;
}

/**
 * A `grid`×`grid` spread of sample windows over a picture, clamped to its edges. One centre
 * window is not enough: on a frame whose middle is smoother than its edges it misses by ~10 %.
 */
export function sampleWindows(width: number, height: number, side: number, grid = 2): SampleWindow[] {
  const windows: SampleWindow[] = [];
  const maxX = Math.max(0, width - side);
  const maxY = Math.max(0, height - side);
  for (let row = 0; row < grid; row++) {
    for (let column = 0; column < grid; column++) {
      windows.push({
        sx: Math.round((maxX * (column + 0.5)) / grid),
        sy: Math.round((maxY * (row + 0.5)) / grid)
      });
    }
  }
  return windows;
}

/** Bytes of the whole export, from the bytes of the sampled windows and their pixel count. */
export function extrapolateSize(sampledBytes: number, sampledPixels: number, exportPixels: number): number {
  if (sampledPixels <= 0) return 0;
  return Math.round((sampledBytes / sampledPixels) * exportPixels);
}
