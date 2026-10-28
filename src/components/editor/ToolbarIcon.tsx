import type { ReactNode } from "react";

/** Presentation only: the command and its accessible name belong to the toolbar. */
type IconName = "paragraph" | "heading1" | "heading2" | "heading3"
  | "bold" | "italic" | "bulletItem" | "quote" | "undo" | "redo";

// Embedded paths from the approved local V3 editor, adapted to the real F1 tools.
// No icon font, external asset or dependency is needed.
const paths: Record<IconName, ReactNode> = {
  paragraph: <path d="M13 4H9a5 5 0 0 0 0 10h4M13 4v16M18 4v16M10 4h11" />,
  heading1: <><path d="M3 5v14M13 5v14M3 12h10" /><path d="m17 13 3-2v8M17 19h5" /></>,
  heading2: <><path d="M3 5v14M13 5v14M3 12h10" /><path d="M17 12a2.5 2.5 0 0 1 5 0c0 2-5 4-5 7h5" /></>,
  heading3: <><path d="M3 5v14M13 5v14M3 12h10" /><path d="M17 11h5l-3 4c4-1 4 5-2 4" /></>,
  bold: <path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z" />,
  italic: <path d="M10 4h9M5 20h9M15 4 9 20" />,
  bulletItem: <><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
  quote: <path d="M5 5v14M10 7h10M10 12h8M10 17h10" />,
  undo: <path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v3" />,
  redo: <path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0-7 7v3" />,
};

export default function ToolbarIcon({ name }: { name: IconName }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
