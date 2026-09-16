import { describe, it, expect } from 'vitest';
import { generateSceneNarrative } from '../sceneNarrative';
import type { BoundingBox } from '../../types/detection';

const IMG_W = 1000;
const IMG_H = 800;

function box(label: string, x: number, y: number, w: number, h: number, score = 0.9): BoundingBox {
  return { label, x, y, width: w, height: h, score };
}

describe('generateSceneNarrative', () => {
  it('returns empty message when no detections', () => {
    const result = generateSceneNarrative({ detections: [], imageWidth: IMG_W, imageHeight: IMG_H, lang: 'ru' });
    expect(result).toBe('Объекты не обнаружены.');
  });

  it('filters low-confidence detections', () => {
    const dets = [box('person', 400, 300, 100, 200, 0.3)];
    const result = generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'en' });
    expect(result).toBe('No objects detected.');
  });

  it('describes a single person in center', () => {
    const dets = [box('person', 350, 100, 300, 500)]; // large, center
    const result = generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'en' });
    expect(result).toContain('person');
    expect(result).toContain('center');
  });

  it('describes objects on the left and right', () => {
    const dets = [
      box('car', 50, 400, 150, 100),   // left, small
      box('dog', 800, 500, 80, 60),     // right, small
    ];
    const result = generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'en' });
    expect(result).toContain('left');
    expect(result).toContain('right');
  });

  it('groups multiple same-label detections', () => {
    const dets = [
      box('person', 100, 100, 50, 80),
      box('person', 200, 100, 50, 80),
      box('person', 300, 100, 50, 80),
    ];
    const result = generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'en' });
    expect(result).toContain('3 people');
  });

  it('mentions objects between 0.4 and 0.5 as possible, people not', () => {
    const dets = [box('person', 350, 100, 300, 500), box('dog', 700, 500, 200, 150, 0.45), box('person', 50, 500, 100, 200, 0.45)];
    const ru = generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'ru' });
    expect(ru).toBe('На переднем плане в центре — человек. Справа — возможно, собака.');
    const en = generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'en' });
    expect(en).toBe('A person in the foreground in the center. Possibly a dog on the right.');
  });

  it('puts the place first and the object last', () => {
    const dets = [box('person', 700, 100, 300, 500), box('car', 50, 600, 80, 50)];
    expect(generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'ru' })).toBe(
      'На переднем плане справа — человек. На заднем плане слева — автомобиль.'
    );
  });

  it('produces Russian narrative with localized labels', () => {
    const dets = [box('car', 400, 300, 350, 350)]; // large, center
    const result = generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'ru' });
    expect(result).toContain('автомобиль');
    expect(result).toContain('в центре');
  });

  it('produces Uzbek narrative', () => {
    const dets = [box('dog', 100, 400, 50, 40)]; // small, left
    const result = generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'uz' });
    expect(result).toContain('it');
    expect(result).toContain('chapda');
  });

  it('adds total count suffix for many objects', () => {
    const dets = Array.from({ length: 7 }, (_, i) =>
      box('person', 100 + i * 80, 200, 40, 60)
    );
    const result = generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'en' });
    expect(result).toContain('7 objects detected in total');
  });

  it('distinguishes foreground and background by size', () => {
    const dets = [
      box('person', 300, 100, 400, 600), // large → foreground
      box('car', 50, 600, 80, 50),       // small → background
    ];
    const result = generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'en' });
    expect(result).toContain('foreground');
    expect(result).toContain('background');
  });
});

describe('generateSceneNarrative — face boxes', () => {
  it('ignores face detections: they duplicate the person, not a scene object', () => {
    const dets = [box('person', 350, 100, 300, 500), box('face', 450, 120, 100, 110)];
    const result = generateSceneNarrative({ detections: dets, imageWidth: IMG_W, imageHeight: IMG_H, lang: 'en' });
    expect(result).toContain('person');
    expect(result).not.toContain('face');
    expect(result).not.toContain('2 ');
  });

  it('reports no objects when only faces were detected', () => {
    const result = generateSceneNarrative({
      detections: [box('face', 450, 120, 100, 110)],
      imageWidth: IMG_W,
      imageHeight: IMG_H,
      lang: 'ru'
    });
    expect(result).toBe('Объекты не обнаружены.');
  });
});
