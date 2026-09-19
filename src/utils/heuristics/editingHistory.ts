type Lang = 'ru' | 'en' | 'uz';

/** Generative work a file admits to: none, the whole picture, a patch in it, or a plain multi-shot blend. */
export type AiScope = 'none' | 'generated' | 'edited' | 'composite';

export interface EditingAnalysis {
  edited: boolean;
  software: string[];
  editingLevel: 'none' | 'basic' | 'professional';
  hints: string[];
  /** What the file's own tags claim about generative work in it. */
  aiScope: AiScope;
  aiTool: string | null;
  /** The marker the scope rests on, verbatim: «Credit: …», «DigitalSourceType: …», a PNG chunk. */
  aiEvidence: string | null;
  /** What the generator left inside the file (PNG text chunks): the model and the start of the prompt. */
  aiDetails: AiDetails | null;
}

export interface AiDetails {
  model: string | null;
  /** First line of the prompt, cut to `AI_PROMPT_EXCERPT` characters. */
  prompt: string | null;
  /** The chunk that carried it: `parameters`, `workflow`, `prompt`, `Comment`, `Description`… */
  chunk: string;
}

export const AI_PROMPT_EXCERPT = 120;

const excerpt = (text: string): string | null => {
  const line = text.split(/\r?\n/)[0]?.trim() ?? '';
  if (!line) return null;
  return line.length > AI_PROMPT_EXCERPT ? `${line.slice(0, AI_PROMPT_EXCERPT - 1).trimEnd()}…` : line;
};

const stringChunk = (png: Record<string, unknown>, key: string): string | null => {
  const value = png[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

/**
 * AI generators write their settings into PNG text chunks, never into EXIF: Automatic1111 /
 * Forge a `parameters` block («…Steps: 30, Sampler: …, Model: …»), ComfyUI the `workflow` /
 * `prompt` JSON with `class_type` nodes, NovelAI `Software` + `Comment` JSON, InvokeAI an
 * `invokeai_metadata` / `sd-metadata` JSON. Returns the tool, the model and the prompt line.
 */
export function findPngAiMarkers(png: Record<string, unknown>): { tool: string; details: AiDetails } | null {
  const parameters = stringChunk(png, 'parameters');
  if (parameters && /(^|\n)Steps: \d+|Sampler: |Seed: \d+/.test(parameters)) {
    const model = parameters.match(/(?:^|, |\n)Model: ([^,\n]+)/)?.[1]?.trim() ?? null;
    return { tool: 'Stable Diffusion', details: { model, prompt: excerpt(parameters), chunk: 'parameters' } };
  }
  for (const key of ['workflow', 'prompt']) {
    const json = stringChunk(png, key);
    if (json && /"class_type"\s*:/.test(json)) {
      const model = json.match(/"ckpt_name"\s*:\s*"([^"]+)"/)?.[1] ?? json.match(/"unet_name"\s*:\s*"([^"]+)"/)?.[1] ?? null;
      const prompt = json.match(/"text"\s*:\s*"([^"]{1,400})"/)?.[1] ?? null;
      return { tool: 'ComfyUI', details: { model, prompt: prompt ? excerpt(prompt) : null, chunk: key } };
    }
  }
  for (const key of ['invokeai_metadata', 'sd-metadata', 'invokeai']) {
    const json = stringChunk(png, key);
    if (json) {
      const model = json.match(/"(?:model_weights|model_name|model)"\s*:\s*"([^"]+)"/)?.[1] ?? null;
      const prompt = json.match(/"(?:positive_prompt|prompt)"\s*:\s*"([^"]{1,400})"/)?.[1] ?? null;
      return { tool: 'InvokeAI', details: { model, prompt: prompt ? excerpt(prompt) : null, chunk: key } };
    }
  }
  const software = stringChunk(png, 'Software');
  const comment = stringChunk(png, 'Comment');
  if ((software && /novelai/i.test(software)) || (comment && /"uc"\s*:/.test(comment) && /"steps"\s*:/.test(comment))) {
    const description = stringChunk(png, 'Description');
    return { tool: 'NovelAI', details: { model: null, prompt: description ? excerpt(description) : null, chunk: 'Comment' } };
  }
  const text = Object.values(png)
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  for (const marker of AI_MARKERS) {
    if (marker.pattern.test(text)) {
      return { tool: marker.tool, details: { model: null, prompt: null, chunk: 'text' } };
    }
  }
  return null;
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

