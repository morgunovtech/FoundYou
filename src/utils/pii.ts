import type { OCRResult } from '../hooks/useOCR';

/*
 * Documents and contacts in the recognised text: a bank card number (Luhn), an
 * IBAN (mod 97), a phone number, an e-mail, a messenger handle, a passport MRZ,
 * or the words that mark a document (passport, boarding pass, receipt). Every
 * finding names the kind and shows a masked sample; the raw text stays in the
 * OCR result. Pure functions over the OCR output; nothing leaves the device.
 */

export type PiiKind = 'card' | 'iban' | 'mrz' | 'phone' | 'email' | 'handle' | 'document';

export interface PiiFinding {
  kind: PiiKind;
  /** Masked sample for the card («•••• 1234», «+998 9• ••• •• ••»). */
  sample: string;
  /** Indexes of the OCR regions the finding came from (for the blur). */
  regions: number[];
}

// `\b` in JavaScript is ASCII-only, so a Cyrillic word never sits on a "word boundary": the
// edges are spelled out as "no letter or digit on either side" instead, with the `u` flag.
const DOCUMENT_WORDS =
  /(?<![\p{L}\p{N}])(passport|паспорт|pasport|passeport|reisepass|boarding\s*pass|посадочн\p{L}*|driver'?s?\s*licen[cs]e|водительск\p{L}*|удостоверени\p{L}*|guvohnoma|id\s*card|identity\s*card|permis|residence\s*permit|виза|инн|stir|jshshir|пинфл|снилс|полис|receipt|чек|chek|invoice|счёт-фактура|kvitansiya|квитанция)(?![\p{L}\p{N}])/iu;

/** Luhn check for a digit string. */
export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** ISO 13616 mod-97 check. */
export function ibanValid(value: string): boolean {
  const iban = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

const CARD_RE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g;
// «00» only starts a number when no digit precedes it («1000 000 000» is a sum, not a phone),
// and a number never continues past a line break (the next line is the next line).
const PHONE_RE = /(?:\+|(?<!\d)00)\d[\d \t().-]{7,17}\d|\b8[ \t(-]?\d{3}[ \t)-]?\d{3}[ \t-]?\d{2}[ \t-]?\d{2}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const HANDLE_RE = /(?<![\w@])@[A-Za-z0-9_]{4,32}\b/g;
// TD1 lines are 30, TD3 lines 44 characters; OCR adds or drops a couple.
const MRZ_LINE_RE = /^[A-Z0-9<]{26,48}$/;

const maskDigits = (digits: string) => `•••• ${digits.slice(-4)}`;
const maskPhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  const international = /^\s*(\+|00)/.test(value);
  const head = international ? digits.replace(/^00/, '').slice(0, 3) : digits.slice(0, 1);
  const rest = digits.replace(/^00/, '').slice(head.length);
  return `${international ? '+' : ''}${head} ${'•'.repeat(rest.length)}`;
};
const maskEmail = (value: string) => {
  const [user, domain] = value.split('@');
  return `${user.slice(0, 2)}•••@${domain}`;
};

/** Regions whose text contains the sample, for the blur. */
function regionsWith(ocr: OCRResult, fragment: string): number[] {
  const needle = fragment.replace(/\s+/g, '');
  const hits: number[] = [];
  ocr.regions.forEach((region, index) => {
    if (needle && region.text.replace(/\s+/g, '').includes(needle.slice(0, Math.min(needle.length, 6)))) hits.push(index);
  });
  return hits;
}

export function findPii(ocr: OCRResult | null | undefined): PiiFinding[] {
  if (!ocr || ocr.fullText.trim().length < 4) return [];
  const text = ocr.fullText;
  const findings: PiiFinding[] = [];
  const seen = new Set<string>();
  const add = (kind: PiiKind, sample: string, fragment: string) => {
    const key = `${kind}:${sample}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, sample, regions: regionsWith(ocr, fragment) });
  };

  // Bank cards: 13–19 digits with optional separators and a valid Luhn checksum.
  for (const match of text.match(CARD_RE) ?? []) {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits) && !/^(\d)\1+$/.test(digits)) add('card', maskDigits(digits), match);
  }
  // IBAN.
  for (const match of text.match(IBAN_RE) ?? []) {
    if (ibanValid(match)) add('iban', `${match.slice(0, 4)}•••${match.replace(/\s+/g, '').slice(-4)}`, match);
  }
  // MRZ: two or three lines of capitals, digits and «<», with the passport or ID prefix.
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, '').toUpperCase());
  for (const line of lines) {
    if (MRZ_LINE_RE.test(line) && (line.split('<').length - 1) >= 5 && /^(P|I|A|C|V)[A-Z<]/.test(line)) {
      add('mrz', `${line.slice(0, 5)}•••`, line.slice(0, 8));
      break;
    }
  }
  // Phones, e-mails, handles. A card number already found is not also a phone.
  const cardTails = new Set(findings.filter((f) => f.kind === 'card').map((f) => f.sample.slice(-4)));
  for (const match of text.match(PHONE_RE) ?? []) {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) continue;
    if (digits.length >= 13 && cardTails.has(digits.slice(-4))) continue;
    add('phone', maskPhone(match), match);
  }
  for (const match of text.match(EMAIL_RE) ?? []) add('email', maskEmail(match), match);
  for (const match of text.match(HANDLE_RE) ?? []) add('handle', `${match.slice(0, 3)}•••`, match);
  // Document words.
  const word = DOCUMENT_WORDS.exec(text);
  if (word) add('document', word[0], word[0]);

  return findings;
}
