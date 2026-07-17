import { useEffect, useRef, useState } from 'react';
import type { MessageKey } from '../i18n';
import type { BoundingBox, DetectionSummary } from '../types/detection';
import type { BasicFileInfo } from '../types/metadata';

async function loadModel() {
  const resolved = await Promise.all([
    import('@tensorflow-models/coco-ssd'),
    import('@tensorflow/tfjs')
  ]).catch((error) => {
    console.warn('analysis-model-load', error);
    return null;
  });

  if (!resolved) return null;

  const [{ load }, tf] = resolved;
  if (typeof window !== 'undefined') {
    await tf.setBackend('webgl').catch(() => tf.setBackend('cpu'));
    await tf.ready();
  }
  return load({ base: 'lite_mobilenet_v2' });
}

export function useImageAnalysis(fileInfo: BasicFileInfo | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ключ перевода вместо готовой строки: локализация происходит при рендере,
  // поэтому смена языка не перезапускает детекцию.
  const [detectionStatus, setDetectionStatus] = useState<{ key: MessageKey; progress: number } | null>(null);
  const [detections, setDetections] = useState<BoundingBox[]>([]);
  const [summary, setSummary] = useState<DetectionSummary | null>(null);
  const modelRef = useRef<any | null>(null);
  const capabilityCheckedRef = useRef(false);

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
      return () => {
        cancelled = true;
      };
    }

    if (typeof window === 'undefined') {
      return () => {
        cancelled = true;
      };
    }

    const hasWebGL = (() => {
      if (!window.WebGLRenderingContext) return false;
      try {
        const canvas = document.createElement('canvas');
        return !!(
          canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
        );
      } catch (error) {
        console.warn('webgl-check', error);
        return false;
      }
    })();

    if (!hasWebGL && !('OffscreenCanvas' in window)) {
      if (!capabilityCheckedRef.current) {
        setError('contentUnavailable');
        capabilityCheckedRef.current = true;
      }
      reset();
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const detect = async () => {
      setLoading(true);
      setError(null);
      setDetectionStatus({ key: 'detectionStagePrep', progress: 0 });
      let decoded: DecodedSource | null = null;
      try {
        if (import.meta.env.DEV) {
          console.info('[pipeline] analyze:start');
        }
        if (!modelRef.current) {
          setDetectionStatus({ key: 'detectionStageModel', progress: 0.15 });
          modelRef.current = await loadModel();
          if (!modelRef.current && import.meta.env.DEV) {
            console.info('[pipeline] analyze:skip-detection (model unavailable)');
          }
        }
        setDetectionStatus({ key: 'detectionStageDecode', progress: 0.3 });
        decoded = await decodeForAnalysis(fileInfo);
        if (!decoded) {
          throw new Error('analysis-image');
        }
        if (import.meta.env.DEV) {
          console.info('[analysis] image ready', {
            width: decoded.source.width,
            height: decoded.source.height,
            original: { width: fileInfo.width, height: fileInfo.height }
          });
        }
        if (cancelled) return;
        const scaledForDetection = scaleImage(decoded.source, DETECTION_MAX_DIMENSION, {
          width: decoded.baseWidth,
          height: decoded.baseHeight
        });
        setDetectionStatus({ key: 'detectionStageDetect', progress: 0.55 });
        const predictions =
          modelRef.current?.detect && scaledForDetection.canvas.width > 1 && scaledForDetection.canvas.height > 1
            ? await modelRef.current.detect(scaledForDetection.canvas, undefined, 0.2)
            : [];
        if (cancelled) return;
        setDetectionStatus({ key: 'detectionStageProcess', progress: 0.8 });
        const boxes: BoundingBox[] = predictions.map((pred: any) => ({
          x: pred.bbox[0] * scaledForDetection.scaleX,
          y: pred.bbox[1] * scaledForDetection.scaleY,
          width: pred.bbox[2] * scaledForDetection.scaleX,
          height: pred.bbox[3] * scaledForDetection.scaleY,
          score: pred.score,
          label: pred.class
        }));
        const summaryValue = summarizeDetections(boxes);
        setDetections(boxes);
        setSummary(summaryValue);
        if (import.meta.env.DEV) {
          console.info('[pipeline] analyze:done', { objects: boxes.length });
        }
        capabilityCheckedRef.current = true;
        setDetectionStatus({ key: 'detectionStageDone', progress: 1 });
      } catch (err) {
        console.error('analysis', err);
        if (!cancelled) {
          setError('contentUnavailable');
          reset();
        }
      } finally {
        decoded?.cleanup?.();
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    detect();

    return () => {
      cancelled = true;
    };
  }, [fileInfo]);

  return {
    loading,
    error,
    detectionStatus,
    detections,
    summary
  };
}

type CanvasSource = CanvasImageSource & { width: number; height: number };
const DETECTION_MAX_DIMENSION = 1600;
const MAX_ANALYSIS_PIXELS = 14_000_000;
const DECODE_MAX_DIMENSION = DETECTION_MAX_DIMENSION;

type DecodedSource = {
  source: CanvasSource;
  baseWidth: number;
  baseHeight: number;
  cleanup?: () => void;
};

async function decodeForAnalysis(fileInfo: BasicFileInfo): Promise<DecodedSource | null> {
  // Детекции отдаются в координатах рабочего файла (fileInfo.width/height):
  // именно в этом пространстве живут превью и канвас очистки.
  const workingWidth = fileInfo.width;
  const workingHeight = fileInfo.height;
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
  maxDimension = 2000,
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
  let people = 0;
  let vehicles = 0;
  let animals = 0;
  const topLabels: string[] = [];

  detections.forEach((d) => {
    if (d.score < 0.5) return;
    if (d.label === 'person') people += 1;
    if (vehiclesSet.has(d.label)) vehicles += 1;
    if (animalsSet.has(d.label)) animals += 1;
    if (topLabels.length < 5 && !topLabels.includes(d.label)) {
      topLabels.push(d.label);
    }
  });

  const description = topLabels.length > 0 ? topLabels.join(', ') : '';

  return { people, vehicles, animals, description };
}
