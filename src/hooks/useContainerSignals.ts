import { useEffect, useState } from 'react';
import type { BasicFileInfo } from '../types/metadata';
import { parseJpegSignals, type JpegSignals } from '../utils/jpegQuant';

/** DQT and SOF sit before the scan; even a large XMP or ICC block rarely pushes them past this. */
const HEAD_BYTES = 4 * 1024 * 1024;

/**
 * JPEG compression signals (quantization tables, subsampling, segments) of the original file:
 * read from the head of the bytes, locally, without decoding. Null for PNG / HEIC / WebP
 * sources and while the read is in flight.
 */
export function useContainerSignals(fileInfo: BasicFileInfo | null): JpegSignals | null {
  const file = fileInfo ? (fileInfo.originalFile ?? fileInfo.file) : null;
  const mime = fileInfo ? (fileInfo.originalMimeType ?? fileInfo.mimeType) : '';
  const [settled, setSettled] = useState<{ file: File; signals: JpegSignals | null } | null>(null);

  useEffect(() => {
    if (!file) return undefined;
    const isJpeg = /jpe?g$/i.test(mime) || /\.jpe?g$/i.test(file.name);
    if (!isJpeg) {
      setSettled({ file, signals: null });
      return undefined;
    }
    let active = true;
    (async () => {
      let signals: JpegSignals | null;
      try {
        signals = parseJpegSignals(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()));
      } catch {
        signals = null;
      }
      if (active) setSettled({ file, signals });
    })();
    return () => {
      active = false;
    };
  }, [file, mime]);

  return settled && settled.file === file ? settled.signals : null;
}
