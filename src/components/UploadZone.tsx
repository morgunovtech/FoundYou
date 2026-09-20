import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import clsx from 'clsx';
import { useT } from '../i18n';
import { ErrorBanner } from './ErrorBanner';
import { MAX_FILE_SIZE_MB } from '../hooks/useImageFile';

interface UploadZoneProps {
  loading: boolean;
  onFile: (file: File) => void;
  error?: string | null;
  /** A file that was accepted but has something wrong with it (today: cut short). Never blocks. */
  warning?: string | null;
  /** Receives the «open the picker» function so a button elsewhere (the sticky corner one) can call it. */
  pickerRef?: React.MutableRefObject<(() => void) | null>;
}

/** Shipped with the site, same origin: a photograph with an EXIF block written for the demo. */
const DEMO_URL = '/images/demo.jpg';
const DEMO_NAME = 'found-you-example.jpg';

const IMAGE_NAME_PATTERN = /\.(jpe?g|png|webp|avif|gif|bmp|heic|heif)$/i;

function looksLikeImage(file: File): boolean {
  return file.type.toLowerCase().startsWith('image/') || IMAGE_NAME_PATTERN.test(file.name);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export const UploadZone: React.FC<UploadZoneProps> = ({ loading, onFile, error, warning, pickerRef }) => {
  const t = useT();
  const uploadInputId = `upload-input-${useId().replace(/[:]/g, '')}`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Drop-side validation that never reaches useImageFile (non-image payloads,
  // several files at once). The hook's own error arrives via the `error` prop.
  const [localError, setLocalError] = useState<string | null>(null);
  const [localHint, setLocalHint] = useState<string | null>(null);
  // The sample is a file like any other once it is loaded; the flag only keeps the note on
  // screen that says so, and any file chosen afterwards clears it.
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoActive, setDemoActive] = useState(false);

  const openPicker = useCallback(() => {
    if (loading) return;
    inputRef.current?.click();
  }, [loading]);

  useEffect(() => {
    if (!pickerRef) return undefined;
    pickerRef.current = openPicker;
    return () => {
      pickerRef.current = null;
    };
  }, [pickerRef, openPicker]);

  const acceptFile = useCallback(
    (file: File) => {
      setLocalError(null);
      setDemoActive(false);
      onFile(file);
    },
    [onFile]
  );

  /**
   * «Попробовать на примере»: a prepared photograph shipped with the site, fetched from our
   * own origin and handed to the same pipeline as a dropped file. It exists because the first
   * screen otherwise asks a stranger to hand over their own photo to a service they have no
   * reason to trust yet — and because the first analysis downloads tens of megabytes of models
   * before showing anything at all. The note that follows says outright that the EXIF block was
   * written for the demonstration, so nobody reads its coordinates as a real place.
   */
  const loadDemo = useCallback(async () => {
    if (loading || demoLoading) return;
    setDemoLoading(true);
    setLocalError(null);
    setLocalHint(null);
    try {
      const response = await fetch(DEMO_URL);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      setDemoActive(true);
      onFile(new File([blob], DEMO_NAME, { type: blob.type || 'image/jpeg' }));
    } catch {
      setDemoActive(false);
      setLocalError(t('demoFailed'));
    } finally {
      setDemoLoading(false);
    }
  }, [demoLoading, loading, onFile, t]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      setLocalHint(files.length > 1 ? t('multipleFilesHint') : null);
      acceptFile(files[0]);
    },
    [acceptFile, t]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      if (loading) return;
      const files = event.dataTransfer.files;
      if (files.length === 0) return;
      const first = files[0];
      if (!looksLikeImage(first)) {
        setLocalHint(null);
        setLocalError(t('unsupportedFormat'));
        return;
      }
      handleFiles(files);
    },
    [handleFiles, loading, t]
  );

  // Clipboard paste anywhere on the page (except inside text fields) uploads
  // the first image item — screenshots land here without a save/drag detour.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (loading || isEditableTarget(event.target)) return;
      const items = event.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            setLocalHint(null);
            acceptFile(file);
          }
          return;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [acceptFile, loading]);

  const bannerMessage = error ?? localError;

  return (
    <section className="fy-card" aria-label={t('uploadButton')}>
      <div
        className={clsx('fy-drop', { 'is-drag-over': dragOver })}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragOver(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          id={uploadInputId}
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/heic,image/heif,.heic,.heif"
          className="sr-only"
          tabIndex={-1}
          aria-label={t('uploadButton')}
          onChange={(event) => {
            handleFiles(event.target.files);
            if (event.target) event.target.value = '';
          }}
        />
        <label
          className="fy-drop-label"
          htmlFor={uploadInputId}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openPicker();
            }
          }}
        >
          <span className="v4-btn v4-btn-primary" aria-live="polite">
            {loading ? t('uploading') : t('uploadButton')}
          </span>
          <p className="fy-drop-hint">{t('orDrop')}</p>
          <p className="fy-drop-meta">{t('uploadFormats', { limit: MAX_FILE_SIZE_MB })}</p>
        </label>
      </div>
      <div className="fy-demo">
        <button type="button" className="v4-btn fy-btn-sm" onClick={loadDemo} disabled={loading || demoLoading}>
          {demoLoading ? t('demoLoading') : t('demoButton')}
        </button>
      </div>
      {demoActive ? (
        <p className="fy-notice" role="status">
          {t('demoNotice')}
        </p>
      ) : null}
      {localHint ? (
        <p className="fy-notice" role="status">
          {localHint}
        </p>
      ) : null}
      {bannerMessage ? <ErrorBanner message={bannerMessage} /> : null}
      {warning && !bannerMessage ? (
        <p className="fy-notice fy-notice--negative" role="status">
          {warning}
        </p>
      ) : null}
    </section>
  );
};
