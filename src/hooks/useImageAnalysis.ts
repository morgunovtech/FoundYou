import { useEffect, useState } from 'react';
import type { Detection, FaceDetector, ObjectDetector } from '@mediapipe/tasks-vision';
import {
  FACE_LABEL,
  PERSON_LABEL,
  type BoundingBox,
  type DetectionErrorCode,
  type DetectionStage,
  type DetectionStatus,
  type DetectionSummary
} from '../types/detection';
import type { BasicFileInfo } from '../types/metadata';
import { selectPlausibleFaces, FACE_MODEL_MIN_CONFIDENCE, PERSON_CONTEXT_SCORE, type Rect } from '../utils/facePlausibility';
import { rotateCanvas, unrotateBox, unrotatePoint, type Quarter } from '../utils/faceRotation';

/* ── self-hosted MediaPipe assets (see scripts/prepare-assets.mjs) ── */

/** Directory with `vision_wasm[_nosimd]_internal.{js,wasm}`; FilesetResolver picks the SIMD variant itself. */
const WASM_BASE_PATH = '/mediapipe/wasm';
/*
 * Two BlazeFace models, because each is blind to the other's case. Measured on a five-person
 * group photo and on a crop of one face from it: short range finds 2 of the 5 faces in the group
 * (the two nearest) and the close-up at 0.83; full range finds all 5 in the group (0.70–0.96)
 * and the close-up not at all. Short range is trained for a face that fills the frame, full range
 * for faces that are small in it, so both run and `pickDistinctFaces` merges the two lists.
 * Neither invented a face on the negatives (a car and rocks, an empty hillside, a screenshot).
 */
const FACE_MODEL_URL = '/mediapipe/models/blaze_face_short_range.tflite';
const FACE_FAR_MODEL_URL = '/mediapipe/models/blaze_face_full_range.tflite';
/** Lite2 instead of Lite0: better recall on small and partly hidden objects for a 12 MB model (see prepare-assets). */
const OBJECT_MODEL_URL = '/mediapipe/models/efficientdet_lite2.tflite';

/** EfficientDet-Lite2 works on 448×448 and BlazeFace short-range on 128×128, so anything above ~800 px is wasted decode work. */
const DETECTION_MAX_DIMENSION = 800;
const MAX_ANALYSIS_PIXELS = 14_000_000;
const DECODE_MAX_DIMENSION = DETECTION_MAX_DIMENSION;

const OBJECT_SCORE_THRESHOLD = 0.4;
const OBJECT_MAX_RESULTS = 20;
/** Kept next to the gate's own floor so the two cannot drift apart; see facePlausibility.ts. */
const FACE_MIN_CONFIDENCE = FACE_MODEL_MIN_CONFIDENCE;
/** Grow each BlazeFace box by this fraction of its size on every side so hair, ears and chin end up under the blur. */
const FACE_PADDING_RATIO = 0.15;

type MediaPipe = typeof import('@mediapipe/tasks-vision');
type WasmFileset = Awaited<ReturnType<MediaPipe['FilesetResolver']['forVisionTasks']>>;
type Delegate = 'GPU' | 'CPU';

interface Detectors {
  objects: ObjectDetector;
  faces: FaceDetector;
  /** The full-range pass; see FACE_FAR_MODEL_URL. */
  farFaces: FaceDetector;
  delegate: Delegate;
}

interface DetectionResults {
  objects: Detection[];
  faces: Detection[];
  delegate: Delegate;
}

class ModelUnavailableError extends Error {}

/* ── module-level singletons ───────────────────────────────── */

let detectorsPromise: Promise<Detectors> | null = null;
let detectQueue: Promise<unknown> = Promise.resolve();

const noop = () => undefined;

/**
 * Loads the MediaPipe bundle, resolves the self-hosted WASM fileset and creates both detectors
 * once per page. The CPU delegate goes first: EfficientDet-Lite2 + BlazeFace answer in roughly
 * 50–100 ms on WASM SIMD, while the GPU delegate spends about five seconds compiling shaders
 * before its first inference — a bad trade for a session of one or two photos. GPU (WebGL2)
 * is kept as the fallback should the CPU build refuse to load. A failed load resets the
 * singleton so the next file retries (e.g. the network came back).
 */
