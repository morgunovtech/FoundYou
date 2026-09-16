import { describe, expect, it } from 'vitest';
import { SAMSUNG_TAIL_BYTES, mccCountry, parseSamsungTrailer } from '../samsungTrailer';

const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

interface Block {
  type: number;
  name: string;
  data: number[];
}

/** A JPEG stub followed by a Samsung trailer in the documented layout. */
function samsungFile(blocks: Block[], jpegBytes = 64): Uint8Array {
  const jpeg = [0xff, 0xd8, ...new Array(jpegBytes - 4).fill(0x11), 0xff, 0xd9];
  const encoded = blocks.map((b) => [...u32(b.type), ...u32(b.name.length), ...text(b.name), ...b.data]);
  const body = encoded.flat();
  const dirStart = jpeg.length + body.length;
  const entries: number[] = [];
  let position = jpeg.length;
  for (const block of encoded) {
    entries.push(...u32(0), ...u32(dirStart - position), ...u32(block.length));
    position += block.length;
  }
  const dir = [...text('SEFH'), ...u32(0x106), ...u32(blocks.length), ...entries];
  return new Uint8Array([...jpeg, ...body, ...dir, ...u32(dir.length), ...text('SEFT')]);
}

describe('parseSamsungTrailer', () => {
  it('returns null for files without a trailer', () => {
    expect(parseSamsungTrailer(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(parseSamsungTrailer(new Uint8Array(0))).toBeNull();
  });

  it('reads the SIM country, the UTC stamp and the block list', () => {
    const file = samsungFile([
      { type: 0x0a01, name: 'Image_UTC_Data', data: text('1718375412000') },
      { type: 0x0aa1, name: 'MCC_Data', data: text('434') },
      { type: 0x0c61, name: 'Camera_Scene_Info', data: [1, 2, 3, 4] }
    ]);
    const trailer = parseSamsungTrailer(file);
    expect(trailer).not.toBeNull();
    expect(trailer!.mcc).toBe('434');
    expect(trailer!.imageUtc).toBe('2024-06-14T14:30:12.000Z');
    expect(trailer!.motionPhotoBytes).toBeNull();
    expect(trailer!.blocks.map((b) => b.name)).toEqual(['Image_UTC_Data', 'MCC_Data', 'Camera_Scene_Info']);
    expect(trailer!.bytes).toBe(file.length - 64);
  });

  it('measures a Motion Photo video that starts before the tail window without reading it', () => {
    const video = new Array(SAMSUNG_TAIL_BYTES + 5000).fill(0x42);
    const file = samsungFile([
      { type: 0x0a30, name: 'MotionPhoto_Data', data: video },
      { type: 0x0aa1, name: 'MCC_Data', data: text('250') }
    ]);
    const tail = file.subarray(file.length - SAMSUNG_TAIL_BYTES);
    const trailer = parseSamsungTrailer(tail, file.length);
    expect(trailer!.mcc).toBe('250');
    expect(trailer!.motionPhotoBytes).toBe(8 + 'MotionPhoto_Data'.length + video.length);
    expect(trailer!.bytes).toBe(file.length - 64);
  });

  it('falls back to scanning names when the directory layout is unknown', () => {
    const body = [...text('....MCC_Data434....Image_UTC_Data1718375412000....')];
    const dir = [...text('SEFH'), ...u32(0x106), ...u32(1), ...u32(0), ...u32(0), ...u32(0)];
    const file = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, ...body, ...dir, ...u32(dir.length), ...text('SEFT')]);
    const trailer = parseSamsungTrailer(file);
    expect(trailer!.mcc).toBe('434');
    expect(trailer!.imageUtc).toBe('2024-06-14T14:30:12.000Z');
  });
});

describe('mccCountry', () => {
  it('maps common codes and rejects unknown ones', () => {
    expect(mccCountry('434')).toBe('UZ');
    expect(mccCountry('250')).toBe('RU');
    expect(mccCountry('310')).toBe('US');
    expect(mccCountry('001')).toBeNull();
    expect(mccCountry(null)).toBeNull();
  });
});
