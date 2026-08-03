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

  // Escape で閉じたときだけ Chevron へフォーカスを返す。
  // ポインター・ジェスチャーで閉じたときに返すと、プログラム的な focus() が
  // :focus-visible を立てて Chevron にリングが出てしまう。
  const restoreFocusOnCloseRef = useRef(false);

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
      // Escape で閉じた場合だけ Chevron へ戻す（キーボード利用者の文脈を保つ）。
      // ポインター操作では focus を動かさず、リングを出さない
      if (shouldRestoreFocusRef.current && restoreFocusOnCloseRef.current) {
        triggerRef.current?.focus();
      }
      shouldRestoreFocusRef.current = false;
      restoreFocusOnCloseRef.current = false;
      return;
    }

    shouldRestoreFocusRef.current = true;
    const sheet = sheetRef.current;
    const focusable = () => Array.from(
      sheet?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    );
    // 最初の操作要素ではなく sheet 自体へ移す。tabindex="-1" + outline:none なので
    // リングが出ず、Tab を押した時点で通常どおり内部要素へ入る
    sheet?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        restoreFocusOnCloseRef.current = true;
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      // sheet 自体にフォーカスがある初期状態からは、先頭要素へ入れる
      if (document.activeElement === sheet) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
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
