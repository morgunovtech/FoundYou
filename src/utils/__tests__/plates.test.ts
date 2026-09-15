import { describe, expect, it } from 'vitest';
import { findPlateCandidates, looksLikePlate, normalizePlateText } from '../plates';
import type { BoundingBox } from '../../types/detection';
import type { OCRRegion, OCRResult } from '../../hooks/useOCR';

const region = (text: string, box: Partial<OCRRegion> = {}): OCRRegion => ({
  text,
  x: 100,
  y: 100,
  width: 160,
  height: 40,
  confidence: 80,
  ...box
});
const ocr = (...regions: OCRRegion[]): OCRResult => ({ fullText: regions.map((r) => r.text).join(' '), regions });
const car = (box: Partial<BoundingBox> = {}): BoundingBox => ({ x: 0, y: 0, width: 400, height: 300, score: 0.8, label: 'car', ...box });
const image = { width: 1000, height: 800 };

describe('normalizePlateText', () => {
  it('maps Cyrillic look-alikes to Latin and drops separators', () => {
    expect(normalizePlateText('а 123 вс 77')).toBe('A123BC77');
    expect(normalizePlateText('01 A 123 BC')).toBe('01A123BC');
    expect(normalizePlateText('b-mw 1234')).toBe('BMW1234');
  });
});

describe('looksLikePlate', () => {
  it('accepts Russian, Uzbek, UK and German patterns', () => {
    for (const text of ['А123ВС77', '01A123BC', '01 123 ABC', 'AB12 CDE', 'B-MW 1234', 'KA 01 AB 1234'.slice(0, 11)]) {
      expect(looksLikePlate(text), text).toBe(true);
    }
  });

  it('rejects words, numbers, dates, prices and phone numbers', () => {
    for (const text of ['FOUND YOU', '12.06.2026', '1 003', '+998901234567', '24/7', '199 руб', 'abcd1', 'A1']) {
      expect(looksLikePlate(text), text).toBe(false);
    }
  });
});

describe('findPlateCandidates', () => {
  it('returns nothing without OCR', () => {
    expect(findPlateCandidates(null, [car()], image)).toEqual([]);
    expect(findPlateCandidates(ocr(), [car()], image)).toEqual([]);
  });

  it('flags a plate-shaped token that reads like a plate, even without a vehicle box', () => {
    const [plate] = findPlateCandidates(ocr(region('А123ВС77')), [], image);
    expect(plate).toMatchObject({ text: 'A123BC77', source: 'pattern', x: 100, width: 160 });
  });

  it('ignores plate-like text in a tall box (a poster, not a plate)', () => {
    expect(findPlateCandidates(ocr(region('А123ВС77', { width: 60, height: 60 })), [], image)).toEqual([]);
    expect(findPlateCandidates(ocr(region('А123ВС77', { width: 800, height: 200 })), [], image)).toEqual([]);
  });

  it('on a vehicle any short alphanumeric token counts: Tesseract misreads plates', () => {
    const misread = region('0IA1', { x: 150, y: 220, width: 100, height: 30 });
    const [plate] = findPlateCandidates(ocr(misread), [car()], image);
    expect(plate).toMatchObject({ source: 'vehicle', text: '0IA1' });
  });

  it('does not treat a roof sign or a word on the car as a plate', () => {
    const roofSign = region('0IA1', { x: 150, y: 10, width: 100, height: 30 }); // upper 30 % of the box: not where plates live
    const word = region('TOYOTA', { x: 150, y: 220, width: 100, height: 30 });
    expect(findPlateCandidates(ocr(roofSign, word), [car()], image)).toEqual([]);
  });

  it('needs a confident vehicle: a 0.2 "car" is scenery', () => {
    const token = region('0IA1', { x: 150, y: 220, width: 100, height: 30 });
    expect(findPlateCandidates(ocr(token), [car({ score: 0.2 })], image)).toEqual([]);
  });

  it('marks both signals when pattern and vehicle agree', () => {
    const [plate] = findPlateCandidates(ocr(region('01A123BC', { x: 150, y: 220, width: 120, height: 30 })), [car()], image);
    expect(plate.source).toBe('both');
  });
});
