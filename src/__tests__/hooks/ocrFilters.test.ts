// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildResult,
  extractRegions,
  isGoodWord,
  isPlausibleToken,
  type RecognizedLineLike,
  type RecognizedPageLike,
  type WordInfo
} from '../../hooks/useOCR';

/* ── synthetic page DSL ──────────────────────────────────────
 * Word boxes are in OCR-canvas pixels. The default canvas is 2000×1500
 * (area 3 000 000 px², so the 0.02 % speck floor is 600 px²); the default
 * box is 120×40 = 4800 px², comfortably real.
 */

const CANVAS = { width: 2000, height: 1500 };

function word(text: string, confidence: number, x0 = 100, y0 = 100, w = 120, h = 40): WordInfo {
  return { text, confidence, bbox: { x0, y0, x1: x0 + w, y1: y0 + h } };
}

/** Line confidence defaults to the mean of its words, as Tesseract reports it. */
function line(words: WordInfo[], confidence?: number): RecognizedLineLike {
  const mean = words.reduce((sum, w) => sum + w.confidence, 0) / Math.max(1, words.length);
  return { confidence: confidence ?? mean, words };
}

function page(lines: RecognizedLineLike[], text = ''): RecognizedPageLike {
  return { blocks: [{ paragraphs: [{ lines }] }], text };
}

/** The exact fragments the iPhone landscape (foliage, no text) produced, at their typical confidences. */
function noisyLines(): RecognizedLineLike[] {
  return [
    line([word('MII', 41, 100, 100), word('NN', 43, 240, 100)]),
    line([word('3', 38, 100, 200), word('p', 40, 240, 200)]),
    line([word('AONE', 52, 100, 300), word('2', 47, 240, 300), word('BGR', 55, 380, 300)]),
    line([word('7', 44, 100, 400), word('wll', 46, 240, 400)]),
    line([word('HAN', 57, 100, 500), word('atte', 59, 240, 500)]),
    line([word('vam', 49, 100, 600), word('SAT', 51, 240, 600)]),
    line([word('RETES', 55, 100, 700)])
  ];
}
const NOISY_RAW_TEXT = 'MII NN\n3 p\nAONE 2 BGR\n7 wll\nHAN atte\nvam SAT\nRETES';

/** A street sign: `ул. Навои 12` over a phone number. */
function signLines(): RecognizedLineLike[] {
  return [
    line([word('ул.', 88, 100, 200, 60), word('Навои', 91, 170, 200, 130, 42), word('12', 86, 310, 200, 40)]),
    line([
      word('+998', 85, 100, 300, 80),
      word('90', 84, 190, 300, 40),
      word('123', 90, 240, 300, 60),
      word('45', 83, 310, 300, 40),
      word('67', 87, 360, 300, 40)
    ])
  ];
}
const SIGN_TEXT = 'ул. Навои 12\n+998 90 123 45 67';

/* ── isPlausibleToken ──────────────────────────────────────── */

describe('isPlausibleToken', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'whitespace'],
    ['---', 'punctuation only'],
    ['…', 'ellipsis'],
    ['p.', 'one letter + punctuation'],
    ['3)', 'one digit + punctuation'],
    ['(a', 'punctuation + one letter'],
    ['%^&a', 'mostly symbols'],
    ['a-b-c-d', 'below 60 % alphanumerics (4/7)'],
    ['Hаn', 'Latin + Cyrillic in one token'],
    ['Taшkent', 'Cyrillic glyph inside a Latin word'],
    ['wlll', 'three identical letters'],
    ['Ннн', 'three identical Cyrillic letters (case-insensitive)'],
    ['bgrt', 'four lowercase letters without a vowel'],
    ['Mgmt', 'mixed-case letters without a vowel']
  ])('rejects %j (%s)', (token) => {
    expect(isPlausibleToken(token)).toBe(false);
  });

  it.each([
    ['TEST', 'plain Latin'],
    ['123', 'digits'],
    ['FOUND', 'uppercase with vowel'],
    ['Ташкент', 'Cyrillic name'],
    ['Chilonzor', 'Latin name'],
    ['+998', 'phone prefix (3/4 alphanumerics)'],
    ['01A123BC', 'plate without spaces'],
    ['ул.', 'abbreviation with a dot (2/3 alphanumerics)'],
    ['Coca-Cola', 'hyphenated brand'],
    ['HTML', 'all-caps abbreviation without a vowel'],
    ['ГИБДД', 'Cyrillic all-caps abbreviation'],
    ['A', 'single capital (plate series letter)'],
    ['3', 'single digit (house number)'],
    ['to‘g‘ri', 'Uzbek Latin with typographic apostrophes'],
    ["Ko'kcha", 'Uzbek Latin with ASCII apostrophe'],
    ['oʻzbek', 'Uzbek Latin with modifier letter turned comma'],
    ['1000', 'repeated digits are not a repeated-letter run'],
    ['www.site.uz', 'www. is the one legitimate triple letter'],
    ['12:30', 'time'],
    ['12.05.2024', 'date']
  ])('accepts %j (%s)', (token) => {
    expect(isPlausibleToken(token)).toBe(true);
  });
});

