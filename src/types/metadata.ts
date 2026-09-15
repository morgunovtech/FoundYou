export interface BasicFileInfo {
  file: File;
  dataUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  aspectRatio: number;
  sizeBytes: number;
  mimeType: string;
  originalFile?: File;
  originalMimeType?: string;
  originalSizeBytes?: number;
  originalName?: string;
  originalWidth?: number;
  originalHeight?: number;
  wasConverted?: boolean;
  processedSizeBytes?: number;
}

export interface MetadataGroups {
  exif: Record<string, unknown>;
  xmp: Record<string, unknown>;
  iptc: Record<string, unknown>;
  icc: Record<string, unknown>;
  /**
   * PNG-only: IHDR header fields plus every text chunk (tEXt / zTXt / iTXt), e.g. the
   * Stable Diffusion `parameters` prompt or ComfyUI `workflow`. Absent for non-PNG sources.
   */
  png?: Record<string, unknown>;
}

export interface StructuredMetadata {
  groups: MetadataGroups;
  /**
   * ISO-8601 instant (UTC). Kept for compatibility (weather lookups, hashing).
   * When `utcOffset` is null the camera wall-clock was taken AS IF it were UTC, because the
   * true instant is unknown — never show this value to the user, show `shotDateLocal`.
   */
  shotDate?: string;
  /** Wall-clock exactly as the camera wrote it, normalised to `YYYY-MM-DDTHH:mm:ss` (no zone). */
  shotDateLocal?: string;
  /** `+05:00` form when EXIF carried OffsetTimeOriginal/OffsetTime; null when the offset is unknown. */
  utcOffset?: string | null;
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  software?: string;
  exposureTime?: string;
  aperture?: number;
  iso?: number;
  focalLength?: number;
  focalLength35mm?: number;
  gps?: {
    lat: number;
    lon: number;
    altitude?: number;
    accuracy?: number;
    heading?: number;
  };
  completeness: number;
  orientation?: 'portrait' | 'landscape' | 'square' | 'unknown';
}

export type ManualCoordinates = {
  lat: number;
  lon: number;
};