function getDetectors(): Promise<Detectors> {
  if (detectorsPromise) return detectorsPromise;

  const loading = (async () => {
    const mp = await import('@mediapipe/tasks-vision');
    const fileset = await mp.FilesetResolver.forVisionTasks(WASM_BASE_PATH);
    try {
      return await createDetectors(mp, fileset, 'CPU');
    } catch (err) {
      console.warn('mediapipe-cpu-delegate', err);
    }
    if (hasWebGL2()) {
      return createDetectors(mp, fileset, 'GPU');
    }
    throw new Error('mediapipe-delegates-unavailable');
  })().catch((err: unknown) => {
    detectorsPromise = null;
    console.warn('analysis-model-load', err);
    throw new ModelUnavailableError(err instanceof Error ? err.message : String(err));
  });

  detectorsPromise = loading;
  return loading;
}

async function createDetectors(mp: MediaPipe, fileset: WasmFileset, delegate: Delegate): Promise<Detectors> {
  const results = await Promise.allSettled([
    mp.ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: OBJECT_MODEL_URL, delegate },
      runningMode: 'IMAGE',
      scoreThreshold: OBJECT_SCORE_THRESHOLD,
      maxResults: OBJECT_MAX_RESULTS
    }),
    mp.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
      runningMode: 'IMAGE',
      minDetectionConfidence: FACE_MIN_CONFIDENCE
    }),
    mp.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_FAR_MODEL_URL, delegate },
      runningMode: 'IMAGE',
      minDetectionConfidence: FACE_MIN_CONFIDENCE
    })
  ]);
  const [objects, faces, farFaces] = results;
  if (objects.status === 'fulfilled' && faces.status === 'fulfilled' && farFaces.status === 'fulfilled') {
    return { objects: objects.value, faces: faces.value, farFaces: farFaces.value, delegate };
  }
  // Do not leak a WASM instance when only one of the two models failed.
  for (const result of results) {
    if (result.status === 'fulfilled') result.value.close();
  }
  const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  throw failed.reason;
}

/** Closes the current detectors and recreates them on the CPU delegate (used when GPU inference itself throws). */
function recreateOnCpu(current: Detectors): Promise<Detectors> {
  try {
    current.objects.close();
    current.faces.close();
    current.farFaces.close();
  } catch (err) {
    console.warn('mediapipe-close', err);
  }
  const loading = (async () => {
    const mp = await import('@mediapipe/tasks-vision');
    const fileset = await mp.FilesetResolver.forVisionTasks(WASM_BASE_PATH);
    return createDetectors(mp, fileset, 'CPU');
  })().catch((err: unknown) => {
    detectorsPromise = null;
    throw err;
  });
  detectorsPromise = loading;
  return loading;
}

/** Runs both models on the same frame; MediaPipe's IMAGE-mode `detect()` is synchronous. */
function detectWith(detectors: Detectors, image: HTMLCanvasElement): DetectionResults {
  return {
    objects: detectors.objects.detect(image).detections,
    faces: [...detectors.faces.detect(image).detections, ...detectors.farFaces.detect(image).detections],
    delegate: detectors.delegate
  };
}

async function runDetection(image: HTMLCanvasElement): Promise<DetectionResults> {
  const detectors = await getDetectors();
  try {
    return detectWith(detectors, image);
  } catch (err) {
    if (detectors.delegate !== 'GPU') throw err;
    // A WebGL2 context that exists but cannot run the graph (blocklisted driver, lost context):
    // retry once on the CPU delegate before giving up on this image.
    console.warn('mediapipe-gpu-detect', err);
    return detectWith(await recreateOnCpu(detectors), image);
  }
}

/** Both face models on one frame, with the same GPU→CPU retry as the full pass. */
async function runFaceDetection(image: HTMLCanvasElement): Promise<Detection[]> {
  const detectors = await getDetectors();
  const faces = (d: Detectors) => [...d.faces.detect(image).detections, ...d.farFaces.detect(image).detections];
  try {
    return faces(detectors);
  } catch (err) {
    if (detectors.delegate !== 'GPU') throw err;
    console.warn('mediapipe-gpu-detect-rotated', err);
    return faces(await recreateOnCpu(detectors));
  }
}

