import { FACE_LABEL, PERSON_LABEL, type BoundingBox } from '../types/detection';
import { capitalize } from './weather';

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

const ZONE_RU: Record<Zone, string> = { left: 'слева', center: 'в центре', right: 'справа' };
const ZONE_EN: Record<Zone, string> = { left: 'on the left', center: 'in the center', right: 'on the right' };
const ZONE_UZ: Record<Zone, string> = { left: 'chapda', center: 'markazda', right: "o'ngda" };

const DEPTH_RU: Record<Depth, string> = { foreground: 'на переднем плане', midground: '', background: 'на заднем плане' };
const DEPTH_EN: Record<Depth, string> = { foreground: 'in the foreground', midground: '', background: 'in the background' };
const DEPTH_UZ: Record<Depth, string> = { foreground: 'old planda', midground: '', background: 'orqa planda' };

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

const MAYBE_RU = 'возможно, ';
const MAYBE_EN = 'possibly ';
const MAYBE_UZ = 'ehtimol, ';

function zoneLabel(zone: Zone, lang: Lang): string {
  if (lang === 'ru') return ZONE_RU[zone];
  if (lang === 'uz') return ZONE_UZ[zone];
  return ZONE_EN[zone];
}

function depthLabel(depth: Depth, lang: Lang): string {
  if (lang === 'ru') return DEPTH_RU[depth];
  if (lang === 'uz') return DEPTH_UZ[depth];
  return DEPTH_EN[depth];
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

  if (lang === 'ru') {
    const object = entry.uncertain ? `${MAYBE_RU}${counted}` : counted;
    return `${place} — ${object}`;
  }
  if (lang === 'uz') {
    const object = entry.uncertain ? `${MAYBE_UZ}${counted}` : counted;
    return `${place} — ${object}`;
  }
  const article = entry.count === 1 ? (EN_VOWEL.test(counted) ? 'an ' : 'a ') : '';
  const object = `${entry.uncertain ? MAYBE_EN : ''}${article}${counted}`;
  return `${object} ${place}`;
}

/* ── main export ─────────────────────────────────────────── */

export function generateSceneNarrative(input: NarrativeInput): string {
  const { detections, imageWidth: imgW, imageHeight: imgH, lang } = input;

  // Face boxes duplicate the person they belong to and are not scene objects.
  const confident = detections.filter(isSceneObject);
  if (confident.length === 0) {
    return lang === 'ru'
      ? 'Объекты не обнаружены.'
      : lang === 'uz'
      ? 'Obyektlar aniqlanmadi.'
      : 'No objects detected.';
  }

  const items: DetectionItem[] = confident.map((d) => {
    const size = sizeClass(d, imgW, imgH);
    return {
      label: d.label,
      zone: horizontalZone(d, imgW),
      depth: depthFromSize(size),
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
    if (lang === 'ru') suffix = ` Всего обнаружено ${total} объектов.`;
    else if (lang === 'uz') suffix = ` Jami ${total} ta obyekt aniqlandi.`;
    else suffix = ` ${total} objects detected in total.`;
  }

  return `${joined}.${suffix}`;
}
