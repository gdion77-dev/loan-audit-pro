/**
 * Loan Audit PRO — src/components/sections/PlaceholderSection.tsx
 * ------------------------------------------------------------------
 * The standard placeholder card shared by the simple sections. Shows
 * the section title, a short explanation and the connect-later note.
 * Presentational only.
 */
import React from 'react';
import { CONNECT_LATER_NOTE } from './sectionDefinitions';

export interface PlaceholderSectionProps {
  readonly title: string;
  readonly explanation: string;
  readonly children?: React.ReactNode;
}

export const PlaceholderSection: React.FC<PlaceholderSectionProps> = ({
  title,
  explanation,
  children,
}) => (
  <section className="lap-card" aria-label={title}>
    <h2 className="lap-card__title">{title}</h2>
    <p className="lap-card__explanation">{explanation}</p>
    {children}
    <p className="lap-card__note">{CONNECT_LATER_NOTE}</p>
  </section>
);
