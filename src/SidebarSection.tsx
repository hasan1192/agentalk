import { ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";

export function DisclosurePanel({
  id,
  expanded,
  children,
}: {
  id: string;
  expanded: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className="disclosure-panel"
      data-expanded={expanded}
      aria-hidden={!expanded}
      inert={!expanded}
    >
      <div className="disclosure-content">{children}</div>
    </div>
  );
}

export default function SidebarSection({
  id,
  label,
  count,
  expanded,
  compact,
  toggleLabel,
  addLabel,
  onToggle,
  onAdd,
  children,
  className = "",
}: {
  id: string;
  label: string;
  count: number;
  expanded: boolean;
  compact: boolean;
  toggleLabel: string;
  addLabel: string;
  onToggle: () => void;
  onAdd: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className} aria-label={label}>
      <div className="sidebar-section-heading">
        <div className="section-heading-controls">
          {!compact && (
            <>
              <span className="section-label">{label}</span>
              <span className="section-count">{count}</span>
              <button
                type="button"
                className="section-disclosure icon-button"
                aria-label={toggleLabel}
                title={toggleLabel}
                aria-expanded={expanded}
                aria-controls={id}
                onClick={onToggle}
              >
                <ChevronRight
                  className="disclosure-chevron"
                  size={15}
                  aria-hidden="true"
                />
              </button>
            </>
          )}
          <button
            type="button"
            className="section-add icon-button"
            onClick={onAdd}
            title={addLabel}
            aria-label={addLabel}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <DisclosurePanel id={id} expanded={expanded || compact}>
        {children}
      </DisclosurePanel>
    </section>
  );
}
