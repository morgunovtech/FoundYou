import { useEffect, useState } from 'react';
import type { BasicFileInfo } from '../types/metadata';
import { measureFlatness } from '../utils/screenshot';

export interface FrameStats {
  /** Share of pixels equal to their right-hand neighbour (see `measureFlatness`). */
  flatRatio: number;
}

/** Enough to keep interface blocks flat and sensor noise visible; cheap to scan. */
const WORKING_SIZE = 1024;

/**
 * Pixel statistics of the decoded picture at a working size, computed once per file on the
 * main thread (a single drawImage + one pass over ≤ 1 MP). Null while decoding or when the
 * browser cannot decode the file.
 */
export function useFrameStats(fileInfo: BasicFileInfo | null): FrameStats | null {
  const file = fileInfo?.file ?? null;
  const [settled, setSettled] = useState<{ file: File; stats: FrameStats | null } | null>(null);

  useEffect(() => {
    if (!file) return undefined;
    let active = true;
    (async () => {
      let stats: FrameStats | null = null;
      try {
        const bitmap = await createImageBitmap(file);
        try {
          const scale = Math.min(1, WORKING_SIZE / Math.max(bitmap.width, bitmap.height));
          const width = Math.max(1, Math.round(bitmap.width * scale));
          const height = Math.max(1, Math.round(bitmap.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, width, height);
            const { data } = ctx.getImageData(0, 0, width, height);
            stats = { flatRatio: measureFlatness(data, width, height) };
          }
        } finally {
          bitmap.close();
        }
      } catch {
        stats = null;
      }
      if (active) setSettled({ file, stats });
    })();
    return () => {
      active = false;
    };
  }, [file]);

  return settled && settled.file === file ? settled.stats : null;
}
