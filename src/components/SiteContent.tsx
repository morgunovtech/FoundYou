import React, { useMemo } from 'react';
import { useI18n } from '../i18n';
import { siteSections, type SiteSection } from '../site/siteContent';

const Section: React.FC<{ section: SiteSection }> = ({ section }) => (
  <section className="v4-section fy-site" id={section.id} aria-labelledby={`${section.id}-title`}>
    <h2 className="v4-h2" id={`${section.id}-title`}>
      {section.title}
    </h2>
    {section.lead ? <p className="fy-site-lead">{section.lead}</p> : null}
    {section.terms ? (
      <dl className="fy-site-terms">
        {section.terms.map((item) => (
          <div key={item.term}>
            <dt>{item.term}</dt>
            <dd>{item.text}</dd>
          </div>
        ))}
      </dl>
    ) : null}
    {section.steps ? (
      <ol className="fy-site-steps">
        {section.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    ) : null}
    {section.table ? (
      <table className="fy-site-table">
        <thead>
          <tr>
            {section.table.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.table.rows.map((row) => (
            <tr key={row[0]}>
              <th scope="row">{row[0]}</th>
              <td>{row[1]}</td>
              <td>{row[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : null}
    {section.list ? (
      <ul className="fy-site-list">
        {section.list.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    ) : null}
    {section.questions
      ? section.questions.map((item) => (
          <div className="fy-site-qa" key={item.question}>
            <h3 className="fy-site-q">{item.question}</h3>
            <p>{item.answer}</p>
          </div>
        ))
      : null}
    {section.paragraphs ? section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>) : null}
    {section.link ? (
      <p>
        <a href={section.link.href} target="_blank" rel="noopener noreferrer">
          {section.link.label}
        </a>
      </p>
    ) : null}
  </section>
);

/**
 * The copy of the page that is not about one photo: what the service reads, how it works, the
 * two cleanup presets, geotags, questions, who made it. Rendered from the same model the static
 * HTML is built from (`src/site/siteContent.ts`), after the analysis sections and before the
 * «how to check» block, on every page — a stranger who has not chosen a photo reads it on the
 * first screen, and a crawler reads it without JavaScript.
 */
export const SiteContent: React.FC = () => {
  const { lang } = useI18n();
  const sections = useMemo(() => siteSections(lang), [lang]);
  return (
    <>
      {sections.map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </>
  );
};
