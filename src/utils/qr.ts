/*
 * QR codes in the picture: what they encode and where they sit. A code is
 * text the viewer cannot read but any phone can: a Wi-Fi password, a contact
 * card, a boarding pass, a payment request, a link into a private chat.
 * Decoding runs on the canvas, on the device: the native BarcodeDetector when
 * the browser has one, otherwise the bundled jsQR (plain JavaScript, no CDN).
 */

export type QrKind = 'wifi' | 'contact' | 'boarding' | 'payment' | 'url' | 'phone' | 'email' | 'sms' | 'geo' | 'text';

export interface QrPayload {
  kind: QrKind;
  /** Short, masked description for the card: never the raw secret. */
  summary: string;
  /** Kinds that hand a stranger an asset (a network, a person, a ticket, money) rather than a link. */
  sensitive: boolean;
}

export interface QrCode extends QrPayload {
  /** Original-image pixel coordinates of the code. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The decoded text, kept for the raw data table only. */
  raw: string;
  /**
   * Symbology when it is not a QR. A boarding pass is a PDF417 or an Aztec code and calling it
   * «QR-код» in the card would be a small lie in a product that cannot afford one.
   */
  format?: string;
}

function mask(value: string, keep = 2): string {
  const trimmed = value.trim();
  if (trimmed.length <= keep) return '•'.repeat(Math.max(3, trimmed.length));
  return `${trimmed.slice(0, keep)}${'•'.repeat(Math.min(6, Math.max(3, trimmed.length - keep)))}`;
}

/**
 * One `KEY:value` field of a `WIFI:` / `MECARD:` payload. The first field follows the type
 * prefix's own colon (`WIFI:S:HomeNet;…`, which is the order Android's share sheet writes), so
 * `:` is a separator too — a key preceded only by `;` or a line start missed the SSID whenever
 * it came first.
 */
function field(text: string, key: string): string | null {
  const match = new RegExp(`(?:^|[;:\\n])\\s*${key}:([^;\\n]*)`, 'i').exec(text);
  return match ? match[1].trim() : null;
}

/** Classify the decoded text without revealing what it protects. */
export function classifyQrPayload(raw: string): QrPayload {
  const text = raw.trim();
  if (/^WIFI:/i.test(text)) {
    const ssid = field(text, 'S') ?? '';
    const password = field(text, 'P');
    return { kind: 'wifi', summary: `${ssid || '?'}${password ? ` · ${mask(password, 1)}` : ''}`, sensitive: true };
  }
  if (/^BEGIN:VCARD/i.test(text) || /^MECARD:/i.test(text)) {
    const name = field(text, 'FN') ?? field(text, 'N') ?? '';
    return { kind: 'contact', summary: name ? mask(name, 3) : '', sensitive: true };
  }
  // IATA BCBP: «M1» or «M2», a 20-character name field (letters, slash, spaces), then the PNR and route.
  if (/^M[12][A-Z /]{20}[A-Z0-9 ]{7}/.test(text) && text.length >= 60) {
    return { kind: 'boarding', summary: mask(text.slice(2, 22), 3), sensitive: true };
  }
  if (/^000201/.test(text) || /^(bitcoin|ethereum|ton|lightning):/i.test(text)) {
    return { kind: 'payment', summary: mask(text, 6), sensitive: true };
  }
  if (/^tel:/i.test(text)) return { kind: 'phone', summary: mask(text.slice(4), 4), sensitive: true };
  if (/^mailto:/i.test(text)) return { kind: 'email', summary: mask(text.slice(7), 2), sensitive: true };
  if (/^sms(to)?:/i.test(text)) return { kind: 'sms', summary: mask(text.replace(/^sms(to)?:/i, ''), 4), sensitive: true };
  if (/^geo:/i.test(text)) return { kind: 'geo', summary: mask(text.slice(4), 6), sensitive: true };
  if (/^https?:\/\//i.test(text)) {
    let host: string;
    try {
      host = new URL(text).host;
    } catch {
      host = text.replace(/^https?:\/\//i, '').split('/')[0];
    }
    // Invite links into chats and channels are an asset; a plain site is a link.
    const invite = /t\.me\/(\+|joinchat)|chat\.whatsapp\.com|discord\.gg|signal\.group/i.test(text);
    return { kind: 'url', summary: host, sensitive: invite };
  }
  return { kind: 'text', summary: mask(text, 6), sensitive: false };
}

/* ── decoding ───────────────────────────────────────────── */

interface DetectedCode {
  raw: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Symbology, when it is not a QR: `PDF417`, `Aztec`, `DataMatrix`, `Code128`… */
  format?: string;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string; boundingBox: { x: number; y: number; width: number; height: number } }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike;
  }
}

