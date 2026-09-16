import { phashFromImage } from '../phash';

export interface HashResult {
  sha256: string;
  /** Perceptual hash (64-bit, hex) of the decoded picture; null when the canvas could not draw it. */
  phash: string | null;
}

/**
 * SHA-256 of the file bytes (exact-copy matching) and the perceptual hash of the picture
 * (what reverse-image search matches on). `image` is the decoded original; without it only
 * the byte hash is computed.
 */
export async function generateFileHash(file: File, image?: CanvasImageSource | null): Promise<HashResult> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  let phash: string | null = null;
  if (image) {
    try {
      phash = phashFromImage(image);
    } catch {
      phash = null;
    }
  }
  return { sha256: hashHex, phash };
}
