import type { BasicFileInfo, StructuredMetadata } from '../types/metadata';
import type { BoundingBox } from '../types/detection';
import type { OCRResult } from '../hooks/useOCR';
import type { ContentCredentialsState } from '../hooks/useContentCredentials';
import type { FrameStats } from '../hooks/useFrameStats';
import type { PlateCandidate } from './plates';
import type { QrCode } from './qr';
import type { PiiFinding } from './pii';
import { analyzeFilename, type FilenameAnalysis } from './heuristics/filenameAnalyzer';
import { analyzeResolution, type ResolutionAnalysis } from './heuristics/resolutionAnalyzer';
import { detectStrippedMetadata, hasCameraExif, type StrippedAnalysis } from './heuristics/strippedDetector';
import { analyzeEditingHistory, type EditingAnalysis } from './heuristics/editingHistory';
import { analyzeDateTime, type TemporalInsight } from './heuristics/temporalAnalyzer';
import type { HashResult } from './heuristics/hashAnalyzer';
import { generateDigitalProfile, type DigitalProfile, type ProfilePart } from './heuristics/digitalProfile';
import { judgeOrigin, type OriginJudgement } from './originJudge';
import { judgeCompression, type CompressionVerdict, type JpegSignals } from './jpegQuant';
import { scoreScreenshot, type ScreenshotScore } from './screenshot';
import { buildFileHistory, type FileEvent } from './fileHistory';

/** What the heuristics over the file worked out, kept next to the profile for the origin card and the raw table. */
export interface ProData {
  filename: FilenameAnalysis;
  resolution: ResolutionAnalysis;
  stripped: StrippedAnalysis;
  editing: EditingAnalysis;
  hash: HashResult | null;
  temporal: TemporalInsight[];
  /** The one verdict on where the file has been since the shutter, with its grounds. */
  origin: OriginJudgement;
  /** The JPEG tables against the maker in EXIF; null for other containers. */
  compression: CompressionVerdict | null;
  /** The screenshot probability with its reasons. */
  screenshot: ScreenshotScore;
  /** What happened to the file after the shutter, as dated events. */
  history: FileEvent[];
}

export interface ProfileBuildInput {
  fileInfo: BasicFileInfo;
  metadata: StructuredMetadata | null;
  /** The byte hash and the perceptual hash; null when they could not be computed. */
  hash: HashResult | null;
  jpeg: JpegSignals | null;
  frame: FrameStats | null;
  credentials: ContentCredentialsState;
  detections: BoundingBox[];
  ocrResult: OCRResult | null;
  plates: PlateCandidate[];
  qrCodes: QrCode[];
  pii: PiiFinding[];
  lang: 'ru' | 'en' | 'uz';
}

export interface ProfileBuild {
  profile: DigitalProfile;
  /** Null when the file's origin could not be worked out (`profile.undetermined` names it). */
  proData: ProData | null;
}

type OriginFacts = Omit<ProData, 'hash' | 'temporal'>;

/**
 * Everything the «where the file has been» verdict rests on: the name, the size, the editing
 * tags, the stripped detector, the JPEG tables, the screenshot score and the file history. They
 * feed one judge, so they stand or fall together.
 */
