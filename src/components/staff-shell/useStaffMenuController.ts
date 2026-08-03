"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

export interface StaffMenuController {
  readonly open: boolean;
  readonly openMenu: () => void;
  readonly toggle: () => void;
  readonly close: () => void;
  readonly triggerRef: React.RefObject<HTMLButtonElement | null>;
  readonly sheetRef: React.RefObject<HTMLDivElement | null>;
  readonly closeButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly backdropRef: React.RefObject<HTMLButtonElement | null>;
  readonly scrollRegionRef: React.RefObject<HTMLElement | null>;
}

/**
 * staff menu の開閉状態とフォーカス管理。
 *
 * - 開いたら sheet 内へフォーカスを移し、Tab を sheet 内に閉じ込める
 * - Escape で閉じる
 * - 閉じたら header の Chevron へフォーカスを返す
 * - route が変わったら閉じる（ナビゲーション選択で開いたまま残らない）
 */
export function useStaffMenuController(pathname: string | null): StaffMenuController {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const backdropRef = useRef<HTMLButtonElement | null>(null);
  const scrollRegionRef = useRef<HTMLElement | null>(null);
  const shouldRestoreFocusRef = useRef(false);

  const close = useCallback(() => setOpen(false), []);
  const openMenu = useCallback(() => setOpen(true), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  // route が変われば閉じる（戻る・進むでも開いたまま残らない）。
  // effect ではなく render 中に調整する — 開いた menu が一瞬描画されるのを避ける。
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) {
      // 開いていた時だけ Chevron へ戻す。初回マウントでは何もしない
      if (shouldRestoreFocusRef.current) {
        shouldRestoreFocusRef.current = false;
        triggerRef.current?.focus();
      }
      return;
    }

    shouldRestoreFocusRef.current = true;
    const sheet = sheetRef.current;
    const focusable = () => Array.from(
      sheet?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    );
    focusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return {
    open,
    openMenu,
    toggle,
    close,
    triggerRef,
    sheetRef,
    closeButtonRef,
    backdropRef,
    scrollRegionRef,
  };
}
