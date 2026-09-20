import React from 'react';
import { useT, type MessageKey } from '../i18n';

/**
 * What kind of statement a line is.
 *
 * The page mixes three things that look identical once they are set in the same type: a value
 * copied out of the file, a conclusion drawn from several of those values, and a guess that
 * happens to be worth saying. «Дата съёмки: 15 марта, 16:42» is the first. «Похоже на жильё» is
 * the second. «Скорее всего, это место, где вы живёте» is the third, and printing it in the
 * same voice as the date is how a service about honest metadata starts lying.
 *
 * The mark goes only where a reader could mistake one for another — the readings, the guesses,
 * the sizes that merely match a known number. Stamping «ФАКТ» on forty rows that plainly are
 * facts would be noise, and noise is how a mark stops being read at all.
 */

export type ClaimKind = 'fact' | 'inference' | 'hypothesis';

const KEYS: Record<ClaimKind, MessageKey> = {
  fact: 'claimFact',
  inference: 'claimInference',
  hypothesis: 'claimHypothesis'
};

interface ClaimProps {
  kind: ClaimKind;
}

export const Claim: React.FC<ClaimProps> = ({ kind }) => {
  const t = useT();
  return (
    <span className="fy-claim" data-claim={kind}>
      {t(KEYS[kind])}
    </span>
  );
};
