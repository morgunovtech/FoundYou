/** Label of a box produced by the MediaPipe FaceDetector (BlazeFace short-range); already padded for blurring. */
export const FACE_LABEL = 'face';
/** COCO class name of a whole person, from the MediaPipe ObjectDetector (EfficientDet-Lite0). */
export const PERSON_LABEL = 'person';

export interface BoundingBox {
  /** Original-image pixel coordinates (not the downscaled analysis frame). */
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  /** `'face'`, `'person'` or another COCO class name (`'car'`, `'cell phone'`, …). */
  label: string;
}

export interface DetectionSummary {
  people: number;
  vehicles: number;
  animals: number;
  description: string;
}

/** Pipeline step ids reported by useImageAnalysis; the UI maps them to `detectionStage*` i18n keys. */
export type DetectionStage = 'prep' | 'model' | 'decode' | 'detect' | 'process' | 'done';

export interface DetectionStatus {
  stage: DetectionStage;
  /** 0..1 */
  progress: number;
}

/**
 * Error codes returned by useImageAnalysis (the component translates them):
 * - `detection-unavailable` — the MediaPipe runtime or a model file could not be loaded (offline / asset 404); nothing was checked.
 * - `detection-failed`      — the models loaded but analysing this particular image failed.
 * - `content-unavailable`   — the device has no WebAssembly; analysis is skipped entirely (no WebGL is fine: the CPU delegate is used).
 */
export type DetectionErrorCode = 'detection-unavailable' | 'detection-failed' | 'content-unavailable';
