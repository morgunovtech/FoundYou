import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useT } from '../i18n';
import { HERO_SCENARIO_HOLD_MS, HERO_SCENARIO_KEYS } from '../utils/heroScenarios';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

interface InfoBlockProps {
  /** Rotate the sharing scenario in the title; off once a photo is loaded. */
  scenariosActive: boolean;
}

/**
 * Hero copy: the title with a rotating sharing scenario, one lead sentence, three short
 * points and the action line — no wall of text on a phone.
 *
 * Every scenario is in the DOM, stacked in one inline-grid cell, so the slot
 * is as wide as the longest phrase and the heading never re-wraps when the
 * phrase changes. The slot is aria-hidden: the static lead (plus the tail
 * for languages that put the verb last) is the accessible name. Reduced
 * motion and a loaded photo both render the plain `appTitle`.
 */
export const InfoBlock: React.FC<InfoBlockProps> = ({ scenariosActive }) => {
  const t = useT();
  const reducedMotion = usePrefersReducedMotion();
  const rotating = scenariosActive && !reducedMotion;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!rotating) return undefined;
    const timer = window.setInterval(() => {
      // A hidden tab keeps its phrase; the next visible tick moves on.
      if (document.hidden) return;
      setIndex((current) => (current + 1) % HERO_SCENARIO_KEYS.length);
    }, HERO_SCENARIO_HOLD_MS);
    return () => window.clearInterval(timer);
  }, [rotating]);

  const tail = t('heroTitleTail');
  return (
    <div className="fy-hero-text">
      <h1 className="fy-h1" id="hero-title">
        {rotating ? (
          <>
            {t('heroTitleLead')}{' '}
            <span className="fy-h1-scenario" aria-hidden="true">
              {HERO_SCENARIO_KEYS.map((key, i) => (
                <span key={key} className={clsx('fy-h1-scenario-item', { 'is-current': i === index })}>
                  {t(key)}
                </span>
              ))}
            </span>
            {tail ? ` ${tail}` : null}
          </>
        ) : (
          t('appTitle')
        )}
      </h1>
      <p className="fy-tagline">{t('introLead')}</p>
      <ul className="fy-intro-list">
        <li>{t('introPoint1')}</li>
        <li>{t('introPoint2')}</li>
        <li>{t('introPoint3')}</li>
      </ul>
      <p className="fy-tagline fy-intro-action">{t('introAction')}</p>
    </div>
  );
};
