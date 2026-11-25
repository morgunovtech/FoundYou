import React from 'react';

interface SectionHeadProps {
  /** Two-digit mono index («01»): the step of the page. */
  num: string;
  title: string;
  /** id of the heading, referenced by the section's aria-labelledby. */
  id: string;
  /** Optional controls rendered on the right edge of the rule. */
  children?: React.ReactNode;
}

/**
 * `.v4-section-head`: mono number on the title's baseline, rule underneath. The number is this
 * page's own (`.fy-section-num` in `styles.css`): the family layer has had no section number
 * since about-me-page v1.5.0, where sections of a page are not a sequence. Here they are the
 * three steps of one job, in order.
 */
export const SectionHead: React.FC<SectionHeadProps> = ({ num, title, id, children }) => (
  <div className="v4-section-head">
    <span className="fy-section-num" aria-hidden="true">
      {num}
    </span>
    <h2 className="v4-h2" id={id}>
      {title}
    </h2>
    {children ? <div className="fy-section-actions">{children}</div> : null}
  </div>
);
