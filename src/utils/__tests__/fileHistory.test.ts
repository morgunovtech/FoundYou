import { describe, expect, it } from 'vitest';
import { buildFileHistory, type FileHistoryInput } from '../fileHistory';
import type { StructuredMetadata } from '../../types/metadata';

function metadata(over: Partial<StructuredMetadata> = {}, exif: Record<string, unknown> = {}): StructuredMetadata {
  return { groups: { exif, xmp: {}, iptc: {}, icc: {} }, completeness: 0, ...over };
}

function input(over: Partial<FileHistoryInput> = {}): FileHistoryInput {
  return {
    metadata: metadata({ shotDateLocal: '2026-06-14T18:30:12', cameraMake: 'samsung', cameraModel: 'SM-S918B' }),
    editing: null,
    stripped: null,
    credentials: null,
    lastModified: null,
    width: 4000,
    height: 3000,
    phash: null,
    ...over
  };
}

const kinds = (events: ReturnType<typeof buildFileHistory>) => events.map((e) => e.kind);

describe('buildFileHistory', () => {
  it('starts with the shot and adds nothing for an untouched original', () => {
    const events = buildFileHistory(input());
    expect(kinds(events)).toEqual(['shot']);
    expect(events[0]).toMatchObject({ at: '2026-06-14T18:30:12', agent: 'samsung SM-S918B' });
  });

  it('reads ModifyDate later than the shot as a modification, with the editor when known', () => {
    // exifr revives EXIF dates into local-field Dates.
    const modified = new Date(2026, 5, 20, 12, 0, 0);
    const events = buildFileHistory(
      input({
        metadata: metadata({ shotDateLocal: '2026-06-14T18:30:12' }, { ModifyDate: modified }),
        editing: { edited: true, software: ['Snapseed'], editingLevel: 'basic', hints: [], isAiGenerated: false, aiTool: null }
      })
    );
    expect(events.find((e) => e.kind === 'modified')).toEqual({ kind: 'modified', at: '2026-06-20T12:00:00', agent: 'Snapseed' });
  });

  it('ignores a ModifyDate equal to the shot, but still lists an editor', () => {
    const same = new Date(2026, 5, 14, 18, 30, 12);
    expect(kinds(buildFileHistory(input({ metadata: metadata({ shotDateLocal: '2026-06-14T18:30:12' }, { ModifyDate: same }) })))).toEqual(['shot']);
    const edited = buildFileHistory(
      input({
        metadata: metadata({ shotDateLocal: '2026-06-14T18:30:12' }, { ModifyDate: same }),
        editing: { edited: true, software: ['Adobe Lightroom'], editingLevel: 'professional', hints: [], isAiGenerated: false, aiTool: null }
      })
    );
    expect(edited.find((e) => e.kind === 'modified')).toEqual({ kind: 'modified', at: null, agent: 'Adobe Lightroom' });
  });

  it('sees a downscale when the EXIF pixel size is bigger than the picture', () => {
    const events = buildFileHistory(input({ metadata: metadata({}, { ExifImageWidth: 4000, ExifImageHeight: 3000 }), width: 1600, height: 1200 }));
    expect(events.find((e) => e.kind === 'resized')).toEqual({
      kind: 'resized',
      at: null,
      agent: null,
      from: { width: 4000, height: 3000 },
      to: { width: 1600, height: 1200 }
    });
    // A rotated original (sides swapped) is not a resize.
    expect(kinds(buildFileHistory(input({ metadata: metadata({}, { ExifImageWidth: 3000, ExifImageHeight: 4000 }) })))).not.toContain('resized');
  });

  it('names the messenger or reports stripped metadata', () => {
    const viaTelegram = buildFileHistory(input({ stripped: { stripped: true, strippedBy: 'Telegram', confidence: 0.9, evidence: ['sign'] } }));
    expect(viaTelegram.find((e) => e.kind === 'messenger')).toMatchObject({ agent: 'Telegram', evidence: 'sign' });
    const unknown = buildFileHistory(input({ stripped: { stripped: true, strippedBy: null, confidence: 0.6, evidence: [] } }));
    expect(unknown.find((e) => e.kind === 'stripped')).toMatchObject({ evidence: null });
  });

  it('lists a signature, an AI marker and the disk time when it is not the capture day', () => {
    const events = buildFileHistory(
      input({
        credentials: {
          generator: 'Adobe Firefly',
          producer: null,
          issuer: 'Adobe Inc.',
          signedAt: '2026-06-15T10:00:00Z',
          actions: [],
          ingredients: 0,
          generative: 'full',
          generativeAgents: ['Adobe Firefly'],
          valid: true,
          failures: []
        } as never,
        lastModified: Date.UTC(2026, 8, 1, 9, 0, 0)
      })
    );
    expect(kinds(events)).toEqual(['shot', 'ai', 'signed', 'disk']);
    expect(events[1]).toMatchObject({ agent: 'Adobe Firefly', at: '2026-06-15T10:00:00Z' });
    expect(events[3].at).toBe('2026-09-01T09:00:00.000Z');
    // The disk time within a day of the shot is the capture itself, not an event.
    const fresh = buildFileHistory(input({ lastModified: Date.UTC(2026, 5, 14, 15, 0, 0) }));
    expect(kinds(fresh)).toEqual(['shot']);
  });

  it('compares the embedded thumbnail with the frame by aspect ratio and perceptual hash', () => {
    const thumb = { url: 'blob:x', width: 160, height: 120, bytes: 5000, phash: '0000000000000000' };
    const same = buildFileHistory(input({ metadata: metadata({ thumbnail: thumb }), phash: '0000000000000003' }));
    expect(same.find((e) => e.kind === 'thumbnail')).toEqual({ kind: 'thumbnail', at: null, agent: null, same: true, distance: 2 });
    const cropped = buildFileHistory(input({ metadata: metadata({ thumbnail: { ...thumb, width: 160, height: 160 } }), phash: 'ffffffffffffffff' }));
    expect(cropped.find((e) => e.kind === 'thumbnail')).toMatchObject({ same: false, distance: 64 });
    // No hashes: the ratio decides.
    const ratioOnly = buildFileHistory(input({ metadata: metadata({ thumbnail: { ...thumb, phash: null } }) }));
    expect(ratioOnly.find((e) => e.kind === 'thumbnail')).toMatchObject({ same: true, distance: null });
  });
});
