import { describe, expect, it } from 'vitest';
import { findAuthorship } from '../authorship';
import type { MetadataGroups } from '../../types/metadata';

const groups = (partial: Partial<MetadataGroups>): MetadataGroups => ({
  exif: {},
  xmp: {},
  iptc: {},
  icc: {},
  ...partial
});

describe('findAuthorship and the editors’ own credit line', () => {
  it('does not name the eraser as the author', () => {
    /*
     * IPTC `Credit` is where the phone editors leave their mark — the same line
     * `editingHistory.ts` reads to say «генеративная правка». A file that had a lamp post
     * removed used to get a card «Автор и контакты: Apple Photos Clean Up», severity high.
     */
    for (const credit of ['Apple Photos Clean Up', 'Edited with Google AI', 'Galaxy AI']) {
      const found = findAuthorship(groups({ iptc: { Credit: credit } }));
      expect(found?.people ?? []).toEqual([]);
      expect(found?.findings.find((f) => f.value === credit)?.kind).toBe('rights');
    }
  });

  it('keeps Credit and Source as credit lines, next to the copyright', () => {
    const found = findAuthorship(groups({ iptc: { Credit: 'Reuters', Source: 'AP Images', Byline: 'Jane Doe' } }));
    expect(found?.people).toEqual(['Jane Doe']);
    expect(found?.findings.filter((f) => f.kind === 'rights').map((f) => f.value)).toEqual(['Reuters', 'AP Images']);
  });
});
