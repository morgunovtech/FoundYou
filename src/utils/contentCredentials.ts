/**
 * Content Credentials (C2PA) — the signed provenance manifest some cameras, editors and AI
 * generators embed. Presence is detected by walking the container ourselves (a few bytes,
 * no library); only when a manifest is really there do we load the self-hosted c2pa toolkit
 * (worker + WASM under /c2pa/) to parse and validate it. Nothing leaves the device.
 */
export type GenerativeKind = 'none' | 'trainedAlgorithmicMedia' | 'compositeWithTrainedAlgorithmicMedia' | 'legacy';

export interface ContentCredentials {
  /** Software that produced the manifest, e.g. "Adobe Photoshop 25.0". */
  generator: string | null;
  /** Author from the CreativeWork assertion, when declared. */
  producer: string | null;
  /** Certificate issuer that signed the manifest. */
  issuer: string | null;
  /** ISO timestamp of the signature. */
  signedAt: string | null;
  /** True when the active manifest has no validation failures. */
  valid: boolean;
  /** Validation failure codes, e.g. "assertion.dataHash.mismatch". */
  failures: string[];
  generative: GenerativeKind;
  /** Generative tools named in the actions, e.g. ["Adobe Firefly"]. */
  generativeAgents: string[];
  /** Action labels in order, e.g. ["c2pa.created", "c2pa.edited"]. */
  actions: string[];
  ingredients: number;
  manifests: number;
}

/* ── presence detection (no library) ────────────────────── */

const ASCII = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const JUMB = ASCII('jumb');
const C2PA = ASCII('c2pa');
/** UUID of the C2PA box in ISO BMFF (HEIF/HEIC/AVIF/MP4). */
const C2PA_BMFF_UUID = [0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81];

function indexOf(bytes: Uint8Array, needle: number[], from = 0, to = bytes.length): number {
  outer: for (let i = from; i <= to - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function equals(bytes: Uint8Array, offset: number, needle: number[]): boolean {
  if (offset + needle.length > bytes.length) return false;
  for (let i = 0; i < needle.length; i++) if (bytes[offset + i] !== needle[i]) return false;
  return true;
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/** JPEG: an APP11 segment carrying a JUMBF box whose description names "c2pa". */
function jpegHasC2pa(bytes: Uint8Array): boolean {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return false; // EOI / SOS: metadata is over
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return false;
    const payloadStart = offset + 4;
    const payloadEnd = Math.min(bytes.length, offset + 2 + length);
    if (marker === 0xeb && bytes[payloadStart] === 0x4a && bytes[payloadStart + 1] === 0x50) {
      if (indexOf(bytes, JUMB, payloadStart, payloadEnd) !== -1 && indexOf(bytes, C2PA, payloadStart, payloadEnd) !== -1) {
        return true;
      }
    }
    offset = payloadEnd;
  }
  return false;
}

/** PNG: the `caBX` chunk. */
function pngHasC2pa(bytes: Uint8Array): boolean {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = u32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === 'caBX') return true;
    if (type === 'IEND' || type === 'IDAT') return false;
    offset += 12 + length;
  }
  return false;
}

/** RIFF/WebP: a `C2PA` chunk. */
function riffHasC2pa(bytes: Uint8Array): boolean {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = u32le(bytes, offset + 4);
    if (fourcc === 'C2PA') return true;
    offset += 8 + size + (size % 2);
  }
  return false;
}

/** ISO BMFF (HEIC/HEIF/AVIF): a top-level `uuid` box with the C2PA UUID, or a bare `jumb` box. */
function bmffHasC2pa(bytes: Uint8Array): boolean {
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = u32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) return false;
      // 64-bit size: high word must be zero for anything we can address.
      if (u32(bytes, offset + 8) !== 0) return false;
      size = u32(bytes, offset + 12);
      header = 16;
    } else if (size === 0) {
      size = bytes.length - offset;
    }
    if (size < header) return false;
    if (type === 'jumb') return true;
    if (type === 'uuid' && equals(bytes, offset + header, C2PA_BMFF_UUID)) return true;
    offset += size;
  }
  return false;
}

export type ContainerKind = 'jpeg' | 'png' | 'webp' | 'bmff' | 'unknown';

export function sniffContainer(bytes: Uint8Array): ContainerKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 12 && equals(bytes, 0, ASCII('RIFF')) && equals(bytes, 8, ASCII('WEBP'))) return 'webp';
  if (bytes.length >= 12 && equals(bytes, 4, ASCII('ftyp'))) return 'bmff';
  return 'unknown';
}

/** True when the file carries a C2PA manifest store. Pure byte walk, no decoding. */
export function detectC2paPresence(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  switch (sniffContainer(bytes)) {
    case 'jpeg':
      return jpegHasC2pa(bytes);
    case 'png':
      return pngHasC2pa(bytes);
    case 'webp':
      return riffHasC2pa(bytes);
    case 'bmff':
      return bmffHasC2pa(bytes);
    default:
      return false;
  }
}

/* ── manifest summary (structural, testable without the toolkit) ─ */

interface AssertionLike {
  label: string;
  data: unknown;
}

interface ManifestLike {
  claimGenerator?: string | null;
  claimGeneratorInfo?: Array<{ name?: string; version?: string }> | null;
  signatureInfo?: { issuer?: string | null; time?: string | null } | null;
  ingredients?: unknown[];
  assertions?: { data?: AssertionLike[] } | null;
}

