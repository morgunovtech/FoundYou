import { describe, expect, it } from 'vitest';
import { generateDigitalProfile, type DigitalProfile, type ProfileInput, type ProfileSectionKind } from '../heuristics/digitalProfile';
import type { FilenameAnalysis } from '../heuristics/filenameAnalyzer';
import type { ResolutionAnalysis } from '../heuristics/resolutionAnalyzer';
import type { StrippedAnalysis } from '../heuristics/strippedDetector';
import type { EditingAnalysis } from '../heuristics/editingHistory';
import type { TemporalInsight } from '../heuristics/temporalAnalyzer';
import type { StructuredMetadata } from '../../types/metadata';
import type { BoundingBox } from '../../types/detection';

type Lang = 'ru' | 'en' | 'uz';
const LANGS: Lang[] = ['ru', 'en', 'uz'];

/* ── section ids: `kind` is the stable identifier of every section ── */
const kinds = (profile: DigitalProfile) => profile.sections.map((section) => section.kind);
const section = (profile: DigitalProfile, kind: ProfileSectionKind) => {
  const found = profile.sections.find((candidate) => candidate.kind === kind);
  if (!found) throw new Error(`section ${kind} missing`);
  return found;
};

/* ── fixtures ─────────────────────────────────────────────── */
const NO_FILENAME: FilenameAnalysis = { platform: null, device: '', confidence: 0, photoIndex: null, estimatedMonths: null, isScreenshot: false };
const IPHONE_FILENAME: FilenameAnalysis = { platform: 'Apple iOS', device: 'iPhone', confidence: 0.9, photoIndex: 1234, estimatedMonths: 8, isScreenshot: false };
const TELEGRAM_FILENAME: FilenameAnalysis = { platform: 'Telegram', device: 'Saved from Telegram', confidence: 0.95, photoIndex: null, estimatedMonths: null, isScreenshot: false };

const NO_RES: ResolutionAnalysis = { possibleDevices: [], contentType: 'unknown', contentHint: '', isScreenshot: false };
const PHOTO_RES: ResolutionAnalysis = { possibleDevices: ['iPhone 12/13/14/15'], contentType: 'standard_photo', contentHint: '4:3 — standard photo', isScreenshot: false };
const SCREENSHOT_RES: ResolutionAnalysis = { possibleDevices: ['FullHD monitor'], contentType: 'video_frame', contentHint: '16:9 — video frame / screenshot', isScreenshot: true };

const NOT_STRIPPED: StrippedAnalysis = { stripped: false, strippedBy: null, confidence: 0, evidence: [] };
const STRIPPED_TELEGRAM: StrippedAnalysis = { stripped: true, strippedBy: 'Telegram', confidence: 0.85, evidence: ['sign-1', 'sign-2'] };
const STRIPPED_UNKNOWN: StrippedAnalysis = { stripped: true, strippedBy: null, confidence: 0.6, evidence: ['sign-1'] };

const NOT_EDITED: EditingAnalysis = { edited: false, software: [], editingLevel: 'none', hints: [], aiScope: 'none', aiTool: null, aiEvidence: null, aiDetails: null };
const PHOTOSHOP: EditingAnalysis = { edited: true, software: ['Adobe Photoshop'], editingLevel: 'professional', hints: ['pro-hint'], aiScope: 'none', aiTool: null, aiEvidence: null, aiDetails: null };
const AI_MIDJOURNEY: EditingAnalysis = { edited: true, software: ['Midjourney'], editingLevel: 'none', hints: [], aiScope: 'generated', aiTool: 'Midjourney', aiEvidence: 'XMP', aiDetails: null };

const TEMPORAL_HIGH: TemporalInsight[] = [
  { fact: 'Night photo (2:00)', inference: 'You were awake late at night', severity: 'medium' },
  { fact: 'Weekend', inference: '', severity: 'high' }
];
const TEMPORAL_LOW: TemporalInsight[] = [{ fact: 'Lunchtime', inference: '', severity: 'low' }];

const HASH = { sha256: '0123456789abcdef'.repeat(4), phash: 'a1b2c3d4e5f60718' };