/* ── isGoodWord ────────────────────────────────────────────── */

describe('isGoodWord', () => {
  const w = (text: string, confidence: number) => word(text, confidence);

  it.each([
    ['MII', 41],
    ['NN', 43],
    ['3', 38],
    ['p', 40],
    ['AONE', 52],
    ['BGR', 55],
    ['wll', 46],
    ['atte', 59],
    ['vam', 49],
    ['RETES', 55],
    // the same fragments at the top of the typical noise range
    ['MII', 60],
    ['NN', 60],
    ['3', 60],
    ['p', 60],
    ['AONE', 60],
    ['BGR', 60],
    ['wll', 60],
    ['atte', 60],
    ['vam', 60]
  ])('rejects screenshot garbage %j at confidence %i', (text, confidence) => {
    expect(isGoodWord(w(text, confidence))).toBe(false);
  });

  it.each([
    ['TEST', 70],
    ['123', 70],
    ['FOUND', 70],
    ['Ташкент', 70],
    ['Chilonzor', 70],
    ['+998', 70],
    ['01A123BC', 70],
    ['ул.', 70],
    ['Coca-Cola', 70],
    ['TEST', 95],
    ['Ташкент', 95]
  ])('keeps real text %j at confidence %i', (text, confidence) => {
    expect(isGoodWord(w(text, confidence))).toBe(true);
  });

  it('length ≤ 2: needs ≥ 82 and all digits or all capitals', () => {
    expect(isGoodWord(w('NN', 81))).toBe(false);
    expect(isGoodWord(w('NN', 82))).toBe(true);
    expect(isGoodWord(w('01', 82))).toBe(true);
    expect(isGoodWord(w('A', 82))).toBe(true);
    expect(isGoodWord(w('3', 82))).toBe(true);
    expect(isGoodWord(w('nn', 99))).toBe(false); // lowercase pair
    expect(isGoodWord(w('на', 99))).toBe(false); // lowercase Cyrillic pair
    expect(isGoodWord(w('A1', 99))).toBe(false); // mixed letter + digit
  });

  it('length 3–4: needs ≥ 68', () => {
    expect(isGoodWord(w('TEST', 67))).toBe(false);
    expect(isGoodWord(w('TEST', 68))).toBe(true);
    expect(isGoodWord(w('123', 67))).toBe(false);
    expect(isGoodWord(w('123', 68))).toBe(true);
  });

  it('length ≥ 5: needs ≥ 58', () => {
    expect(isGoodWord(w('FOUND', 57))).toBe(false);
    expect(isGoodWord(w('FOUND', 58))).toBe(true);
    expect(isGoodWord(w('Ташкент', 57))).toBe(false);
    expect(isGoodWord(w('Ташкент', 58))).toBe(true);
  });

  it('confidence never rescues an implausible token', () => {
    expect(isGoodWord(w('Hаn', 99))).toBe(false);
    expect(isGoodWord(w('wlll', 99))).toBe(false);
    expect(isGoodWord(w('p.', 99))).toBe(false);
    expect(isGoodWord(w('---', 99))).toBe(false);
  });
});

