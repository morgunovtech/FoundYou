type Lang = 'ru' | 'en' | 'uz';

export interface EditingAnalysis {
  edited: boolean;
  software: string[];
  editingLevel: 'none' | 'basic' | 'professional';
  hints: string[];
  isAiGenerated: boolean;
  aiTool: string | null;
}

interface SoftwareProfile {
  level: 'none' | 'basic' | 'professional';
  hint: Record<Lang, string>;
  /** Other product names that identify the same editor; matched like the key (whole words, case-insensitive). */
  aliases?: string[];
}

const SOFTWARE_PROFILES: Record<string, SoftwareProfile> = {
  'Adobe Photoshop': { level: 'professional', hint: { ru: 'Профессиональный редактор изображений', en: 'Professional image editor', uz: 'Professional rasm muharriri' } },
  'Adobe Lightroom': {
    level: 'professional',
    hint: { ru: 'Обработка RAW — вероятно, фотограф', en: 'RAW processing — likely a photographer', uz: 'RAW ishlov berish — fotograf' },
    // "Adobe Photoshop Lightroom Classic 13.0" is Lightroom, not Photoshop.
    aliases: ['Adobe Photoshop Lightroom', 'Lightroom'],
  },
  'Capture One': { level: 'professional', hint: { ru: 'Инструмент коммерческих фотографов', en: 'Commercial photography tool', uz: 'Professional fotograf vositasi' } },
  'Affinity Photo': { level: 'professional', hint: { ru: 'Профессиональная обработка', en: 'Professional editing', uz: 'Professional tahrirlash' } },
  'GIMP': { level: 'professional', hint: { ru: 'Открытый редактор — технически подкованный пользователь', en: 'Open-source editor — technically savvy user', uz: 'Ochiq kodli muharrir' } },
  'DaVinci Resolve': { level: 'professional', hint: { ru: 'Кадр из видеоредактора — видеограф', en: 'Video editor frame — videographer', uz: 'Video muharriri kadri' } },
  'Snapseed': { level: 'basic', hint: { ru: 'Мобильная обработка перед публикацией', en: 'Mobile editing before publishing', uz: 'Nashr oldidan mobil tahrirlash' } },
  'VSCO': { level: 'basic', hint: { ru: 'Мобильные фильтры — типично для Instagram', en: 'Mobile filters — typical for Instagram', uz: 'Mobil filtrlar — Instagram uchun' } },
  'PicsArt': { level: 'basic', hint: { ru: 'Мобильный фоторедактор с эффектами', en: 'Mobile photo editor with effects', uz: 'Effektli mobil foto muharriri' } },
  'Photos': { level: 'basic', hint: { ru: 'Стандартное приложение Apple', en: 'Apple Photos app', uz: 'Apple Photos ilovasi' } },
  'Google Photos': { level: 'basic', hint: { ru: 'Обработка в Google Photos — данные в облаке Google', en: 'Google Photos — data in Google cloud', uz: 'Google Photos — ma\'lumotlar bulutda' } },
  'Samsung Gallery': { level: 'basic', hint: { ru: 'Стандартный редактор Samsung', en: 'Samsung default editor', uz: 'Samsung standart muharriri' } },
  'Remini': { level: 'basic', hint: { ru: 'AI-апскейлер — оригинал низкого качества', en: 'AI upscaler — original was low quality', uz: 'AI upskeyler — asl sifat past' } },
  'Topaz': { level: 'professional', hint: { ru: 'Профессиональный AI-апскейлинг', en: 'Professional AI upscaling', uz: 'Professional AI upskeyling' } },
};

// AI generation markers found in XMP/EXIF
const AI_MARKERS: Array<{ pattern: RegExp; tool: string }> = [
  { pattern: /stable.?diffusion/i, tool: 'Stable Diffusion' },
  { pattern: /midjourney/i, tool: 'Midjourney' },
  { pattern: /dall.?e/i, tool: 'DALL-E' },
  { pattern: /firefly/i, tool: 'Adobe Firefly' },
  { pattern: /comfyui/i, tool: 'ComfyUI' },
  { pattern: /automatic1111|a1111/i, tool: 'Automatic1111' },
  { pattern: /novelai/i, tool: 'NovelAI' },
  { pattern: /\bflux\b/i, tool: 'Flux' },
  { pattern: /ai_type/i, tool: 'AI (unknown)' },
  { pattern: /dream\s?studio/i, tool: 'DreamStudio' },
  { pattern: /leonardo\.ai/i, tool: 'Leonardo.AI' },
  { pattern: /runway/i, tool: 'Runway' },
];

