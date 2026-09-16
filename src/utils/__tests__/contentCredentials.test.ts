import { describe, expect, it } from 'vitest';
import { detectC2paPresence, parseGenerator, sniffContainer, summarizeManifestStore, type ManifestStoreLike } from '../contentCredentials';

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());

function jpegSegment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 255, length & 255, ...payload];
}
const app0 = jpegSegment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const jumbfPayload = [...ascii('JP'), 0, 1, 0, 0, 0, 0, ...be32(40), ...ascii('jumb'), ...be32(32), ...ascii('jumd'), ...new Array(16).fill(0), 3, ...ascii('c2pa'), 0];
const sos = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xff, 0xd9];

function pngChunk(type: string, data: number[]): number[] {
  return [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}
const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ihdr = pngChunk('IHDR', new Array(13).fill(0));

function riff(chunks: number[][]): Uint8Array {
  const body = chunks.flat();
  return bytes(ascii('RIFF'), le32(body.length + 4), ascii('WEBP'), body);
}
const riffChunk = (fourcc: string, data: number[]) => [...ascii(fourcc), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : [])];

function box(type: string, payload: number[]): number[] {
  return [...be32(8 + payload.length), ...ascii(type), ...payload];
}
const ftyp = box('ftyp', [...ascii('heic'), 0, 0, 0, 0, ...ascii('mif1heic')]);
const C2PA_UUID = [0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81];

describe('sniffContainer', () => {
  it('recognises JPEG, PNG, WebP and ISO BMFF by their magic bytes', () => {
    expect(sniffContainer(bytes([0xff, 0xd8, 0xff], app0))).toBe('jpeg');
    expect(sniffContainer(bytes(pngSig, ihdr))).toBe('png');
    expect(sniffContainer(riff([riffChunk('VP8 ', [0, 0])]))).toBe('webp');
    expect(sniffContainer(bytes(ftyp))).toBe('bmff');
    expect(sniffContainer(bytes(ascii('GIF89a')))).toBe('unknown');
  });
});

describe('detectC2paPresence', () => {
  it('finds the JUMBF manifest in a JPEG APP11 segment and only there', () => {
    expect(detectC2paPresence(bytes([0xff, 0xd8], app0, jpegSegment(0xeb, jumbfPayload), sos))).toBe(true);
    // the same words inside a COM segment are just text
    expect(detectC2paPresence(bytes([0xff, 0xd8], app0, jpegSegment(0xfe, [...ascii('jumb c2pa in a comment')]), sos))).toBe(false);
    // an APP11 that is not JUMBF
    expect(detectC2paPresence(bytes([0xff, 0xd8], app0, jpegSegment(0xeb, [...ascii('XX'), ...ascii('jumbc2pa')]), sos))).toBe(false);
    expect(detectC2paPresence(bytes([0xff, 0xd8], app0, sos))).toBe(false);
  });

  it('stops at the scan data instead of scanning megabytes of pixels', () => {
    const afterSos = bytes([0xff, 0xd8], app0, sos, jpegSegment(0xeb, jumbfPayload));
    expect(detectC2paPresence(afterSos)).toBe(false);
  });

  it('finds the caBX chunk in PNG', () => {
    expect(detectC2paPresence(bytes(pngSig, ihdr, pngChunk('caBX', [1, 2, 3]), pngChunk('IEND', [])))).toBe(true);
    expect(detectC2paPresence(bytes(pngSig, ihdr, pngChunk('tEXt', ascii('caBX')), pngChunk('IEND', [])))).toBe(false);
  });

  it('finds the C2PA chunk in WebP', () => {
    expect(detectC2paPresence(riff([riffChunk('VP8 ', [0, 0]), riffChunk('C2PA', [1, 2, 3])]))).toBe(true);
    expect(detectC2paPresence(riff([riffChunk('VP8 ', [0, 0]), riffChunk('EXIF', [1, 2])]))).toBe(false);
  });

  it('finds the C2PA uuid box (or a bare jumb box) in HEIC/AVIF', () => {
    expect(detectC2paPresence(bytes(ftyp, box('uuid', [...C2PA_UUID, 1, 2, 3])))).toBe(true);
    expect(detectC2paPresence(bytes(ftyp, box('jumb', [0, 0])))).toBe(true);
    expect(detectC2paPresence(bytes(ftyp, box('uuid', [...new Array(16).fill(7), 1]), box('mdat', [0])))).toBe(false);
  });

  it('tolerates a 64-bit box size and truncated input', () => {
    const large = [...be32(1), ...ascii('mdat'), ...be32(0), ...be32(16)];
    expect(detectC2paPresence(bytes(ftyp, large, box('uuid', C2PA_UUID)))).toBe(true);
    expect(detectC2paPresence(bytes([0xff, 0xd8, 0xff]))).toBe(false);
    expect(detectC2paPresence(new Uint8Array(0))).toBe(false);
  });
});

