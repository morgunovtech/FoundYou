import type { MetadataGroups } from '../types/metadata';

/**
 * Who the file says took the picture — and how to reach them.
 *
 * These fields were always read (they are counted in «было N полей» and printed in the raw
 * table), but never surfaced as a fact, so a file carrying a full name, an e-mail address and
 * a phone number looked exactly as quiet as one carrying none. Desktop editors and DSLR bodies
 * write them without being asked: Lightroom fills `Artist` and `Copyright` from the catalogue
 * preset, a Canon body carries `CameraOwnerName` from its own settings menu, Windows Explorer
 * writes `XPAuthor` when someone types an author into the file properties dialogue, and the
 * IPTC contact block is the standard newsroom byline.
 *
 * Nothing here leaves the device: the values come from the groups exifr already parsed.
 */

export type AuthorshipKind = 'person' | 'contact' | 'rights';

export interface AuthorshipFinding {
  /** Which tag the value came from, for the raw table and for the card's subtext. */
  tag: string;
  kind: AuthorshipKind;
  value: string;
}

export interface Authorship {
  findings: AuthorshipFinding[];
  /** Names of people — the part that identifies someone rather than a licence. */
  people: string[];
  /** E-mail addresses, phone numbers, sites and postal lines from the IPTC contact block. */
  contacts: string[];
}

/**
 * `dc:creator` is not in this table on purpose. In practice it holds the tool that wrote the
 * file at least as often as a person's name — `analyzeEditingHistory` treats it as software
 * for exactly that reason — so it is read separately below and only kept when it does not look
 * like a program.
 *
 * Neither are IPTC `Credit` and `Source`. `Credit` is where the phone editors leave their own
 * mark — «Apple Photos Clean Up», «Edited with Google AI», «Galaxy AI» — which is exactly what
 * `editingHistory.ts` reads it for, and a file that had a lamp post removed used to get a card
 * naming the eraser as its author. Both are credit lines, so they are listed with the rights.
 */
const PERSON_TAGS = ['Artist', 'artist', 'CameraOwnerName', 'OwnerName', 'XPAuthor', 'Byline', 'BylineTitle'];

const RIGHTS_TAGS = ['Copyright', 'copyright', 'CopyrightNotice', 'Rights', 'WebStatement', 'UsageTerms', 'Credit', 'Source'];

/** The IPTC/XMP contact block a newsroom fills in: these are ways to reach a specific person. */
const CONTACT_TAGS = ['CiEmailWork', 'CiTelWork', 'CiUrlWork', 'CiAdrExtadr', 'CiAdrCity', 'CiAdrCtry', 'Contact', 'SpecialInstructions'];

/**
 * Names a `Creator` value has to avoid to count as a person. The list is deliberately short and
 * matches on the whole trimmed value or a leading word, because a real surname must never be
 * silently dropped: a false «this is a tool» hides the very fact this card exists for.
 */
const TOOL_LIKE = /(adobe|lightroom|photoshop|capture one|gimp|darktable|affinity|luminar|snapseed|picasa|camera|imagemagick|ffmpeg|canva|figma|midjourney|dall[-· ]?e|stable diffusion|automatic1111|comfyui|invokeai|novelai)/i;

/** A version string on its own («13.2», «v2.4.1») is a program, not a person. */
const VERSION_ONLY = /^v?\d+(\.\d+)*$/;

function textOf(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(textOf);
  return [];
}

/** True when a `Creator` / `dc:creator` value reads as a person rather than the tool. */
export function looksLikeAPerson(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 120) return false;
  if (VERSION_ONLY.test(text)) return false;
  return !TOOL_LIKE.test(text);
}

/**
 * exifr does not put IPTC and XMP keys in the same group for every container, so a tag is
 * looked for in all of them rather than in the one it «should» be in — a missed author line is
 * the whole point of the card, and a duplicate is filtered out by the caller anyway.
 */
const GROUP_ORDER: Array<keyof MetadataGroups> = ['exif', 'iptc', 'xmp'];

function read(groups: MetadataGroups, key: string): string[] {
  return GROUP_ORDER.flatMap((group) => {
    const bag = groups[group] as Record<string, unknown> | undefined;
    return bag ? textOf(bag[key]) : [];
  });
}

/**
 * Every author, contact and rights line the file carries. Returns `null` when there is nothing
 * to report, so the caller can leave the card out rather than print an empty one.
 */
export function findAuthorship(groups: MetadataGroups | undefined): Authorship | null {
  if (!groups) return null;
  const findings: AuthorshipFinding[] = [];
  const seen = new Set<string>();

  const push = (tag: string, kind: AuthorshipKind, values: string[]) => {
    for (const value of values) {
      const key = `${kind}:${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ tag, kind, value });
    }
  };

  for (const key of PERSON_TAGS) push(key, 'person', read(groups, key));
  // `Creator` only when it does not read as the name of a program (see TOOL_LIKE).
  for (const key of ['Creator', 'creator', 'dc:creator']) {
    push(key, 'person', read(groups, key).filter(looksLikeAPerson));
  }
  for (const key of CONTACT_TAGS) push(key, 'contact', read(groups, key));
  for (const key of RIGHTS_TAGS) push(key, 'rights', read(groups, key));

  if (findings.length === 0) return null;
  return {
    findings,
    people: findings.filter((f) => f.kind === 'person').map((f) => f.value),
    contacts: findings.filter((f) => f.kind === 'contact').map((f) => f.value)
  };
}