function originFacts({ fileInfo, metadata, hash, jpeg, frame, credentials, lang }: ProfileBuildInput): OriginFacts {
  const originalName = fileInfo.originalName ?? fileInfo.file.name;
  const filename = analyzeFilename(originalName, lang);
  const resolution = analyzeResolution(fileInfo.width, fileInfo.height, lang);
  const exif = metadata?.groups?.exif ?? {};
  const xmp = metadata?.groups?.xmp ?? {};
  const editing = analyzeEditingHistory(exif, xmp, lang, metadata?.groups?.png ?? null, metadata?.groups?.iptc ?? null);
  // Make / Model / DateTimeOriginal, not the six-field resolution stub every re-encoder
  // writes: a Telegram file carries that stub and used to count as «metadata preserved».
  const cameraExif = hasCameraExif(exif);
  const stripped = detectStrippedMetadata({
    filename: originalName,
    filenameAnalysis: filename,
    mimeType: fileInfo.mimeType,
    width: fileInfo.width,
    height: fileInfo.height,
    hasExif: cameraExif,
    hasSoftwareTag: !!(exif.Software ?? exif.software ?? xmp.CreatorTool ?? xmp.creatorTool),
    // PNG text chunks, XMP and IPTC are metadata too: a generator's «parameters» chunk is
    // exactly the thing the card used to call «метаданные были удалены».
    hasOtherMetadata:
      Object.keys(metadata?.groups?.png ?? {}).length > 0 ||
      Object.keys(xmp).length > 0 ||
      Object.keys(metadata?.groups?.iptc ?? {}).length > 0,
    lang
  });
  const originalMime = fileInfo.originalMimeType ?? fileInfo.mimeType;
  const compression = jpeg ? judgeCompression(jpeg, metadata?.cameraMake) : null;
  const screenshot = scoreScreenshot({
    filenameScreenshot: filename.isScreenshot,
    knownScreenSize: resolution.isScreenshot,
    hasCameraExif: Boolean(metadata?.cameraMake || metadata?.cameraModel),
    hasShotDate: Boolean(metadata?.shotDateLocal),
    mimeType: originalMime,
    flatRatio: frame?.flatRatio ?? null
  });
  const history = buildFileHistory({
    metadata: metadata ?? null,
    editing,
    stripped,
    credentials: credentials.data ?? null,
    lastModified: (fileInfo.originalFile ?? fileInfo.file).lastModified || null,
    width: fileInfo.originalWidth ?? fileInfo.width,
    height: fileInfo.originalHeight ?? fileInfo.height,
    phash: hash?.phash ?? null
  });
  // One verdict over every sign, so the rows of the origin card stop contradicting each other.
  const origin = judgeOrigin({
    mimeType: originalMime,
    width: fileInfo.width,
    height: fileInfo.height,
    hasCameraExif: cameraExif,
    filename,
    stripped,
    editing,
    compression,
    livePhoto: Boolean(metadata?.apple?.livePhoto),
    motionPhoto: metadata?.samsung?.motionPhotoBytes != null,
    modifiedLater: history.some((event) => event.kind === 'modified' && event.at != null),
    resized: history.some((event) => event.kind === 'resized'),
    thumbnailDiffers: history.some((event) => event.kind === 'thumbnail' && event.same === false),
    screenshotLikely: filename.isScreenshot || screenshot.level === 'likely' || screenshot.level === 'certain'
  });
  return { filename, resolution, stripped, editing, origin, compression, screenshot, history };
}

/**
 * The digital profile of one file from what the hooks have read so far. Pure and synchronous.
 *
 * The heuristics read tags a stranger's file wrote, so any of them can meet a value it did not
 * expect and throw. Two parts fail on their own, and the rest of the profile is still built:
 * the reading of the shot time (`time`) and the group behind the origin verdict (`origin`).
 * A failed part is named in `profile.undetermined`; nothing is put in its place — a neutral
 * stand-in would read as «не редактировался» or «дата не найдена», which the file never said.
 * Anything else that throws leaves this function, and the caller shows the whole section as
 * not analysed.
 */
export function buildProfile(input: ProfileBuildInput): ProfileBuild {
  const { fileInfo, metadata, hash, lang } = input;
  const undetermined: ProfilePart[] = [];

  let temporal: TemporalInsight[] = [];
  try {
    // Wall-clock of the camera, not the viewer's zone: "night photo" must be night where it was taken.
    temporal = analyzeDateTime(metadata?.shotDateLocal ?? metadata?.shotDate, lang);
  } catch (err) {
    console.warn('digital-profile: time', err);
    undetermined.push('time');
  }

  let facts: OriginFacts | null = null;
  try {
    facts = originFacts(input);
  } catch (err) {
    console.warn('digital-profile: origin', err);
    undetermined.push('origin');
  }

  const profile = generateDigitalProfile({
    filename: facts?.filename ?? null,
    resolution: facts?.resolution ?? null,
    stripped: facts?.stripped ?? null,
    editing: facts?.editing ?? null,
    hash,
    temporal,
    origin: facts?.origin ?? null,
    undetermined,
    metadata,
    detections: input.detections,
    ocrResult: input.ocrResult,
    plates: input.plates,
    qrCodes: input.qrCodes,
    pii: input.pii,
    credentials: input.credentials.data,
    credentialsStatus: input.credentials.status,
    originalFilename: fileInfo.originalName ?? fileInfo.file.name,
    lang
  });

  return { profile, proData: facts ? { ...facts, hash, temporal } : null };
}
