/*
 * Samsung «SEF» trailer: data Samsung phones append after the JPEG end-of-image
 * marker. The gallery uses it, EXIF viewers ignore it, and it leaves with the
 * file: the SIM operator's country (`MCC_Data`), a UTC timestamp of the shot
 * (`Image_UTC_Data`), the Motion Photo video (`MotionPhoto_Data`), dual-camera
 * and scene blocks.
 *
 * Layout (from the tail of the file):
 *   … [block]* [SEFH directory] [uint32 LE directory length] "SEFT"
 * Directory: "SEFH", uint32 LE version, uint32 LE count, then `count` entries of
 * 12 bytes: uint32 LE type, uint32 LE offset (backwards from the directory start),
 * uint32 LE length. Each block starts with an 8-byte header (type, name length)
 * followed by the ASCII name and the payload.
 *
 * The parser is deliberately tolerant: entries are validated against the file
 * size, block names are read from the block itself, and known names are also
 * scanned for in the tail as a fallback, because vendor layouts drift between
 * firmware generations. The canvas export never carries any of this over; the
 * result is shown so the owner knows what the original file gives away.
 */

export interface SamsungTrailerBlock {
  name: string;
  size: number;
}

export interface SamsungTrailer {
  /** Bytes after the JPEG EOI marker that belong to the trailer (directory plus blocks). */
  bytes: number;
  blocks: SamsungTrailerBlock[];
  /** Mobile Country Code of the SIM operator, three digits, when `MCC_Data` is present. */
  mcc: string | null;
  /** UTC instant of the shot from `Image_UTC_Data` (ms since the epoch), when present. */
  imageUtc: string | null;
  /** The Motion Photo video payload in bytes, when `MotionPhoto_Data` is present. */
  motionPhotoBytes: number | null;
}

const SEFT = 'SEFT';
const SEFH = 'SEFH';
/** Enough for the directory and every small block; the Motion Photo video is measured, not read. */
export const SAMSUNG_TAIL_BYTES = 256 * 1024;

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + length)));

const u32 = (bytes: Uint8Array, offset: number) =>
  offset + 4 <= bytes.length
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    : null;

const NAME_RE = /^[A-Za-z0-9_]{4,64}/;

/** The ASCII block name written after the 8-byte block header. */
function blockName(bytes: Uint8Array, start: number, length: number): string | null {
  const nameLength = u32(bytes, start + 4);
  if (nameLength != null && nameLength > 0 && nameLength <= 64 && start + 8 + nameLength <= bytes.length) {
    const name = ascii(bytes, start + 8, nameLength);
    if (NAME_RE.test(name) && name.length === nameLength) return name;
  }
  // Header layout unknown: take the first ASCII run inside the block head.
  const head = ascii(bytes, start, Math.min(length, 80));
  const match = /[A-Za-z][A-Za-z0-9_]{3,63}/.exec(head);
  return match ? match[0] : null;
}

function payload(bytes: Uint8Array, start: number, length: number, name: string): Uint8Array {
  const nameLength = u32(bytes, start + 4);
  const headerEnd =
    nameLength != null && nameLength === name.length
      ? start + 8 + nameLength
      : start + head(bytes, start, length).indexOf(name) + name.length;
  return bytes.subarray(headerEnd, start + length);
}

const head = (bytes: Uint8Array, start: number, length: number) => ascii(bytes, start, Math.min(length, 80));

const digits = (value: Uint8Array, max: number) => {
  const text = String.fromCharCode(...value.subarray(0, Math.min(value.length, max)));
  const match = /\d+/.exec(text);
  return match ? match[0] : null;
};

/**
 * Parse the trailer from the tail of a file. `tail` must be the last `fileSize - tailStart`
 * bytes of the file; `fileSize` lets offsets that point before the tail be validated and the
 * Motion Photo video be measured without reading it.
 */
