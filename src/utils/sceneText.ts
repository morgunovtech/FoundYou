/*
 * Does the text in the picture agree with the place the GPS points at? A street
 * name on a sign, a shop name that matches a place nearby, a house number next
 * to a matching street: each turns «coordinates say» into «the picture shows».
 * The comparison runs on the device over data the page already has (the OCR
 * text, the reverse-geocode answer, the nearby places); nothing is sent.
 */

export type SceneMatchKind = 'road' | 'place' | 'poi' | 'house';

export interface SceneMatch {
  kind: SceneMatchKind;
  /** The name from the map data that matched. */
  name: string;
  /** The token read from the picture. */
  token: string;
}

export interface SceneTextInput {
  text: string;
  road?: string | null;
  houseNumber?: string | null;
  placeName?: string | null;
  poiNames?: string[];
}

const MIN_TOKEN = 4;
/** Street-type words on both sides carry no information («улица» matches every street). */
const STOP = new Set([
  'улица', 'ул', 'проспект', 'пр', 'переулок', 'пер', 'шоссе', 'площадь', 'бульвар', 'набережная', 'проезд', 'дом', 'корпус', 'строение',
  'street', 'avenue', 'road', 'lane', 'drive', 'boulevard', 'square', 'house',
  'ko‘chasi', 'kochasi', 'kuchasi', 'shoh', 'mahalla', 'mahallasi', 'tumani', 'shahar', 'shahri', 'uy', 'dom',
  'магазин', 'кафе', 'ресторан', 'аптека', 'банк', 'shop', 'store', 'cafe', 'market', 'apteka', 'dokon', 'do‘kon', 'market'
]);

export function normaliseToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[‘’'`ʻ]/g, '')
    .replace(/[^a-zа-я0-9]+/gi, '');
}

export function tokensOf(value: string): string[] {
  return tokenPairs(value).map((pair) => pair.norm);
}

/** Normalised tokens with the word as written, for showing the match the way the picture shows it. */
function tokenPairs(value: string): Array<{ norm: string; raw: string }> {
  return value
    .split(/[\s,.;:()«»"'/\\|-]+/)
    .map((raw) => ({ norm: normaliseToken(raw), raw: raw.trim() }))
    .filter(({ norm }) => norm.length >= MIN_TOKEN && !STOP.has(norm) && !/^\d+$/.test(norm));
}

function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.includes(short);
}

/** Every name whose token appears in the picture text, one match per name. */
export function matchSceneText(input: SceneTextInput): SceneMatch[] {
  const seen = tokenPairs(input.text);
  if (seen.length === 0) return [];
  const matches: SceneMatch[] = [];
  const tryName = (kind: SceneMatchKind, name: string | null | undefined) => {
    if (!name) return false;
    for (const nameToken of tokensOf(name)) {
      const hit = seen.find((pair) => tokenMatches(pair.norm, nameToken));
      if (hit) {
        matches.push({ kind, name, token: hit.raw });
        return true;
      }
    }
    return false;
  };
  const roadMatched = tryName('road', input.road);
  tryName('place', input.placeName);
  for (const poi of input.poiNames ?? []) tryName('poi', poi);
  // A house number only counts next to a matching street: bare digits are everywhere.
  if (roadMatched && input.houseNumber) {
    const number = normaliseToken(input.houseNumber);
    const raw = input.text.split(/[\s,.;:()«»"'/\\|]+/).map(normaliseToken);
    if (number && raw.includes(number)) matches.push({ kind: 'house', name: input.houseNumber, token: input.houseNumber });
  }
  return matches;
}
