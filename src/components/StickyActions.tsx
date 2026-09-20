import React, { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

interface StickyActionsProps {
  /** Show «new photo» and «to cleanup»: only once a photo is loaded, before that there is nothing to go to. */
  photoLoaded: boolean;
  /** Opens the drop zone's file picker. */
  onNewPhoto: () => void;
}

/** Scrolled this far, the hero with the drop zone is off screen and the buttons earn their place. */
const SHOW_AFTER_PX = 240;

/**
 * Three fixed buttons in the bottom-right corner on the design system's `.v4-scroll-top`
 * pattern: «Наверх» (the DS arrow) and, once a photo is loaded, «К очистке» (a downward arrow
 * to section 03) and «Загрузить новое фото» (a picture-plus pictogram that opens the drop
 * zone's file picker). All appear after the first screen has been scrolled past, stay out of
 * the Tab order until then (the DS class toggles visibility) and disappear in print.
 *
 * «К очистке» is navigation, not a call to action: the facts section runs long, and section 03
 * is otherwise several screens of scrolling away. It moves the viewport and nothing else.
 */
export const StickyActions: React.FC<StickyActionsProps> = ({ photoLoaded, onNewPhoto }) => {
  const t = useT();
  const reducedMotion = usePrefersReducedMotion();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > SHOW_AFTER_PX);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  const toCleanup = useCallback(() => {
    const heading = document.getElementById('sec-cleanup');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    heading.focus({ preventScroll: true });
  }, [reducedMotion]);

  const visible = scrolled ? ' is-visible' : '';
  return (
    <>
      {photoLoaded ? (
        <button
          type="button"
          className={`v4-scroll-top fy-sticky-new${visible}`}
          onClick={onNewPhoto}
          aria-label={t('newPhotoLabel')}
          title={t('newPhotoLabel')}
        >
          {/* A picture (frame, sun, hills) with a plus in the corner: «another photo». */}
          <svg
            className="fy-sticky-icon"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="3" y="7" width="12" height="12" />
            <circle cx="7" cy="11" r="1.5" />
            <path d="M4 18 L8.5 13 L11 15.5 L12.5 14 L14.5 16" />
            <path d="M19.75 3.5 V10.5 M16.25 7 H23.25" />
          </svg>
        </button>
      ) : null}
      {photoLoaded ? (
        <button
          type="button"
          className={`v4-scroll-top fy-sticky-cleanup${visible}`}
          onClick={toCleanup}
          aria-label={t('toCleanupLabel')}
          title={t('toCleanupLabel')}
        >
          ↓
        </button>
      ) : null}
      <button
        type="button"
        className={`v4-scroll-top${visible}`}
        onClick={() => window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })}
        aria-label={t('scrollTopLabel')}
        title={t('scrollTopLabel')}
      >
        ↑
      </button>
    </>
  );
};