/* ── word-boundary matching of product names ─────────────────── */

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A product name matches only as whole words: "photos" must not fire inside "photoshop".
 * Whitespace inside multi-word names is flexible. No lookbehind (Safari < 16.4): the
 * leading boundary is captured so the match span can be corrected.
 */
function wordPattern(name: string): RegExp {
  const words = name.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  return new RegExp(`(^|[^a-z0-9])(${words})(?![a-z0-9])`, 'i');
}

interface Span { start: number; end: number }

interface ProfileMatcher {
  name: string;
  profile: SoftwareProfile;
  patterns: RegExp[];
}

const PROFILE_MATCHERS: ProfileMatcher[] = Object.entries(SOFTWARE_PROFILES).map(([name, profile]) => ({
  name,
  profile,
  patterns: [name, ...(profile.aliases ?? [])].map(wordPattern),
}));

/** Longest span in `text` matched by any of the patterns, or null. */
function findSpan(text: string, patterns: RegExp[]): Span | null {
  let best: Span | null = null;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = match.index + match[1].length;
    const end = start + match[2].length;
    if (!best || end - start > best.end - best.start) best = { start, end };
  }
  return best;
}

const encloses = (outer: Span, inner: Span) =>
  outer.start <= inner.start && outer.end >= inner.end && outer.end - outer.start > inner.end - inner.start;

/* ── camera firmware (not an editor) ─────────────────────────── */

/**
 * Values cameras and phones write into EXIF `Software` that describe the firmware, not an
 * editing application. An untouched photo must not read as "edited".
 */
const FIRMWARE_PATTERNS: RegExp[] = [
  /^v?\d+(?:\.\d+)*[a-z]?$/i, // iPhone "17.5.1", DJI "v01.00.0500", "1.0"
  /^ver(?:sion)?\.?\s*v?\d+(?:\.\d+)*$/i, // Nikon/Panasonic "Ver.1.10", Olympus "Version 1.0"
  /^(?:camera\s+)?firmware(?:\s+version)?\s*:?\s*v?\d+(?:\.\d+)*$/i, // Canon "Firmware Version 1.1.0"
  /\bver\.?\s?\d+(?:\.\d+)+\s*$/i, // Fujifilm "Digital Camera X-T4 Ver1.02", Ricoh "GR III Ver1.00"
  /^[A-Z0-9-]+\s+v\d+(?:\.\d+)+\s*$/, // Sony "ILCE-7M3 v3.10" (model code + version)
  /^[A-Z](?=[A-Z0-9]*\d)[A-Z0-9]{7,}$/, // Samsung build ID "S918BXXS4BXA1", "G991BXXU5DVJ8"
  /^HDR\+\s/, // Google Pixel camera pipeline "HDR+ 1.0.540104767z"
  /release-keys|\b(?:user|userdebug)\s+\d/, // Android build fingerprint (Xiaomi & co)
  /^(?:HUAWEI|HONOR)\b/i, // "HUAWEI ELE-L29"
  /^[A-Z]{3}-[A-Z]{1,3}\d{2}[A-Z]?\s+\d+(?:\.\d+)+/, // Huawei EMUI "ELE-L29 10.0.0.168(C432E4R2P1)"
  /^HD\d+(?:\.\d+){3,}/, // GoPro "HD7.01.01.90.00"
];

export function isCameraFirmware(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  // An AI tool name is software even when it looks like a build ID ("AUTOMATIC1111").
  if (AI_MARKERS.some(({ pattern }) => pattern.test(text))) return false;
  return FIRMWARE_PATTERNS.some(pattern => pattern.test(text));
}

/* ── software sources ────────────────────────────────────────── */

/** Keys that hold a tool name. `dc:creator` (`Creator`) is the author and is deliberately absent. */
const EXIF_SOFTWARE_KEYS = ['Software', 'software'];
const XMP_TOOL_KEYS = [
  'CreatorTool', 'creatorTool', 'xmp:CreatorTool',
  'HistorySoftwareAgent', 'historySoftwareAgent',
  'SoftwareAgent', 'softwareAgent', 'stEvt:softwareAgent',
];
const HISTORY_AGENT_KEYS = ['softwareAgent', 'SoftwareAgent', 'stEvt:softwareAgent'];

function pushText(out: string[], value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(entry => pushText(out, entry));
    return;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const text = String(value).trim();
  if (text) out.push(text);
}

