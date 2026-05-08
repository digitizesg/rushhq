import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Wider on desktop for forms with multi-column rows. */
  size?: "md" | "lg";
}

export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  const widthClass = size === "lg" ? "max-w-3xl" : "max-w-md";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-ink/30 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${widthClass} bg-page sm:rounded-lg shadow-[0_20px_50px_-20px_rgba(42,33,24,0.4)] border border-line max-h-[92vh] flex flex-col`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <p className="text-[18px] font-medium text-ink">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="size-8 grid place-items-center rounded-md text-muted hover:text-ink hover:bg-soft"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
