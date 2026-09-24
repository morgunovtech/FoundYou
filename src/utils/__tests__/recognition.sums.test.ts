import { describe, expect, it } from 'vitest';
import { classifyQrPayload } from '../qr';
import { findPii } from '../pii';
import type { OCRResult } from '../../hooks/useOCR';

const ocr = (fullText: string): OCRResult => ({
  fullText,
  regions: fullText.split('\n').map((text, index) => ({ text, x: 0, y: index * 20, width: 100, height: 18, confidence: 90 }))
});

describe('findPii and figures that are not phone numbers', () => {
  it('does not read a sum with spaces as a phone', () => {
    /*
     * «(?<!\d)00» let «000 000 000» through — nine digits, so a phone — out of «Итого: 1 000 000
     * 000 сум», and the finding's regions became blur boxes on a receipt's total.
     */
    expect(findPii(ocr('Итого: 1 000 000 000 сум')).map((f) => f.kind)).toEqual([]);
    expect(findPii(ocr('12 000 000 000')).map((f) => f.kind)).toEqual([]);
    expect(findPii(ocr('Сумма 000 123 456 789')).map((f) => f.kind)).toEqual([]);
  });

  it('still finds real numbers in both spellings', () => {
    expect(findPii(ocr('Call +998 90 123 45 67')).map((f) => f.kind)).toContain('phone');
    expect(findPii(ocr('Tel 0049 30 1234567')).map((f) => f.kind)).toContain('phone');
    expect(findPii(ocr('8 (495) 123-45-67')).map((f) => f.kind)).toContain('phone');
  });

  it('reads STIR only as a taxpayer number, not as a cooking verb', () => {
    expect(findPii(ocr('STIR: 123456789')).map((f) => f.kind)).toContain('document');
    expect(findPii(ocr('Chicken stir fry with rice')).map((f) => f.kind)).not.toContain('document');
  });
});

describe('classifyQrPayload reads the first field after the type prefix', () => {
  it('finds the SSID when it comes first, as Android writes it', () => {
    const wifi = classifyQrPayload('WIFI:S:HomeNet;T:WPA;P:secret;;');
    expect(wifi.kind).toBe('wifi');
    expect(wifi.summary).toContain('HomeNet');
    expect(wifi.summary).not.toContain('secret');
  });

  it('finds a MECARD name', () => {
    const card = classifyQrPayload('MECARD:N:Doe,John;TEL:+998901234567;;');
    expect(card.kind).toBe('contact');
    expect(card.summary.startsWith('Doe')).toBe(true);
    expect(card.summary).not.toContain('John');
  });
});
