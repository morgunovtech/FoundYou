import { describe, expect, it } from 'vitest';
import { countMetadataFields, PNG_HEADER_FIELDS } from '../metadataFields';
import type { StructuredMetadata } from '../../types/metadata';

const metadata = (groups: Partial<StructuredMetadata['groups']>): StructuredMetadata => ({
  groups: { exif: {}, xmp: {}, iptc: {}, icc: {}, ...groups },
  completeness: 0
});

describe('countMetadataFields', () => {
  it('counts the groups the post-export check re-parses', () => {
    expect(countMetadataFields(metadata({ exif: { Make: 'Apple', Model: 'iPhone' }, xmp: { CreateDate: 'x' }, iptc: {}, icc: { ProfileVersion: 4 } }))).toBe(4);
    expect(countMetadataFields(null)).toBe(0);
  });

  it('does not count the PNG image header, which no export can remove', () => {
    /*
     * IHDR (size, bit depth, colour type…) is merged into the `png` group next to the text
     * chunks so the raw table can show it, and the post-export count skips it. Counting it
     * before and not after read «было 7 полей, осталось 0» over a PNG that carried nothing.
     */
    const header: Record<string, unknown> = {};
    for (const field of PNG_HEADER_FIELDS) header[field] = 1;
    expect(PNG_HEADER_FIELDS.size).toBe(7);
    expect(countMetadataFields(metadata({ png: header }))).toBe(0);
    expect(countMetadataFields(metadata({ png: { ...header, parameters: 'a prompt', Software: 'x' } }))).toBe(2);
  });
});