/** The longest side the decoder works on: QR modules stay legible, the pass stays fast. */
const QR_MAX_DIMENSION = 1600;

async function decodeWithJsQr(imageData: ImageData): Promise<DetectedCode[]> {
  const { default: jsQR } = await import('jsqr');
  const codes: DetectedCode[] = [];
  const data = new Uint8ClampedArray(imageData.data);
  // jsQR returns one code per pass: paint the found one over and look again, a few times.
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = jsQR(data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
    if (!found) break;
    const xs = [found.location.topLeftCorner.x, found.location.topRightCorner.x, found.location.bottomLeftCorner.x, found.location.bottomRightCorner.x];
    const ys = [found.location.topLeftCorner.y, found.location.topRightCorner.y, found.location.bottomLeftCorner.y, found.location.bottomRightCorner.y];
    const x = Math.max(0, Math.min(...xs));
    const y = Math.max(0, Math.min(...ys));
    const width = Math.min(imageData.width, Math.max(...xs)) - x;
    const height = Math.min(imageData.height, Math.max(...ys)) - y;
    if (found.data) codes.push({ raw: found.data, x, y, width, height });
    for (let row = Math.floor(y); row < Math.ceil(y + height); row++) {
      for (let col = Math.floor(x); col < Math.ceil(x + width); col++) {
        const p = (row * imageData.width + col) * 4;
        data[p] = data[p + 1] = data[p + 2] = 128;
      }
    }
  }
  return codes;
}

/**
 * Finds and decodes QR codes in a picture, in original-image coordinates. Returns [] when there
 * are none or the decoders are unavailable; never throws.
 */
export async function findQrCodes(source: CanvasImageSource, width: number, height: number): Promise<QrCode[]> {
  const scale = Math.min(1, QR_MAX_DIMENSION / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  let detected: DetectedCode[] = [];
  try {
    if (typeof window !== 'undefined' && window.BarcodeDetector) {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const results = await detector.detect(canvas);
      detected = results
        .filter((r) => r.rawValue)
        .map((r) => ({ raw: r.rawValue, x: r.boundingBox.x, y: r.boundingBox.y, width: r.boundingBox.width, height: r.boundingBox.height }));
    }
  } catch {
    detected = [];
  }
  if (detected.length === 0) {
    try {
      detected = await decodeWithJsQr(ctx.getImageData(0, 0, canvas.width, canvas.height));
    } catch {
      detected = [];
    }
  }
  /*
   * Still nothing: try the symbologies neither path can read at all. A boarding pass is a
   * PDF417 or an Aztec code, never a QR, and it carries the passenger's name, record locator
   * and flight in plain text; a parcel label is a DataMatrix; a delivery slip is a Code 128.
   * The reader costs about 930 KB, which is why it is spent only where the answer would
   * otherwise be «ничего не найдено» — a photo with a QR in it never reaches this branch.
   */
  if (detected.length === 0) {
    try {
      const { findWideBarcodes } = await import('./barcodes');
      const wide = await findWideBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height));
      detected = wide.map((code) => ({
        raw: code.text,
        x: code.box?.x ?? 0,
        y: code.box?.y ?? 0,
        width: code.box?.width ?? 0,
        height: code.box?.height ?? 0,
        format: code.format || undefined
      }));
    } catch {
      detected = [];
    }
  }
  return detected.map((code) => ({
    ...classifyQrPayload(code.raw),
    raw: code.raw,
    format: code.format,
    x: code.x / scale,
    y: code.y / scale,
    width: code.width / scale,
    height: code.height / scale
  }));
}
