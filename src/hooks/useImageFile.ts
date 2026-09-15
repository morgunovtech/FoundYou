import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { BasicFileInfo } from '../types/metadata';
import { decodeHeicToJpegForPreview } from '../utils/heic';

const MAX_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_PIXEL_COUNT = 40_000_000; // guard overly large resolution that may crash canvases
const NATIVE_SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp'];
const HEIC_TYPES = ['image/heic', 'image/heif'];
const SUPPORTED_TYPES = [...NATIVE_SUPPORTED_TYPES, ...HEIC_TYPES];
// ISO BMFF brands that hold HEIF/HEIC stills (heim/heis/hevm: multi-image & sequence variants).
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'mif1', 'msf1'];

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
    const bytes = new Uint8Array(buffer);
    // Check for 'ftyp' box marker at offset 4
    if (bytes.length < 12) return false;
    const ftyp = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    if (!ftyp) return false;
    // Read the brand as ASCII
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    return HEIC_BRANDS.includes(brand);
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
  // Monotonic counter: a slow earlier file must never overwrite a newer one.
  const generationRef = useRef(0);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => revokeObjectUrl, [revokeObjectUrl]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    setFileInfo(null);
    setError(null);
    setLoading(false);
    revokeObjectUrl();
  }, [revokeObjectUrl]);

  const processFile = useCallback(
    async (file: File) => {
      const generation = ++generationRef.current;
      const isCurrent = () => generationRef.current === generation;
      setLoading(true);
      setError(null);
      if (import.meta.env.DEV) {
        console.info('[pipeline] upload:start', { name: file.name, type: file.type, size: file.size });
      }
      let inferredType = file.type || inferMimeFromName(file.name) || '';
      // The new object URL lives here until the file is fully decoded and
      // validated; only then does it replace the previous one. Rejected or
      // superseded files revoke their own URL and leave the current file intact.
      let pendingObjectUrl: string | null = null;
      try {
        if (!inferredType || !SUPPORTED_TYPES.includes(inferredType)) {
          if (await sniffHeic(file)) {
            inferredType = 'image/heic';
          }
        }
        if (!isCurrent()) return;

        if (file.size > MAX_SIZE_BYTES) {
          setError(t('fileTooLarge', { limit: 20 }));
          return;
        }
        if (!SUPPORTED_TYPES.includes(inferredType)) {
          setError(t('unsupportedFormat'));
          return;
        }

        const needsHeicConversion = HEIC_TYPES.includes(inferredType);
        const sourceFile = file;
        const heicDecoded = needsHeicConversion ? await decodeHeicToJpegForPreview(file) : null;
        if (!isCurrent()) return;
        const workingFile = heicDecoded?.file ?? file;
        const mimeType = workingFile.type || inferredType || 'image/jpeg';
        pendingObjectUrl = URL.createObjectURL(workingFile);
        const { url: thumbnailUrl, width, height } = await makeThumbnail(pendingObjectUrl);
        if (!isCurrent()) {
          URL.revokeObjectURL(pendingObjectUrl);
          pendingObjectUrl = null;
          return;
        }
        const pixelCount = width * height;
        if (pixelCount > MAX_PIXEL_COUNT) {
          URL.revokeObjectURL(pendingObjectUrl);
          pendingObjectUrl = null;
          setError(t('fileTooLargeResolution'));
          return;
        }
        const info: BasicFileInfo = {
          file: workingFile,
          dataUrl: pendingObjectUrl,
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
        // Commit: the new file passed every check, so the previous one can go.
        revokeObjectUrl();
        objectUrlRef.current = pendingObjectUrl;
        pendingObjectUrl = null;
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
        if (pendingObjectUrl) {
          URL.revokeObjectURL(pendingObjectUrl);
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
    processFile,
    reset
  };
}
