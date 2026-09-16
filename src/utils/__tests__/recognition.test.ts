import { describe, expect, it } from 'vitest';
import { classifyQrPayload } from '../qr';
import { findPii, ibanValid, luhn } from '../pii';
import { matchSceneText, tokensOf } from '../sceneText';
import type { OCRResult } from '../../hooks/useOCR';

describe('classifyQrPayload', () => {
  it('names the kind and masks the secret', () => {
    const wifi = classifyQrPayload('WIFI:T:WPA;S:Home_5G;P:hunter2secret;;');
    expect(wifi).toMatchObject({ kind: 'wifi', sensitive: true });
    expect(wifi.summary).toContain('Home_5G');
    expect(wifi.summary).not.toContain('hunter2secret');
    expect(classifyQrPayload('BEGIN:VCARD\nVERSION:3.0\nFN:Semyon Morgunov\nTEL:+998901234567\nEND:VCARD')).toMatchObject({
      kind: 'contact',
      sensitive: true,
      summary: 'Sem••••••'
    });
    expect(classifyQrPayload('M1MORGUNOV/SEMYON      E1A2B3C TASISTHY 0601 123Y010A0001 100')).toMatchObject({ kind: 'boarding', sensitive: true });
    expect(classifyQrPayload('00020101021126580014BR.GOV.BCB.PIX')).toMatchObject({ kind: 'payment', sensitive: true });
    expect(classifyQrPayload('tel:+998901234567')).toMatchObject({ kind: 'phone', summary: '+998••••••' });
    expect(classifyQrPayload('mailto:s@morgunov.tech')).toMatchObject({ kind: 'email' });
    expect(classifyQrPayload('geo:41.31,69.28')).toMatchObject({ kind: 'geo', sensitive: true });
  });
  it('treats a plain site as a link and a chat invite as an asset', () => {
    expect(classifyQrPayload('https://foundyou.morgunov.tech/?ref=qr')).toEqual({ kind: 'url', summary: 'foundyou.morgunov.tech', sensitive: false });
    expect(classifyQrPayload('https://t.me/+AbCdEf123')).toMatchObject({ kind: 'url', sensitive: true });
    expect(classifyQrPayload('just some words')).toMatchObject({ kind: 'text', sensitive: false });
  });
});

const ocr = (fullText: string, regions: string[] = [fullText]): OCRResult => ({
  fullText,
  regions: regions.map((text, i) => ({ text, x: i * 100, y: 0, width: 90, height: 20, confidence: 90 }))
});

describe('findPii', () => {
  it('validates card numbers with Luhn and IBANs with mod 97', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(ibanValid('GB82 WEST 1234 5698 7654 33')).toBe(false);
  });
  it('finds a card, masks it and points at its region', () => {
    const findings = findPii(ocr('VISA 4111 1111 1111 1111 VALID THRU 09/27', ['VISA', '4111 1111 1111 1111', 'VALID THRU 09/27']));
    expect(findings).toContainEqual({ kind: 'card', sample: '•••• 1111', regions: [1] });
    // A random 16-digit string that fails Luhn is not a card.
    expect(findPii(ocr('order 1234 5678 9012 3456'))).toEqual([]);
  });
  it('finds phones, e-mails, handles, an MRZ and document words', () => {
    const findings = findPii(ocr('Call +998 90 123 45 67 or write s@morgunov.tech, @found_you\nP<UZBMORGUNOV<<SEMYON<<<<<<<<<<<<<<<<<<<<<<<\nPASSPORT'));
    // A card brand is not a travel document.
    expect(findPii(ocr('VISA 4111 1111 1111 1111')).map((f) => f.kind)).toEqual(['card']);
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['phone', 'email', 'handle', 'mrz', 'document']));
    expect(findings.find((f) => f.kind === 'phone')?.sample).toBe('+998 •••••••••');
    expect(findings.find((f) => f.kind === 'email')?.sample).toBe('s@••@morgunov.tech'.replace('s@••@', 's•••@'));
    expect(findings.find((f) => f.kind === 'handle')?.sample).toBe('@fo•••');
    expect(findings.find((f) => f.kind === 'mrz')?.sample).toBe('P<UZB•••');
  });
  it('does not report a card number twice as a phone, and stays quiet on short text', () => {
    const findings = findPii(ocr('4111111111111111'));
    expect(findings.map((f) => f.kind)).toEqual(['card']);
    expect(findPii(ocr('hi'))).toEqual([]);
    expect(findPii(null)).toEqual([]);
  });
});

describe('matchSceneText', () => {
  it('tokenises names without street-type words', () => {
    expect(tokensOf('улица Амира Темура, 12')).toEqual(['амира', 'темура']);
    expect(tokensOf("Mustaqillik ko‘chasi")).toEqual(['mustaqillik']);
  });
  it('confirms the street, the place and a nearby POI from the picture text', () => {
    const matches = matchSceneText({
      text: 'SAFIA bakery\nAmir Temur 12\nopen 24/7',
      road: 'Amir Temur shoh ko‘chasi',
      houseNumber: '12',
      placeName: 'Lotus Hotel',
      poiNames: ['Safia', 'Evos', 'Amir Temur square']
    });
    expect(matches).toEqual([
      { kind: 'road', name: 'Amir Temur shoh ko‘chasi', token: 'Amir' },
      { kind: 'poi', name: 'Safia', token: 'SAFIA' },
      { kind: 'poi', name: 'Amir Temur square', token: 'Amir' },
      { kind: 'house', name: '12', token: '12' }
    ]);
  });
  it('needs a matching street before a house number counts, and ignores stop words', () => {
    expect(matchSceneText({ text: 'дом 12', road: 'улица Пушкина', houseNumber: '12' })).toEqual([]);
    expect(matchSceneText({ text: 'улица магазин кафе', road: 'улица Пушкина', poiNames: ['Кафе Пушкинъ'] })).toEqual([]);
    expect(matchSceneText({ text: '', road: 'улица Пушкина' })).toEqual([]);
  });
});
