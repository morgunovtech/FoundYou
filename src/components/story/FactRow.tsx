import React from 'react';
import { useT } from '../../i18n';
import { SEVERITY_KEYS, type Severity } from './storyKeys';

export interface FactRowProps {
  title: string;
  severity: Severity;
  value: string | null;
  sub: string | null;
  children?: React.ReactNode;
}

/**
 * One fact card: what the file says (value, rows) and nothing else. The severity colours the
 * left rule and is also read out, so it is never carried by colour alone.
 */
export const FactRow: React.FC<FactRowProps> = ({ title, severity, value, sub, children }) => {
  const t = useT();
  return (
    <article className="fy-fact" data-severity={severity}>
      <div className="fy-fact-head">
        <h3 className="fy-fact-title">
          {title}
          <span className="sr-only">{`, ${t(SEVERITY_KEYS[severity])}`}</span>
        </h3>
      </div>
      {value ? <p className="fy-fact-value">{value}</p> : null}
      {sub ? <p className="fy-fact-sub">{sub}</p> : null}
      {children}
    </article>
  );
};
