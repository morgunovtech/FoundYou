// @vitest-environment happy-dom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../../i18n/messages';
import type { BasicFileInfo, StructuredMetadata } from '../../types/metadata';

/*
 * Section 02 must leave «Собираем факты…» whatever the heuristics do with the file. Until 1.7.2
 * a throw inside the profile effect of App.tsx was caught and logged, and the section stayed
 * pending for good. Here the real App runs its real effect and the real StoryBlock; the hooks
 * that need a browser engine (decode, detection, OCR, QR, C2PA) are replaced by settled
 * answers, and one heuristic at a time is made to throw.
 */

const FILE: BasicFileInfo = {
  file: new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'IMG_0042.jpg', { type: 'image/jpeg' }),
  dataUrl: 'blob:test/source',
  thumbnailUrl: 'blob:test/thumb',
  width: 4032,
  height: 3024,
  aspectRatio: 4 / 3,
  sizeBytes: 4,
  mimeType: 'image/jpeg'
};

const METADATA: StructuredMetadata = {
  groups: { exif: { Make: 'Apple', Model: 'iPhone 15 Pro', Artist: 'Test Author' }, xmp: {}, iptc: {}, icc: {} },
  cameraMake: 'Apple',
  cameraModel: 'iPhone 15 Pro',
  shotDate: '2024-06-15T02:30:00.000Z',
  shotDateLocal: '2024-06-15T02:30:00',
  completeness: 0.5
};

/** Which heuristic throws in the current test. */
const broken = vi.hoisted(() => ({ editing: false, time: false, profile: false }));
const EMPTY = vi.hoisted(() => ({ detections: [] as never[], codes: [] as never[] }));

vi.mock('../../utils/heuristics/editingHistory', async (original) => {
  const actual = await original<typeof import('../../utils/heuristics/editingHistory')>();
  return {
    ...actual,
    analyzeEditingHistory: (...args: Parameters<typeof actual.analyzeEditingHistory>) => {
      if (broken.editing) throw new TypeError('editing heuristic: unexpected tag value');
      return actual.analyzeEditingHistory(...args);
    }
  };
});
vi.mock('../../utils/heuristics/temporalAnalyzer', async (original) => {
  const actual = await original<typeof import('../../utils/heuristics/temporalAnalyzer')>();
  return {
    ...actual,
    analyzeDateTime: (...args: Parameters<typeof actual.analyzeDateTime>) => {
      if (broken.time) throw new RangeError('temporal heuristic: invalid date');
      return actual.analyzeDateTime(...args);
    }
  };
});
vi.mock('../../utils/heuristics/digitalProfile', async (original) => {
  const actual = await original<typeof import('../../utils/heuristics/digitalProfile')>();
  return {
    ...actual,
    generateDigitalProfile: (...args: Parameters<typeof actual.generateDigitalProfile>) => {
      if (broken.profile) throw new Error('profile generator failed');
      return actual.generateDigitalProfile(...args);
    }
  };
});
vi.mock('../../utils/heuristics/hashAnalyzer', () => ({
  generateFileHash: () => Promise.resolve({ sha256: '0123456789abcdef'.repeat(4), phash: null })
}));

vi.mock('../../hooks/useImageFile', () => ({
  useImageFile: () => ({ fileInfo: FILE, error: null, warning: null, loading: false, processFile: () => Promise.resolve() })
}));
vi.mock('../../hooks/useExifMetadata', () => ({ useExifMetadata: () => ({ metadata: METADATA, loading: false, error: null }) }));
vi.mock('../../hooks/useContentCredentials', () => {
  const state = { status: 'none', data: null };
  return { useContentCredentials: () => state };
});
vi.mock('../../hooks/useImageAnalysis', () => ({
  useImageAnalysis: () => ({
    loading: false,
    error: null,
    detectionStatus: null,
    detections: EMPTY.detections,
    modelUnavailable: false,
    settledFile: FILE
  })
}));
vi.mock('../../hooks/useOCR', () => ({ useOCR: () => ({ loading: false, error: null, result: null, progress: null }) }));
vi.mock('../../hooks/useQrCodes', () => ({ useQrCodes: () => ({ codes: EMPTY.codes, loading: false }) }));
vi.mock('../../hooks/useContainerSignals', () => ({ useContainerSignals: () => null }));
vi.mock('../../hooks/useFrameStats', () => ({ useFrameStats: () => null }));

