import type { StructuredMetadata } from '../../types/metadata';
import type { PlateCandidate } from '../plates';
import type { QrCode, QrKind } from '../qr';
import type { PiiFinding, PiiKind } from '../pii';
import type { ContentCredentials } from '../contentCredentials';
import type { CredentialsStatus } from '../../hooks/useContentCredentials';
import type { BoundingBox } from '../../types/detection';
import { messages, type MessageKey } from '../../i18n';
import type { OCRResult } from '../../hooks/useOCR';
import type { FilenameAnalysis } from './filenameAnalyzer';
import type { ResolutionAnalysis } from './resolutionAnalyzer';
import type { StrippedAnalysis } from './strippedDetector';
import type { EditingAnalysis } from './editingHistory';
import type { HashResult } from './hashAnalyzer';
import type { TemporalInsight, Severity } from './temporalAnalyzer';

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
  threatScenario: string | null;
}

export interface LeakLevel {
  level: 'low' | 'medium' | 'high' | 'critical';
  color: string;
  label: string;
  description: string;
}

export interface DigitalProfile {
  sections: ProfileSection[];
  leakScore: number;
  leakLevel: LeakLevel;
  serialNumbers: string[];
}

/* ── leak level ─────────────────────────────────────────── */

const LEVELS: Record<Lang, Record<string, LeakLevel>> = {
  ru: {
    critical: { level: 'critical', color: '#DC2626', label: 'Критическая утечка', description: 'Фото раскрывает адрес, устройство, привычки. Не публикуйте без очистки.' },
    high: { level: 'high', color: '#F59E0B', label: 'Высокий риск', description: 'Достаточно данных для частичной идентификации.' },
    medium: { level: 'medium', color: '#3B82F6', label: 'Умеренный риск', description: 'Некоторые данные доступны, но недостаточны для полной идентификации.' },
    low: { level: 'low', color: '#10B981', label: 'Низкий риск', description: 'Метаданные минимальны. Фото относительно анонимно.' },
  },
  en: {
    critical: { level: 'critical', color: '#DC2626', label: 'Critical leak', description: 'Photo reveals your address, device, and habits. Do not publish without cleanup.' },
    high: { level: 'high', color: '#F59E0B', label: 'High risk', description: 'Enough data for partial identification.' },
    medium: { level: 'medium', color: '#3B82F6', label: 'Moderate risk', description: 'Some data available, but insufficient for full identification.' },
    low: { level: 'low', color: '#10B981', label: 'Low risk', description: 'Minimal metadata. Photo is relatively anonymous.' },
  },
  uz: {
    critical: { level: 'critical', color: '#DC2626', label: 'Kritik oqish', description: 'Foto manzil, qurilma va odatlarni oshkor qiladi. Tozalashsiz nashr etmang.' },
    high: { level: 'high', color: '#F59E0B', label: 'Yuqori xavf', description: 'Qisman identifikatsiya uchun yetarli ma\'lumot.' },
    medium: { level: 'medium', color: '#3B82F6', label: 'O\'rtacha xavf', description: 'Ba\'zi ma\'lumotlar mavjud, lekin to\'liq identifikatsiya uchun yetarli emas.' },
    low: { level: 'low', color: '#10B981', label: 'Past xavf', description: 'Minimal metadata. Foto nisbatan anonim.' },
  },
};

function getLeakLevel(score: number, lang: Lang): LeakLevel {
  const l = LEVELS[lang];
  if (score >= 80) return l.critical;
  if (score >= 50) return l.high;
  if (score >= 25) return l.medium;
  return l.low;
}

/* ── threat scenarios ───────────────────────────────────── */

interface ThreatMap { [key: string]: Record<Lang, string> }

