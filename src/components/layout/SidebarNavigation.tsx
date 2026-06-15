/**
 * Loan Audit PRO — src/components/layout/SidebarNavigation.tsx
 * ------------------------------------------------------------------
 * Left sidebar listing the nine sections. Presentational: it reports
 * clicks upward via onSelect and highlights the active section. No
 * engine or routing dependency.
 */
import React from 'react';
import { SECTIONS, type SectionId } from '../sections/sectionDefinitions';

export interface SidebarNavigationProps {
  readonly activeSection: SectionId;
  readonly onSelect: (id: SectionId) => void;
}

export const SidebarNavigation: React.FC<SidebarNavigationProps> = ({
  activeSection,
  onSelect,
}) => (
  <nav className="lap-sidebar" aria-label="Ενότητες">
    <p className="lap-sidebar__brand">Loan Audit PRO</p>
    <p className="lap-sidebar__subtitle">Τεχνικός οικονομικός έλεγχος</p>
    <ul className="lap-sidebar__list">
      {SECTIONS.map((section, index) => {
        const isActive = section.id === activeSection;
        return (
          <li key={section.id}>
            <button
              type="button"
              className={isActive ? 'lap-nav-item lap-nav-item--active' : 'lap-nav-item'}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect(section.id)}
            >
              <span className="lap-nav-item__index">{index + 1}</span>
              <span className="lap-nav-item__label">{section.title}</span>
            </button>
          </li>
        );
      })}
    </ul>
  </nav>
);
