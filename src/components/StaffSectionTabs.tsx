"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  STAFF_SECTION_SWIPE_END_EVENT,
  STAFF_SECTION_SWIPE_PROGRESS_EVENT,
  type StaffSectionSwipeEndDetail,
  type StaffSectionSwipeProgressDetail,
} from "./staff-section-tabs-events";

export interface StaffSectionTabItem {
  href: string;
  label: string;
  icon: LucideIcon;
  color: string;
  matchHrefs?: string[];
}

interface StaffSectionTabsProps {
  tabs: StaffSectionTabItem[];
  activeHref?: string;
  fontSize?: number;
  iconSize?: number;
  /** 3タブ切替では履歴を増やしすぎないため replace 遷移を使う */
  replace?: boolean;
  /** グループごとの前回位置を保持し、タブハイライトだけを滑らかに動かす */
  animationKey?: string;
}

function buildTabsSignature(tabs: StaffSectionTabItem[]) {
  return JSON.stringify(tabs.map((tab) => tab.matchHrefs ?? [tab.href]));
}

function findTabIndexFromSignature(tabsSignature: string, href: string) {
  try {
    const groups = JSON.parse(tabsSignature) as string[][];
    return groups.findIndex((group) => group.includes(href));
  } catch {
    return -1;
  }
}