/**
 * The second look: the same frame turned 90° each way, with every box and keypoint mapped back
 * into upright-canvas coordinates so the caller can merge the three lists as one.
 *
 * A failure here is never fatal — the upright result stands on its own — so a pass that throws is
 * logged and dropped.
 */
async function detectRotatedFaces(image: HTMLCanvasElement): Promise<Detection[]> {
  const out: Detection[] = [];
  const upright = { width: image.width, height: image.height };
  for (const quarter of ['cw', 'ccw'] as Quarter[]) {
    const rotated = rotateCanvas(image, quarter);
    if (!rotated) continue;
    let found: Detection[];
    try {
      found = await runFaceDetection(rotated);
    } catch (err) {
      console.warn('rotated-face-pass', err);
      continue;
    }
    for (const det of found) {
      const bb = det.boundingBox;
      if (!bb) continue;
      const box = unrotateBox({ x: bb.originX, y: bb.originY, width: bb.width, height: bb.height }, quarter, upright);
      out.push({
        categories: det.categories,
        boundingBox: { originX: box.x, originY: box.y, width: box.width, height: box.height, angle: 0 },
        keypoints: (det.keypoints ?? []).map((kp) => {
          const point = unrotatePoint({ x: kp.x, y: kp.y }, quarter);
          return { ...kp, x: point.x, y: point.y };
        })
      });
    }
  }
  return out;
}

/** Serialises `detect()` calls: a new file waits for the previous inference to finish. */
function enqueueDetection<T>(job: () => Promise<T>): Promise<T> {
  const run = detectQueue.then(job, job);
  detectQueue = run.then(noop, noop);
  return run;
}

