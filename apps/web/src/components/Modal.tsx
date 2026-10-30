"use client";

import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The dialog every study, board and database screen opens: a card over a
 * dimmed page, closed by Escape, by the backdrop, or by whatever the card
 * offers.
 *
 * Rendered into <body> through a portal. The panels it is opened from use
 * `backdrop-filter`, and an ancestor with a filter becomes the containing
 * block for `position: fixed` - so a dialog left in place covers the 400px
 * panel it was opened from instead of the page.
 */
export function Overlay({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

export default function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Room for a board beside its controls. */
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Overlay>
    <div
      className="scrim fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card-float my-auto w-full animate-fade space-y-3 p-5 ${wide ? "max-w-3xl" : "max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-ivory/10 hover:text-ink"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
    </Overlay>
  );
}