export default function StaffSectionTabs({
  tabs,
  activeHref,
  fontSize = 12,
  iconSize = 14,
  replace = false,
  animationKey,
}: StaffSectionTabsProps) {
  const pathname = usePathname();
  const currentHref = activeHref ?? pathname ?? "";
  const tabsSignature = buildTabsSignature(tabs);
  const activeIndex = findTabIndexFromSignature(tabsSignature, currentHref);
  const tabCount = tabs.length;
  const [indicatorPosition, setIndicatorPosition] = useState<number | null>(null);
  const [animateIndicator, setAnimateIndicator] = useState(false);
  const committedSwipeIndexRef = useRef<number | null>(null);
  const swipeAnimationFrameRef = useRef<number | null>(null);
  const pendingSwipePositionRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (swipeAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(swipeAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!animationKey || tabCount === 0 || typeof window === "undefined") return;

    const clampPosition = (value: number) => Math.max(0, Math.min(tabCount - 1, value));
    const flushPendingPosition = () => {
      swipeAnimationFrameRef.current = null;
      setIndicatorPosition(pendingSwipePositionRef.current);
    };

    const onSwipeProgress = (event: Event) => {
      const detail = (event as CustomEvent<StaffSectionSwipeProgressDetail>).detail;
      if (detail.key !== animationKey) return;

      pendingSwipePositionRef.current = clampPosition(detail.baseIndex + detail.offsetTabs);
      setAnimateIndicator(false);
      if (swipeAnimationFrameRef.current == null) {
        swipeAnimationFrameRef.current = window.requestAnimationFrame(flushPendingPosition);
      }
    };

    const onSwipeEnd = (event: Event) => {
      const detail = (event as CustomEvent<StaffSectionSwipeEndDetail>).detail;
      if (detail.key !== animationKey) return;

      if (swipeAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(swipeAnimationFrameRef.current);
        swipeAnimationFrameRef.current = null;
      }

      if (detail.committed && typeof detail.settledIndex === "number") {
        committedSwipeIndexRef.current = clampPosition(detail.settledIndex);
        pendingSwipePositionRef.current = committedSwipeIndexRef.current;
        setAnimateIndicator(true);
        setIndicatorPosition(committedSwipeIndexRef.current);
        return;
      }

      committedSwipeIndexRef.current = null;
      pendingSwipePositionRef.current = activeIndex >= 0 ? activeIndex : null;
      setAnimateIndicator(true);
      setIndicatorPosition(activeIndex >= 0 ? activeIndex : null);
    };

    window.addEventListener(STAFF_SECTION_SWIPE_PROGRESS_EVENT, onSwipeProgress as EventListener);
    window.addEventListener(STAFF_SECTION_SWIPE_END_EVENT, onSwipeEnd as EventListener);
    return () => {
      if (swipeAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(swipeAnimationFrameRef.current);
        swipeAnimationFrameRef.current = null;
      }
      window.removeEventListener(STAFF_SECTION_SWIPE_PROGRESS_EVENT, onSwipeProgress as EventListener);
      window.removeEventListener(STAFF_SECTION_SWIPE_END_EVENT, onSwipeEnd as EventListener);
    };
  }, [activeIndex, animationKey, tabCount]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let raf1 = 0;
    let raf2 = 0;
    const cancelFrames = () => {
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
    const storageKey = `staff-section-tabs:${animationKey ?? "default"}`;
    const saveCurrentHref = () => {
      try {
        window.sessionStorage.setItem(storageKey, currentHref);
      } catch (error) {
        console.error("Failed to access sessionStorage for tabs", error);
      }
    };

    if (activeIndex < 0 || tabCount === 0) {
      committedSwipeIndexRef.current = null;
      pendingSwipePositionRef.current = null;
      return cancelFrames;
    }

    if (committedSwipeIndexRef.current === activeIndex) {
      committedSwipeIndexRef.current = null;
      saveCurrentHref();
      raf1 = window.requestAnimationFrame(() => {
        setAnimateIndicator(true);
        setIndicatorPosition(activeIndex);
      });
      return cancelFrames;
    }

    let previousIndex = -1;
    try {
      const previousHref = window.sessionStorage.getItem(storageKey);
      if (previousHref) {
        previousIndex = findTabIndexFromSignature(tabsSignature, previousHref);
      }
      window.sessionStorage.setItem(storageKey, currentHref);
    } catch (error) {
      console.error("Failed to access sessionStorage for tabs", error);
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion || previousIndex < 0 || previousIndex === activeIndex) {
      raf1 = window.requestAnimationFrame(() => {
        setAnimateIndicator(false);
        setIndicatorPosition(activeIndex);
        raf2 = window.requestAnimationFrame(() => setAnimateIndicator(true));
      });
      return cancelFrames;
    }

    raf1 = window.requestAnimationFrame(() => {
      setAnimateIndicator(false);
      setIndicatorPosition(previousIndex);
      raf2 = window.requestAnimationFrame(() => {
        setAnimateIndicator(true);
        setIndicatorPosition(activeIndex);
      });
    });

    return cancelFrames;
  }, [activeIndex, animationKey, currentHref, tabCount, tabsSignature]);

  const renderedIndicatorPosition = activeIndex >= 0 && tabCount > 0 ? indicatorPosition : null;

  return (
    <div
      style={{
        padding: "12px 16px",
        background: "rgba(255,255,255,0.8)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid #e2e8f0",
        zIndex: 10,
        flexShrink: 0,
      }}
    >
        <div
        style={{
          display: "flex",
          position: "relative",
          gap: 6,
          background: "#f1f5f9",
          borderRadius: 12,
          padding: 4,
        }}
      >
        {renderedIndicatorPosition != null && tabCount > 0 ? (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 4,
              top: 4,
              bottom: 4,
              width: `calc(${100 / tabCount}% - ${(6 * (tabCount - 1)) / tabCount}px)`,
              borderRadius: 10,
              background: "#fff",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              transform: `translateX(calc(${renderedIndicatorPosition * 100}% + ${renderedIndicatorPosition * 6}px))`,
              transition: animateIndicator
                ? "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)"
                : "none",
              willChange: "transform",
            }}
          />
        ) : null}
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const candidates = tab.matchHrefs ?? [tab.href];
          const active = candidates.includes(currentHref);
          const showFallbackActive = renderedIndicatorPosition == null && active;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              replace={replace}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                zIndex: 1,
                gap: 6,
                padding: "8px 0",
                borderRadius: 10,
                textDecoration: "none",
                background: showFallbackActive ? "#fff" : "transparent",
                color: active ? tab.color : "#94a3b8",
                fontWeight: active ? 800 : 600,
                fontSize,
                transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                boxShadow: showFallbackActive ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
              }}
            >
              <Icon size={iconSize} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
