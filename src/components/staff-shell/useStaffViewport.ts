"use client";

import { useEffect, useState } from "react";
import type { StaffViewportMode } from "@/lib/staff-viewport-policy";

/** scroll と静止で header の fade 濃度を変える。境界のばたつきを防ぐためヒステリシスを持つ */
const ELEVATE_AT_PX = 4;
const FLATTEN_AT_PX = 2;

/**
 * viewport policy の実行側。
 *
 * locked のときだけ document スクロールを止める。
 * 各ページが個別に document.body.style.overflow を触らないよう、
 * ここが唯一の適用箇所になる。
 */
export function useStaffViewportLock(mode: StaffViewportMode): void {
  useEffect(() => {
    if (mode !== "locked") return;

    const body = document.body;
    const root = document.documentElement;
    const previousBody = body.style.overflow;
    const previousRoot = root.style.overflow;
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";

    return () => {
      body.style.overflow = previousBody;
      root.style.overflow = previousRoot;
    };
  }, [mode]);
}

/** document scroll 中だけ header の fade を濃くする */
export function useStaffHeaderElevation(mode: StaffViewportMode): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // locked では document が動かないので購読しない
    if (mode === "locked") return;

    const onScroll = () => {
      const offset = window.scrollY || document.documentElement.scrollTop || 0;
      setScrolled((current) => {
        if (!current && offset > ELEVATE_AT_PX) return true;
        if (current && offset < FLATTEN_AT_PX) return false;
        return current;
      });
    };

    // 復元されたスクロール位置を拾うため一度だけ遅延実行する
    const frame = window.requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [mode]);

  // locked では常に静止表現。state を書き換えずに導出する
  return mode === "locked" ? false : scrolled;
}
