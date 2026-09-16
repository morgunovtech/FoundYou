import { describe, expect, it } from 'vitest';
import { buildStory, buildVerdict, type StoryInput, type Translate } from '../story';
import type { DigitalProfile, ProfileSection, ProfileSectionKind } from '../heuristics/digitalProfile';
import type { StructuredMetadata } from '../../types/metadata';
import type { BoundingBox } from '../../types/detection';
import { formatCoords } from '../insightsCompact';

/* The fake translator echoes the key and its params, so assertions can target keys, not prose. */
const t: Translate = (key, params) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key;

function section(kind: ProfileSectionKind, leakPoints: number, title: string = kind): ProfileSection {
  return { kind, icon: '', title, text: '', subtext: null, leakPoints, severity: 'low', threatScenario: null } as ProfileSection;
}

function profile(level: DigitalProfile['leakLevel']['level'], sections: ProfileSection[]): DigitalProfile {
  return {
    sections,
    leakScore: 0,
    leakLevel: { level, color: '', label: level, description: `why-${level}` },
    serialNumbers: []
  };
}

function box(label: string, score = 0.9): BoundingBox {
  return { x: 0, y: 0, width: 10, height: 10, score, label } as BoundingBox;
}

function input(overrides: Partial<StoryInput> = {}): StoryInput {
  return {
    t,
    lang: 'ru',
    metadata: null,
    profile: null,
    temporal: [],
    editing: null,
    stripped: null,
    detections: [],
    ocrResult: null,
    place: null,
    accuracyLabel: null,
    weatherLine: null,
    holidayNames: null,
    ...overrides
  };
}

const metadata = {
  shotDateLocal: '2026-06-14T18:30:00',
  cameraMake: 'samsung',
  cameraModel: 'SM-S918B',
  gps: { lat: 41.3111, lon: 69.2797 }
} as unknown as StructuredMetadata;

