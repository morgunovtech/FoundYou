/**
 * Web Share API for the cleaned file: on a phone the safe copy goes straight into the
 * messenger's share sheet instead of the gallery. Feature-detected, never assumed.
 */
export type ShareOutcome = 'shared' | 'cancelled' | 'needs-gesture' | 'unsupported' | 'failed';

function probeFile(): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'probe.jpg', { type: 'image/jpeg' });
}

export function canShareFiles(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [probeFile()] });
  } catch {
    return false;
  }
}

/**
 * Shares one file. `needs-gesture` means the browser's activation window closed while the
 * export was running: keep the file and let the user tap once more.
 */
export async function shareFile(
  file: File,
  title?: string,
  nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator
): Promise<ShareOutcome> {
  if (!canShareFiles(nav) || !nav) return 'unsupported';
  try {
    if (!nav.canShare({ files: [file] })) return 'unsupported';
    await nav.share({ files: [file], title });
    return 'shared';
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError' || name === 'InvalidStateError' || name === 'SecurityError') return 'needs-gesture';
    return 'failed';
  }
}
