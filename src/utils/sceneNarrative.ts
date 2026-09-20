import { FACE_LABEL, PERSON_LABEL, type BoundingBox } from '../types/detection';
import { capitalize } from './weather';
import { formatMessage, type MessageKey } from '../i18n';

type Lang = 'ru' | 'en' | 'uz';

interface NarrativeInput {
  detections: BoundingBox[];
  imageWidth: number;
  imageHeight: number;
  lang: Lang;
}

/* ── spatial helpers ─────────────────────────────────────── */

type Zone = 'left' | 'center' | 'right';
type Depth = 'foreground' | 'midground' | 'background';

function horizontalZone(box: BoundingBox, imageWidth: number): Zone {
  const cx = box.x + box.width / 2;
  const ratio = cx / imageWidth;
  if (ratio < 0.33) return 'left';
  if (ratio > 0.67) return 'right';
  return 'center';
}


/* ── COCO label (EfficientDet-Lite2) → human-readable label ─ */

const LABELS_RU: Record<string, string> = {
  person: 'человек', car: 'автомобиль', bus: 'автобус', truck: 'грузовик',
  bicycle: 'велосипед', motorcycle: 'мотоцикл', train: 'поезд',
  dog: 'собака', cat: 'кошка', bird: 'птица', horse: 'лошадь',
  sheep: 'овца', cow: 'корова', elephant: 'слон', bear: 'медведь',
  zebra: 'зебра', giraffe: 'жираф',
  backpack: 'рюкзак', umbrella: 'зонт', handbag: 'сумка', suitcase: 'чемодан',
  bottle: 'бутылка', cup: 'чашка', fork: 'вилка', knife: 'нож', spoon: 'ложка',
  bowl: 'тарелка', banana: 'банан', apple: 'яблоко', sandwich: 'бутерброд',
  orange: 'апельсин', pizza: 'пицца', cake: 'торт',
  chair: 'стул', couch: 'диван', bed: 'кровать', 'dining table': 'стол',
  tv: 'телевизор', laptop: 'ноутбук', mouse: 'мышь', keyboard: 'клавиатура',
  'cell phone': 'телефон', book: 'книга', clock: 'часы', vase: 'ваза',
  'potted plant': 'растение', toilet: 'туалет', sink: 'раковина',
  refrigerator: 'холодильник', oven: 'печь', microwave: 'микроволновка',
  toaster: 'тостер', bench: 'скамейка',
  'traffic light': 'светофор', 'fire hydrant': 'гидрант', 'stop sign': 'знак стоп',
  'parking meter': 'паркомат', skateboard: 'скейтборд', surfboard: 'сёрф',
  'tennis racket': 'ракетка', 'sports ball': 'мяч', kite: 'воздушный змей',
  'baseball bat': 'бита', 'baseball glove': 'перчатка', frisbee: 'фрисби',
  skis: 'лыжи', snowboard: 'сноуборд', 'wine glass': 'бокал',
  'hot dog': 'хот-дог', donut: 'пончик', broccoli: 'брокколи', carrot: 'морковь',
  scissors: 'ножницы', 'teddy bear': 'плюшевый мишка', 'hair drier': 'фен',
  toothbrush: 'зубная щётка', tie: 'галстук', boat: 'лодка', airplane: 'самолёт',
  remote: 'пульт',
};

const LABELS_UZ: Record<string, string> = {
  person: 'odam', car: 'avtomobil', bus: 'avtobus', truck: 'yuk mashinasi',
  bicycle: 'velosiped', motorcycle: 'mototsikl', train: 'poyezd',
  dog: 'it', cat: 'mushuk', bird: 'qush', horse: 'ot',
  sheep: 'qo\'y', cow: 'sigir',
  chair: 'stul', couch: 'divan', bed: 'karavot', tv: 'televizor',
  laptop: 'noutbuk', 'cell phone': 'telefon', book: 'kitob', clock: 'soat',
  bottle: 'shisha', cup: 'piyola', bench: 'skameyka',
  'traffic light': 'svetofor', boat: 'qayiq', airplane: 'samolyot',
  backpack: 'ryukzak', umbrella: 'soyabon', handbag: 'sumka',
};

/** Human label for a COCO class in the UI language (the preview boxes use it too). */
export function localizeLabel(label: string, lang: Lang): string {
  if (lang === 'ru') return LABELS_RU[label] ?? label;
  if (lang === 'uz') return LABELS_UZ[label] ?? label;
  return label;
}

/* ── zone labels ─────────────────────────────────────────── */

/**
 * The three per-language tables these used to be are now dictionary keys, so a missing one is
 * caught by `MessageKey`. What stays as code below is what a dictionary cannot hold: the 80-entry
 * COCO label table, the Russian plural rule, and the sentence order itself — Russian says «место —
 * объект» and English «an object place», which is grammar rather than a string.
 */
