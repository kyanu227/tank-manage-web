"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { MODES } from "../constants";
import type { OpMode } from "../types";

export function useOperationSwipe(mode: OpMode) {
  const router = useRouter();
  const swipeRef = useRef<{ startX: number; startY: number } | null>(null);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      swipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY };
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!swipeRef.current) return;
      const dx = e.changedTouches[0].clientX - swipeRef.current.startX;
      const dy = e.changedTouches[0].clientY - swipeRef.current.startY;
      const startX = swipeRef.current.startX;
      swipeRef.current = null;

      // ドラムロール列（右端80px）から開始したスワイプは無視
      const screenW = window.innerWidth;
      if (startX > screenW - 80) return;

      // 横40px以上 & 横移動が縦より大きい
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;

      const idx = MODES.indexOf(mode);
      const next = dx < 0
        ? MODES[(idx + 1) % MODES.length]
        : MODES[(idx - 1 + MODES.length) % MODES.length];

      // replace で履歴に積まない。戻るボタンの挙動が直感的になる
      router.replace(`/staff/${next}`);
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [mode, router]);
}