describe('parseGenerator', () => {
  it('turns the claim generator user-agent into a product name', () => {
    expect(parseGenerator('Adobe_Photoshop/25.0 (Windows)')).toBe('Adobe Photoshop 25.0');
    expect(parseGenerator('c2pa-rs/0.36.0')).toBe('c2pa-rs 0.36.0');
    expect(parseGenerator('Leica Camera AG M11-P')).toBe('Leica Camera AG M11-P');
  });
});

describe('summarizeManifestStore', () => {
  const store = (manifest: Partial<ManifestStoreLike['activeManifest']>, extra: Partial<ManifestStoreLike> = {}): ManifestStoreLike => ({
    manifests: { 'urn:uuid:1': {} },
    activeManifest: manifest,
    validationStatus: [],
    ...extra
  });

  it('reads generator, producer, signer and actions from a camera-style manifest', () => {
    const summary = summarizeManifestStore(
      store({
        claimGenerator: 'Leica_M11-P/1.0',
        signatureInfo: { issuer: 'Leica Camera AG', time: '2026-06-14T18:30:00Z' },
        ingredients: [],
        assertions: {
          data: [
            { label: 'c2pa.actions', data: { actions: [{ action: 'c2pa.created', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture' }] } },
            { label: 'stds.schema-org.CreativeWork', data: { author: [{ '@type': 'Person', name: 'S. Morgunov' }] } }
          ]
        }
      })
    );
    expect(summary).toMatchObject({
      generator: 'Leica M11-P 1.0',
      producer: 'S. Morgunov',
      issuer: 'Leica Camera AG',
      signedAt: '2026-06-14T18:30:00Z',
      valid: true,
      failures: [],
      generative: 'none',
      generativeAgents: [],
      actions: ['c2pa.created'],
      ingredients: 0,
      manifests: 1
    });
  });

  it('flags generative AI from the digitalSourceType and names the tool', () => {
    const summary = summarizeManifestStore(
      store({
        claimGeneratorInfo: [{ name: 'Adobe Firefly', version: '3.0' }],
        assertions: {
          data: [
            {
              label: 'c2pa.actions.v2',
              data: {
                actions: [
                  {
                    action: 'c2pa.created',
                    digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
                    softwareAgent: { name: 'Adobe Firefly', version: '3.0' }
                  }
                ]
              }
            }
          ]
        }
      })
    );
    expect(summary.generative).toBe('trainedAlgorithmicMedia');
    expect(summary.generativeAgents).toEqual(['Adobe Firefly 3.0']);
    expect(summary.generator).toBe('Adobe Firefly 3.0');
  });

  it('treats a composite edit as composite unless a full generation is also declared', () => {
    const composite = summarizeManifestStore(
      store({
        assertions: {
          data: [
            {
              label: 'c2pa.actions',
              data: {
                actions: [
                  { action: 'c2pa.edited', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia', softwareAgent: 'Adobe_Photoshop/25.0' }
                ]
              }
            }
          ]
        }
      })
    );
    expect(composite.generative).toBe('compositeWithTrainedAlgorithmicMedia');
    expect(composite.generativeAgents).toEqual(['Adobe Photoshop 25.0']);

    const legacy = summarizeManifestStore(store({ assertions: { data: [{ label: 'com.adobe.generative-ai', data: { description: 'Adobe Firefly' } }] } }));
    expect(legacy.generative).toBe('legacy');
    expect(legacy.generativeAgents).toEqual(['Adobe Firefly']);
  });

  it('prefers validationResults failures, falls back to validationStatus, and counts ingredients', () => {
    const failed = summarizeManifestStore(
      store(
        { ingredients: [{}, {}] },
        { validationStatus: [{ code: 'signingCredential.untrusted' }], validationResults: { activeManifest: { failure: [{ code: 'assertion.dataHash.mismatch' }] } } }
      )
    );
    expect(failed.valid).toBe(false);
    expect(failed.failures).toEqual(['assertion.dataHash.mismatch']);
    expect(failed.ingredients).toBe(2);

    const legacyStatus = summarizeManifestStore(store({}, { validationStatus: [{ code: 'signingCredential.untrusted' }], validationResults: null }));
    expect(legacyStatus.failures).toEqual(['signingCredential.untrusted']);

    const clean = summarizeManifestStore(store({}, { validationResults: { activeManifest: { failure: [] } }, validationStatus: [{ code: 'ignored' }] }));
    expect(clean.valid).toBe(true);
  });
});
