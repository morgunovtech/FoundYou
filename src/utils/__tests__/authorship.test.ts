import { describe, expect, it } from 'vitest';
import { findAuthorship, looksLikeAPerson } from '../authorship';
import { findWrittenPlace } from '../placeFromMetadata';
import type { MetadataGroups } from '../../types/metadata';

const groups = (partial: Partial<MetadataGroups>): MetadataGroups => ({
  exif: {},
  xmp: {},
  iptc: {},
  icc: {},
  ...partial
});

describe('findAuthorship', () => {
  it('says nothing about a file that names nobody', () => {
    expect(findAuthorship(groups({ exif: { Make: 'Apple', ISO: 64 } }))).toBeNull();
    expect(findAuthorship(undefined)).toBeNull();
  });

  it('finds the name an editor or a camera body wrote', () => {
    const found = findAuthorship(groups({ exif: { Artist: 'Семён Моргунов', CameraOwnerName: 'S. Morgunov' } }));
    expect(found?.people).toEqual(['Семён Моргунов', 'S. Morgunov']);
    expect(found?.findings.map((f) => f.tag)).toEqual(['Artist', 'CameraOwnerName']);
  });

  it('separates a way to reach someone from a licence line', () => {
    const found = findAuthorship(
      groups({
        exif: { Copyright: '© 2026 MOR TECH' },
        xmp: { CiEmailWork: 'hi@example.com', CiTelWork: '+998 90 000 00 00' }
      })
    );
    expect(found?.contacts).toEqual(['hi@example.com', '+998 90 000 00 00']);
    // The licence is reported, but it is not a person and not a contact.
    expect(found?.people).toEqual([]);
    expect(found?.findings.find((f) => f.kind === 'rights')?.value).toBe('© 2026 MOR TECH');
  });

  it('reads a tag whichever group exifr put it in', () => {
    // The same key arrives under `iptc` for a JPEG and under `xmp` for a HEIC.
    expect(findAuthorship(groups({ iptc: { Byline: 'A. Reporter' } }))?.people).toEqual(['A. Reporter']);
    expect(findAuthorship(groups({ xmp: { Byline: 'A. Reporter' } }))?.people).toEqual(['A. Reporter']);
  });

  it('reports the same value once however many tags carry it', () => {
    const found = findAuthorship(groups({ exif: { Artist: 'Anna Petrova' }, iptc: { Byline: 'Anna Petrova' } }));
    expect(found?.people).toEqual(['Anna Petrova']);
  });

  it('takes a list apart', () => {
    expect(findAuthorship(groups({ xmp: { Creator: ['Anna Petrova', 'Ivan Ivanov'] } }))?.people).toEqual([
      'Anna Petrova',
      'Ivan Ivanov'
    ]);
  });
});

describe('looksLikeAPerson', () => {
  /*
   * `dc:creator` holds the tool as often as the author — `analyzeEditingHistory` treats it as
   * software for that reason. Here it may only pass as a person when it clearly is not a program,
   * because printing «Автор: Adobe Photoshop» discredits the whole card.
   */
  it('keeps names', () => {
    for (const name of ['Семён Моргунов', 'A. Reporter', "O'Brien", 'Jean-Luc Picard']) {
      expect(looksLikeAPerson(name)).toBe(true);
    }
  });

  it('rejects the tools that write themselves into this field', () => {
    for (const tool of ['Adobe Photoshop 25.0', 'Lightroom Classic', 'darktable 4.6', 'ComfyUI', 'Midjourney']) {
      expect(looksLikeAPerson(tool)).toBe(false);
    }
  });

  it('rejects a bare version and an empty value', () => {
    expect(looksLikeAPerson('13.2')).toBe(false);
    expect(looksLikeAPerson('v2.4.1')).toBe(false);
    expect(looksLikeAPerson('   ')).toBe(false);
  });
});

describe('findWrittenPlace', () => {
  it('says nothing when the file names no place', () => {
    expect(findWrittenPlace(groups({ exif: { Make: 'Apple' } }))).toBeNull();
    expect(findWrittenPlace(undefined)).toBeNull();
  });

  it('joins the parts finest first', () => {
    const place = findWrittenPlace(
      groups({ iptc: { SubLocation: 'Чиланзар', City: 'Ташкент', Country: 'Узбекистан', CountryCode: 'UZ' } })
    );
    expect(place?.line).toBe('Чиланзар, Ташкент, Узбекистан');
    expect(place?.countryCode).toBe('UZ');
    expect(place?.tags).toContain('SubLocation');
  });

  it('does not repeat a part that equals the one before it', () => {
    // A city that is also its own province: «Ташкент, Ташкент» reads as a mistake.
    expect(findWrittenPlace(groups({ iptc: { City: 'Ташкент', Province: 'ташкент' } }))?.line).toBe('Ташкент');
  });

  it('a country code alone is not a place', () => {
    // Nothing to show a reader: «UZ» on its own is not where the picture was taken.
    expect(findWrittenPlace(groups({ iptc: { CountryCode: 'UZ' } }))).toBeNull();
  });

  it('reads the place whichever group carries it', () => {
    expect(findWrittenPlace(groups({ xmp: { 'photoshop:City': 'Самарканд' } }))?.line).toBe('Самарканд');
    expect(findWrittenPlace(groups({ exif: { City: 'Бухара' } }))?.line).toBe('Бухара');
  });

  it('prefers the first key listed for a part', () => {
    // `SubLocation` is the IPTC field; `Location` is the XMP one. Both may be present.
    const place = findWrittenPlace(groups({ iptc: { SubLocation: 'Регистан' }, xmp: { Location: 'Somewhere else' } }));
    expect(place?.sublocation).toBe('Регистан');
  });
});