const t = (lang: Lang, key: MessageKey, params?: Record<string, string | number>) => formatMessage(lang, key, params);

/**
 * Objects the detector saw with a score between `UNCERTAIN_SCORE` and `CONFIDENT_SCORE` are
 * mentioned as «возможно»: a dog half hidden behind two people usually lands there. People
 * stay at the higher bar because they drive the verdict.
 */
export const CONFIDENT_SCORE = 0.5;
export const UNCERTAIN_SCORE = 0.4;

export function isSceneObject(d: BoundingBox): boolean {
  if (d.label === FACE_LABEL) return false;
  return d.score >= (d.label === PERSON_LABEL ? CONFIDENT_SCORE : UNCERTAIN_SCORE);
}

function zoneLabel(zone: Zone, lang: Lang): string {
  return t(lang, `sceneZone_${zone}` as MessageKey);
}

function depthLabel(depth: Depth, lang: Lang): string {
  return t(lang, `sceneDepth_${depth}` as MessageKey);
}

/* ── size description ────────────────────────────────────── */

type SizeClass = 'large' | 'medium' | 'small';

function sizeClass(box: BoundingBox, imgW: number, imgH: number): SizeClass {
  const area = (box.width * box.height) / ((imgW * imgH) || 1);
  if (area > 0.08) return 'large';
  if (area > 0.02) return 'medium';
  return 'small';
}

function depthFromSize(size: SizeClass): Depth {
  if (size === 'large') return 'foreground';
  if (size === 'medium') return 'midground';
  return 'background';
}

const DEPTH_ORDER: Depth[] = ['foreground', 'midground', 'background'];

/** The further of two readings: a lone distant car is «background» however big it is for its kind. */
function furtherOf(a: Depth, b: Depth): Depth {
  return DEPTH_ORDER[Math.max(DEPTH_ORDER.indexOf(a), DEPTH_ORDER.indexOf(b))];
}

/**
 * Depth against the nearest object of the same kind, which is what tells a back row from a front
 * one. The share of the picture alone cannot: in a five-person group shot the two people standing
 * behind still fill 15 % of the frame each — over the 8 % «large» bar — and the sentence put all
 * five in the foreground. Measured against the nearest person they come out at about half, and
 * half is what standing behind looks like.
 */
function depthAgainstKind(area: number, largestOfKind: number): Depth {
  const ratio = largestOfKind > 0 ? area / largestOfKind : 1;
  if (ratio >= 0.7) return 'foreground';
  if (ratio >= 0.35) return 'midground';
  return 'background';
}

function areaShare(box: BoundingBox, imgW: number, imgH: number): number {
  return (box.width * box.height) / ((imgW * imgH) || 1);
}

/** How far down the frame an object reaches, 0 at the top edge and 1 at the bottom. */
const bottomShare = (box: BoundingBox, imgH: number): number => (box.y + box.height) / (imgH || 1);

/**
 * Depth from where the object stops, which is the one reading that works when there is nothing to
 * compare it with.
 *
 * A photograph taken by a person holding a camera has its near things at the bottom: the hand,
 * the table, the thing being shown. Something that ends in the upper half of the frame is across
 * the room, whatever share of the picture it happens to fill.
 *
 * This exists because the other two readings cannot answer for a lone object. Reported from a
 * phone: a hand holding a box with an armchair behind it, where the chair was the only thing
 * EfficientDet could name (a box of pills is not among COCO's 80 classes) and the sentence read
 * «На переднем плане в центре — стул». The chair fills a tenth of the frame, which clears the 8 %
 * «large» bar, and comparing a lone chair against the largest chair compares it with itself and
 * always scores 1. Both said foreground; neither could have said anything else.
 */
function depthFromBottom(bottom: number): Depth {
  if (bottom >= 0.75) return 'foreground';
  if (bottom >= 0.55) return 'midground';
  return 'background';
}

/* ── grouping ────────────────────────────────────────────── */

interface DetectionItem {
  label: string;
  zone: Zone;
  depth: Depth;
  score: number;
}

interface GroupedEntry {
  label: string;
  count: number;
  zone: Zone;
  depth: Depth;
  /** Every member scored below `CONFIDENT_SCORE`. */
  uncertain: boolean;
}