const box = (label: string, score: number): BoundingBox => ({ x: 0, y: 0, width: 10, height: 10, score, label });
const region = (text: string) => ({ text, x: 0, y: 0, width: 1, height: 1, confidence: 90 });

function metadata(overrides: Partial<StructuredMetadata> = {}): StructuredMetadata {
  return { groups: { exif: {}, xmp: {}, iptc: {}, icc: {} }, completeness: 0, ...overrides };
}

const FULL_META = metadata({
  cameraMake: 'Apple',
  cameraModel: 'iPhone 15 Pro',
  shotDateLocal: '2024-06-15T02:30:00',
  gps: { lat: 41.311158, lon: 69.279737, altitude: 455.2, accuracy: 5 },
  groups: { exif: { Make: 'Apple', SerialNumber: 'ABC123' }, xmp: {}, iptc: {}, icc: {} },
  completeness: 0.9
});

function base(lang: Lang = 'en'): ProfileInput {
  return {
    filename: NO_FILENAME,
    resolution: NO_RES,
    stripped: NOT_STRIPPED,
    editing: NOT_EDITED,
    hash: null,
    temporal: [],
    metadata: null,
    detections: [],
    ocrResult: null,
    originalFilename: 'x.jpg',
    lang
  };
}

function fullInput(lang: Lang = 'en'): ProfileInput {
  return {
    filename: IPHONE_FILENAME,
    resolution: PHOTO_RES,
    stripped: NOT_STRIPPED,
    editing: PHOTOSHOP,
    hash: HASH,
    temporal: TEMPORAL_HIGH,
    metadata: FULL_META,
    detections: [box('person', 0.9), box('person', 0.4), box('car', 0.95)],
    ocrResult: { fullText: 'Amir Temur 12', regions: [region('Amir Temur'), region('12')] },
    originalFilename: 'IMG_1234.HEIC',
    lang
  };
}

function strippedInput(lang: Lang = 'en'): ProfileInput {
  return {
    ...base(lang),
    filename: TELEGRAM_FILENAME,
    resolution: { ...PHOTO_RES, possibleDevices: [] },
    stripped: STRIPPED_TELEGRAM,
    originalFilename: 'photo_2024-06-14_18-30-12.jpg'
  };
}

/* ── tests ────────────────────────────────────────────────── */

