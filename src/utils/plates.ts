import type { BoundingBox } from '../types/detection';
import type { OCRRegion, OCRResult } from '../hooks/useOCR';

/**
 * Licence-plate candidates without a plate model: the OCR regions that read like a plate
 * (letters + digits, plate-shaped box) and the OCR regions that sit on a detected vehicle.
 * Precision over recall — a token is only a plate when the text pattern or the vehicle
 * position says so, never on shape alone.
 */
export interface PlateCandidate {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Normalised text (Latin uppercase, no separators). */
  text: string;
  confidence: number;
  /** What made this region a candidate. */
  source: 'pattern' | 'vehicle' | 'both';
}

export const VEHICLE_LABELS = new Set(['car', 'truck', 'bus', 'motorcycle']);
const MIN_VEHICLE_SCORE = 0.4;

/** Cyrillic letters that plates share with the Latin alphabet, mapped to their Latin twins. */
const CYRILLIC_TWINS: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X'
};

export function normalizePlateText(text: string): string {
  return text
    .toUpperCase()
    .replace(/[А-Я]/g, (ch) => CYRILLIC_TWINS[ch] ?? ch)
    .replace(/[\s\-.·_|:]/g, '');
}

/**
 * A plate-like token: 5–9 Latin letters and digits, at least two digits and one letter,
 * no lowercase and nothing else. Dates, prices, phone numbers (digits only) and words
 * (letters only) never pass.
 */
export function looksLikePlate(text: string): boolean {
  const normalized = normalizePlateText(text);
  if (normalized.length < 5 || normalized.length > 9) return false;
  if (!/^[A-Z0-9]+$/.test(normalized)) return false;
  const digits = (normalized.match(/\d/g) ?? []).length;
  const letters = normalized.length - digits;
  return digits >= 2 && letters >= 1;
}

function aspect(region: { width: number; height: number }): number {
  return region.height > 0 ? region.width / region.height : 0;
}

function isPlateShaped(region: OCRRegion, image?: { width: number; height: number }): boolean {
  const ratio = aspect(region);
  if (ratio < 1.8 || ratio > 9) return false;
  if (image && image.height > 0 && region.height > image.height * 0.2) return false;
  return true;
}

function onVehicle(region: OCRRegion, vehicles: BoundingBox[]): boolean {
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  return vehicles.some((v) => {
    if (cx < v.x || cx > v.x + v.width) return false;
    // Plates sit on the lower two thirds of a vehicle box; a roof sign or a billboard behind the car does not.
    return cy >= v.y + v.height * 0.3 && cy <= v.y + v.height;
  });
}

export function findPlateCandidates(
  ocr: OCRResult | null | undefined,
  detections: BoundingBox[],
  image?: { width: number; height: number }
): PlateCandidate[] {
  if (!ocr || ocr.regions.length === 0) return [];
  const vehicles = detections.filter((d) => VEHICLE_LABELS.has(d.label) && d.score >= MIN_VEHICLE_SCORE);
  const out: PlateCandidate[] = [];
  for (const region of ocr.regions) {
    if (!isPlateShaped(region, image)) continue;
    const text = normalizePlateText(region.text);
    const pattern = looksLikePlate(region.text);
    // On a vehicle Tesseract often misreads the plate, so any short alphanumeric token counts there.
    const vehicle = vehicles.length > 0 && onVehicle(region, vehicles) && text.length >= 3 && /\d/.test(text) && /^[A-Z0-9]+$/.test(text);
    if (!pattern && !vehicle) continue;
    out.push({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      text,
      confidence: region.confidence,
      source: pattern && vehicle ? 'both' : pattern ? 'pattern' : 'vehicle'
    });
  }
  return out;
}
