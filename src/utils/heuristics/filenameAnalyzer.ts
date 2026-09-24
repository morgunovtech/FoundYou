type Lang = 'ru' | 'en' | 'uz';

export interface FilenameAnalysis {
  platform: string | null;
  device: string;
  confidence: number;
  photoIndex: number | null;
  estimatedMonths: number | null;
  /** The name follows a screenshot pattern (Screenshot_…, Снимок экрана…, IMG_NNNN.PNG). */
  isScreenshot: boolean;
}

interface FilenamePattern {
  regex: RegExp;
  platform: string;
  device: Record<Lang, string>;
  confidence: number;
  screenshot?: boolean;
}

const PATTERNS: FilenamePattern[] = [
  // Apple iOS
  { regex: /^IMG_\d{4}\.(?:JPG|JPEG|HEIC|MOV)$/i, platform: 'Apple iOS', device: { ru: 'iPhone', en: 'iPhone', uz: 'iPhone' }, confidence: 0.9 },
  { regex: /^IMG_\d{4}\s?\(\d+\)\.(?:JPG|JPEG)$/i, platform: 'Apple iOS', device: { ru: 'iPhone (дубликат AirDrop)', en: 'iPhone (AirDrop duplicate)', uz: 'iPhone (AirDrop nusxasi)' }, confidence: 0.85 },
  { regex: /^Live\sPhoto/i, platform: 'Apple iOS', device: { ru: 'iPhone (Live Photo)', en: 'iPhone (Live Photo)', uz: 'iPhone (Live Photo)' }, confidence: 0.95 },
  { regex: /^IMG_\d{4}\.PNG$/i, platform: 'Apple iOS', device: { ru: 'Скриншот iPhone', en: 'iPhone screenshot', uz: 'iPhone skrinshot' }, confidence: 0.8, screenshot: true },

  // Google Pixel
  { regex: /^PXL_\d{8}_\d{9,}/i, platform: 'Android', device: { ru: 'Google Pixel', en: 'Google Pixel', uz: 'Google Pixel' }, confidence: 0.95 },

  // Samsung
  { regex: /^\d{8}_\d{6}\.jpg$/i, platform: 'Android', device: { ru: 'Samsung Galaxy', en: 'Samsung Galaxy', uz: 'Samsung Galaxy' }, confidence: 0.7 },
  { regex: /^SAMSUNG_/i, platform: 'Android', device: { ru: 'Samsung', en: 'Samsung', uz: 'Samsung' }, confidence: 0.95 },

  // Huawei
  { regex: /^IMG_\d{8}_\d{6}\.jpg$/i, platform: 'Android', device: { ru: 'Huawei / Honor', en: 'Huawei / Honor', uz: 'Huawei / Honor' }, confidence: 0.6 },

  // Xiaomi
  { regex: /^IMG_\d{8}_\d{6}_\d{3}\.jpg$/i, platform: 'Android', device: { ru: 'Xiaomi / Redmi', en: 'Xiaomi / Redmi', uz: 'Xiaomi / Redmi' }, confidence: 0.65 },

  // DSLR / mirrorless
  { regex: /^DSC\d{5}\.(?:JPG|ARW|NEF)$/i, platform: 'Camera', device: { ru: 'Sony / Nikon', en: 'Sony / Nikon', uz: 'Sony / Nikon' }, confidence: 0.85 },
  { regex: /^DSC_\d{4,5}\.(?:JPG|NEF)$/i, platform: 'Camera', device: { ru: 'Nikon DSLR', en: 'Nikon DSLR', uz: 'Nikon DSLR' }, confidence: 0.9 },
  { regex: /^_DSC\d{4,5}\.(?:JPG|ARW)$/i, platform: 'Camera', device: { ru: 'Sony Alpha', en: 'Sony Alpha', uz: 'Sony Alpha' }, confidence: 0.9 },
  { regex: /^IMG_\d{4,5}\.CR[23]$/i, platform: 'Camera', device: { ru: 'Canon EOS', en: 'Canon EOS', uz: 'Canon EOS' }, confidence: 0.95 },

  // GoPro
  { regex: /^GOPR\d{4}\./i, platform: 'Camera', device: { ru: 'GoPro', en: 'GoPro', uz: 'GoPro' }, confidence: 0.95 },
  { regex: /^GX\d{6}\./i, platform: 'Camera', device: { ru: 'GoPro', en: 'GoPro', uz: 'GoPro' }, confidence: 0.9 },

  // DJI
  { regex: /^DJI_\d{4,}\./i, platform: 'Drone', device: { ru: 'DJI (дрон)', en: 'DJI (drone)', uz: 'DJI (dron)' }, confidence: 0.95 },

  // Screenshots
  { regex: /^Screenshot_\d{4}-\d{2}-\d{2}/i, platform: 'Android', device: { ru: 'Скриншот Android', en: 'Android screenshot', uz: 'Android skrinshot' }, confidence: 0.95, screenshot: true },
  { regex: /^Screenshot\s\d{4}-\d{2}-\d{2}\sat\s/i, platform: 'Apple macOS', device: { ru: 'Скриншот Mac', en: 'Mac screenshot', uz: 'Mac skrinshot' }, confidence: 0.95, screenshot: true },
  { regex: /^Снимок экрана/i, platform: 'Desktop', device: { ru: 'Скриншот (русская ОС)', en: 'Screenshot (Russian OS)', uz: 'Skrinshot (rus OS)' }, confidence: 0.9, screenshot: true },
  { regex: /^Screen\sShot\s/i, platform: 'Apple macOS', device: { ru: 'Скриншот Mac', en: 'Mac screenshot', uz: 'Mac skrinshot' }, confidence: 0.9, screenshot: true },

  // Messenger re-saves
  { regex: /^photo_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jpg$/i, platform: 'Telegram', device: { ru: 'Сохранено из Telegram', en: 'Saved from Telegram', uz: 'Telegramdan saqlangan' }, confidence: 0.95 },
  // Telegram on macOS and iOS: a space and dots (`photo_2022-03-08 13.33.59.jpeg`), optionally a
  // Finder duplicate counter. All 43 Telegram files in the owner's bench are named this way and
  // none matched the underscore form above — the most common messenger name on a Mac went unseen.
  { regex: /^photo_\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}(?: \d+)?\.jpe?g$/i, platform: 'Telegram', device: { ru: 'Сохранено из Telegram', en: 'Saved from Telegram', uz: 'Telegramdan saqlangan' }, confidence: 0.95 },
  // Telegram Desktop: `photo_12@08-03-2022_13-33-59.jpg`.
  { regex: /^photo_\d+@\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{2}\.jpe?g$/i, platform: 'Telegram', device: { ru: 'Сохранено из Telegram', en: 'Saved from Telegram', uz: 'Telegramdan saqlangan' }, confidence: 0.95 },
  { regex: /^signal-\d{4}-\d{2}-\d{2}/i, platform: 'Signal', device: { ru: 'Сохранено из Signal', en: 'Saved from Signal', uz: 'Signaldan saqlangan' }, confidence: 0.95 },
  { regex: /^received_\d+\.jpeg$/i, platform: 'Facebook Messenger', device: { ru: 'Сохранено из FB Messenger', en: 'Saved from FB Messenger', uz: 'FB Messengerdan saqlangan' }, confidence: 0.9 },
  { regex: /^WhatsApp\sImage\s\d{4}-\d{2}-\d{2}/i, platform: 'WhatsApp', device: { ru: 'Сохранено из WhatsApp', en: 'Saved from WhatsApp', uz: 'WhatsAppdan saqlangan' }, confidence: 0.95 },
  { regex: /^viber_image_\d+/i, platform: 'Viber', device: { ru: 'Сохранено из Viber', en: 'Saved from Viber', uz: 'Viberdan saqlangan' }, confidence: 0.9 },
];

