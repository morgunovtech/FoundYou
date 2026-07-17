import type { StructuredMetadata } from '../types/metadata';

// Браузер уже применяет EXIF Orientation при декодировании (image-orientation:
// from-image), поэтому width/height здесь всегда «визуальные» — повторно
// разворачивать их по тегу нельзя, иначе портрет и пейзаж меняются местами.
export function inferOrientation(
  width: number,
  height: number
): StructuredMetadata['orientation'] {
  if (!width || !height) return 'unknown';
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}