describe('generateDigitalProfile: full EXIF + GPS', () => {
  const profile = generateDigitalProfile(fullInput());

  it('emits every section in the documented order', () => {
    expect(kinds(profile)).toEqual([
      'device',
      'location',
      'time',
      'people',
      'text',
      'ai',
      'editing',
      'origin',
      'content',
      'serial',
      'hash'
    ]);
  });

  it('caps the score at 100 and rates it critical', () => {
    const raw = profile.sections.reduce((sum, s) => sum + s.leakPoints, 0);
    expect(raw).toBeGreaterThan(100);
    expect(profile.leakScore).toBe(100);
    expect(profile.leakLevel.level).toBe('critical');
    expect(profile.leakLevel.color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('device from EXIF: 15 points, high, make in brackets', () => {
    const device = section(profile, 'device');
    expect(device).toMatchObject({ text: 'iPhone 15 Pro (Apple)', leakPoints: 15, severity: 'high' });
    expect(device.subtext).toBeTruthy();
  });

  it('location: 25 points, 5-decimal coordinates, altitude and accuracy', () => {
    const location = section(profile, 'location');
    expect(location).toMatchObject({ text: '41.31116, 69.27974 (455m)', leakPoints: 25, severity: 'high' });
    expect(location.subtext).toContain('5');
  });

  it('time: joins every fact, keeps only non-empty inferences, takes the max severity', () => {
    const time = section(profile, 'time');
    expect(time.text).toBe('Night photo (2:00). Weekend');
    expect(time.subtext).toBe('You were awake late at night');
    expect(time).toMatchObject({ leakPoints: 15, severity: 'high' });
  });

  it('people: counts only persons with score ≥ 0.5', () => {
    const people = section(profile, 'people');
    expect(people).toMatchObject({ leakPoints: 20, severity: 'high' });
    expect(people.text).toContain('1');
    expect(people.text).not.toContain('2');
    expect(people.text).not.toContain('3');
  });

  it('text: counts OCR regions', () => {
    const text = section(profile, 'text');
    expect(text).toMatchObject({ leakPoints: 10, severity: 'medium' });
    expect(text.text).toContain('2');
  });

  it('AI check negative: no points, low, no threat', () => {
    expect(section(profile, 'ai')).toMatchObject({ leakPoints: 0, severity: 'low' });
  });

  it('editing: lists software, first hint as subtext, 5 points', () => {
    expect(section(profile, 'editing')).toMatchObject({ text: 'Adobe Photoshop', subtext: 'pro-hint', leakPoints: 5, severity: 'low' });
  });

  it('origin: original file, no points', () => {
    expect(section(profile, 'origin')).toMatchObject({ leakPoints: 0, severity: 'low' });
  });

  it('content type: the resolution hint', () => {
    expect(section(profile, 'content')).toMatchObject({ text: PHOTO_RES.contentHint, leakPoints: 0, severity: 'low' });
  });

  it('serial numbers: 10 points and exposed on the profile', () => {
    expect(section(profile, 'serial')).toMatchObject({ text: 'SerialNumber: ABC123', leakPoints: 10, severity: 'medium' });
    expect(profile.serialNumbers).toEqual(['SerialNumber: ABC123']);
  });

  it('hash: pHash first, then the first 16 hex chars of SHA-256, 5 points', () => {
    expect(section(profile, 'hash')).toMatchObject({ text: 'pHash a1b2c3d4e5f60718 · SHA-256 0123456789abcdef…', leakPoints: 5, severity: 'low' });
  });
});

describe('generateDigitalProfile: stripped messenger file', () => {
  const profile = generateDigitalProfile(strippedInput());

  it('has no location/people/text/serial/hash sections', () => {
    expect(kinds(profile)).toEqual(['device', 'time', 'ai', 'editing', 'origin', 'content']);
  });

  it('scores low', () => {
    expect(profile.leakScore).toBe(13); // device by indirect signs (8) + passed through a messenger (5)
    expect(profile.leakLevel.level).toBe('low');
    expect(profile.serialNumbers).toEqual([]);
  });

  it('device comes from the filename with medium severity', () => {
    expect(section(profile, 'device')).toMatchObject({ text: 'Saved from Telegram', leakPoints: 8, severity: 'medium' });
  });

  it('time section says nothing was found', () => {
    expect(section(profile, 'time')).toMatchObject({ leakPoints: 0, severity: 'low' });
  });

  it('origin names the messenger and cites the first sign', () => {
    const origin = section(profile, 'origin');
    expect(origin.text).toContain('Telegram');
    expect(origin).toMatchObject({ subtext: 'sign-1', leakPoints: 5, severity: 'medium' });
  });

  it('origin without a known platform still reports the strip', () => {
    const anonymous = generateDigitalProfile({ ...base(), stripped: STRIPPED_UNKNOWN });
    const origin = section(anonymous, 'origin');
    expect(origin.text).not.toContain('Telegram');
    expect(origin).toMatchObject({ subtext: 'sign-1', leakPoints: 5 });
  });
});

describe('generateDigitalProfile: leak levels', () => {
  const gpsOnly = metadata({ gps: { lat: 1, lon: 2 } });

  it.each<[string, Partial<ProfileInput>, number, DigitalProfile['leakLevel']['level']]>([
    ['nothing', {}, 0, 'low'],
    ['GPS only', { metadata: gpsOnly }, 25, 'medium'],
    ['GPS + a person', { metadata: gpsOnly, detections: [box('person', 0.8)] }, 45, 'medium'],
    ['GPS + person + EXIF camera', { metadata: metadata({ gps: { lat: 1, lon: 2 }, cameraModel: 'X100V' }), detections: [box('person', 0.8)] }, 60, 'high'],
    [
      'GPS + person + camera + hash + serial + night',
      {
        metadata: metadata({ gps: { lat: 1, lon: 2 }, cameraModel: 'X100V', groups: { exif: { BodySerialNumber: 'S1' }, xmp: {}, iptc: {}, icc: {} } }),
        detections: [box('person', 0.8)],
        hash: HASH,
        temporal: TEMPORAL_HIGH
      },
      90,
      'critical'
    ]
  ])('%s → %d (%s)', (_label, overrides, score, level) => {
    const profile = generateDigitalProfile({ ...base(), ...overrides });
    expect(profile.leakScore).toBe(score);
    expect(profile.leakLevel.level).toBe(level);
  });

  it('the always-on sections are present even for an empty input', () => {
    expect(kinds(generateDigitalProfile(base()))).toEqual(['time', 'ai', 'editing', 'origin']);
  });
});

describe('generateDigitalProfile: individual branches', () => {
  it('device falls back to the filename when EXIF has no model', () => {
    const profile = generateDigitalProfile({ ...base(), filename: IPHONE_FILENAME });
    expect(section(profile, 'device')).toMatchObject({ text: 'iPhone', leakPoints: 8, severity: 'medium' });
  });

  it('device falls back to the resolution guess when neither EXIF nor the filename knows it', () => {
    const profile = generateDigitalProfile({ ...base(), resolution: PHOTO_RES });
    expect(section(profile, 'device')).toMatchObject({ text: 'iPhone 12/13/14/15', leakPoints: 8, severity: 'medium' });
    // a recognised filename still beats the resolution guess
    const named = generateDigitalProfile({ ...base(), filename: IPHONE_FILENAME, resolution: PHOTO_RES });
    expect(section(named, 'device').text).toBe('iPhone');
    // an empty camera model string is not a device either
    const blankModel = generateDigitalProfile({ ...base(), metadata: metadata({ cameraModel: '' }), resolution: PHOTO_RES });
    expect(section(blankModel, 'device').text).toBe('iPhone 12/13/14/15');
    // nothing at all → no section
    expect(kinds(generateDigitalProfile(base()))).not.toContain('device');
  });

  it('GPS without altitude/accuracy has a bare coordinate text and no subtext', () => {
    const profile = generateDigitalProfile({ ...base(), metadata: metadata({ gps: { lat: -33.86882, lon: 151.20929 } }) });
    expect(section(profile, 'location')).toMatchObject({ text: '-33.86882, 151.20929', subtext: null });
  });

  it('temporal medium → 8 points; all-empty inferences → no subtext', () => {
    const medium = generateDigitalProfile({ ...base(), temporal: [{ fact: 'Night', inference: '', severity: 'medium' }] });
    expect(section(medium, 'time')).toMatchObject({ text: 'Night', subtext: null, leakPoints: 8, severity: 'medium' });
    const low = generateDigitalProfile({ ...base(), temporal: TEMPORAL_LOW });
    expect(section(low, 'time')).toMatchObject({ leakPoints: 8, severity: 'low' });
  });

  it('people: low-confidence persons and other labels are ignored', () => {
    const none = generateDigitalProfile({ ...base(), detections: [box('person', 0.49), box('dog', 0.99), box('car', 0.9)] });
    expect(kinds(none)).not.toContain('people');
    const three = generateDigitalProfile({ ...base(), detections: [box('person', 0.5), box('person', 0.7), box('person', 0.99)] });
    expect(section(three, 'people').text).toContain('3');
  });

  it('text: needs at least two confident fragments and more than three characters of OCR output', () => {
    // A lone token is texture noise more often than a sign, however long it is.
    expect(kinds(generateDigitalProfile({ ...base(), ocrResult: { fullText: 'abcd', regions: [region('abcd')] } }))).not.toContain('text');
    expect(kinds(generateDigitalProfile({ ...base(), ocrResult: { fullText: 'a b', regions: [region('a'), region('b')] } }))).not.toContain('text');
    expect(kinds(generateDigitalProfile({ ...base(), ocrResult: { fullText: 'abcd ef', regions: [region('abcd'), region('ef')] } }))).toContain('text');
  });

  it('AI positive: tool name, medium severity, a threat scenario', () => {
    const profile = generateDigitalProfile({ ...base(), editing: AI_MIDJOURNEY });
    const ai = section(profile, 'ai');
    expect(ai).toMatchObject({ text: 'Midjourney', leakPoints: 0, severity: 'medium' });
    // a generated picture without a tool name still gets a label
    const unknownTool = generateDigitalProfile({ ...base(), editing: { ...AI_MIDJOURNEY, aiTool: null, aiDetails: null } });
    expect(section(unknownTool, 'ai').text).toBe('AI');
  });

  it('editing without hints has no subtext', () => {
    const profile = generateDigitalProfile({ ...base(), editing: { ...PHOTOSHOP, software: ['Snapseed', 'VSCO'], hints: [] } });
    expect(section(profile, 'editing')).toMatchObject({ text: 'Snapseed, VSCO', subtext: null, leakPoints: 5 });
  });

  it('content type: the screenshot hint; no section without a hint', () => {
    const shot = generateDigitalProfile({ ...base(), resolution: SCREENSHOT_RES });
    expect(section(shot, 'content').text).toBe(SCREENSHOT_RES.contentHint);
    expect(kinds(generateDigitalProfile(base()))).not.toContain('content');
  });

  it('serial numbers: every known key, skipping null and single-character values', () => {
    const profile = generateDigitalProfile({
      ...base(),
      metadata: metadata({
        groups: {
          exif: { LensSerialNumber: 'L-77', ImageUniqueID: 'u', BodySerialNumber: null, cameraSerialNumber: 42, InternalSerialNumber: undefined },
          xmp: {},
          iptc: {},
          icc: {}
        }
      })
    });
    expect(profile.serialNumbers).toEqual(['LensSerialNumber: L-77', 'cameraSerialNumber: 42']);
    expect(section(profile, 'serial').text).toBe('LensSerialNumber: L-77; cameraSerialNumber: 42');
  });

  it('hash section only when a hash exists', () => {
    expect(kinds(generateDigitalProfile(base()))).not.toContain('hash');
    expect(section(generateDigitalProfile({ ...base(), hash: HASH }), 'hash').text).toMatch(/^pHash [0-9a-f]{16} · SHA-256 [0-9a-f]{16}…$/);
    expect(section(generateDigitalProfile({ ...base(), hash: { ...HASH, phash: null } }), 'hash').text).toMatch(/^SHA-256: [0-9a-f]{16}\.\.\.$/);
  });
});

describe('generateDigitalProfile: languages', () => {
  it.each(LANGS)('%s: every section has a title and text, and the report carries them', (lang) => {
    for (const input of [fullInput(lang), strippedInput(lang), base(lang)]) {
      const profile = generateDigitalProfile(input);
      expect(profile.leakLevel.label.trim().length).toBeGreaterThan(0);
      expect(profile.leakLevel.description.trim().length).toBeGreaterThan(0);
      for (const s of profile.sections) {
        expect(typeof s.title, `${s.kind} title (${lang})`).toBe('string');
        expect(s.title.trim().length, `${s.kind} title (${lang})`).toBeGreaterThan(0);
        expect(typeof s.text, `${s.kind} text (${lang})`).toBe('string');
        expect(s.text.trim().length, `${s.kind} text (${lang})`).toBeGreaterThan(0);
        expect(s.text).not.toContain('undefined');
        if (s.subtext !== null) expect(s.subtext.trim().length).toBeGreaterThan(0);
      }

    }
  });

  it('the level labels differ between languages and the score does not', () => {
    const profiles = LANGS.map((lang) => generateDigitalProfile(fullInput(lang)));
    expect(new Set(profiles.map((p) => p.leakScore)).size).toBe(1);
    expect(new Set(profiles.map((p) => p.leakLevel.level)).size).toBe(1);
    expect(new Set(profiles.map((p) => p.leakLevel.label)).size).toBe(3);
    expect(new Set(profiles.map((p) => section(p, 'location').title)).size).toBe(3);
  });
});
