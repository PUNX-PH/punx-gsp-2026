// Small inline icons: one for each kind of step, and one for each status (so a status is never told by color alone).
import type { ReactNode } from "react";
import type { StepStatus } from "@/lib/canvas/cardView";

const svg = (children: ReactNode, className?: string) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    {children}
  </svg>
);

/** The icon of a kind of step. */
export function Icon({ type }: { type: string }) {
  switch (type) {
    case "reference-image":
      return svg(
        <>
          <rect x="2" y="3" width="12" height="10" rx="2" />
          <circle cx="6" cy="7" r="1.2" />
          <path d="M3 12l3.5-3.5 2.5 2.5 2-2 2 2" />
        </>,
      );
    case "model":
      return svg(
        <>
          <path d="M8 2l5 2.8v6.4L8 14l-5-2.8V4.8L8 2z" />
          <path d="M8 8.2l5-3.4M8 8.2L3 4.8M8 8.2V14" />
        </>,
      );
    case "prepare-model":
      return svg(
        <>
          <path d="M8 2l5 2.8v6.4L8 14l-5-2.8V4.8L8 2z" />
          <path d="M5.6 8.2l1.7 1.7 3.1-3.3" />
        </>,
      );
    case "make-shape":
      return svg(
        <>
          <path d="M3.5 12.5L7 4.5l3.5 8z" />
          <circle cx="12" cy="4.8" r="1.8" />
        </>,
      );
    case "palette-from-image":
      return svg(<path d="M8 2.5c2.5 3 4 4.7 4 6.7a4 4 0 0 1-8 0c0-2 1.5-3.7 4-6.7z" />);
    case "describe-game":
      return svg(
        <>
          <path d="M3 3.5h10v7H8.2L5 13v-2.5H3z" />
          <path d="M5.8 6h4.4M5.8 8h2.6" />
        </>,
      );
    case "game-template":
      return svg(
        <>
          <rect x="2" y="5" width="12" height="7" rx="3.5" />
          <path d="M5.5 7.5v2M4.5 8.5h2" />
          <circle cx="10.5" cy="8" r=".6" />
          <circle cx="12" cy="9.6" r=".6" />
        </>,
      );
    case "preview":
      return svg(<path d="M5.5 3.5l7 4.5-7 4.5z" />);
    default:
      return svg(<rect x="3" y="3" width="10" height="10" rx="2" />);
  }
}

/** The icon of a status. Nothing for a step that has not done anything yet. */
export function StatusIcon({ status, spinnerClassName }: { status: StepStatus; spinnerClassName?: string }) {
  switch (status) {
    case "done":
      return svg(<path d="M3.5 8.5l3 3 6-7" />);
    case "running":
      return svg(<path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5" />, spinnerClassName);
    case "failed":
      return svg(
        <>
          <path d="M8 2.5l6 10.5H2L8 2.5z" />
          <path d="M8 6.8v2.6M8 11.4v.2" />
        </>,
      );
    case "attention":
      return svg(
        <>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3.4M8 10.7v.2" />
        </>,
      );
    case "skipped":
      return svg(
        <>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M5.5 8h5" />
        </>,
      );
    case "not-used":
      return svg(<circle cx="8" cy="8" r="5.5" strokeDasharray="2 2.4" />);
    default:
      return null;
  }
}

export const CrossIcon = () => svg(<path d="M4 4l8 8M12 4l-8 8" />);
export const PlusIcon = () => svg(<path d="M8 3.5v9M3.5 8h9" />);
