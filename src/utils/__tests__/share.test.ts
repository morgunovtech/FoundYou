import { describe, expect, it, vi } from 'vitest';
import { canShareFiles, shareFile } from '../share';

const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
const nav = (overrides: Partial<Navigator>): Navigator => ({ ...overrides }) as Navigator;

describe('canShareFiles', () => {
  it('is false without the API or when files are not shareable', () => {
    expect(canShareFiles(undefined)).toBe(false);
    expect(canShareFiles(nav({}))).toBe(false);
    expect(canShareFiles(nav({ share: vi.fn() }))).toBe(false);
    expect(canShareFiles(nav({ share: vi.fn(), canShare: () => false }))).toBe(false);
    expect(
      canShareFiles(
        nav({
          share: vi.fn(),
          canShare: () => {
            throw new TypeError('bad data');
          }
        })
      )
    ).toBe(false);
  });

  it('is true when the browser accepts a file payload', () => {
    expect(canShareFiles(nav({ share: vi.fn(), canShare: () => true }))).toBe(true);
  });
});

describe('shareFile', () => {
  it('reports success and passes the file', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareFile(file, 'title', nav({ share, canShare: () => true }))).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file], title: 'title' });
  });

  it('maps the browser errors to outcomes the UI can act on', async () => {
    const failing = (name: string) => nav({ share: vi.fn().mockRejectedValue(Object.assign(new Error(name), { name })), canShare: () => true });
    expect(await shareFile(file, undefined, failing('AbortError'))).toBe('cancelled');
    expect(await shareFile(file, undefined, failing('NotAllowedError'))).toBe('needs-gesture');
    expect(await shareFile(file, undefined, failing('InvalidStateError'))).toBe('needs-gesture');
    expect(await shareFile(file, undefined, failing('TypeError'))).toBe('failed');
  });

  it('is unsupported without the API or for a payload the browser refuses', async () => {
    expect(await shareFile(file, undefined, undefined)).toBe('unsupported');
    expect(await shareFile(file, undefined, nav({ share: vi.fn(), canShare: () => false }))).toBe('unsupported');
  });
});
