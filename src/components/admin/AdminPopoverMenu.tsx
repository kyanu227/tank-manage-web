"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./AdminNavigation.module.css";

export default function AdminPopoverMenu({
  ariaLabel,
  title,
  icon,
  disabled = false,
  centered = false,
  children,
}: {
  ariaLabel: string;
  title: string;
  icon: ReactNode;
  disabled?: boolean;
  centered?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closeAndRestore = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeAndRestore();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestore();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={styles.footerAction}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.iconButton}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
      </button>
      {open && (
        <div
          className={`${styles.popover} ${centered ? styles.popoverCentered : ""}`}
          role="menu"
          aria-label={ariaLabel}
          onClick={(event) => {
            if ((event.target as Element).closest("a")) closeAndRestore();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
