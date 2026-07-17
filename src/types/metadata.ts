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
}

export interface StructuredMetadata {
  groups: MetadataGroups;
  shotDate?: string;
  /** Локальное время съёмки из EXIF без часового пояса (YYYY-MM-DDTHH:mm:ss) */
  shotDateLocal?: string;
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
  orientation?: 'portrait' | 'landscape' | 'square' | 'unknown';
}

export type ManualCoordinates = {
  lat: number;
  lon: number;
};
