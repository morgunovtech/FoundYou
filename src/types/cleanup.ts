export interface ManualMaskPoint {
  x: number;
  y: number;
}

export interface ManualMask {
  id: string;
  points: ManualMaskPoint[];
  radius: number;
}

export interface AntiSearchParams {
  crop: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  rotation: number;
  noiseSeed: number;
  noiseAmplitude: number;
  brightnessShift: number;
  contrastShift: number;
  saturationShift: number;
  hueShift: number;
  warpStrength: number;
}

export type QualityMode = 'low' | 'medium' | 'original';

export interface CleanupPreviewDimensions {
  width: number;
  height: number;
}

export type OutputFormat = 'original' | 'jpeg' | 'png' | 'webp';

/** Result of re-parsing the exported blob with exifr after download. */
export interface VerifyResult {
  /** Metadata fields found in the uploaded file (EXIF + XMP + IPTC + ICC). */
  before: number;
  /** Fields still present in the exported file; null when the format could not be parsed (e.g. WebP). */
  after: number | null;
  /**
   * Hamming distance (0–64) between the perceptual hashes of the original and the export;
   * null when either could not be computed. Reverse-image search stops matching past ~10.
   */
  phashDistance?: number | null;
  /** Bytes after the end of the image in the original (Samsung trailer, Motion Photo); the export has none. */
  trailingBytesBefore?: number;
}
