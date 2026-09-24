import { useCallback, useEffect, useRef, useState } from 'react';
import type { BasicFileInfo } from '../types/metadata';
import { decodeHeicToJpegForPreview } from '../utils/heic';
import { maxUploadPixels, megapixels } from '../utils/platform';
import { checkTruncation } from '../utils/truncation';

/** Upload limit in megabytes; the drop zone shows it and `fileTooLarge` quotes it. */
/*
 * A 50 MP Oppo photo is an ordinary photo now, and it used to be refused twice over: 49.9 MP
 * against a 40 MP ceiling and 10–25 MB against a 20 MB one. Both ceilings were set to the size
 * of a canvas the export would need, not to what the browser can open. The export keeps its own,
 * lower cap (`maxExportPixels`, with the note that says the copy was scaled down); these two are
 * only about whether the file can be looked at at all.
 */
export const MAX_FILE_SIZE_MB = 50;
const MAX_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
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

/** Why a file was refused; `App.tsx` maps each code to its dictionary key (hooks stay free of i18n). */
export type FileErrorCode =
  | 'file-too-large'
  | 'file-too-large-resolution'
  | 'unsupported-format'
  | 'heic-conversion-failed'
  | 'browser-format-unsupported'
  | 'corrupted-file';

export interface FileError {
  code: FileErrorCode;
  /** The numbers the message quotes (the limit, the actual size). */
  params?: Record<string, string | number>;
}

/** The file was accepted, but something about it has to be said before the reader trusts the frame. */
export type FileWarningCode = 'jpeg-truncated' | 'png-truncated';

export function useImageFile() {
  const [fileInfo, setFileInfo] = useState<BasicFileInfo | null>(null);
  const [error, setError] = useState<FileError | null>(null);
  /*
   * A second, non-blocking channel. An error means nothing is shown; a warning means the file was
   * accepted and analysed, and something about it has to be said before the reader trusts the
   * frame — today that is only «the file is cut short». Both are codes, not text: a translated
   * string in state stays in the language it was made in when the reader switches.
   */
  const [warning, setWarning] = useState<FileWarningCode | null>(null);
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

  const processFile = useCallback(
    async (file: File) => {
      const generation = ++generationRef.current;
      const isCurrent = () => generationRef.current === generation;
      setLoading(true);
      setError(null);
      setWarning(null);
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
          setError({ code: 'file-too-large', params: { limit: MAX_FILE_SIZE_MB } });
          return;
        }
        if (!SUPPORTED_TYPES.includes(inferredType)) {
          setError({ code: 'unsupported-format' });
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
        if (pixelCount > maxUploadPixels()) {
          URL.revokeObjectURL(pendingObjectUrl);
          pendingObjectUrl = null;
          // Name both numbers: «слишком высокое» alone leaves no idea by how much or what to do.
          setError({
            code: 'file-too-large-resolution',
            params: { actual: megapixels(pixelCount), limit: megapixels(maxUploadPixels()) }
          });
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
        // The end-marker check runs on the bytes as they arrived, before any HEIC conversion, and
        // never blocks: a cut file still carries its metadata and most of its pixels.
        const truncation = await checkTruncation(sourceFile);
        if (!isCurrent()) {
          URL.revokeObjectURL(pendingObjectUrl);
          pendingObjectUrl = null;
          return;
        }
        if (truncation === 'jpeg-truncated' || truncation === 'png-truncated') setWarning(truncation);

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
          setError({ code: 'heic-conversion-failed' });
        } else if (inferredType === 'image/avif') {
          setError({ code: 'browser-format-unsupported' });
        } else {
          setError({ code: 'corrupted-file' });
        }
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    },
    [revokeObjectUrl]
  );

  return {
    fileInfo,
    error,
    warning,
    loading,
    processFile
  };
}