/**
 * A shot counter is only the whole basename `IMG_NNNN(N)` / `DSC_NNNN(N)` / `DSCNNNNN` / `_DSCNNNN`
 * (iPhone, Canon, Nikon, Sony), optionally with an AirDrop " (n)" suffix. Date-stamped names such
 * as `IMG_20240614_183012.jpg` carry no counter — the first digits are a date, not an index.
 */
const SEQUENCE_NAME_REGEX = /^(?:IMG_|_?DSC_?)(\d{4,5})(?:\s?\(\d+\))?\.[A-Za-z0-9]+$/i;

function estimatePhotoIndex(filename: string): { photoIndex: number; estimatedMonths: number } | null {
  const match = SEQUENCE_NAME_REGEX.exec(filename);
  if (!match) return null;
  const index = parseInt(match[1], 10);
  if (index <= 0) return null;
  const photosPerDay = 5;
  const estimatedDays = Math.round(index / photosPerDay);
  return { photoIndex: index, estimatedMonths: Math.max(1, Math.round(estimatedDays / 30)) };
}

export function analyzeFilename(filename: string, lang: Lang): FilenameAnalysis {
  for (const pattern of PATTERNS) {
    if (pattern.regex.test(filename)) {
      const indexInfo = estimatePhotoIndex(filename);
      return {
        platform: pattern.platform,
        device: pattern.device[lang],
        confidence: pattern.confidence,
        photoIndex: indexInfo?.photoIndex ?? null,
        estimatedMonths: indexInfo?.estimatedMonths ?? null,
        isScreenshot: Boolean(pattern.screenshot),
      };
    }
  }
  return { platform: null, device: '', confidence: 0, photoIndex: null, estimatedMonths: null, isScreenshot: false };
}
