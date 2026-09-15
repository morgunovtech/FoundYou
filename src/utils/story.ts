import type { DigitalProfile, ProfileSectionKind } from './heuristics/digitalProfile';
import type { TemporalInsight } from './heuristics/temporalAnalyzer';
import type { EditingAnalysis } from './heuristics/editingHistory';
import type { StrippedAnalysis } from './heuristics/strippedDetector';
import type { StructuredMetadata } from '../types/metadata';
import type { BoundingBox } from '../types/detection';
import type { OCRResult } from '../hooks/useOCR';
import type { MessageKey } from '../i18n';
import { formatDetailedDate } from './format';
import { formatCoords } from './insightsCompact';

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface StoryInput {
  t: Translate;
  lang: string;
  metadata: StructuredMetadata | null;
  profile: DigitalProfile | null;
  temporal: TemporalInsight[];
  editing: EditingAnalysis | null;
  stripped: StrippedAnalysis | null;
  detections: BoundingBox[];
  ocrResult: OCRResult | null;
  /** Localised place line from reverse geocoding, when known. */
  place: string | null;
  /** Formatted accuracy ("± 12 м"), when known. */
  accuracyLabel: string | null;
  weatherLine: string | null;
  holidayNames: string | null;
}

export interface Story {
  /** Short paragraph: where, when, on what, in what weather, who and what is in the frame. */
  sentences: string[];
  /** One closing sentence: what all of the above lets a stranger learn. */
  conclusion: string | null;
}

/**
 * Turns the analysis into the paragraph a stranger could write about the owner from this one
 * photo. Every sentence is a translated template; missing signals are simply skipped, so the
 * text never contains placeholders.
 */
export function buildStory(input: StoryInput): Story {
  const { t, lang, metadata, temporal, editing, stripped, detections, ocrResult, place, accuracyLabel, weatherLine, holidayNames } =
    input;
  const sentences: string[] = [];

  // When
  const when = metadata?.shotDateLocal ? formatDetailedDate(metadata.shotDateLocal, lang) : undefined;
  if (when) {
    sentences.push(t('storyWhen', { when }));
  } else {
    sentences.push(t('storyWhenUnknown'));
  }

  // Where
  if (place) {
    sentences.push(t('storyWhere', { place }));
  } else if (metadata?.gps) {
    sentences.push(
      t('storyWhereCoords', {
        coords: formatCoords(metadata.gps.lat, metadata.gps.lon),
        accuracy: accuracyLabel ?? t('insightAccuracyUnknown')
      })
    );
  }

  // Device
  const device = [metadata?.cameraMake, metadata?.cameraModel].filter(Boolean).join(' ').trim();
  if (device) sentences.push(t('storyDevice', { device }));

  // Habits: the temporal heuristics already speak the user's language.
  const inference = temporal.map((item) => item.inference).filter(Boolean).join('. ');
  const facts = temporal.map((item) => item.fact).filter(Boolean).join('. ');
  if (facts) sentences.push(inference ? `${facts}. ${inference}.` : `${facts}.`);

  // Weather and holiday
  if (weatherLine) sentences.push(t('storyWeather', { weather: weatherLine }));
  if (holidayNames) sentences.push(t('storyHoliday', { holiday: holidayNames }));

  // People
  const persons = detections.filter((d) => d.label === 'person' && d.score >= 0.5).length;
  const faces = detections.filter((d) => d.label === 'face').length;
  const people = Math.max(persons, faces);
  sentences.push(people > 0 ? t('storyPeople', { count: people }) : t('storyNoPeople'));

  // Text
  if (ocrResult && ocrResult.regions.length >= 2 && ocrResult.fullText.trim().length > 3) {
    const sample = ocrResult.fullText.replace(/\s+/g, ' ').trim().slice(0, 60);
    sentences.push(t('storyText', { sample }));
  }

  // Origin / editing
  if (stripped?.stripped && stripped.strippedBy) {
    sentences.push(t('storyMessenger', { platform: stripped.strippedBy }));
  } else if (editing?.edited && editing.software.length > 0) {
    sentences.push(t('storyEdited', { software: editing.software.join(', ') }));
  } else if (!stripped?.stripped) {
    sentences.push(t('storyOriginal'));
  }

  return { sentences, conclusion: buildConclusion(input) };
}

function buildConclusion({ t, profile, detections }: StoryInput): string | null {
  if (!profile) return null;
  const kinds = new Set<ProfileSectionKind>(profile.sections.filter((s) => s.leakPoints > 0).map((s) => s.kind));
  const pieces: string[] = [];
  if (kinds.has('location') && kinds.has('time')) pieces.push(t('storyPieceWhereWhen'));
  else if (kinds.has('location')) pieces.push(t('storyPieceWhere'));
  if (kinds.has('time')) pieces.push(t('storyPieceHabits'));
  if (kinds.has('device')) pieces.push(t('storyPieceDevice'));
  if (kinds.has('people') || detections.some((d) => d.label === 'face')) pieces.push(t('storyPiecePeople'));
  if (kinds.has('hash') || kinds.has('serial')) pieces.push(t('storyPieceLink'));
  if (pieces.length === 0) return t('storyConclusion', { items: t('storyPieceLittle') });
  return t('storyConclusion', { items: joinList(pieces, t) });
}

function joinList(items: string[], t: Translate): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${t('listAnd')} ${items[items.length - 1]}`;
}

/* ── verdict ─────────────────────────────────────────────── */

export interface Verdict {
  level: DigitalProfile['leakLevel']['level'];
  title: string;
  why: string;
  /** Titles of the two or three heaviest leaks, for "Главные утечки: …". */
  reasons: string[];
  /** Primary CTA is a strong recommendation; soft CTA when sharing is fine. */
  ctaKey: 'verdictCta' | 'verdictCtaSoft';
}

const VERDICT_KEYS: Record<Verdict['level'], MessageKey> = {
  low: 'verdictLow',
  medium: 'verdictMedium',
  high: 'verdictHigh',
  critical: 'verdictCritical'
};

export function buildVerdict(profile: DigitalProfile, t: Translate): Verdict {
  const level = profile.leakLevel.level;
  const reasons = [...profile.sections]
    .filter((s) => s.leakPoints > 0)
    .sort((a, b) => b.leakPoints - a.leakPoints)
    .slice(0, 3)
    .map((s) => s.title);
  return {
    level,
    title: t(VERDICT_KEYS[level]),
    why: profile.leakLevel.description,
    reasons,
    ctaKey: level === 'low' ? 'verdictCtaSoft' : 'verdictCta'
  };
}
