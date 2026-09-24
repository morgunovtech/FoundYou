import React from 'react';

export interface FactRowProps {
  title: string;
  value: string | null;
  sub: string | null;
  children?: React.ReactNode;
}

/**
 * One fact card: what the file says (value, rows) and nothing else. It used to carry a «risk»
 * level as the colour of its left rule and a hidden «высокий риск» for screen readers — a
 * verdict by colour with no legend, on a page whose rule since 2026-09-16 is facts without
 * verdicts. The device card of an iPhone came out «high risk»; nobody could say why.
 */
export const FactRow: React.FC<FactRowProps> = ({ title, value, sub, children }) => (
  <article className="fy-fact">
    <div className="fy-fact-head">
      <h3 className="fy-fact-title">{title}</h3>
    </div>
    {value ? <p className="fy-fact-value">{value}</p> : null}
    {sub ? <p className="fy-fact-sub">{sub}</p> : null}
    {children}
  </article>
);