/* ── generative work ─────────────────────────────────────────────────────────
 *
 * Three claims a file can make about itself, and they must not be collapsed into one:
 * a picture a model drew end to end (`generated`), a photograph with a model-drawn patch
 * in it (`edited` — iOS Clean Up, Google Magic Editor, Galaxy AI), and a frame stitched
 * from several real shots with no model at all (`composite` — Best Take, Add Me).
 * Reporting the second as «created by AI» calls a real photograph fake, which is worse
 * than missing it; reporting the third as AI is simply wrong.
 */

/**
 * IPTC `DigitalSourceType` → what it claims. The value is a vocabulary URI
 * (`http://cv.iptc.org/newscodes/digitalsourcetype/<term>`), so only the last segment is
 * compared — a substring match would read `compositeWithTrainedAlgorithmicMedia` as
 * `trainedAlgorithmicMedia`. Terms not listed here (`digitalCapture`, `minorHumanEdits`,
 * film and print scans) are an ordinary photograph.
 */
const DIGITAL_SOURCE_SCOPES: Record<string, AiScope> = {
  trainedalgorithmicmedia: 'generated',
  algorithmicmedia: 'generated',
  digitalart: 'generated',
  virtualrecording: 'generated',
  compositewithtrainedalgorithmicmedia: 'edited',
  compositesynthetic: 'edited',
  algorithmicallyenhanced: 'edited',
  compositecapture: 'composite',
  composite: 'composite',
};

interface CreditMarker {
  pattern: RegExp;
  tool: string;
  /** Matches only when EXIF `Make` is Apple: the pattern alone is too common to trust. */
  appleOnly?: boolean;
}

/**
 * What the phone's own generative editor writes into the credit line. Apple puts
 * «Apple Photos Clean Up» in IPTC `Credit`; Google marks Magic Editor / Magic Eraser /
 * Zoom Enhance the same way. The exact strings are vendor-specific and change between
 * releases, so `aiEvidence` always carries the value verbatim — the label here is only a
 * name for it, and an unmatched credit still shows up in the raw table.
 */
const GENERATIVE_EDITORS: CreditMarker[] = [
  { pattern: /apple\s+photos?\s+clean\s?up/i, tool: 'Apple Photos Clean Up' },
  // Apple files also carry a bare «Clean Up»; on anyone else's file that is a photo agency's
  // name, not a tool, so the maker has to agree before it counts.
  { pattern: /^clean\s?up$/i, tool: 'Apple Photos Clean Up', appleOnly: true },
  { pattern: /edited\s+with\s+google\s+ai|magic\s?(editor|eraser)|zoom\s?enhance|\bgoogle\s+ai\b/i, tool: 'Google AI' },
  { pattern: /\bgalaxy\s+ai\b|samsung\s+generative/i, tool: 'Galaxy AI' },
];

/**
 * The same credit line, but for features that blend several real frames without a model.
 * Anchored: the exact strings are unverified, and «Best Take Studio» in a credit is a name.
 */
const COMPOSITE_CREDITS: CreditMarker[] = [
  { pattern: /^best\s?take$/i, tool: 'Best Take' },
  { pattern: /^add\s?me$/i, tool: 'Add Me' },
];

/** The first marker whose pattern matches one whole credit line. */
function matchCredit(table: CreditMarker[], credits: string[], isApple: boolean): CreditMarker | null {
  for (const marker of table) {
    if (marker.appleOnly && !isApple) continue;
    if (credits.some((credit) => marker.pattern.test(credit.trim()))) return marker;
  }
  return null;
}

/** Credit lines wherever exifr filed them: IPTC-IIM 2:110, XMP `photoshop:Credit`, merged keys. */
function collectCredits(iptc: Record<string, unknown>, xmp: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ['Credit', 'credit']) {
    pushText(out, iptc[key]);
    pushText(out, xmp[key]);
  }
  pushText(out, xmp['photoshop:Credit']);
  const photoshop = xmp.photoshop;
  if (photoshop && typeof photoshop === 'object') {
    pushText(out, (photoshop as Record<string, unknown>).Credit);
  }
  return out;
}