/** Cheap probe for the GPU delegate; the context is released again right away. */
function hasWebGL2(): boolean {
  if (typeof WebGL2RenderingContext === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch (error) {
    console.warn('webgl2-check', error);
    return false;
  }
}

/* ── hook ──────────────────────────────────────────────────── */

export function useImageAnalysis(fileInfo: BasicFileInfo | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DetectionErrorCode | null>(null);
  const [modelUnavailable, setModelUnavailable] = useState(false);
  const [detectionStatus, setDetectionStatus] = useState<DetectionStatus | null>(null);
  const [detections, setDetections] = useState<BoundingBox[]>([]);
  const [summary, setSummary] = useState<DetectionSummary | null>(null);
  /** The file whose analysis has finished (success or failure) — lets consumers sequence work after detection. */
  const [settledFile, setSettledFile] = useState<BasicFileInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    const reset = () => {
      setDetections([]);
      setSummary(null);
      setDetectionStatus(null);
    };

    if (!fileInfo) {
      reset();
      setError(null);
      setLoading(false);
      setSettledFile(null);
      return () => {
        cancelled = true;
      };
    }

    if (typeof window === 'undefined') {
      return () => {
        cancelled = true;
      };
    }

    setSettledFile(null);

    // No WebGL is fine (CPU delegate); only a missing WebAssembly runtime rules analysis out.
    if (typeof WebAssembly === 'undefined') {
      reset();
      setError('content-unavailable');
      setModelUnavailable(true);
      setLoading(false);
      setSettledFile(fileInfo);
      return () => {
        cancelled = true;
      };
    }

    const setStage = (stage: DetectionStage, progress: number) => {
      if (!cancelled) setDetectionStatus({ stage, progress });
    };

    const detect = async () => {
      // The previous file's boxes must not be drawn over (or blurred on) this one while it is analysed.
      reset();
      setLoading(true);
      setError(null);
      setStage('prep', 0);
      let decoded: DecodedSource | null = null;
      // Decode in parallel with the (first-time) runtime + model download.
      const decodePromise = decodeForAnalysis(fileInfo).catch((err) => {
        console.warn('analysis-decode', err);
        return null;
      });
      try {
        if (import.meta.env.DEV) {
          console.info('[pipeline] analyze:start');
        }
        setStage('model', 0.15);
        const modelStart = performance.now();
        const detectors = await getDetectors();
        if (cancelled) return;
        setModelUnavailable(false);
        if (import.meta.env.DEV) {
          console.info('[analysis] models ready', {
            ms: Math.round(performance.now() - modelStart),
            delegate: detectors.delegate
          });
        }

        setStage('decode', 0.3);
        decoded = await decodePromise;
        if (!decoded) {
          throw new Error('analysis-image');
        }
        if (cancelled) return;
        if (import.meta.env.DEV) {
          console.info('[analysis] image ready', {
            width: decoded.source.width,
            height: decoded.source.height,
            original: { width: fileInfo.width, height: fileInfo.height }
          });
        }
        const scaledForDetection = scaleImage(decoded.source, DETECTION_MAX_DIMENSION, {
          width: decoded.baseWidth,
          height: decoded.baseHeight
        });

        setStage('detect', 0.55);
        const detectStart = performance.now();
        const results: DetectionResults =
          scaledForDetection.canvas.width > 1 && scaledForDetection.canvas.height > 1
            ? await enqueueDetection(() => runDetection(scaledForDetection.canvas))
            : { objects: [], faces: [], delegate: detectors.delegate };
        if (cancelled) return;
        if (import.meta.env.DEV) {
          console.info('[analysis] detect', {
            ms: Math.round(performance.now() - detectStart),
            delegate: results.delegate,
            objects: results.objects.length,
            faces: results.faces.length
          });
        }

        setStage('process', 0.8);
        const persons = collectPersons(results.objects);
        let faces = plausibleFaces(results.faces, persons, scaledForDetection.canvas);
        /*
         * Then the same frame turned 90° each way, always. The first shape of this gated the extra
         * passes on «more people than faces», and it never fired on the case it was written for:
         * measured on a five-person group photo turned on its side, EfficientDet loses the people
         * along with BlazeFace (5 persons → 2), so the two counts stay equal while three faces go
         * unfound. The measurements that replaced the gate, all on the CPU delegate at 800 px:
         *   · group photo upright   — 5 faces before, 5 after, +116 ms (nothing invented)
         *   · the same turned 90°   — 2 faces before, 4 after, +135 ms
         *   · tight portrait, both orientations — 1 before, 1 after, +65 ms
         *   · two screenshots       — 0 raw detections from the rotated passes at all, +73–85 ms
         * So the cost is 65–135 ms against a ~900 ms detect, no negative gained a face, and the
         * sideways group photo doubled its recall. `pickDistinctFaces` inside `plausibleFaces`
         * merges the three lists, so a face seen twice is still one face.
         */
        const rotatedStart = performance.now();
        const rotated = await enqueueDetection(() => detectRotatedFaces(scaledForDetection.canvas));
        if (cancelled) return;
        const uprightFaces = faces.length;
        if (rotated.length > 0) {
          faces = plausibleFaces([...results.faces, ...rotated], persons, scaledForDetection.canvas);
        }
        if (import.meta.env.DEV) {
          console.info('[analysis] rotated face pass', {
            ms: Math.round(performance.now() - rotatedStart),
            persons: persons.length,
            raw: rotated.length,
            before: uprightFaces,
            after: faces.length
          });
        }
        const frame: Frame = {
          scaleX: scaledForDetection.scaleX,
          scaleY: scaledForDetection.scaleY,
          width: decoded.baseWidth,
          height: decoded.baseHeight
        };
        const boxes: BoundingBox[] = [
          ...toBoundingBoxes(results.objects, frame, {}),
          ...toBoundingBoxes(faces, frame, { label: FACE_LABEL, padRatio: FACE_PADDING_RATIO })
        ];
        setDetections(boxes);
        setSummary(summarizeDetections(boxes));
        if (import.meta.env.DEV) {
          console.info('[pipeline] analyze:done', {
            objects: results.objects.length,
            faces: faces.length,
            persons: persons.length
          });
        }
        setStage('done', 1);
      } catch (err) {
        if (cancelled) return;
        console.error('analysis', err);
        reset();
        if (err instanceof ModelUnavailableError) {
          // Do NOT present "no objects" as a result — nothing was checked.
          setModelUnavailable(true);
          setError('detection-unavailable');
        } else {
          setError('detection-failed');
        }
      } finally {
        if (decoded) {
          decoded.cleanup?.();
        } else {
          // Bailed out before awaiting the decode — release the bitmap when it lands.
          void decodePromise.then((d) => d?.cleanup?.());
        }
        if (!cancelled) {
          setLoading(false);
          setSettledFile(fileInfo);
        }
      }
    };

    void detect();

    return () => {
      cancelled = true;
    };
  }, [fileInfo]);

  return {
    loading,
    error,
    modelUnavailable,
    detectionStatus,
    detections,
    summary,
    settledFile
  };
}

