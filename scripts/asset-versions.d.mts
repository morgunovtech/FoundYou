export interface AssetVersions {
  ocr: string;
  mediapipe: string;
  c2pa: string;
  zxing: string;
}

/** Installed versions of the packages behind the runtime assets, read from node_modules. */
export function readVersions(root: string): AssetVersions;