/* ── buildResult ───────────────────────────────────────────── */

describe('buildResult: noisy page', () => {
  it('yields no text for the iPhone foliage screenshot', () => {
    const result = buildResult(page(noisyLines(), NOISY_RAW_TEXT), 1, 1, CANVAS);
    expect(result).toEqual({ fullText: '', regions: [], meanConfidence: 0 });
  });

  it('yields no text even when a single strong word survives (result gate: ≥ 2 words)', () => {
    const lines = [...noisyLines(), line([word('АПТЕКА', 96, 100, 800)])];
    expect(buildResult(page(lines), 1, 1, CANVAS)).toEqual({ fullText: '', regions: [], meanConfidence: 0 });
  });

  it('keeps a two-word sign next to the noise', () => {
    const lines = [...noisyLines(), line([word('АПТЕКА', 96, 100, 800), word('24', 90, 240, 800)])];
    const result = buildResult(page(lines, NOISY_RAW_TEXT), 1, 1, CANVAS);
    expect(result.fullText).toBe('АПТЕКА 24');
    expect(result.regions.map((r) => r.text)).toEqual(['АПТЕКА', '24']);
    expect(result.meanConfidence).toBe(93);
  });
});

describe('buildResult: real sign', () => {
  it('returns the sign text, regions scaled to the original image and the mean confidence', () => {
    // Original 4000×3000 was OCR'd on a 2000×1500 canvas → scale 2 on both axes.
    const result = buildResult(page([...signLines(), ...noisyLines()], SIGN_TEXT), 2, 2, CANVAS);

    expect(result.fullText).toBe(SIGN_TEXT);
    expect(result.regions).toHaveLength(8);
    expect(result.regions[0]).toEqual({ text: 'ул.', x: 200, y: 400, width: 120, height: 80, confidence: 88 });
    expect(result.regions[1]).toEqual({ text: 'Навои', x: 340, y: 400, width: 260, height: 84, confidence: 91 });
    expect(result.regions.map((r) => r.text)).toEqual(['ул.', 'Навои', '12', '+998', '90', '123', '45', '67']);
    expect(result.meanConfidence).toBeCloseTo((88 + 91 + 86 + 85 + 84 + 90 + 83 + 87) / 8, 10);
  });

  it('scales x and y independently', () => {
    const result = buildResult(page(signLines()), 1.5, 3, CANVAS);
    expect(result.regions[0]).toEqual({ text: 'ул.', x: 150, y: 600, width: 90, height: 120, confidence: 88 });
  });

  it('keeps a licence plate split into short tokens as long as one token has ≥ 3 alphanumerics', () => {
    const plate = line([
      word('01', 95, 100, 100, 40),
      word('A', 96, 150, 100, 30),
      word('123', 94, 190, 100, 60),
      word('BC', 93, 260, 100, 50)
    ]);
    expect(buildResult(page([plate]), 1, 1, CANVAS).fullText).toBe('01 A 123 BC');
  });
});

describe('buildResult: line gates', () => {
  it('drops a line below confidence 45 even when its words are strong', () => {
    const weakLine = line([word('ТАШКЕНТ', 92, 100, 500), word('ЦЕНТР', 90, 240, 500)], 44);
    const result = buildResult(page([...signLines(), weakLine]), 1, 1, CANVAS);
    expect(result.fullText).toBe(SIGN_TEXT);
    expect(result.regions.map((r) => r.text)).not.toContain('ТАШКЕНТ');
  });

  it('keeps a line at exactly confidence 45', () => {
    const edge = line([word('ТАШКЕНТ', 92, 100, 500), word('ЦЕНТР', 90, 240, 500)], 45);
    expect(buildResult(page([edge]), 1, 1, CANVAS).fullText).toBe('ТАШКЕНТ ЦЕНТР');
  });

  it('drops a line made only of ≤ 2-character fragments', () => {
    const fragments = line([word('01', 95, 100, 500, 40), word('A', 96, 150, 500, 30), word('BC', 94, 190, 500, 50)]);
    const result = buildResult(page([...signLines(), fragments]), 1, 1, CANVAS);
    expect(result.fullText).toBe(SIGN_TEXT);
  });

  it('drops a line whose only anchor is an abbreviation with < 3 alphanumerics', () => {
    const abbrOnly = line([word('ул.', 95, 100, 500, 60), word('д.', 95, 170, 500, 40)]);
    const result = buildResult(page([...signLines(), abbrOnly]), 1, 1, CANVAS);
    expect(result.fullText).toBe(SIGN_TEXT);
  });
});

