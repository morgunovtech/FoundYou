import React, { useId } from 'react';

interface ExplainerProps {
  /** Mono label above the text, e.g. «Как это использует злоумышленник». */
  title: string;
  /** One or more `<p>` paragraphs. */
  children: React.ReactNode;
}

/**
 * Educational insert (`.fy-explainer`): a paper card with a 2px orange rule on
 * the left, a mono label in the text accent and prose below. Reused wherever a
 * section needs the «why this matters» next to the data it explains. It is
 * always visible: never collapsed, toggled or tucked behind a badge.
 */
export const Explainer: React.FC<ExplainerProps> = ({ title, children }) => {
  const id = useId();
  return (
    <aside className="fy-explainer" aria-labelledby={id}>
      <p className="fy-explainer-label" id={id}>
        {title}
      </p>
      <div className="fy-explainer-body">{children}</div>
    </aside>
  );
};
