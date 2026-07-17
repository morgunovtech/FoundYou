import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { BasicFileInfo } from '../types/metadata';
import { decodeHeicToJpegForPreview } from '../utils/heic';

const MAX_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_PIXEL_COUNT = 40_000_000; // guard overly large resolution that may crash canvases
const NATIVE_SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp'];
const HEIC_TYPES = ['image/heic', 'image/heif'];
const SUPPORTED_TYPES = [...NATIVE_SUPPORTED_TYPES, ...HEIC_TYPES];

function inferMimeFromName(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return null;
}

async function sniffHeic(file: File): Promise<boolean> {
  try {
    const buffer = await file.slice(0, 24).arrayBuffer();
    const signature = new TextDecoder().decode(new Uint8Array(buffer));
    return /ftypheic|ftypheix|ftyphevc|ftypmif1|ftypmsf1/i.test(signature);
  } catch (error) {
    console.warn('heic-sniff-failed', error);
    return false;
  }
}

async function makeThumbnail(
  dataUrl: string,
  maxSize = 720
): Promise<{ url: string; width: number; height: number }> {
  const image = new Image();
  image.decoding = 'async';
  image.src = dataUrl;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('image-load'));
  });
  const canvas = document.createElement('canvas');
  const longestSide = Math.max(image.width, image.height);
  const scale = Math.min(1, maxSize / longestSide);
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas');
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.92);
  return { url, width: image.width, height: image.height };
}

export function useImageFile() {
  const t = useT();
  const [fileInfo, setFileInfo] = useState<BasicFileInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  // Счётчик поколений: при быстрой повторной загрузке результат устаревшей
  // обработки игнорируется, а её objectURL освобождается.
  const generationRef = useRef(0);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => revokeObjectUrl, [revokeObjectUrl]);

  const processFile = useCallback(
    async (file: File) => {
      const generation = ++generationRef.current;
      const isCurrent = () => generation === generationRef.current;
      setLoading(true);
      setError(null);
      if (import.meta.env.DEV) {
        console.info('[pipeline] upload:start', { name: file.name, type: file.type, size: file.size });
      }
      let inferredType = file.type || inferMimeFromName(file.name) || '';
      let objectUrl: string | null = null;
      try {
        if (!inferredType || !SUPPORTED_TYPES.includes(inferredType)) {
          if (await sniffHeic(file)) {
            inferredType = 'image/heic';
          }
        }
        if (!isCurrent()) return;

        if (file.size > MAX_SIZE_BYTES) {
          setError(t('fileTooLarge', { limit: 20 }));
          setLoading(false);
          return;
        }
        if (!SUPPORTED_TYPES.includes(inferredType)) {
          setError(t('unsupportedFormat'));
          setLoading(false);
          return;
        }

        const needsHeicConversion = HEIC_TYPES.includes(inferredType);
        const sourceFile = file;
        const heicDecoded = needsHeicConversion ? await decodeHeicToJpegForPreview(file) : null;
        const workingFile = heicDecoded?.file ?? file;
        const mimeType = workingFile.type || inferredType || 'image/jpeg';
        objectUrl = URL.createObjectURL(workingFile);
        const { url: thumbnailUrl, width, height } = await makeThumbnail(objectUrl);
        if (!isCurrent()) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        const pixelCount = width * height;
        if (pixelCount > MAX_PIXEL_COUNT) {
          URL.revokeObjectURL(objectUrl);
          setError(t('fileTooLargeResolution'));
          setLoading(false);
          return;
        }
        // Успех: только теперь заменяем предыдущий objectURL — при отклонённой
        // загрузке текущее фото остаётся рабочим.
        revokeObjectUrl();
        objectUrlRef.current = objectUrl;
        const info: BasicFileInfo = {
          file: workingFile,
          dataUrl: objectUrl,
          thumbnailUrl,
          width,
          height,
          aspectRatio: width / height,
          sizeBytes: needsHeicConversion ? sourceFile.size : workingFile.size,
          mimeType,
          originalFile: needsHeicConversion ? sourceFile : undefined,
          originalMimeType: needsHeicConversion ? sourceFile.type : undefined,
          originalSizeBytes: needsHeicConversion ? sourceFile.size : undefined,
          originalName: needsHeicConversion ? sourceFile.name : undefined,
          originalWidth: heicDecoded?.width,
          originalHeight: heicDecoded?.height,
          processedSizeBytes: workingFile.size,
          wasConverted: needsHeicConversion
        };
        setFileInfo(info);
        if (import.meta.env.DEV) {
          console.info('[pipeline] upload:ready', {
            width,
            height,
            mime: workingFile.type,
            converted: needsHeicConversion
          });
        }
      } catch (err) {
        console.error('file-processing', err);
        if (objectUrl && objectUrlRef.current !== objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        if (!isCurrent()) return;
        if (HEIC_TYPES.includes(inferredType)) {
          setError(t('heicConversionFailed'));
        } else if (inferredType === 'image/avif') {
          setError(t('browserFormatUnsupported'));
        } else {
          setError(t('corruptedFile'));
        }
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    },
    [revokeObjectUrl, t]
  );

  return {
    fileInfo,
    error,
    loading,
    processFile
  };
}
