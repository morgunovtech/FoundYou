import type { StructuredMetadata } from '../../types/metadata';
import type { PlateCandidate } from '../plates';
import type { QrCode, QrKind } from '../qr';
import type { PiiFinding, PiiKind } from '../pii';
import type { ContentCredentials } from '../contentCredentials';
import type { CredentialsStatus } from '../../hooks/useContentCredentials';
import type { BoundingBox } from '../../types/detection';
import { formatMessage, messages, type MessageKey } from '../../i18n';
import type { OCRResult } from '../../hooks/useOCR';
import type { FilenameAnalysis } from './filenameAnalyzer';
import type { ResolutionAnalysis } from './resolutionAnalyzer';
import type { StrippedAnalysis } from './strippedDetector';
import type { EditingAnalysis } from './editingHistory';
import type { HashResult } from './hashAnalyzer';
import type { TemporalInsight, Severity } from './temporalAnalyzer';
import type { OriginJudgement } from '../originJudge';
import { describeOrigin } from '../originText';

type Lang = 'ru' | 'en' | 'uz';

/* ── types ──────────────────────────────────────────────── */

export type ProfileSectionKind =
  | 'device'
  | 'location'
  | 'time'
  | 'people'
  | 'text'
  | 'ai'
  | 'editing'
  | 'origin'
  | 'content'
  | 'serial'
  | 'hash'
  | 'plates'
  | 'qr'
  | 'documents';

/** Sections rendered together in the «Откуда файл» card. */
export const ORIGIN_KINDS = new Set<ProfileSectionKind>(['device', 'serial', 'origin', 'editing', 'ai', 'content']);

export interface ProfileSection {
  /** Stable id of the fact the section describes; the UI attaches details (map, OCR text) by it. */
  kind: ProfileSectionKind;
  title: string;
  text: string;
  subtext: string | null;
  leakPoints: number;
  severity: Severity;
}

export interface LeakLevel {
  level: 'low' | 'medium' | 'high' | 'critical';
  label: string;
  description: string;
}

/** A fact the file does not carry at all; listed under the leak index instead of as an empty card. */
export type MissingFact = 'date' | 'location' | 'device';

export interface DigitalProfile {
  sections: ProfileSection[];
  leakScore: number;
  leakLevel: LeakLevel;
  serialNumbers: string[];
  /** What the file says nothing about, in a fixed order: date, location, device. */
  missing: MissingFact[];
}

/* ── leak level ─────────────────────────────────────────── */

/**
 * The four bands of the leak index, from the dictionary. The index was computed all along and,
 * since the verdict card went on 2026-09-16, shown nowhere but the raw table; the owner asked
 * for it back on 2026-09-24 as a number with its arithmetic next to it. The descriptions say
 * what the file states, not what the reader should do: the «не публикуйте» and the habits went.
 */
const LEVEL_KEYS: Record<LeakLevel['level'], { label: MessageKey; description: MessageKey }> = {
  critical: { label: 'leakLevelCritical', description: 'leakLevelCriticalDesc' },
  high: { label: 'leakLevelHigh', description: 'leakLevelHighDesc' },
  medium: { label: 'leakLevelMedium', description: 'leakLevelMediumDesc' },
  low: { label: 'leakLevelLow', description: 'leakLevelLowDesc' }
};