export function parseSamsungTrailer(tail: Uint8Array, fileSize = tail.length): SamsungTrailer | null {
  const n = tail.length;
  if (n < 16 || ascii(tail, n - 4, 4) !== SEFT) return null;
  const dirLength = u32(tail, n - 8);
  if (dirLength == null || dirLength < 12 || dirLength > n - 8) return null;
  const dirStart = n - 8 - dirLength;
  if (ascii(tail, dirStart, 4) !== SEFH) return null;
  const count = u32(tail, dirStart + 8) ?? 0;
  const tailStart = fileSize - n;

  const blocks: SamsungTrailerBlock[] = [];
  let mcc: string | null = null;
  let imageUtc: string | null = null;
  let motionPhotoBytes: number | null = null;
  let earliest = tailStart + dirStart;

  for (let i = 0; i < count && i < 64; i++) {
    const entry = dirStart + 12 + i * 12;
    if (entry + 12 > dirStart + dirLength) break;
    const offset = u32(tail, entry + 4);
    const length = u32(tail, entry + 8);
    if (offset == null || length == null || length < 8 || offset < length) continue;
    const absoluteStart = tailStart + dirStart - offset;
    if (absoluteStart < 0) continue;
    earliest = Math.min(earliest, absoluteStart);
    const start = absoluteStart - tailStart;
    if (start < 0) {
      // The block begins before the tail we hold: it is the video (or another large payload).
      blocks.push({ name: 'MotionPhoto_Data', size: length });
      motionPhotoBytes = length;
      continue;
    }
    const name = blockName(tail, start, length);
    if (!name) continue;
    blocks.push({ name, size: length });
    const value = payload(tail, start, length, name);
    if (name === 'MCC_Data') {
      const found = digits(value, 16);
      if (found && found.length >= 3) mcc = found.slice(0, 3);
    } else if (name === 'Image_UTC_Data') {
      const found = digits(value, 24);
      if (found && found.length >= 12 && found.length <= 14) imageUtc = new Date(Number(found)).toISOString();
    } else if (name === 'MotionPhoto_Data') {
      motionPhotoBytes = value.length;
    }
  }

  // Fallback for layouts the entry parser did not recognise: the names are plain ASCII.
  if (blocks.length === 0) {
    const text = ascii(tail, 0, n);
    for (const name of ['MCC_Data', 'Image_UTC_Data', 'MotionPhoto_Data']) {
      const at = text.indexOf(name);
      if (at === -1) continue;
      blocks.push({ name, size: 0 });
      const after = tail.subarray(at + name.length);
      if (name === 'MCC_Data') mcc = digits(after, 16)?.slice(0, 3) ?? null;
      if (name === 'Image_UTC_Data') {
        const found = digits(after, 24);
        if (found && found.length >= 12 && found.length <= 14) imageUtc = new Date(Number(found)).toISOString();
      }
    }
    if (blocks.length === 0) return null;
  }

  return { bytes: fileSize - earliest, blocks, mcc, imageUtc, motionPhotoBytes };
}

/** Reads the tail of a file and parses the trailer; null for files without one. */
export async function readSamsungTrailer(file: Blob): Promise<SamsungTrailer | null> {
  if (file.size < 16) return null;
  const start = Math.max(0, file.size - SAMSUNG_TAIL_BYTES);
  const tail = new Uint8Array(await file.slice(start).arrayBuffer());
  return parseSamsungTrailer(tail, file.size);
}

/* ── Mobile Country Codes → ISO 3166-1 alpha-2 (ITU-T E.212) ─────────────────── */