function groupDetections(items: DetectionItem[]): GroupedEntry[] {
  const map = new Map<string, GroupedEntry>();
  for (const item of items) {
    const key = `${item.label}|${item.zone}|${item.depth}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.uncertain = existing.uncertain && item.score < CONFIDENT_SCORE;
    } else {
      map.set(key, { label: item.label, count: 1, zone: item.zone, depth: item.depth, uncertain: item.score < CONFIDENT_SCORE });
    }
  }
  // Sort: foreground first, then midground, then background
  const depthOrder: Record<Depth, number> = { foreground: 0, midground: 1, background: 2 };
  return Array.from(map.values()).sort((a, b) => depthOrder[a.depth] - depthOrder[b.depth]);
}

/* ── plural helpers ──────────────────────────────────────── */

function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${count} ${few}`;
  return `${count} ${many}`;
}

/* ── object label with count ─────────────────────────────── */

// Russian-specific plural forms for common COCO labels
const RU_PLURALS: Record<string, [string, string, string]> = {
  'человек': ['человек', 'человека', 'человек'],
  'автомобиль': ['автомобиль', 'автомобиля', 'автомобилей'],
  'автобус': ['автобус', 'автобуса', 'автобусов'],
  'грузовик': ['грузовик', 'грузовика', 'грузовиков'],
  'велосипед': ['велосипед', 'велосипеда', 'велосипедов'],
  'мотоцикл': ['мотоцикл', 'мотоцикла', 'мотоциклов'],
  'собака': ['собака', 'собаки', 'собак'],
  'кошка': ['кошка', 'кошки', 'кошек'],
  'птица': ['птица', 'птицы', 'птиц'],
  'лошадь': ['лошадь', 'лошади', 'лошадей'],
  'стул': ['стул', 'стула', 'стульев'],
  'бутылка': ['бутылка', 'бутылки', 'бутылок'],
  'книга': ['книга', 'книги', 'книг'],
};

function countedLabel(label: string, count: number, lang: Lang): string {
  if (count === 1) return localizeLabel(label, lang);
  if (lang === 'ru') {
    const ruLabel = LABELS_RU[label] ?? label;
    const forms = RU_PLURALS[ruLabel];
    if (forms) return pluralRu(count, forms[0], forms[1], forms[2]);
    return `${count} ${ruLabel}`;
  }
  if (lang === 'uz') {
    return `${count} ta ${localizeLabel(label, lang)}`;
  }
  // English: simple plural
  const en = localizeLabel(label, lang);
  if (count === 1) return en;
  if (en === 'person') return `${count} people`;
  return `${count} ${en}${en.endsWith('s') ? '' : 's'}`;
}

const EN_VOWEL = /^[aeiou]/i;

/* ── sentence builders ───────────────────────────────────── */

/**
 * One phrase per group, place first, object last: «На переднем плане справа — человек»,
 * «Справа — собака», «A person in the foreground on the right».
 */
function buildPhrase(entry: GroupedEntry, lang: Lang): string {
  const counted = countedLabel(entry.label, entry.count, lang);
  const depth = depthLabel(entry.depth, lang);
  const zone = zoneLabel(entry.zone, lang);
  const place = [depth, zone].filter(Boolean).join(' ');

  const maybe = entry.uncertain ? t(lang, 'sceneMaybe') : '';
  // The word order is the part a dictionary cannot carry: Russian and Uzbek put the place first.
  if (lang === 'ru' || lang === 'uz') return `${place} — ${maybe}${counted}`;
  const article = entry.count === 1 ? (EN_VOWEL.test(counted) ? 'an ' : 'a ') : '';
  return `${maybe}${article}${counted} ${place}`;
}

/* ── main export ─────────────────────────────────────────── */

export function generateSceneNarrative(input: NarrativeInput): string {
  const { detections, imageWidth: imgW, imageHeight: imgH, lang } = input;

  // Face boxes duplicate the person they belong to and are not scene objects.
  const confident = detections.filter(isSceneObject);
  if (confident.length === 0) {
    return t(lang, 'sceneNoObjects');
  }

  // The biggest box of every kind is the yardstick for the rest of that kind.
  const largestOfKind = new Map<string, number>();
  for (const d of confident) {
    const area = areaShare(d, imgW, imgH);
    largestOfKind.set(d.label, Math.max(largestOfKind.get(d.label) ?? 0, area));
  }

  const items: DetectionItem[] = confident.map((d) => {
    const area = areaShare(d, imgW, imgH);
    return {
      label: d.label,
      zone: horizontalZone(d, imgW),
      // The furthest of the three readings: its share of the frame, its size against the nearest
      // of its own kind, and how far down the frame it reaches. Any one of them saying «further»
      // is enough, because each is blind to a case the others catch.
      depth: furtherOf(
        furtherOf(depthFromSize(sizeClass(d, imgW, imgH)), depthAgainstKind(area, largestOfKind.get(d.label) ?? area)),
        depthFromBottom(bottomShare(d, imgH))
      ),
      score: d.score,
    };
  });

  const groups = groupDetections(items);

  // Build phrases
  const phrases = groups.map((g) => buildPhrase(g, lang));

  // Every phrase is its own sentence.
  const joined = phrases.map((p) => capitalize(p)).join('. ');

  // Add total summary suffix if many objects
  const total = confident.length;
  let suffix = '';
  if (total > 5) {
    suffix = t(lang, 'sceneTotal', { total });
  }

  return `${joined}.${suffix}`;
}