// The rest of the page is not under test and needs a canvas, a map or the design-system chrome.
vi.mock('../../components/SceneBlock', () => ({ SceneBlock: () => null }));
vi.mock('../../components/CleanupDownloadBlock', () => ({ CleanupDownloadBlock: () => null }));
vi.mock('../../components/story/FrameChecksCard', () => ({ FrameChecksCard: () => <div data-testid="frame-checks" /> }));
vi.mock('../../components/SiteContent', () => ({ SiteContent: () => null }));
vi.mock('../../components/VerifyBlock', () => ({ VerifyBlock: () => null }));
vi.mock('../../components/InfoBlock', () => ({ InfoBlock: () => null }));
vi.mock('../../components/UploadZone', () => ({ UploadZone: () => null }));
vi.mock('../../components/StickyActions', () => ({ StickyActions: () => null }));
vi.mock('../../components/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('../../components/SiteFooter', () => ({ SiteFooter: () => null }));

import App from '../../App';
import { I18nProvider } from '../../i18n';

const ru = messages.ru;
/** The text of a dictionary line up to its first placeholder, enough to find the line on the page. */
const head = (value: string) => value.split('{')[0];

/** happy-dom never decodes a picture: answer every load with an error, as a broken image would. */
class FailingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onerror?.());
  }
}

function renderApp() {
  return render(
    <I18nProvider>
      <App />
    </I18nProvider>
  );
}

/** Section 02 has settled when it shows either the index or the «could not» line. */
async function settled() {
  await waitFor(() => {
    expect(screen.queryByText(ru.factsPending)).toBeNull();
  });
}

describe('section 02 when a profile heuristic throws', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    broken.editing = false;
    broken.time = false;
    broken.profile = false;
    vi.stubGlobal('Image', FailingImage);
    window.history.replaceState(null, '', '/');
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('control: with nothing thrown the section shows the index and no failure line', async () => {
    renderApp();
    expect(screen.getByText(ru.factsPending)).toBeTruthy();
    await settled();

    expect(screen.getByText(ru.leakIndexTitle)).toBeTruthy();
    expect(screen.queryByText(ru.factsFailed)).toBeNull();
    expect(screen.queryByText(head(ru.factsPartial), { exact: false })).toBeNull();
    expect(screen.queryByText(ru.originUndetermined)).toBeNull();
    // The origin card carries its history rows.
    expect(screen.getByText(ru.historyCreated)).toBeTruthy();
  });

  it('a throw in the editing heuristic: the rest is shown and the origin part says it could not be determined', async () => {
    broken.editing = true;
    renderApp();
    await settled();

    // The index and the facts that do not rest on the failed group are there.
    expect(screen.getByText(ru.leakIndexTitle)).toBeTruthy();
    expect(screen.getByText(ru.authorTitle)).toBeTruthy();
    expect(screen.getByText('iPhone 15 Pro', { exact: false })).toBeTruthy();
    // The failed part is named under the index and in its own card, and nothing stands in for it.
    expect(screen.getByText(head(ru.factsPartial), { exact: false }).textContent).toContain(ru.factsPartOrigin);
    expect(screen.getByText(ru.originUndetermined)).toBeTruthy();
    expect(screen.queryByText(ru.historyNotEdited)).toBeNull();
    expect(screen.queryByText(ru.historyCreated)).toBeNull();
    expect(screen.queryByText(ru.factsFailed)).toBeNull();
    expect(warn).toHaveBeenCalledWith('digital-profile: origin', expect.any(TypeError));
  });

  it('a throw in the time heuristic: the time card stays and only its reading is marked', async () => {
    broken.time = true;
    renderApp();
    await settled();

    expect(screen.getByText(ru.leakIndexTitle)).toBeTruthy();
    const partial = screen.getByText(head(ru.factsPartial), { exact: false }).textContent ?? '';
    expect(partial).toContain(ru.factsPartTime);
    expect(partial).not.toContain(ru.factsPartOrigin);
    // The origin card is whole, and «в файле нет даты» is not claimed.
    expect(screen.getByText(ru.historyCreated)).toBeTruthy();
    expect(screen.queryByText(ru.leakMissingDate, { exact: false })).toBeNull();
    expect(warn).toHaveBeenCalledWith('digital-profile: time', expect.any(RangeError));
  });

  it('a throw the profile cannot route around: one calm line instead of the endless pending one', async () => {
    broken.profile = true;
    renderApp();
    await settled();

    const line = screen.getByText(ru.factsFailed);
    expect(line.getAttribute('role')).toBe('status');
    expect(screen.queryByText(ru.leakIndexTitle)).toBeNull();
    // What does not come from the profile is still on the page.
    expect(screen.getByText(ru.authorTitle)).toBeTruthy();
    expect(screen.getByTestId('frame-checks')).toBeTruthy();
    expect(warn).toHaveBeenCalledWith('digital-profile', expect.any(Error));
  });
});