export interface ManifestStoreLike {
  manifests?: Record<string, unknown>;
  activeManifest: ManifestLike;
  validationStatus?: Array<{ code: string }>;
  validationResults?: { activeManifest?: { failure?: Array<{ code: string }> } } | null;
}

/** "Adobe_Photoshop/25.0 (Windows)" → "Adobe Photoshop 25.0" */
export function parseGenerator(value: string): string {
  const first = value.split(/\s+(?=\S+\/)/)[0] ?? value;
  const [name, version] = first.split('/');
  const cleanName = (name ?? '').replace(/_/g, ' ').trim();
  const cleanVersion = (version ?? '').replace(/\(.*$/, '').trim();
  return [cleanName, cleanVersion].filter(Boolean).join(' ').trim() || value.trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function agentName(agent: unknown): string | null {
  if (typeof agent === 'string') return parseGenerator(agent);
  const record = asRecord(agent);
  if (!record) return null;
  const name = typeof record.name === 'string' ? record.name : null;
  const version = typeof record.version === 'string' ? record.version : null;
  return name ? [name, version].filter(Boolean).join(' ') : null;
}

export function summarizeManifestStore(store: ManifestStoreLike): ContentCredentials {
  const manifest = store.activeManifest;
  const assertions = manifest.assertions?.data ?? [];

  const info = manifest.claimGeneratorInfo?.[0];
  const generator = info?.name
    ? [info.name, info.version].filter(Boolean).join(' ')
    : manifest.claimGenerator
      ? parseGenerator(manifest.claimGenerator)
      : null;

  let producer: string | null = null;
  const actions: string[] = [];
  const agents = new Set<string>();
  let generative: GenerativeKind = 'none';

  for (const assertion of assertions) {
    const data = asRecord(assertion.data);
    if (!data) continue;
    if (assertion.label.startsWith('stds.schema-org.CreativeWork')) {
      const authors = Array.isArray(data.author) ? data.author : [];
      const first = asRecord(authors[0]);
      if (first && typeof first.name === 'string' && !producer) producer = first.name;
    }
    if (assertion.label.startsWith('c2pa.actions')) {
      const list = Array.isArray(data.actions) ? data.actions : [];
      for (const item of list) {
        const action = asRecord(item);
        if (!action) continue;
        if (typeof action.action === 'string') actions.push(action.action);
        const sourceType = typeof action.digitalSourceType === 'string' ? action.digitalSourceType : '';
        if (sourceType.includes('compositeWithTrainedAlgorithmicMedia')) {
          if (generative === 'none' || generative === 'legacy') generative = 'compositeWithTrainedAlgorithmicMedia';
          const agent = agentName(action.softwareAgent);
          if (agent) agents.add(agent);
        } else if (sourceType.includes('trainedAlgorithmicMedia')) {
          generative = 'trainedAlgorithmicMedia';
          const agent = agentName(action.softwareAgent);
          if (agent) agents.add(agent);
        }
      }
    }
    if (assertion.label.startsWith('com.adobe.generative-ai')) {
      if (generative === 'none') generative = 'legacy';
      const desc = typeof data.description === 'string' ? data.description : null;
      if (desc) agents.add(desc);
    }
  }

  const failures = (store.validationResults?.activeManifest?.failure ?? store.validationStatus ?? []).map((s) => s.code);

  return {
    generator,
    producer,
    issuer: manifest.signatureInfo?.issuer ?? null,
    signedAt: manifest.signatureInfo?.time ?? null,
    valid: failures.length === 0,
    failures,
    generative,
    generativeAgents: Array.from(agents),
    actions,
    ingredients: manifest.ingredients?.length ?? 0,
    manifests: Object.keys(store.manifests ?? {}).length || 1
  };
}

/* ── toolkit loading (lazy, self-hosted) ─────────────────── */

export const C2PA_WASM_URL = '/c2pa/toolkit_bg.wasm';
export const C2PA_WORKER_URL = '/c2pa/c2pa.worker.min.js';

type C2paInstance = { read(input: Blob): Promise<{ manifestStore: unknown | null }> };
let instance: Promise<C2paInstance> | null = null;

function getToolkit(): Promise<C2paInstance> {
  if (!instance) {
    instance = import('c2pa')
      .then(({ createC2pa }) => createC2pa({ wasmSrc: C2PA_WASM_URL, workerSrc: C2PA_WORKER_URL }) as unknown as Promise<C2paInstance>)
      .catch((err: unknown) => {
        instance = null;
        throw err;
      });
  }
  return instance;
}

const MIME_BY_CONTAINER: Record<ContainerKind, string | null> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  bmff: 'image/heic',
  unknown: null
};

/**
 * Parses and validates the manifest store of a file that `detectC2paPresence` said carries one.
 * Returns null when the toolkit finds no manifest after all.
 */
export async function readContentCredentials(file: File, bytes: Uint8Array): Promise<ContentCredentials | null> {
  const c2pa = await getToolkit();
  const container = sniffContainer(bytes);
  const mime = file.type || MIME_BY_CONTAINER[container] || 'application/octet-stream';
  const input = file.type ? file : new File([file], file.name || 'image', { type: mime });
  const { manifestStore } = await c2pa.read(input);
  if (!manifestStore) return null;
  return summarizeManifestStore(manifestStore as ManifestStoreLike);
}
