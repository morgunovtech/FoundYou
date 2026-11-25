import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../../i18n/messages';
import type { BasicFileInfo, StructuredMetadata } from '../../types/metadata';

/** Which heuristic throws in the current test. */
const broken = vi.hoisted(() => ({ filename: false, time: false }));

vi.mock('../heuristics/filenameAnalyzer', async (original) => {
  const actual = await original<typeof import('../heuristics/filenameAnalyzer')>();
  return {
    ...actual,
    analyzeFilename: (...args: Parameters<typeof actual.analyzeFilename>) => {
      if (broken.filename) throw new Error('filename heuristic failed');
      return actual.analyzeFilename(...args);
    }
  };
});
vi.mock('../heuristics/temporalAnalyzer', async (original) => {
  const actual = await original<typeof import('../heuristics/temporalAnalyzer')>();
  return {
    ...actual,
    analyzeDateTime: (...args: Parameters<typeof actual.analyzeDateTime>) => {
      if (broken.time) throw new Error('temporal heuristic failed');
      return actual.analyzeDateTime(...args);
    }
  };
});

import { buildProfile, type ProfileBuildInput } from '../profileBuild';

const LANGS = ['ru', 'en', 'uz'] as const;

const FILE: BasicFileInfo = {
  file: new File([new Uint8Array(4)], 'IMG_0042.jpg', { type: 'image/jpeg' }),
  dataUrl: 'blob:test/source',
  thumbnailUrl: 'blob:test/thumb',
  width: 4032,
  height: 3024,
  aspectRatio: 4 / 3,
  sizeBytes: 4,
  mimeType: 'image/jpeg'
};

const METADATA: StructuredMetadata = {
  groups: { exif: { Make: 'Apple', Model: 'iPhone 15 Pro', SerialNumber: 'ABC123' }, xmp: {}, iptc: {}, icc: {} },
  cameraMake: 'Apple',
  cameraModel: 'iPhone 15 Pro',
  shotDateLocal: '2024-06-15T02:30:00',
  gps: { lat: 41.311158, lon: 69.279737 },
  completeness: 0.9
};

function input(overrides: Partial<ProfileBuildInput> = {}): ProfileBuildInput {
  return {
    fileInfo: FILE,
    metadata: METADATA,
    hash: { sha256: '0123456789abcdef'.repeat(4), phash: null },
    jpeg: null,
    frame: null,
    credentials: { status: 'none', data: null },
    detections: [],
    ocrResult: null,
    plates: [],
    qrCodes: [],
    pii: [],
    lang: 'en',
    ...overrides
  };
}

const kinds = (build: ReturnType<typeof buildProfile>) => build.profile.sections.map((section) => section.kind);

describe('buildProfile', () => {
  beforeEach(() => {
    broken.filename = false;
    broken.time = false;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the whole profile when nothing throws', () => {
    const build = buildProfile(input());
    expect(build.profile.undetermined).toEqual([]);
    expect(build.proData).not.toBeNull();
    expect(kinds(build)).toEqual(expect.arrayContaining(['device', 'location', 'time', 'ai', 'editing', 'origin', 'serial', 'hash']));
  });

  it('a throw in the origin group leaves its sections out and keeps the facts read straight from the file', () => {
    const whole = buildProfile(input());
    broken.filename = true;
    const build = buildProfile(input());

    expect(build.profile.undetermined).toEqual(['origin']);
    expect(build.proData).toBeNull();
    // No neutral stand-ins: «не редактировался», «признаков AI нет» and a verdict were never established.
    for (const kind of ['ai', 'editing', 'origin', 'content'] as const) expect(kinds(build)).not.toContain(kind);
    // EXIF model, coordinates, time, serial and hash do not depend on the group.
    expect(kinds(build)).toEqual(expect.arrayContaining(['device', 'location', 'time', 'serial', 'hash']));
    // The index never counts more than the whole profile would, and never claims the points of the missing part.
    expect(build.profile.leakScore).toBeLessThanOrEqual(whole.profile.leakScore);
  });

  it('with the origin group failed, a file without an EXIF model is not said to carry no device', () => {
    broken.filename = true;
    const build = buildProfile(input({ metadata: { ...METADATA, cameraModel: undefined } }));
    expect(kinds(build)).not.toContain('device');
    expect(build.profile.missing).not.toContain('device');
  });

  it.each(LANGS)('a throw in the time heuristic keeps the card with «could not be determined» (%s)', (lang) => {
    broken.time = true;
    const build = buildProfile(input({ lang }));

    expect(build.profile.undetermined).toEqual(['time']);
    const time = build.profile.sections.find((section) => section.kind === 'time');
    expect(time?.text).toBe(messages[lang].profileUndetermined);
    expect(time?.leakPoints).toBe(0);
    expect(build.profile.missing).not.toContain('date');
    // The origin card is intact.
    expect(build.proData?.temporal).toEqual([]);
    expect(kinds(build)).toContain('origin');
  });

  it('both parts can fail on one file and the profile is still returned', () => {
    broken.filename = true;
    broken.time = true;
    const build = buildProfile(input());
    expect(build.profile.undetermined).toEqual(['time', 'origin']);
    expect(kinds(build)).toContain('location');
  });
});
