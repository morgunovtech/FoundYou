import type { MetadataGroups } from '../types/metadata';

/**
 * Where the file says the picture was taken, when there are no coordinates.
 *
 * A photograph stripped of GPS is not necessarily stripped of place: IPTC and XMP carry a
 * written location — city, sub-location, province, country — that editors, agency workflows
 * and phone «add location» features fill in. It survives the geotag being turned off, and it
 * survives most of the advice people are given about privacy, because everyone checks the
 * coordinates and nobody checks the caption block.
 *
 * This is read from the groups exifr already parsed; nothing is sent anywhere, and the text is
 * never geocoded — turning a written address into coordinates would mean sending a string
 * pulled out of someone's file to a third party, which this project does not do.
 */

export interface WrittenPlace {
  sublocation?: string;
  city?: string;
  province?: string;
  country?: string;
  countryCode?: string;
  /** The parts joined finest-first, ready to print: «Чиланзар, Ташкент, Узбекистан». */
  line: string;
  /** Which tags the parts came from, for the subtext under the row. */
  tags: string[];
}

const GROUP_ORDER: Array<keyof MetadataGroups> = ['iptc', 'xmp', 'exif'];

/** Finest first. Each entry lists the tags that may hold that part; the first non-empty one wins. */
const PARTS: Array<{ field: keyof Omit<WrittenPlace, 'line' | 'tags'>; keys: string[] }> = [
  {
    field: 'sublocation',
    keys: ['SubLocation', 'Sub-location', 'Location', 'Iptc4xmpCore:Location']
  },
  {
    field: 'city',
    keys: ['City', 'photoshop:City']
  },
  {
    field: 'province',
    keys: ['Province', 'ProvinceState', 'State', 'photoshop:State']
  },
  {
    field: 'country',
    keys: ['Country', 'CountryName', 'photoshop:Country']
  },
  {
    field: 'countryCode',
    keys: ['CountryCode']
  }
];

function textOf(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = textOf(item);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The written place, or `null` when the file names none. A country code on its own is not a
 * place worth a row — it is printed only next to a country or city that was also found.
 */
export function findWrittenPlace(groups: MetadataGroups | undefined): WrittenPlace | null {
  if (!groups) return null;
  const found: Partial<WrittenPlace> = {};
  const tags: string[] = [];

  // exifr does not group IPTC and XMP keys the same way for every container, so each key is
  // looked for in all three groups rather than in the one it «should» be in.
  outer: for (const { field, keys } of PARTS) {
    for (const key of keys) {
      for (const group of GROUP_ORDER) {
        const bag = groups[group] as Record<string, unknown> | undefined;
        const value = bag ? textOf(bag[key]) : null;
        if (value) {
          found[field] = value;
          tags.push(key);
          continue outer;
        }
      }
    }
  }

  const parts = [found.sublocation, found.city, found.province, found.country].filter(
    (part): part is string => Boolean(part)
  );
  if (parts.length === 0) return null;

  // Drop a part that merely repeats the one before it («Ташкент, Ташкент»).
  const line = parts
    .filter((part, index) => index === 0 || part.toLowerCase() !== parts[index - 1].toLowerCase())
    .join(', ');

  return { ...found, line, tags };
}
