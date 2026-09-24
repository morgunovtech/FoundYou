import type { StructuredMetadata } from '../types/metadata';

/** Every metadata group the export strips and the verification re-counts; one list for both. */
export const METADATA_GROUPS = ['exif', 'xmp', 'iptc', 'icc', 'png'] as const;

/**
 * The PNG image header, which `extractMetadataFromOriginal` merges into the `png` group next to
 * the text chunks so the raw table can show it. It is the structure of the picture (size, bit
 * depth, colour type), not metadata: it survives every export, and the post-export count skips
 * it — so the pre-export count must skip it too, or a PNG that carries nothing at all reads
 * «было 7 полей, осталось 0».
 */
export const PNG_HEADER_FIELDS = new Set(['ImageWidth', 'ImageHeight', 'BitDepth', 'ColorType', 'Compression', 'Filter', 'Interlace']);

/**
 * How many metadata fields the original carries, over the same groups the post-export check
 * parses (`countRemainingMetadata` in App.tsx), so «было N полей» and «полей метаданных: N»
 * are one number for JPEG and PNG alike.
 */
export function countMetadataFields(metadata: StructuredMetadata | null): number {
  if (!metadata) return 0;
  const groups = metadata.groups as unknown as Record<string, Record<string, unknown> | undefined>;
  return METADATA_GROUPS.reduce((sum, key) => {
    const fields = Object.keys(groups[key] ?? {});
    return sum + (key === 'png' ? fields.filter((field) => !PNG_HEADER_FIELDS.has(field)).length : fields.length);
  }, 0);
}