describe('buildStory', () => {
  it('never emits placeholders: an empty analysis still reads as a short, honest paragraph', () => {
    const story = buildStory(input());
    expect(story.sentences).toEqual(['storyWhenUnknown', 'storyNoPeople', 'storyOriginal']);
    expect(story.conclusion).toBeNull();
  });

  it('tells when, where, on what, in what weather, who and what is in the frame', () => {
    const story = buildStory(
      input({
        metadata,
        place: 'Tashkent',
        weatherLine: '36°C',
        holidayNames: 'Kurban Hayit',
        temporal: [{ fact: 'Weekend', inference: 'Personal time', severity: 'low' }],
        detections: [box('person'), box('face'), box('face')],
        ocrResult: { fullText: 'FOUND  YOU', regions: [{ text: 'FOUND' }, { text: 'YOU' }] } as never,
        stripped: { stripped: true, strippedBy: 'Telegram', confidence: 0.9, evidence: [] }
      })
    );
    const [when, where, device, habits, weather, holiday, people, text, origin] = story.sentences;
    expect(when).toMatch(/^storyWhen\(when=/);
    expect(where).toBe('storyWhere(place=Tashkent)');
    expect(device).toBe('storyDevice(device=samsung SM-S918B)');
    expect(habits).toBe('Weekend.');
    expect(weather).toBe('storyWeather(weather=36°C)');
    expect(holiday).toBe('storyHoliday(holiday=Kurban Hayit)');
    // two faces beat one person box: a close portrait is still two people
    expect(people).toBe('storyPeople(count=2)');
    expect(text).toBe('storyText(sample=FOUND YOU)');
    expect(origin).toBe('storyMessenger(platform=Telegram)');
    expect(story.sentences).toHaveLength(9);
  });

  it('falls back to coordinates when the address is unknown', () => {
    const coords = formatCoords(41.3111, 69.2797);
    const story = buildStory(input({ metadata }));
    expect(story.sentences[1]).toBe(`storyWhereCoords(coords=${coords},accuracy=insightAccuracyUnknown)`);
    const withAccuracy = buildStory(input({ metadata, accuracyLabel: '± 12 м' }));
    expect(withAccuracy.sentences[1]).toBe(`storyWhereCoords(coords=${coords},accuracy=± 12 м)`);
  });

  it('names the editor for edited files and stays silent on origin for stripped files of unknown source', () => {
    const edited = buildStory(
      input({ editing: { edited: true, software: ['Photoshop'], editingLevel: 'professional', hints: [], isAiGenerated: false, aiTool: null } })
    );
    expect(edited.sentences).toContain('storyEdited(software=Photoshop)');
    expect(edited.sentences).not.toContain('storyOriginal');

    const strippedUnknown = buildStory(input({ stripped: { stripped: true, strippedBy: null, confidence: 0.5, evidence: [] } }));
    expect(strippedUnknown.sentences.some((s) => s.startsWith('storyMessenger'))).toBe(false);
    expect(strippedUnknown.sentences).not.toContain('storyOriginal');
  });

  it('ignores OCR noise: a single fragment is not "text on the photo"', () => {
    const one = buildStory(input({ ocrResult: { fullText: 'abcd', regions: [{ text: 'abcd' }] } as never }));
    expect(one.sentences.some((s) => s.startsWith('storyText'))).toBe(false);
    const short = buildStory(input({ ocrResult: { fullText: 'a b', regions: [{ text: 'a' }, { text: 'b' }] } as never }));
    expect(short.sentences.some((s) => s.startsWith('storyText'))).toBe(false);
  });

  it('counts only confident person boxes but every face', () => {
    const story = buildStory(input({ detections: [box('person', 0.3), box('person', 0.4)] }));
    expect(story.sentences).toContain('storyNoPeople');
    const faces = buildStory(input({ detections: [box('face', 0.3)] }));
    expect(faces.sentences).toContain('storyPeople(count=1)');
  });

  describe('conclusion', () => {
    it('joins the leaking pieces into one sentence with a localized "and"', () => {
      const story = buildStory(
        input({ profile: profile('high', [section('location', 30), section('time', 10), section('device', 5), section('content', 0)]) })
      );
      expect(story.conclusion).toBe('storyConclusion(items=storyPieceWhereWhen, storyPieceHabits listAnd storyPieceDevice)');
    });

    it('uses the location-only piece when time does not leak, and skips sections without leak points', () => {
      const story = buildStory(input({ profile: profile('medium', [section('location', 20), section('time', 0), section('hash', 3)]) }));
      expect(story.conclusion).toBe('storyConclusion(items=storyPieceWhere listAnd storyPieceLink)');
    });

    it('mentions people when faces are detected even without a leaking people section', () => {
      const story = buildStory(input({ profile: profile('low', []), detections: [box('face')] }));
      expect(story.conclusion).toBe('storyConclusion(items=storyPiecePeople)');
    });

    it('says "little" when nothing leaks', () => {
      const story = buildStory(input({ profile: profile('low', [section('content', 0)]) }));
      expect(story.conclusion).toBe('storyConclusion(items=storyPieceLittle)');
    });
  });
});

describe('buildVerdict', () => {
  it('maps every leak level to its verdict key and keeps the heuristics explanation as "why"', () => {
    for (const level of ['low', 'medium', 'high', 'critical'] as const) {
      const verdict = buildVerdict(profile(level, []), t);
      expect(verdict.level).toBe(level);
      expect(verdict.title).toBe(`verdict${level[0].toUpperCase()}${level.slice(1)}`);
      expect(verdict.why).toBe(`why-${level}`);
    }
  });

  it('recommends cleanup for anything above low risk', () => {
    expect(buildVerdict(profile('low', []), t).ctaKey).toBe('verdictCtaSoft');
    expect(buildVerdict(profile('medium', []), t).ctaKey).toBe('verdictCta');
    expect(buildVerdict(profile('critical', []), t).ctaKey).toBe('verdictCta');
  });

  it('lists the three heaviest leaks by title, heaviest first, ignoring harmless sections', () => {
    const verdict = buildVerdict(
      profile('high', [
        section('content', 0, 'Content'),
        section('device', 5, 'Device'),
        section('location', 30, 'Location'),
        section('time', 10, 'Time'),
        section('hash', 40, 'Hash')
      ]),
      t
    );
    // The fingerprint never makes the list: it has no card, only a row in the raw data; the device
    // is named by its shared «Откуда файл» card.
    expect(verdict.reasons).toEqual(['Location', 'Time', 'factOriginTitle']);
  });

  it('counts the device, origin, editing and serial sections as one «Откуда файл» reason', () => {
    const verdict = buildVerdict(
      profile('high', [section('device', 15, 'Device'), section('serial', 10, 'Serial'), section('origin', 5, 'Origin'), section('people', 20, 'People')]),
      t
    );
    expect(verdict.reasons).toEqual(['People', 'factOriginTitle']);
  });
});
