import { describe, expect, it } from 'vitest';
import { generateSceneNarrative, pluralEn, RU_PLURALS, SCENE_LABELS } from '../sceneNarrative';
import type { BoundingBox } from '../../types/detection';

/*
 * The COCO label table is the documented exception to the dictionary (a `MessageKey` cannot
 * check it), so it needs its own coverage test. Without one the Uzbek table stood at 30 of 80
 * — `localizeLabel` fell back to the English word in the middle of an Uzbek sentence — and the
 * Russian plural table at 13, printing «3 ноутбук».
 */
describe('the COCO label tables', () => {
  const classes = Object.keys(SCENE_LABELS.ru);

  it('cover the 80 classes in every language', () => {
    expect(classes).toHaveLength(80);
    for (const label of classes) {
      expect(SCENE_LABELS.uz[label], `uz: ${label}`).toBeTruthy();
    }
    expect(Object.keys(SCENE_LABELS.uz).sort()).toEqual([...classes].sort());
  });

  it('have three Russian forms for every label', () => {
    for (const label of classes) {
      const ru = SCENE_LABELS.ru[label];
      expect(RU_PLURALS[ru], `ru plural: ${ru}`).toHaveLength(3);
    }
  });

  it('hold no Cyrillic in the Uzbek column', () => {
    for (const value of Object.values(SCENE_LABELS.uz)) expect(value).not.toMatch(/[Ѐ-ӿ]/);
  });
});

describe('pluralEn', () => {
  it('knows the nouns that do not take an s', () => {
    expect(pluralEn('bus')).toBe('buses');
    expect(pluralEn('bench')).toBe('benches');
    expect(pluralEn('sandwich')).toBe('sandwiches');
    expect(pluralEn('toothbrush')).toBe('toothbrushes');
    expect(pluralEn('knife')).toBe('knives');
    expect(pluralEn('sheep')).toBe('sheep');
    expect(pluralEn('mouse')).toBe('mice');
    expect(pluralEn('wine glass')).toBe('wine glasses');
    expect(pluralEn('skis')).toBe('skis');
    expect(pluralEn('scissors')).toBe('scissors');
    expect(pluralEn('person')).toBe('people');
    expect(pluralEn('dog')).toBe('dogs');
    expect(pluralEn('hair drier')).toBe('hair driers');
  });
});

describe('the counted label in a sentence', () => {
  // All in the centre zone at the same depth, so the sentence counts them as one group.
  const box = (label: string, x: number): BoundingBox => ({ label, score: 0.9, x, y: 900, width: 60, height: 60 });
  const objects = (label: string, count: number) => Array.from({ length: count }, (_, i) => box(label, 400 + i * 70));

  it('pluralises in all three languages', () => {
    const size = { imageWidth: 1000, imageHeight: 1000 };
    expect(generateSceneNarrative({ detections: objects('laptop', 3), ...size, lang: 'ru' })).toContain('3 ноутбука');
    expect(generateSceneNarrative({ detections: objects('bus', 2), ...size, lang: 'en' })).toContain('2 buses');
    expect(generateSceneNarrative({ detections: objects('elephant', 2), ...size, lang: 'uz' })).toContain('2 ta fil');
  });
});