const MCC_COUNTRY: Record<string, string> = {
  '202': 'GR',
  '204': 'NL',
  '206': 'BE',
  '208': 'FR',
  '212': 'MC',
  '213': 'AD',
  '214': 'ES',
  '216': 'HU',
  '218': 'BA',
  '219': 'HR',
  '220': 'RS',
  '221': 'XK',
  '222': 'IT',
  '226': 'RO',
  '228': 'CH',
  '230': 'CZ',
  '231': 'SK',
  '232': 'AT',
  '234': 'GB',
  '235': 'GB',
  '238': 'DK',
  '240': 'SE',
  '242': 'NO',
  '244': 'FI',
  '246': 'LT',
  '247': 'LV',
  '248': 'EE',
  '250': 'RU',
  '255': 'UA',
  '257': 'BY',
  '259': 'MD',
  '260': 'PL',
  '262': 'DE',
  '266': 'GI',
  '268': 'PT',
  '270': 'LU',
  '272': 'IE',
  '274': 'IS',
  '276': 'AL',
  '278': 'MT',
  '280': 'CY',
  '282': 'GE',
  '283': 'AM',
  '284': 'BG',
  '286': 'TR',
  '288': 'FO',
  '290': 'GL',
  '293': 'SI',
  '294': 'MK',
  '295': 'LI',
  '297': 'ME',
  '302': 'CA',
  '310': 'US',
  '311': 'US',
  '312': 'US',
  '313': 'US',
  '314': 'US',
  '315': 'US',
  '316': 'US',
  '334': 'MX',
  '338': 'JM',
  '340': 'GP',
  '342': 'BB',
  '344': 'AG',
  '346': 'KY',
  '348': 'VG',
  '350': 'BM',
  '352': 'GD',
  '354': 'MS',
  '356': 'KN',
  '358': 'LC',
  '360': 'VC',
  '362': 'CW',
  '363': 'AW',
  '364': 'BS',
  '365': 'AI',
  '366': 'DM',
  '368': 'CU',
  '370': 'DO',
  '372': 'HT',
  '374': 'TT',
  '376': 'TC',
  '400': 'AZ',
  '401': 'KZ',
  '402': 'BT',
  '404': 'IN',
  '405': 'IN',
  '406': 'IN',
  '410': 'PK',
  '412': 'AF',
  '413': 'LK',
  '414': 'MM',
  '415': 'LB',
  '416': 'JO',
  '417': 'SY',
  '418': 'IQ',
  '419': 'KW',
  '420': 'SA',
  '421': 'YE',
  '422': 'OM',
  '424': 'AE',
  '425': 'IL',
  '426': 'BH',
  '427': 'QA',
  '428': 'MN',
  '429': 'NP',
  '430': 'AE',
  '431': 'AE',
  '432': 'IR',
  '434': 'UZ',
  '436': 'TJ',
  '437': 'KG',
  '438': 'TM',
  '440': 'JP',
  '441': 'JP',
  '450': 'KR',
  '452': 'VN',
  '454': 'HK',
  '455': 'MO',
  '456': 'KH',
  '457': 'LA',
  '460': 'CN',
  '461': 'CN',
  '466': 'TW',
  '467': 'KP',
  '470': 'BD',
  '472': 'MV',
  '502': 'MY',
  '505': 'AU',
  '510': 'ID',
  '514': 'TL',
  '515': 'PH',
  '520': 'TH',
  '525': 'SG',
  '528': 'BN',
  '530': 'NZ',
  '536': 'NR',
  '537': 'PG',
  '539': 'TO',
  '540': 'SB',
  '541': 'VU',
  '542': 'FJ',
  '544': 'AS',
  '545': 'KI',
  '546': 'NC',
  '547': 'PF',
  '548': 'CK',
  '549': 'WS',
  '550': 'FM',
  '551': 'MH',
  '552': 'PW',
  '553': 'TV',
  '554': 'TK',
  '555': 'NU',
  '602': 'EG',
  '603': 'DZ',
  '604': 'MA',
  '605': 'TN',
  '606': 'LY',
  '607': 'GM',
  '608': 'SN',
  '609': 'MR',
  '610': 'ML',
  '611': 'GN',
  '612': 'CI',
  '613': 'BF',
  '614': 'NE',
  '615': 'TG',
  '616': 'BJ',
  '617': 'MU',
  '618': 'LR',
  '619': 'SL',
  '620': 'GH',
  '621': 'NG',
  '622': 'TD',
  '623': 'CF',
  '624': 'CM',
  '625': 'CV',
  '626': 'ST',
  '627': 'GQ',
  '628': 'GA',
  '629': 'CG',
  '630': 'CD',
  '631': 'AO',
  '632': 'GW',
  '633': 'SC',
  '634': 'SD',
  '635': 'RW',
  '636': 'ET',
  '637': 'SO',
  '638': 'DJ',
  '639': 'KE',
  '640': 'TZ',
  '641': 'UG',
  '642': 'BI',
  '643': 'MZ',
  '645': 'ZM',
  '646': 'MG',
  '647': 'RE',
  '648': 'ZW',
  '649': 'NA',
  '650': 'MW',
  '651': 'LS',
  '652': 'BW',
  '653': 'SZ',
  '654': 'KM',
  '655': 'ZA',
  '657': 'ER',
  '659': 'SS',
  '702': 'BZ',
  '704': 'GT',
  '706': 'SV',
  '708': 'HN',
  '710': 'NI',
  '712': 'CR',
  '714': 'PA',
  '716': 'PE',
  '722': 'AR',
  '724': 'BR',
  '730': 'CL',
  '732': 'CO',
  '734': 'VE',
  '736': 'BO',
  '738': 'GY',
  '740': 'EC',
  '744': 'PY',
  '746': 'SR',
  '748': 'UY',
  '750': 'FK'
};

/** ISO 3166-1 alpha-2 for a Mobile Country Code; null for test, satellite and unknown codes. */
export function mccCountry(mcc: string | null | undefined): string | null {
  if (!mcc) return null;
  return MCC_COUNTRY[mcc] ?? null;
}
