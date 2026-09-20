import type { FilenameAnalysis } from './filenameAnalyzer';

type Lang = 'ru' | 'en' | 'uz';

export interface StrippedAnalysis {
  stripped: boolean;
  strippedBy: string | null;
  confidence: number;
  evidence: string[];
}

interface StrippedInput {
  filename: string;
  filenameAnalysis: FilenameAnalysis;
  mimeType: string;
  width: number;
  height: number;
  hasExif: boolean;
  hasSoftwareTag: boolean;
  /** Anything else the container carries: PNG text chunks, XMP, IPTC. A file with those was not stripped. */
  hasOtherMetadata?: boolean;
  lang: Lang;
}

/**
 * Formats a camera writes EXIF into. Everything else — PNG, GIF, BMP, WebP — has nothing to
 * strip, so «метаданные были удалены» about one of them is simply wrong: a drawing, a chart or a
 * screenshot saved as PNG never had EXIF to lose.
 */
const EXIF_BEARING = /(jpeg|jpg|heic|heif|avif|tiff)/i;

const EVIDENCE: Record<string, Record<Lang, string>> = {
  jpeg_no_exif: {
    ru: 'JPEG высокого разрешения без метаданных — нетипично для камеры',
    en: 'High-resolution JPEG without metadata — unusual for a camera',
    uz: 'Yuqori sifatli JPEG metadata\'siz — kamera uchun nostandart',
  },
  messenger_name: {
    ru: 'Имя файла соответствует паттерну мессенджера',
    en: 'Filename matches a messenger pattern',
    uz: 'Fayl nomi messenjer shabloniga mos',
  },
  non_camera_name: {
    ru: 'Нестандартное имя файла — вероятно, переименовано или загружено с сервиса',
    en: 'Non-standard filename — likely renamed or downloaded from a service',
    uz: 'Nostandart fayl nomi — qayta nomlangan yoki xizmatdan yuklangan',
  },
  low_resolution_jpeg: {
    ru: 'Разрешение ниже типичного для камеры — фото было пережато сервисом',
    en: 'Resolution below typical for a camera — photo was re-compressed by a service',
    uz: 'Kamera uchun past razreshlik — foto xizmat tomonidan qayta siqilgan',
  },
};

const CAMERA_NAME_REGEX = /^(IMG|DSC|PXL|GOPR|DJI|DCIM|photo|_DSC|GX)/i;

/**
 * Platforms that re-encode uploads and drop EXIF. Only these may be named in `strippedBy`;
 * a camera/vendor platform inferred from the filename (Apple iOS, Android, Camera…) is where
 * the photo was *taken*, not what removed its metadata.
 */
const STRIPPING_PLATFORMS = new Set([
  'Telegram',
  'Signal',
  'WhatsApp',
  'Viber',
  'Facebook Messenger',
  'Instagram',
  'VK',
  'Discord',
]);

export function detectStrippedMetadata(input: StrippedInput): StrippedAnalysis {
  const { filename, filenameAnalysis, mimeType, width, height, hasExif, hasSoftwareTag, lang } = input;
  const evidence: string[] = [];

  // Metadata of any kind — EXIF, a Software tag, PNG text chunks, XMP, IPTC — means nothing was stripped.
  if (hasExif || hasSoftwareTag || input.hasOtherMetadata) {
    return { stripped: false, strippedBy: null, confidence: 0, evidence: [] };
  }
  // A format that never carries EXIF cannot have had it removed.
  if (!EXIF_BEARING.test(mimeType)) {
    return { stripped: false, strippedBy: null, confidence: 0, evidence: [] };
  }

  const isJpeg = mimeType.includes('jpeg') || mimeType.includes('jpg');
  const megapixels = (width * height) / 1_000_000;

  // Sign 1: High-res JPEG without EXIF
  if (isJpeg && megapixels > 1) {
    evidence.push(EVIDENCE.jpeg_no_exif[lang]);
  }

  // Sign 2: Messenger filename pattern
  const strippingPlatform =
    filenameAnalysis.platform && STRIPPING_PLATFORMS.has(filenameAnalysis.platform) ? filenameAnalysis.platform : null;
  if (strippingPlatform) {
    evidence.push(EVIDENCE.messenger_name[lang]);
  }

  // Sign 3: Non-camera filename
  if (!CAMERA_NAME_REGEX.test(filename) && !filenameAnalysis.platform) {
    evidence.push(EVIDENCE.non_camera_name[lang]);
  }

  // Sign 4: Suspiciously low resolution for JPEG (typical of social media re-compression)
  const longestSide = Math.max(width, height);
  if (isJpeg && longestSide > 0 && longestSide <= 1600 && megapixels > 0.5) {
    evidence.push(EVIDENCE.low_resolution_jpeg[lang]);
  }

  const stripped = evidence.length >= 1 && !hasExif;
  return {
    stripped,
    strippedBy: stripped ? strippingPlatform : null,
    confidence: evidence.length >= 2 ? 0.85 : evidence.length === 1 ? 0.6 : 0,
    evidence,
  };
}