/** The bands: 80 and above, 50, 25, below. */
export function leakLevelOf(score: number): LeakLevel['level'] {
  if (score >= 80) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

function getLeakLevel(score: number, lang: Lang): LeakLevel {
  const level = leakLevelOf(score);
  return {
    level,
    label: formatMessage(lang, LEVEL_KEYS[level].label),
    description: formatMessage(lang, LEVEL_KEYS[level].description)
  };
}

/* ── the index after cleanup ────────────────────────────── */

export interface CleanupChoices {
  blurFaces: boolean;
  blurText: boolean;
  blurPlates: boolean;
  blurQr: boolean;
  blurDocuments: boolean;
}

/** Sections whose points rest on metadata alone: every export path rewrites the container and drops them. */
const METADATA_KINDS = new Set<ProfileSectionKind>(['device', 'location', 'time', 'editing', 'origin', 'serial', 'content', 'ai']);

/**
 * What the index would be for the exported copy, from the settings alone: the metadata
 * sections go with the container, the pixel facts go with the blur that covers them. It is
 * the same arithmetic as the index itself, so it can be shown before the button is pressed
 * («73 → 20») and the number becomes a goal of the cleanup rather than only a diagnosis.
 */
export function predictLeakAfter(profile: DigitalProfile, choices: CleanupChoices): number {
  let total = 0;
  for (const section of profile.sections) {
    if (METADATA_KINDS.has(section.kind)) continue;
    if (section.kind === 'people' && choices.blurFaces) continue;
    if (section.kind === 'text' && choices.blurText) continue;
    if (section.kind === 'plates' && choices.blurPlates) continue;
    if (section.kind === 'qr' && choices.blurQr) continue;
    if (section.kind === 'documents' && choices.blurDocuments) continue;
    total += section.leakPoints;
  }
  return Math.min(100, total);
}

/* ── threat scenarios ───────────────────────────────────── */

/* ── new copy lives in one table (no ternaries per CLAUDE.md) ─ */

const TEXTS: Record<string, Record<Lang, string>> = {
  aiTitle: { ru: 'AI-генерация', en: 'AI-generated', uz: 'AI-generatsiya' },
  aiCheckTitle: { ru: 'AI-генерация', en: 'AI check', uz: 'AI-generatsiya' },
  aiNone: { ru: 'Признаков AI-генерации не обнаружено', en: 'No AI generation signs detected', uz: 'AI-generatsiya belgilari topilmadi' },
  aiNoneSigned: { ru: 'Признаков AI нет, происхождение подписано', en: 'No AI signs; provenance is signed', uz: 'AI belgilari yo‘q, kelib chiqishi imzolangan' },
  aiGeneratedSub: { ru: 'Фото создано нейросетью', en: 'Photo created by AI', uz: 'Surat neyrotarmoq tomonidan yaratilgan' },
  aiEditTitle: { ru: 'Генеративная правка', en: 'Generative edit', uz: 'Generativ tahrir' },
  aiEditSub: {
    ru: 'Снимок с камеры, но часть кадра дорисована или затёрта нейросетью — так файл помечают Clean Up на iPhone, Magic Editor на Pixel и Galaxy AI. Что именно изменили, метка не говорит',
    en: 'A camera photo, but part of the frame was repainted or erased by a model — Clean Up on the iPhone, Magic Editor on the Pixel and Galaxy AI mark the file this way. The marker does not say what exactly was changed',
    uz: 'Kamera surati, lekin kadrning bir qismi neyrotarmoq tomonidan qayta chizilgan yoki o‘chirilgan — iPhone’dagi Clean Up, Pixel’dagi Magic Editor va Galaxy AI faylni shunday belgilaydi. Nima o‘zgartirilganini belgi aytmaydi',
  },
  aiCompositeTitle: { ru: 'Склейка кадров', en: 'Multi-shot composite', uz: 'Kadrlar birikmasi' },
  aiCompositeSub: {
    ru: 'Кадр собран из нескольких снимков, сделанных подряд, без генеративной нейросети (Best Take, Add Me и похожие режимы)',
    en: 'The frame is blended from several shots taken moments apart, with no generative model (Best Take, Add Me and similar modes)',
    uz: 'Kadr ketma-ket olingan bir necha suratdan yig‘ilgan, generativ neyrotarmoqsiz (Best Take, Add Me va shunga o‘xshash rejimlar)',
  },
  credSignedBy: { ru: 'Content Credentials, подпись:', en: 'Content Credentials, signed by', uz: 'Content Credentials, imzo:' },
  credValidSuffix: { ru: ' (проверена)', en: ' (verified)', uz: ' (tasdiqlangan)' },
  credInvalidSuffix: { ru: ' (не прошла проверку)', en: ' (failed validation)', uz: ' (tekshiruvdan o‘tmadi)' },
  credChecking: { ru: 'Проверяем Content Credentials…', en: 'Checking Content Credentials…', uz: 'Content Credentials tekshirilmoqda…' },
  credUnavailable: {
    ru: 'Content Credentials есть, но прочитать их не удалось; проверены XMP и метаданные ПО',
    en: 'Content Credentials present but unreadable; XMP and software metadata checked',
    uz: 'Content Credentials bor, lekin o‘qilmadi; XMP va dastur metadatasi tekshirildi',
  },
  credNone: {
    ru: 'Content Credentials нет. Проверены только XMP-теги и метаданные ПО: без подписи AI-снимок неотличим от обычного',
    en: 'No Content Credentials. Only XMP tags and software metadata were checked: without a signature an AI image looks like any other',
    uz: 'Content Credentials yo‘q. Faqat XMP teglari va dastur metadatasi tekshirildi: imzosiz AI-surat oddiy suratdan farq qilmaydi',
  },
  platesTitle: { ru: 'Номера машин', en: 'Licence plates', uz: 'Avtomobil raqamlari' },
  platesText: { ru: 'Возможных номеров: {count}', en: 'Possible plates: {count}', uz: 'Ehtimoliy raqamlar: {count}' },
  platesSub: { ru: 'Найдены по распознанному тексту, проверьте в предпросмотре', en: 'Found via recognised text; check the preview', uz: 'Aniqlangan matn bo‘yicha topildi; ko‘rib chiqing' },
  qrTitle: { ru: 'QR-коды', en: 'QR codes', uz: 'QR-kodlar' },
  qrText: { ru: 'QR-кодов: {count}', en: 'QR codes: {count}', uz: 'QR-kodlar: {count}' },
  qrSub: { ru: 'Любой телефон прочитает их за секунду, даже с экрана', en: 'Any phone reads them in a second, even off a screen', uz: 'Istalgan telefon ularni bir soniyada o‘qiydi, hatto ekrandan ham' },
  documentsTitle: { ru: 'Документы и контакты', en: 'Documents and contacts', uz: 'Hujjatlar va kontaktlar' },
  documentsSub: { ru: 'Прочитано из текста на снимке', en: 'Read from the text in the picture', uz: 'Suratdagi matndan o‘qildi' },
  timeTitle: { ru: 'Когда сделан снимок', en: 'When the photo was taken', uz: 'Surat qachon olingan' },
  personOne: { ru: 'чел.', en: 'person', uz: 'kishi' },
  personMany: { ru: 'чел.', en: 'people', uz: 'kishi' },
  peopleFaces: { ru: '{count} {noun}, лиц различимо: {faces}', en: '{count} {noun}, recognisable faces: {faces}', uz: '{count} {noun}, yuzlar aniq: {faces}' },
  peopleNoFace: { ru: '{count} {noun}, лицо не найдено', en: '{count} {noun}, no face found', uz: '{count} {noun}, yuz topilmadi' },
  hashSub: {
    ru: 'Перцептуальный отпечаток картинки переживает сжатие и лёгкие правки: по нему находят копии; SHA-256 меняется от любого пересохранения',
    en: 'The perceptual fingerprint survives compression and light edits: copies are found by it; SHA-256 changes with any re-save',
    uz: 'Rasmning pertseptual izi siqish va yengil tahrirlardan keyin ham saqlanadi: u orqali nusxalar topiladi; SHA-256 har qanday qayta saqlashda o‘zgaradi',
  },
};

/** Kind labels for the cards, read from the UI dictionaries so the strings live in one place. */
export function qrKindLabel(kind: QrKind, lang: Lang): string {
  return messages[lang][`qrKind_${kind}` as MessageKey];
}
export function piiKindLabel(kind: PiiKind, lang: Lang): string {
  return messages[lang][`piiKind_${kind}` as MessageKey];
}

const PII_HEAVY = new Set<PiiKind>(['card', 'iban', 'mrz']);

/* ── serial number extraction ───────────────────────────── */

const SERIAL_KEYS = [
  'SerialNumber', 'serialNumber',
  'LensSerialNumber', 'lensSerialNumber',
  'InternalSerialNumber', 'internalSerialNumber',
  'BodySerialNumber', 'bodySerialNumber',
  'CameraSerialNumber', 'cameraSerialNumber',
  'ImageUniqueID', 'imageUniqueID',
];

function extractSerialNumbers(exif: Record<string, unknown>): string[] {
  const serials: string[] = [];
  for (const key of SERIAL_KEYS) {
    const value = exif[key];
    if (value != null && String(value).length > 1) {
      serials.push(`${key}: ${String(value)}`);
    }
  }
  return serials;
}

/* ── main generator ─────────────────────────────────────── */

export interface ProfileInput {
  /** Licence-plate candidates from OCR + vehicle boxes (`findPlateCandidates`). */
  plates?: PlateCandidate[];
  /** Decoded QR codes (`findQrCodes`). */
  qrCodes?: QrCode[];
  /** Documents and contacts found in the OCR text (`findPii`). */
  pii?: PiiFinding[];
  /** Parsed Content Credentials (C2PA), when the file carries them. */
  credentials?: ContentCredentials | null;
  credentialsStatus?: CredentialsStatus;
  filename: FilenameAnalysis;
  resolution: ResolutionAnalysis;
  stripped: StrippedAnalysis;
  editing: EditingAnalysis;
  hash: HashResult | null;
  temporal: TemporalInsight[];
  /** The one verdict on where the file has been since the shutter (`judgeOrigin`). */
  origin: OriginJudgement;
  metadata: StructuredMetadata | null;
  detections: BoundingBox[];
  ocrResult: OCRResult | null;
  originalFilename: string;
  lang: Lang;
}

export function generateDigitalProfile(input: ProfileInput): DigitalProfile {
  const { filename, resolution, editing, hash, temporal, origin, metadata, detections, ocrResult, lang } = input;
  /*
   * The dictionary, reached the same way `useT` reaches it. These sections used to carry their
   * own `lang === 'ru' ? … : …` chains, which is how six of their strings ended up with no Uzbek
   * branch at all: the third case quietly served English in the middle of a Russian-or-Uzbek
   * card. A key is checked by `MessageKey`, so the next one cannot go missing silently.
   */
  const t = (key: MessageKey, params?: Record<string, string | number>) => formatMessage(lang, key, params);
  const sections: ProfileSection[] = [];
  const exif = metadata?.groups?.exif ?? {};

  // ── Device ──
  // `||`, not `??`: an unknown filename yields `device: ''`, which must fall through to the resolution guess.
  const device = metadata?.cameraModel || filename.device || resolution.possibleDevices[0] || null;
  if (device) {
    const fromExif = !!metadata?.cameraModel;
    sections.push({
      kind: 'device',
      title: t('profileDeviceTitle'),
      text: device + (metadata?.cameraMake ? ` (${metadata.cameraMake})` : ''),
      subtext: t(fromExif ? 'profileDeviceFromExif' : 'profileDeviceIndirect'),
      leakPoints: fromExif ? 15 : 8,
      severity: fromExif ? 'high' : 'medium',
    });
  }

  // ── GPS ──
  if (metadata?.gps) {
    sections.push({
      kind: 'location',
      title: t('profileLocationTitle'),
      text: `${metadata.gps.lat.toFixed(5)}, ${metadata.gps.lon.toFixed(5)}` + (metadata.gps.altitude != null ? ` (${Math.round(metadata.gps.altitude)}m)` : ''),
      subtext: metadata.gps.accuracy != null ? t('profileLocationAccuracy', { meters: Math.round(metadata.gps.accuracy) }) : null,
      leakPoints: 25,
      severity: 'high',
    });
  }

  // ── Temporal: only when the file names a moment, or claims one it cannot hold (dateFault). A
  // card that says «дата не найдена» is not a fact about the reader; the absence is listed under
  // the index instead (`missing`), where a screenshot's three empty cards used to be.
  if (temporal.length > 0) {
    // Show ALL temporal insights, not just the first
    const allFacts = temporal.map(t => t.fact).join('. ');
    const allInferences = temporal.map(t => t.inference).filter(Boolean).join('. ');
    const maxSeverity = temporal.reduce<Severity>((max, t) => {
      if (t.severity === 'high') return 'high';
      if (t.severity === 'medium' && max !== 'high') return 'medium';
      return max;
    }, 'low');
    sections.push({
      kind: 'time',
      title: TEXTS.timeTitle[lang],
      text: allFacts,
      subtext: allInferences || null,
      leakPoints: maxSeverity === 'high' ? 15 : 8,
      severity: maxSeverity,
    });
  } else if (metadata?.dateFault) {
    sections.push({
      kind: 'time',
      title: TEXTS.timeTitle[lang],
      text: t('profileTimeNone'),
      subtext: t('profileTimeNoneSub'),
      leakPoints: 0,
      severity: 'low',
    });
  }

  // ── People and faces ──
  const personDetections = detections.filter(d => d.label === 'person' && d.score >= 0.5);
  const faceDetections = detections.filter(d => d.label === 'face');
  const peopleCount = Math.max(personDetections.length, faceDetections.length);
  if (peopleCount > 0) {
    const faces = faceDetections.length;
    const noun = (peopleCount === 1 ? TEXTS.personOne : TEXTS.personMany)[lang];
    const text = (faces > 0 ? TEXTS.peopleFaces : TEXTS.peopleNoFace)[lang]
      .replace('{count}', String(peopleCount))
      .replace('{noun}', noun)
      .replace('{faces}', String(faces));
    sections.push({
      kind: 'people',
      title: t('profilePeopleTitle'),
      text,
      subtext: t('profilePeopleSub'),
      leakPoints: 20,
      severity: 'high',
    });
  }

  // ── OCR text ──
  // Two confident fragments at least: a lone token is texture noise more often than a sign.
  if (ocrResult && ocrResult.regions.length >= 2 && ocrResult.fullText.length > 3) {
    sections.push({
      kind: 'text',
      title: t('profileTextTitle'),
      text: t('profileTextFragments', { count: ocrResult.regions.length }),
      subtext: null,
      leakPoints: 10,
      severity: 'medium',
    });
  }

  // ── Licence plates: OCR tokens that read like a plate or sit on a detected vehicle ──
  const plates = input.plates ?? [];
  if (plates.length > 0) {
    const sample = plates.slice(0, 2).map((p) => p.text).join(', ');
    sections.push({
      kind: 'plates',
      title: TEXTS.platesTitle[lang],
      text: `${TEXTS.platesText[lang].replace('{count}', String(plates.length))}: ${sample}`,
      subtext: TEXTS.platesSub[lang],
      leakPoints: 15,
      severity: 'high',
    });
  }

  // ── QR codes: what any phone reads off the picture ──
  const qrCodes = input.qrCodes ?? [];
  if (qrCodes.length > 0) {
    const kinds = Array.from(new Set(qrCodes.map((code) => qrKindLabel(code.kind, lang))));
    const sensitive = qrCodes.some((code) => code.sensitive);
    sections.push({
      kind: 'qr',
      title: TEXTS.qrTitle[lang],
      text: `${TEXTS.qrText[lang].replace('{count}', String(qrCodes.length))}: ${kinds.join(', ')}`,
      subtext: TEXTS.qrSub[lang],
      leakPoints: sensitive ? 20 : 10,
      severity: sensitive ? 'high' : 'medium',
    });
  }

  // ── Documents and contacts in the recognised text ──
  const pii = input.pii ?? [];
  if (pii.length > 0) {
    const kinds = Array.from(new Set(pii.map((finding) => piiKindLabel(finding.kind, lang))));
    const heavy = pii.some((finding) => PII_HEAVY.has(finding.kind));
    sections.push({
      kind: 'documents',
      title: TEXTS.documentsTitle[lang],
      text: kinds.join(', '),
      subtext: TEXTS.documentsSub[lang],
      leakPoints: heavy ? 25 : 10,
      severity: heavy ? 'high' : 'medium',
    });
  }

  // ── AI / provenance (always show). Content Credentials beat metadata guesses. ──
  const cred = input.credentials ?? null;
  const credStatus = input.credentialsStatus ?? 'idle';
  const signer = cred ? (cred.issuer ?? cred.generator ?? 'C2PA') : '';
  if (cred && cred.generative !== 'none') {
    sections.push({
      kind: 'ai',
      title: TEXTS.aiTitle[lang],
      text: cred.generativeAgents.length > 0 ? cred.generativeAgents.join(', ') : cred.generator ?? 'AI',
      subtext: `${TEXTS.credSignedBy[lang]} ${signer}${cred.valid ? TEXTS.credValidSuffix[lang] : TEXTS.credInvalidSuffix[lang]}`,
      leakPoints: 0,
      severity: 'medium',
    });
  } else if (editing.aiScope === 'generated') {
    sections.push({
      kind: 'ai',
      title: TEXTS.aiTitle[lang],
      text: editing.aiTool ?? 'AI',
      subtext: TEXTS.aiGeneratedSub[lang],
      leakPoints: 0,
      severity: 'medium',
    });
  } else if (editing.aiScope === 'edited') {
    // A photograph with a generative patch in it is not «created by AI»: the file says a model
    // touched part of the frame, and saying more than that would accuse a real photo of being fake.
    sections.push({
      kind: 'ai',
      title: TEXTS.aiEditTitle[lang],
      text: editing.aiTool ?? 'AI',
      subtext: TEXTS.aiEditSub[lang],
      leakPoints: 0,
      severity: 'medium',
    });
  } else if (editing.aiScope === 'composite') {
    sections.push({
      kind: 'ai',
      title: TEXTS.aiCompositeTitle[lang],
      text: editing.aiTool ?? TEXTS.aiCompositeTitle[lang],
      subtext: TEXTS.aiCompositeSub[lang],
      leakPoints: 0,
      severity: 'low',
    });
  } else if (cred) {
    sections.push({
      kind: 'ai',
      title: TEXTS.aiCheckTitle[lang],
      text: TEXTS.aiNoneSigned[lang],
      subtext: `${TEXTS.credSignedBy[lang]} ${signer}${cred.valid ? TEXTS.credValidSuffix[lang] : TEXTS.credInvalidSuffix[lang]}`,
      leakPoints: 0,
      severity: 'low',
    });
  } else {
    sections.push({
      kind: 'ai',
      title: TEXTS.aiCheckTitle[lang],
      text: TEXTS.aiNone[lang],
      subtext:
        credStatus === 'checking'
          ? TEXTS.credChecking[lang]
          : credStatus === 'unavailable'
            ? TEXTS.credUnavailable[lang]
            : TEXTS.credNone[lang],
      leakPoints: 0,
      severity: 'low',
    });
  }

  // ── Editing (always show) ──
  if (editing.edited) {
    sections.push({
      kind: 'editing',
      title: t('profileEditingTitle'),
      text: editing.software.join(', '),
      subtext: editing.hints[0] ?? null,
      leakPoints: 5,
      severity: 'low',
    });
  } else {
    sections.push({
      kind: 'editing',
      title: t('profileEditingTitle'),
      text: t('profileEditingNone'),
      subtext: null,
      leakPoints: 0,
      severity: 'low',
    });
  }

  // ── Origin (always show): the one judge's verdict with its grounds. ──
  // The stripped detector, the quantization tables, the Live Photo marker and the size cap used
  // to speak here each on their own and disagreed on the same file; `judgeOrigin` hears them all.
  {
    const described = describeOrigin(origin, t);
    const passedThrough = origin.verdict === 'messenger' || origin.verdict === 'stripped';
    sections.push({
      kind: 'origin',
      title: t('profileOriginTitle'),
      text: described.headline,
      subtext: described.reasons.length > 0 ? described.reasons.join('; ') : null,
      leakPoints: passedThrough ? 5 : 0,
      severity: passedThrough ? 'medium' : 'low',
    });
  }

  // ── Content type ──
  if (resolution.contentHint) {
    sections.push({
      kind: 'content',
      title: t('profileContentTitle'),
      text: resolution.contentHint,
      subtext: null,
      leakPoints: 0,
      severity: 'low',
    });
  }

  // ── Serial numbers ──
  const serials = extractSerialNumbers(exif);
  if (serials.length > 0) {
    sections.push({
      kind: 'serial',
      title: t('profileSerialTitle'),
      text: serials.join('; '),
      subtext: null,
      leakPoints: 10,
      severity: 'medium',
    });
  }

  // ── Hash ──
  if (hash) {
    sections.push({
      kind: 'hash',
      title: t('profileHashTitle'),
      text: hash.phash ? `pHash ${hash.phash} · SHA-256 ${hash.sha256.substring(0, 16)}…` : `SHA-256: ${hash.sha256.substring(0, 16)}...`,
      subtext: TEXTS.hashSub[lang],
      // Every file has a hash, so it measured nothing: it used to add five points to every score.
      leakPoints: 0,
      severity: 'low',
    });
  }

  const leakScore = Math.min(100, sections.reduce((s, sec) => s + sec.leakPoints, 0));

  const missing: MissingFact[] = [];
  if (temporal.length === 0 && !metadata?.dateFault) missing.push('date');
  if (!metadata?.gps) missing.push('location');
  if (!device) missing.push('device');

  return {
    sections,
    leakScore,
    leakLevel: getLeakLevel(leakScore, lang),
    serialNumbers: serials,
    missing,
  };
}
