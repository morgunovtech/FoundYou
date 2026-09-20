/**
 * The barcodes jsQR cannot read.
 *
 * `findQrCodes` covers QR and nothing else: the native `BarcodeDetector` exists only in
 * Chromium, and the bundled `jsqr` is a QR decoder by definition. So a boarding pass — which is
 * a PDF417 or an Aztec code, never a QR — read as «ничего не найдено», although it carries the
 * passenger's name, record locator and flight in plain text. So does a DataMatrix on a parcel
 * label and a Code 128 on a delivery slip.
 *
 * `zxing-wasm` reads all of them. It costs about 930 KB, so it is loaded only when the first
 * pass found nothing at all — the same bargain the straightened OCR pass makes. A screenshot
 * with a QR in it never reaches this code.
 *
 * The `.wasm` is served from this project's own origin (`public/zxing`, copied by
 * `prepare:assets`): privacy invariant 3 forbids a CDN at run time, and zxing-wasm would
 * otherwise fetch its binary from one.
 */

/** Where `prepare:assets` puts the reader binary. Never a CDN. */
const WASM_URL = '/zxing/zxing_reader.wasm';

/**
 * The formats worth the extra pass. QR is deliberately absent — it has already been tried by
 * the time this runs — and the linear retail symbologies are in because a delivery slip or a
 * parcel label carries one and people photograph both.
 */
const FORMATS = ['Aztec', 'PDF417', 'DataMatrix', 'Code128', 'Code39', 'ITF', 'EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'];

export interface WideBarcode {
  /** Decoded payload, verbatim. */
  text: string;
  /** zxing's own name for the symbology: `Aztec`, `PDF417`, `DataMatrix`, `Code128`… */
  format: string;
  /** Bounding box in the pixels of the canvas that was read. */
  box: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Every non-QR barcode in the frame. Returns an empty list on any failure — a missing chunk or
 * a module that will not start must never turn a truthful «ничего не найдено» into an error,
 * which is the same rule the second OCR pass follows.
 */
export async function findWideBarcodes(imageData: ImageData): Promise<WideBarcode[]> {
  try {
    const reader = await import('zxing-wasm/reader');
    reader.prepareZXingModule({ overrides: { locateFile: () => WASM_URL } });
    const results = await reader.readBarcodes(imageData, {
      tryHarder: true,
      formats: FORMATS as never,
      maxNumberOfSymbols: 8
    });
    return results
      .filter((result) => typeof result.text === 'string' && result.text.length > 0)
      .map((result) => ({
        text: result.text,
        format: String(result.format ?? ''),
        box: boxOf(result.position)
      }));
  } catch (error) {
    console.warn('zxing-read', error);
    return [];
  }
}

interface Corner {
  x: number;
  y: number;
}

/** zxing reports four corners; the blur needs an upright box around all of them. */
function boxOf(position: unknown): WideBarcode['box'] {
  if (!position || typeof position !== 'object') return null;
  const corners = Object.values(position as Record<string, unknown>).filter(
    (value): value is Corner =>
      !!value && typeof value === 'object' && Number.isFinite((value as Corner).x) && Number.isFinite((value as Corner).y)
  );
  if (corners.length === 0) return null;
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