function collectSoftwareSources(metadata: Record<string, unknown>, xmp: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of EXIF_SOFTWARE_KEYS) pushText(out, metadata[key]);
  for (const key of XMP_TOOL_KEYS) pushText(out, xmp[key]);

  // Un-merged namespaces: xmp.xmp.CreatorTool, xmp.xmpMM.History[].softwareAgent
  const xmpNs = xmp.xmp;
  if (xmpNs && typeof xmpNs === 'object') {
    pushText(out, (xmpNs as Record<string, unknown>).CreatorTool);
  }
  const xmpMM = xmp.xmpMM;
  const history = xmpMM && typeof xmpMM === 'object' ? (xmpMM as Record<string, unknown>).History : xmp.History;
  if (Array.isArray(history)) {
    for (const event of history) {
      if (!event || typeof event !== 'object') continue;
      for (const key of HISTORY_AGENT_KEYS) pushText(out, (event as Record<string, unknown>)[key]);
    }
  }

  // Deduplicate case-insensitively, keep first spelling
  const seen = new Set<string>();
  return out.filter(text => {
    const key = text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ── analysis ────────────────────────────────────────────────── */

/** `DigitalSourceType` wherever exifr put it: a top-level key, or nested under `Iptc4xmpExt` / `iptcExt`. */
function digitalSourceTypeOf(xmp: Record<string, unknown>): string | null {
  const direct = xmp.DigitalSourceType ?? xmp.digitalSourceType ?? xmp['Iptc4xmpExt:DigitalSourceType'];
  if (typeof direct === 'string') return direct;
  for (const key of ['Iptc4xmpExt', 'iptcExt', 'iptc']) {
    const nested = xmp[key];
    if (nested && typeof nested === 'object') {
      const value = (nested as Record<string, unknown>).DigitalSourceType ?? (nested as Record<string, unknown>).digitalSourceType;
      if (typeof value === 'string') return value;
    }
  }
  return null;
}

export function analyzeEditingHistory(
  metadata: Record<string, unknown>,
  xmp: Record<string, unknown>,
  lang: Lang
): EditingAnalysis {
  const softwareSources = collectSoftwareSources(metadata, xmp);
  const allText = softwareSources.join(' ');
  const foundSoftware: string[] = [];
  const hints: string[] = [];
  let maxLevel: 'none' | 'basic' | 'professional' = 'none';

  // Known profiles. When one matched name sits inside another ("Photos" in "Google Photos",
  // "Adobe Photoshop" in "Adobe Photoshop Lightroom") only the more specific profile counts.
  const matched = PROFILE_MATCHERS.flatMap(matcher => {
    const span = findSpan(allText, matcher.patterns);
    return span ? [{ matcher, span }] : [];
  });
  for (const { matcher, span } of matched) {
    if (matched.some(other => other.matcher !== matcher && encloses(other.span, span))) continue;
    foundSoftware.push(matcher.name);
    hints.push(matcher.profile.hint[lang]);
    if (matcher.profile.level === 'professional') maxLevel = 'professional';
    else if (matcher.profile.level === 'basic' && maxLevel === 'none') maxLevel = 'basic';
  }

  // Unknown software: reported verbatim — unless it is the camera's own firmware string.
  for (const sw of softwareSources) {
    const known = PROFILE_MATCHERS.some(matcher => findSpan(sw, matcher.patterns) !== null);
    if (!known && sw.length > 1 && !isCameraFirmware(sw)) {
      foundSoftware.push(sw);
    }
  }

  // AI generation detection
  let isAiGenerated = false;
  let aiTool: string | null = null;

  const xmpStr = JSON.stringify(xmp).toLowerCase();
  const searchText = [...softwareSources, xmpStr].join(' ');
  for (const marker of AI_MARKERS) {
    if (marker.pattern.test(searchText)) {
      isAiGenerated = true;
      aiTool = marker.tool;
      break;
    }
  }

  // IPTC DigitalSourceType (Iptc4xmpExt): the one industry standard the generators themselves write —
  // OpenAI, Adobe, Google and Microsoft mark their output as trainedAlgorithmicMedia (or a composite of it).
  const digitalSourceType = digitalSourceTypeOf(xmp);
  if (!isAiGenerated && digitalSourceType && /trainedalgorithmicmedia|algorithmicmedia/i.test(digitalSourceType)) {
    isAiGenerated = true;
    aiTool = softwareSources.find((sw) => !isCameraFirmware(sw)) ?? (/composite/i.test(digitalSourceType) ? 'AI (composite, IPTC DigitalSourceType)' : 'AI (IPTC DigitalSourceType)');
  }

  // Check XMP for explicit AI markers
  if (!isAiGenerated && (xmpStr.includes('"ai_type"') || xmpStr.includes('"source":"ai"') || xmpStr.includes('generative'))) {
    isAiGenerated = true;
    aiTool = 'AI (unknown)';
  }

  return {
    edited: foundSoftware.length > 0,
    software: foundSoftware,
    editingLevel: maxLevel,
    hints,
    isAiGenerated,
    aiTool,
  };
}