/* ── result mapping ────────────────────────────────────────── */

/** The EfficientDet person boxes solid enough to vouch for a face found on top of them. */
function collectPersons(objects: Detection[]): Rect[] {
  const persons: Rect[] = [];
  for (const det of objects) {
    const bb = det.boundingBox;
    const top = det.categories[0];
    if (!bb || top?.categoryName !== PERSON_LABEL || (top.score ?? 0) < PERSON_CONTEXT_SCORE) continue;
    persons.push({ x: bb.originX, y: bb.originY, width: bb.width, height: bb.height });
  }
  return persons;
}

/**
 * Keeps only the BlazeFace detections that pass `isPlausibleFace`: keypoints that form a face,
 * plus either a sure score or an EfficientDet person box underneath (frame: the analysis canvas).
 */
function plausibleFaces(
  detected: Detection[],
  persons: Rect[],
  canvas: { width: number; height: number }
): Detection[] {
  const boxed = detected.filter((det) => det.boundingBox);
  /*
   * `selectPlausibleFaces` gates first and merges second, and admits a face a neighbour vouches
   * for. Doing it the other way round — merge, then gate — let a candidate about to be rejected
   * suppress an overlapping one that would have passed, and the gate alone lost every face the
   * object detector had no person box for. On a tight selfie of five that showed as two «ЛИЦО»
   * and two «ЧЕЛОВЕК» boxes over five people, on different people at that.
   */
  const candidates = boxed.map((det) => ({
    box: {
      x: det.boundingBox!.originX,
      y: det.boundingBox!.originY,
      width: det.boundingBox!.width,
      height: det.boundingBox!.height
    },
    score: det.categories[0]?.score ?? 0,
    keypoints: (det.keypoints ?? []).map((kp) => ({ x: kp.x * canvas.width, y: kp.y * canvas.height }))
  }));
  return selectPlausibleFaces(candidates, persons).map((index) => boxed[index]);
}

/** Maps the downscaled analysis canvas back onto the original image. */
interface Frame {
  scaleX: number;
  scaleY: number;
  /** Original image size — boxes are clamped to it. */
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Converts MediaPipe detections (pixels of the analysis canvas) into `BoundingBox`es in
 * original-image pixels. `label` overrides the model's category (BlazeFace has none);
 * `padRatio` grows the box on every side before scaling and clamping.
 */
function toBoundingBoxes(
  detections: Detection[],
  frame: Frame,
  options: { label?: string; padRatio?: number }
): BoundingBox[] {
  const boxes: BoundingBox[] = [];
  const padRatio = options.padRatio ?? 0;
  for (const det of detections) {
    const bb = det.boundingBox;
    if (!bb) continue;
    const top = det.categories[0];
    const label = options.label ?? top?.categoryName?.trim() ?? '';
    // EfficientDet's COCO label map has unnamed slots ("???"); skip anything without a real name.
    if (!label || label === '???') continue;
    const padX = bb.width * padRatio;
    const padY = bb.height * padRatio;
    const x0 = clamp((bb.originX - padX) * frame.scaleX, 0, frame.width);
    const y0 = clamp((bb.originY - padY) * frame.scaleY, 0, frame.height);
    const x1 = clamp((bb.originX + bb.width + padX) * frame.scaleX, 0, frame.width);
    const y1 = clamp((bb.originY + bb.height + padY) * frame.scaleY, 0, frame.height);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    boxes.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, score: top?.score ?? 0, label });
  }
  return boxes;
}

