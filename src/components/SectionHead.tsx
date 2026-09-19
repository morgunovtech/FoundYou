import React from 'react';

interface SectionHeadProps {
  /** Two-digit mono index («01») — the design-system section idiom. */
  num: string;
  title: string;
  /** id of the heading, referenced by the section's aria-labelledby. */
  id: string;
  /** Optional controls rendered on the right edge of the rule. */
  children?: React.ReactNode;
}

/**
 * `.v4-section-head`: mono number on the title's baseline, rule underneath. The number also
 * carries `.fy-section-num`, which lifts it from the design system's 11 px label size to the
 * heading's own size — the vendored `public/ds/v1` is synced from `about-me-page` and is never
 * edited here, so the override lives in `styles.css`.
 */
export const SectionHead: React.FC<SectionHeadProps> = ({ num, title, id, children }) => (
  <div className="v4-section-head">
    <span className="v4-section-num fy-section-num" aria-hidden="true">
      {num}
    </span>
    <h2 className="v4-h2" id={id}>
      {title}
    </h2>
    {children ? <div className="fy-section-actions">{children}</div> : null}
  </div>
);
