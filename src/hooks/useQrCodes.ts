import { useEffect, useState } from 'react';
import type { BasicFileInfo } from '../types/metadata';
import { findQrCodes, type QrCode } from '../utils/qr';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-load'));
    image.src = url;
  });
}

/**
 * QR codes in the loaded picture, decoded on the device (native BarcodeDetector or the
 * bundled jsQR). Runs once per file, independently of the MediaPipe and OCR passes; `getImage`
 * lets the app hand over its already decoded picture instead of decoding it again.
 */
export function useQrCodes(
  fileInfo: BasicFileInfo | null,
  getImage?: (info: BasicFileInfo) => Promise<HTMLImageElement>
): { codes: QrCode[]; loading: boolean } {
  const [codes, setCodes] = useState<QrCode[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!fileInfo) {
      setCodes([]);
      setLoading(false);
      return undefined;
    }
    // A new file: the previous codes (and their boxes) must not reach its profile or its blur.
    setCodes([]);
    setLoading(true);
    (async () => {
      try {
        const image = await (getImage ? getImage(fileInfo) : loadImage(fileInfo.dataUrl));
        const found = await findQrCodes(image, fileInfo.width, fileInfo.height);
        if (active) setCodes(found);
      } catch {
        if (active) setCodes([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fileInfo, getImage]);

  return { codes, loading };
}