/* ── decode / scale helpers ────────────────────────────────── */

type CanvasSource = CanvasImageSource & { width: number; height: number };

type DecodedSource = {
  source: CanvasSource;
  baseWidth: number;
  baseHeight: number;
  cleanup?: () => void;
};

async function decodeForAnalysis(fileInfo: BasicFileInfo): Promise<DecodedSource | null> {
  const workingWidth = fileInfo.width;
  const workingHeight = fileInfo.height;
  // Boxes are reported in the working picture's pixels (`fileInfo.width` × `fileInfo.height`):
  // that is the space the preview overlays, the blur and the OCR/QR boxes all use. For a HEIC
  // converted to a smaller JPEG the original size differs, and mapping to it put the faces
  // off their spots.
  const baseWidth = workingWidth;
  const baseHeight = workingHeight;

  const longestSide = Math.max(workingWidth, workingHeight) || 1;
  const pixelScale = Math.sqrt(MAX_ANALYSIS_PIXELS / Math.max(1, workingWidth * workingHeight));
  const targetScale = Math.min(1, DECODE_MAX_DIMENSION / longestSide, pixelScale);
  const targetWidth = Math.max(1, Math.round(workingWidth * targetScale));
  const targetHeight = Math.max(1, Math.round(workingHeight * targetScale));

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(fileInfo.file, {
        resizeWidth: targetWidth,
        resizeHeight: targetHeight,
        resizeQuality: 'high'
      });
      const cleanup = () => {
        if (typeof (bitmap as ImageBitmap).close === 'function') {
          (bitmap as ImageBitmap).close();
        }
      };
      return {
        source: bitmap as CanvasSource,
        baseWidth,
        baseHeight,
        cleanup
      };
    } catch (error) {
      console.warn('bitmap-decode', error);
    }
  }

  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';
  image.src = fileInfo.dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('image-load'));
  });

  return {
    source: image as CanvasSource,
    baseWidth,
    baseHeight
  };
}

type ScaledCanvas = { canvas: HTMLCanvasElement; scaleX: number; scaleY: number };

function scaleImage(
  image: CanvasSource,
  maxDimension = DETECTION_MAX_DIMENSION,
  base?: { width: number; height: number }
): ScaledCanvas {
  try {
    const canvas = document.createElement('canvas');
    const maxSourceDimension = Math.max(image.width, image.height) || 1;
    const scale = Math.min(1, maxDimension / maxSourceDimension);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('canvas');
    }
    ctx.drawImage(image as CanvasImageSource, 0, 0, width, height);
    const scaleX = (base?.width ?? image.width) / width;
    const scaleY = (base?.height ?? image.height) / height;
    return { canvas, scaleX, scaleY };
  } catch (error) {
    console.warn('scale-image-fallback', error);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return { canvas, scaleX: 1, scaleY: 1 };
  }
}

function summarizeDetections(detections: BoundingBox[]): DetectionSummary {
  const vehiclesSet = new Set(['car', 'bus', 'truck', 'train', 'bicycle', 'motorcycle']);
  const animalsSet = new Set(['dog', 'cat', 'bird', 'horse', 'sheep', 'cow']);
  let persons = 0;
  let faces = 0;
  let vehicles = 0;
  let animals = 0;
  const topLabels: string[] = [];

  detections.forEach((d) => {
    if (d.score < 0.5) return;
    if (d.label === FACE_LABEL) {
      // Faces duplicate the person they belong to and are not scene objects.
      faces += 1;
      return;
    }
    if (d.label === PERSON_LABEL) persons += 1;
    if (vehiclesSet.has(d.label)) vehicles += 1;
    if (animalsSet.has(d.label)) animals += 1;
    if (topLabels.length < 5 && !topLabels.includes(d.label)) {
      topLabels.push(d.label);
    }
  });

  const description = topLabels.length > 0 ? topLabels.join(', ') : '';

  return { people: Math.max(persons, faces), vehicles, animals, description };
}