/** The scope a `DigitalSourceType` value claims; null when the term is not about generative work. */
export function digitalSourceScope(value: string | null): AiScope | null {
  if (!value) return null;
  const term = value.trim().split(/[/#]/).pop() ?? '';
  return DIGITAL_SOURCE_SCOPES[term.toLowerCase()] ?? null;
}

/**
 * `DigitalSourceType` wherever exifr put it: a top-level key, nested under `Iptc4xmpExt` /
 * `iptcExt`, or in the IPTC group of its own.
 */
function digitalSourceTypeOf(xmp: Record<string, unknown>, iptc: Record<string, unknown> | null): string | null {
  for (const source of [xmp, iptc ?? {}]) {
    const direct = source.DigitalSourceType ?? source.digitalSourceType ?? source['Iptc4xmpExt:DigitalSourceType'];
    if (typeof direct === 'string') return direct;
    for (const key of ['Iptc4xmpExt', 'iptcExt', 'iptc']) {
      const nested = source[key];
      if (nested && typeof nested === 'object') {
        const value = (nested as Record<string, unknown>).DigitalSourceType ?? (nested as Record<string, unknown>).digitalSourceType;
        if (typeof value === 'string') return value;
      }
    }
  }
  return null;
}

export function analyzeEditingHistory(
  metadata: Record<string, unknown>,
  xmp: Record<string, unknown>,
  lang: Lang,
  /** PNG header + text chunks (`groups.png`), where the generators leave their settings. */
  png?: Record<string, unknown> | null,
  /** IPTC-IIM fields (`groups.iptc`): the credit line the phone editors write. */
  iptc?: Record<string, unknown> | null
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

  /* ── Generative work ──────────────────────────────────────────────────────
   * Strongest evidence first: the generator's own settings in a PNG chunk, then its name in
   * the software tags, then the IPTC `DigitalSourceType` standard, then the credit line the
   * phone editors write, and only then the loose XMP guesses.
   */
  const pngMarkers = png ? findPngAiMarkers(png) : null;
  const xmpStr = JSON.stringify(xmp).toLowerCase();
  const searchText = [...softwareSources, xmpStr].join(' ');
  const namedGenerator = AI_MARKERS.find((marker) => marker.pattern.test(searchText)) ?? null;

  const digitalSourceType = digitalSourceTypeOf(xmp, iptc ?? null);
  const sourceScope = digitalSourceScope(digitalSourceType);
  const credits = collectCredits(iptc ?? {}, xmp);
  const creditText = credits.join('; ');
  const isApple = /apple/i.test(String(metadata.Make ?? metadata.make ?? ''));
  const editorHit = matchCredit(GENERATIVE_EDITORS, credits, isApple);
  const compositeHit = matchCredit(COMPOSITE_CREDITS, credits, isApple);
  const namedSoftware = softwareSources.find((sw) => !isCameraFirmware(sw)) ?? null;

  let aiScope: AiScope = 'none';
  let aiTool: string | null = null;
  let aiEvidence: string | null = null;
  let aiDetails: AiDetails | null = null;

  if (pngMarkers) {
    aiScope = 'generated';
    aiTool = pngMarkers.tool;
    aiEvidence = `PNG ${pngMarkers.details.chunk}`;
    aiDetails = pngMarkers.details;
  } else if (namedGenerator) {
    aiScope = 'generated';
    aiTool = namedGenerator.tool;
    aiEvidence = namedSoftware ? `Software: ${namedSoftware}` : 'XMP';
  } else if (sourceScope) {
    // The one industry standard the tools write themselves: OpenAI, Adobe, Google, Microsoft
    // and Apple all mark their output here, and the term says whether it is the whole picture.
    aiScope = sourceScope;
    aiTool = editorHit?.tool ?? compositeHit?.tool ?? namedSoftware ?? 'AI (IPTC DigitalSourceType)';
    aiEvidence = `DigitalSourceType: ${digitalSourceType}`;
  } else if (editorHit) {
    aiScope = 'edited';
    aiTool = editorHit.tool;
    aiEvidence = `Credit: ${creditText}`;
  } else if (compositeHit) {
    aiScope = 'composite';
    aiTool = compositeHit.tool;
    aiEvidence = `Credit: ${creditText}`;
  } else if (xmpStr.includes('"ai_type"') || xmpStr.includes('"source":"ai"') || xmpStr.includes('generative')) {
    aiScope = 'generated';
    aiTool = 'AI (unknown)';
    aiEvidence = 'XMP';
  }

  return {
    edited: foundSoftware.length > 0,
    software: foundSoftware,
    editingLevel: maxLevel,
    hints,
    aiScope,
    aiTool,
    aiEvidence,
    aiDetails,
  };
}