const THREATS: ThreatMap = {
  gps: {
    ru: 'Злоумышленник может определить домашний адрес, место работы или маршрут',
    en: 'An attacker can determine your home address, workplace, or route',
    uz: 'Tajovuzkor uy manzili, ish joyi yoki marshrutni aniqlay oladi',
  },
  datetime: {
    ru: 'Позволяет установить распорядок дня и привычки',
    en: 'Reveals daily schedule and habits',
    uz: 'Kundalik tartib va odatlarni oshkor qiladi',
  },
  camera: {
    ru: 'Модель и возраст устройства выдают уровень дохода, версия системы и прошивка — как вы следите за обновлениями; вместе со счётчиком кадров это связывает ваши снимки между собой',
    en: 'The model and its age reveal income level; the system version and firmware show how you keep up with updates; with the shot counter this links your photos to each other',
    uz: 'Model va qurilma yoshi daromad darajasini, tizim versiyasi va proshivka yangilanishlarga munosabatingizni oshkor qiladi; kadr hisoblagichi bilan birga bu suratlaringizni bir-biriga bog‘laydi',
  },
  faces: {
    ru: 'Биометрическая идентификация через сервисы поиска по лицу',
    en: 'Biometric identification via face search services',
    uz: 'Yuz qidiruv xizmatlari orqali biometrik identifikatsiya',
  },
  text: {
    ru: 'Текст на фото (вывески, номера) раскрывает местоположение или контекст',
    en: 'Text in photo (signs, plates) reveals location or context',
    uz: 'Fotodagi matn (belgilar, raqamlar) joylashuv yoki kontekstni oshkor qiladi',
  },
  serial: {
    ru: 'Серийный номер связывает все фото с одного устройства',
    en: 'Serial number links all photos from one device',
    uz: 'Seriya raqami bitta qurilmadan barcha fotolarni bog\'laydi',
  },
  hash: {
    ru: 'По отпечатку картинки поиск по изображению находит копии этого фото на любом сервисе, куда оно загружалось',
    en: 'By the picture fingerprint, reverse image search finds copies of this photo on any service it was uploaded to',
    uz: 'Rasm izi bo‘yicha rasm qidiruvi bu suratning nusxalarini u yuklangan har qanday xizmatda topadi',
  },
  plates: {
    ru: 'По номеру машины находят владельца через базы штрафов и чаты; вместе с местом съёмки это адрес стоянки',
    en: 'A plate leads to the owner through fine databases and chats; with the location it is a parking address',
    uz: 'Avtomobil raqami orqali egasini jarima bazalari va chatlar orqali topadilar; joylashuv bilan birga bu turargoh manzili',
  },
  qr: {
    ru: 'QR-код читается с фото любым телефоном: Wi-Fi-пароль, контакт, посадочный талон или ссылка-приглашение уходят вместе со снимком',
    en: 'A QR code is read off a photo by any phone: a Wi-Fi password, a contact, a boarding pass or an invite link leaves with the picture',
    uz: 'QR-kodni fotodan istalgan telefon o‘qiydi: Wi-Fi paroli, kontakt, bort talon yoki taklif havolasi surat bilan birga ketadi',
  },
  documents: {
    ru: 'Номер карты, паспорт и телефон читаются с фото так же, как с бумаги: этого хватает для мошенничества и поиска аккаунтов',
    en: 'A card number, a passport and a phone number are read off a photo as easily as off paper: enough for fraud and account lookup',
    uz: 'Karta raqami, pasport va telefon fotodan qog‘ozdagidek o‘qiladi: bu firibgarlik va akkauntlarni topish uchun yetarli',
  },
  ai: {
    ru: 'Фото сгенерировано нейросетью — не является реальной фотографией',
    en: 'Photo is AI-generated — not a real photograph',
    uz: 'Foto neyrotarmoq tomonidan yaratilgan — haqiqiy fotosurat emas',
  },
};

/* ── new copy lives in one table (no ternaries per CLAUDE.md) ─ */

const TEXTS: Record<string, Record<Lang, string>> = {
  aiTitle: { ru: 'AI-генерация', en: 'AI-generated', uz: 'AI-generatsiya' },
  aiCheckTitle: { ru: 'AI-генерация', en: 'AI check', uz: 'AI-generatsiya' },
  aiNone: { ru: 'Признаков AI-генерации не обнаружено', en: 'No AI generation signs detected', uz: 'AI-generatsiya belgilari topilmadi' },
  aiNoneSigned: { ru: 'Признаков AI нет, происхождение подписано', en: 'No AI signs; provenance is signed', uz: 'AI belgilari yo‘q, kelib chiqishi imzolangan' },
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
  metadata: StructuredMetadata | null;
  detections: BoundingBox[];
  ocrResult: OCRResult | null;
  originalFilename: string;
  lang: Lang;
}

