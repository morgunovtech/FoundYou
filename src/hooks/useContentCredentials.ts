import { useEffect, useState } from 'react';
import type { BasicFileInfo } from '../types/metadata';
import { detectC2paPresence, readContentCredentials, type ContentCredentials } from '../utils/contentCredentials';

/**
 * `none` — no manifest in the file (decided locally in milliseconds, toolkit never loaded);
 * `found` — manifest parsed; `unavailable` — a manifest is there but the toolkit failed to
 * load or to read it (offline, unsupported container).
 */
export type CredentialsStatus = 'idle' | 'checking' | 'none' | 'found' | 'unavailable';

export interface ContentCredentialsState {
  status: CredentialsStatus;
  data: ContentCredentials | null;
}

interface Settled {
  file: File;
  state: ContentCredentialsState;
}

const IDLE: ContentCredentialsState = { status: 'idle', data: null };
const CHECKING: ContentCredentialsState = { status: 'checking', data: null };

export function useContentCredentials(fileInfo: BasicFileInfo | null): ContentCredentialsState {
  // The settled result is keyed by the file it belongs to, so a new file reads as "checking"
  // without a synchronous reset inside the effect.
  const [settled, setSettled] = useState<Settled | null>(null);
  const file = fileInfo ? fileInfo.originalFile ?? fileInfo.file : null;

  useEffect(() => {
    if (!file) return;
    let active = true;
    (async () => {
      let state: ContentCredentialsState;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!active) return;
        if (!detectC2paPresence(bytes)) {
          state = { status: 'none', data: null };
        } else {
          const data = await readContentCredentials(file, bytes);
          state = data ? { status: 'found', data } : { status: 'none', data: null };
        }
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[c2pa] read failed', err);
        state = { status: 'unavailable', data: null };
      }
      if (active) setSettled({ file, state });
    })();
    return () => {
      active = false;
    };
  }, [file]);

  if (!file) return IDLE;
  return settled && settled.file === file ? settled.state : CHECKING;
}