describe('buildResult: box sanity', () => {
  const speck = word('FOUND', 95, 100, 100, 120, 4); // 4 px tall
  const tiny = word('TINY', 95, 300, 100, 10, 7); // 70 px² < 600 px² (0.02 % of the canvas)
  const banner = word('TEXT', 95, 0, 200, 1900, 40); // 95 % of the canvas width
  const good = [word('VALID', 95, 100, 300), word('WORDS', 94, 240, 300)];

  it('drops specks, tiny boxes and whole-image boxes when the canvas size is known', () => {
    const result = buildResult(page([line([speck, tiny, banner, ...good])]), 1, 1, CANVAS);
    expect(result.fullText).toBe('VALID WORDS');
    expect(result.regions.map((r) => r.text)).toEqual(['VALID', 'WORDS']);
    expect(result.meanConfidence).toBe(94.5);
  });

  it('applies only the absolute height check when the canvas size is unknown', () => {
    const result = buildResult(page([line([speck, tiny, banner, ...good])]), 1, 1);
    expect(result.fullText).toBe('TINY TEXT VALID WORDS');
  });

  it('rejects degenerate boxes', () => {
    const flat = word('VALID', 95, 100, 100, 120, 0);
    const inverted: WordInfo = { text: 'WORDS', confidence: 95, bbox: { x0: 200, y0: 100, x1: 100, y1: 140 } };
    const result = buildResult(page([line([flat, inverted, ...good])]), 1, 1, CANVAS);
    expect(result.regions).toHaveLength(2);
  });
});

describe('buildResult: fallbacks', () => {
  it('never leaks raw data.text when the block tree is empty', () => {
    expect(buildResult({ blocks: [], text: NOISY_RAW_TEXT }, 1, 1, CANVAS).fullText).toBe('');
    expect(buildResult({ blocks: null, text: NOISY_RAW_TEXT }, 1, 1, CANVAS).fullText).toBe('');
    expect(buildResult({ text: 'REAL TEXT THAT WAS NOT FILTERED' }, 1, 1, CANVAS).fullText).toBe('');
  });

  it('never leaks raw data.text when every block was filtered away', () => {
    const result = buildResult(page(noisyLines(), 'ул. Навои 12'), 1, 1, CANVAS);
    expect(result.fullText).toBe('');
  });

  it('uses the legacy flat words list only through the same filters', () => {
    const real = buildResult({ blocks: null, words: signLines().flatMap((l) => l.words ?? []) }, 2, 2, CANVAS);
    expect(real.fullText).toBe('ул. Навои 12 +998 90 123 45 67');
    expect(real.regions).toHaveLength(8);
    expect(real.regions[0]).toEqual({ text: 'ул.', x: 200, y: 400, width: 120, height: 80, confidence: 88 });

    const noise = buildResult({ blocks: null, words: noisyLines().flatMap((l) => l.words ?? []) }, 1, 1, CANVAS);
    expect(noise).toEqual({ fullText: '', regions: [], meanConfidence: 0 });
  });
});

describe('extractRegions', () => {
  it('reports kept confidences in reading order and drops noisy lines', () => {
    const { regions, cleanLines, confidences } = extractRegions(page([...noisyLines(), ...signLines()]), 1, 1, CANVAS);
    expect(cleanLines).toEqual(['ул. Навои 12', '+998 90 123 45 67']);
    expect(confidences).toEqual([88, 91, 86, 85, 84, 90, 83, 87]);
    expect(regions.map((r) => r.text)).toEqual(['ул.', 'Навои', '12', '+998', '90', '123', '45', '67']);
  });
});