export function generateDigitalProfile(input: ProfileInput): DigitalProfile {
  const { filename, resolution, stripped, editing, hash, temporal, metadata, detections, ocrResult, lang } = input;
  const sections: ProfileSection[] = [];
  const exif = metadata?.groups?.exif ?? {};

  // ── Device ──
  // `||`, not `??`: an unknown filename yields `device: ''`, which must fall through to the resolution guess.
  const device = metadata?.cameraModel || filename.device || resolution.possibleDevices[0] || null;
  if (device) {
    const fromExif = !!metadata?.cameraModel;
    sections.push({
      kind: 'device',
      title: lang === 'ru' ? 'Устройство' : lang === 'uz' ? 'Qurilma' : 'Device',
      text: device + (metadata?.cameraMake ? ` (${metadata.cameraMake})` : ''),
      subtext: fromExif
        ? (lang === 'ru' ? 'Определено из метаданных камеры' : lang === 'uz' ? 'Kamera metadatalaridan aniqlangan' : 'Identified from camera metadata')
        : (lang === 'ru' ? 'Определено по косвенным признакам' : lang === 'uz' ? 'Bilvosita belgilar bo\'yicha aniqlangan' : 'Identified by indirect signs'),
      leakPoints: fromExif ? 15 : 8,
      severity: fromExif ? 'high' : 'medium',
      threatScenario: THREATS.camera[lang],
    });
  }

  // ── GPS ──
  if (metadata?.gps) {
    sections.push({
      kind: 'location',
      title: lang === 'ru' ? 'Местоположение' : lang === 'uz' ? 'Joylashuv' : 'Location',
      text: `${metadata.gps.lat.toFixed(5)}, ${metadata.gps.lon.toFixed(5)}` + (metadata.gps.altitude != null ? ` (${Math.round(metadata.gps.altitude)}m)` : ''),
      subtext: metadata.gps.accuracy != null
        ? (lang === 'ru' ? `Точность: ±${Math.round(metadata.gps.accuracy)}м` : `Accuracy: ±${Math.round(metadata.gps.accuracy)}m`)
        : null,
      leakPoints: 25,
      severity: 'high',
      threatScenario: THREATS.gps[lang],
    });
  }

  // ── Temporal (always show) ──
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
      threatScenario: THREATS.datetime[lang],
    });
  } else {
    sections.push({
      kind: 'time',
      title: TEXTS.timeTitle[lang],
      text: lang === 'ru' ? 'Дата/время съёмки не найдены' : lang === 'uz' ? 'Suratga olish sanasi/vaqti topilmadi' : 'Shot date/time not found',
      subtext: lang === 'ru' ? 'Временные метаданные отсутствуют или были удалены' : 'Temporal metadata is missing or was stripped',
      leakPoints: 0,
      severity: 'low',
      threatScenario: null,
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
      title: lang === 'ru' ? 'Люди на фото' : lang === 'uz' ? 'Fotodagi odamlar' : 'People in photo',
      text,
      subtext: lang === 'ru'
        ? 'Лица могут быть найдены через сервисы поиска по изображениям'
        : lang === 'uz'
        ? 'Yuzlar rasm qidiruv xizmatlari orqali topilishi mumkin'
        : 'Faces can be found via image search services',
      leakPoints: 20,
      severity: 'high',
      threatScenario: THREATS.faces[lang],
    });
  }

  // ── OCR text ──
  // Two confident fragments at least: a lone token is texture noise more often than a sign.
  if (ocrResult && ocrResult.regions.length >= 2 && ocrResult.fullText.length > 3) {
    sections.push({
      kind: 'text',
      title: lang === 'ru' ? 'Текст на фото' : lang === 'uz' ? 'Fotodagi matn' : 'Text in photo',
      text: lang === 'ru'
        ? `${ocrResult.regions.length} фрагментов текста`
        : `${ocrResult.regions.length} text fragments`,
      subtext: null,
      leakPoints: 10,
      severity: 'medium',
      threatScenario: THREATS.text[lang],
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
      threatScenario: THREATS.plates[lang],
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
      threatScenario: THREATS.qr[lang],
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
      threatScenario: THREATS.documents[lang],
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
      threatScenario: THREATS.ai[lang],
    });
  } else if (editing.isAiGenerated) {
    sections.push({
      kind: 'ai',
      title: TEXTS.aiTitle[lang],
      text: editing.aiTool ?? 'AI',
      subtext: lang === 'ru' ? 'Фото создано нейросетью' : 'Photo created by AI',
      leakPoints: 0,
      severity: 'medium',
      threatScenario: THREATS.ai[lang],
    });
  } else if (cred) {
    sections.push({
      kind: 'ai',
      title: TEXTS.aiCheckTitle[lang],
      text: TEXTS.aiNoneSigned[lang],
      subtext: `${TEXTS.credSignedBy[lang]} ${signer}${cred.valid ? TEXTS.credValidSuffix[lang] : TEXTS.credInvalidSuffix[lang]}`,
      leakPoints: 0,
      severity: 'low',
      threatScenario: null,
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
      threatScenario: null,
    });
  }

  // ── Editing (always show) ──
  if (editing.edited) {
    sections.push({
      kind: 'editing',
      title: lang === 'ru' ? 'Обработка' : lang === 'uz' ? 'Tahrirlash' : 'Editing',
      text: editing.software.join(', '),
      subtext: editing.hints[0] ?? null,
      leakPoints: 5,
      severity: 'low',
      threatScenario: null,
    });
  } else {
    sections.push({
      kind: 'editing',
      title: lang === 'ru' ? 'Обработка' : lang === 'uz' ? 'Tahrirlash' : 'Editing',
      text: lang === 'ru' ? 'Следов редактирования не обнаружено' : lang === 'uz' ? 'Tahrirlash izlari topilmadi' : 'No editing traces detected',
      subtext: null,
      leakPoints: 0,
      severity: 'low',
      threatScenario: null,
    });
  }

  // ── Origin / messenger (always show) ──
  if (stripped.stripped) {
    sections.push({
      kind: 'origin',
      title: lang === 'ru' ? 'Происхождение' : lang === 'uz' ? 'Kelib chiqishi' : 'Origin',
      text: stripped.strippedBy
        ? (lang === 'ru' ? `Прошло через ${stripped.strippedBy}` : `Passed through ${stripped.strippedBy}`)
        : (lang === 'ru' ? 'Метаданные были удалены' : 'Metadata was stripped'),
      subtext: stripped.evidence[0] ?? null,
      leakPoints: 5,
      severity: 'medium',
      threatScenario: null,
    });
  } else {
    sections.push({
      kind: 'origin',
      title: lang === 'ru' ? 'Происхождение' : lang === 'uz' ? 'Kelib chiqishi' : 'Origin',
      text: lang === 'ru' ? 'Оригинальный файл (не из мессенджера)' : lang === 'uz' ? 'Original fayl (messenjerdan emas)' : 'Original file (not from a messenger)',
      subtext: lang === 'ru' ? 'Метаданные сохранены — файл не проходил через сервисы сжатия' : 'Metadata preserved — file was not re-compressed by a service',
      leakPoints: 0,
      severity: 'low',
      threatScenario: null,
    });
  }

  // ── Content type ──
  if (resolution.contentHint) {
    sections.push({
      kind: 'content',
      title: lang === 'ru' ? 'Тип контента' : lang === 'uz' ? 'Kontent turi' : 'Content type',
      text: resolution.contentHint,
      subtext: null,
      leakPoints: 0,
      severity: 'low',
      threatScenario: null,
    });
  }

  // ── Serial numbers ──
  const serials = extractSerialNumbers(exif);
  if (serials.length > 0) {
    sections.push({
      kind: 'serial',
      title: lang === 'ru' ? 'Серийные номера' : lang === 'uz' ? 'Seriya raqamlari' : 'Serial numbers',
      text: serials.join('; '),
      subtext: null,
      leakPoints: 10,
      severity: 'medium',
      threatScenario: THREATS.serial[lang],
    });
  }

  // ── Hash ──
  if (hash) {
    sections.push({
      kind: 'hash',
      title: lang === 'ru' ? 'Цифровой отпечаток' : lang === 'uz' ? 'Raqamli barmoq izi' : 'Digital fingerprint',
      text: hash.phash ? `pHash ${hash.phash} · SHA-256 ${hash.sha256.substring(0, 16)}…` : `SHA-256: ${hash.sha256.substring(0, 16)}...`,
      subtext: TEXTS.hashSub[lang],
      leakPoints: 5,
      severity: 'low',
      threatScenario: THREATS.hash[lang],
    });
  }

  const leakScore = Math.min(100, sections.reduce((s, sec) => s + sec.leakPoints, 0));

  return {
    sections,
    leakScore,
    leakLevel: getLeakLevel(leakScore, lang),
    serialNumbers: serials,
  };
}
