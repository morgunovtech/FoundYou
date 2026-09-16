import type { StructuredMetadata } from '../types/metadata';

/** Every metadata group the export strips and the verification re-counts; one list for both. */
export const METADATA_GROUPS = ['exif', 'xmp', 'iptc', 'icc', 'png'] as const;

/**
 * How many metadata fields the original carries, over the same groups the post-export check
 * parses (`countRemainingMetadata` in App.tsx), so «было N полей» and «полей метаданных: N»
 * are one number for JPEG and PNG alike.
 */
export function countMetadataFields(metadata: StructuredMetadata | null): number {
  if (!metadata) return 0;
  const groups = metadata.groups as unknown as Record<string, Record<string, unknown> | undefined>;
  return METADATA_GROUPS.reduce((sum, key) => sum + Object.keys(groups[key] ?? {}).length, 0);
}
