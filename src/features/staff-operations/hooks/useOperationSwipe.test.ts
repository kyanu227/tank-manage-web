/**
 * このファイルは reproduction harness から発展した characterization test である。
 * 当初固定していたのは、mode 更新前の連続スワイプが render 時の古い mode を再利用し、
 * 同じ route を2回計算するバグだった。修正後も test 自体は削除せず期待値を反転し、
 * lend から2回左スワイプした場合に /staff/return → /staff/fill となることを固定する。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpMode } from "../types";
import { useOperationSwipe } from "./useOperationSwipe";

type EffectCleanup = () => void;
type EffectRecord = {
  deps: readonly unknown[] | undefined;
  cleanup?: EffectCleanup;
};
type PendingEffect = {
  index: number;
  deps: readonly unknown[] | undefined;
  effect: () => void | EffectCleanup;
};

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  const refSlots: Array<{ current: unknown }> = [];
  const effectSlots: EffectRecord[] = [];
  const pendingEffects: PendingEffect[] = [];
  let refCursor = 0;
  let effectCursor = 0;

  function depsChanged(
    previous: readonly unknown[] | undefined,
    next: readonly unknown[] | undefined,
  ): boolean {
    if (!previous || !next || previous.length !== next.length) return true;
    return previous.some((value, index) => !Object.is(value, next[index]));
  }

  return {
    replace,
    router: { replace },
    handlers: new Map<string, Set<EventListener>>(),
    dispatchSwipeEnd: vi.fn(),
    dispatchSwipeProgress: vi.fn(),
    suppressSwipeClick: vi.fn(),
    beginRender() {
      refCursor = 0;
      effectCursor = 0;
    },
    useRef<T>(initialValue: T): { current: T } {
      const index = refCursor;
      refCursor += 1;
      if (!refSlots[index]) refSlots[index] = { current: initialValue };
      return refSlots[index] as { current: T };
    },
    useEffect(
      effect: () => void | EffectCleanup,
      deps?: readonly unknown[],
    ): void {
      const index = effectCursor;
      effectCursor += 1;
      const previous = effectSlots[index];
      if (!previous || depsChanged(previous.deps, deps)) {
        pendingEffects.push({ index, deps, effect });
      }
    },
    flushEffects() {
      for (const pending of pendingEffects.splice(0)) {
        effectSlots[pending.index]?.cleanup?.();
        const cleanup = pending.effect();
        effectSlots[pending.index] = {
          deps: pending.deps,
          cleanup: cleanup ?? undefined,
        };
      }
    },
    unmount() {
      for (const record of effectSlots) record.cleanup?.();
      refSlots.length = 0;
      effectSlots.length = 0;
      pendingEffects.length = 0;
    },
    resetRuntime() {
      refSlots.length = 0;
      effectSlots.length = 0;
      pendingEffects.length = 0;
      refCursor = 0;
      effectCursor = 0;
    },
  };
});

vi.mock("react", () => ({
  useEffect: mocks.useEffect,
  useLayoutEffect: mocks.useEffect,
  useRef: mocks.useRef,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

vi.mock("@/components/staff-section-tabs-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/staff-section-tabs-events")>();
  return {
    ...actual,
    dispatchStaffSectionSwipeEnd: mocks.dispatchSwipeEnd,
    dispatchStaffSectionSwipeProgress: mocks.dispatchSwipeProgress,
    suppressNextStaffSwipeClick: mocks.suppressSwipeClick,
  };
});

class SwipeTargetElement {
  constructor(
    readonly ignored: boolean,
    readonly surface: string | null = null,
    readonly tagName = "div",
  ) {}

  closest(selector: string): SwipeTargetElement | null {
    if (selector.includes("data-swipe-ignore")) return this.ignored ? this : null;
    if (selector === "[data-staff-swipe-surface]") return this.surface ? this : null;
    if (selector === "a, button:not([disabled])") {
      return this.tagName === "a" || this.tagName === "button" ? this : null;
    }
    return null;
  }

  getAttribute(name: string): string | null {
    return name === "data-staff-swipe-surface" ? this.surface : null;
  }
}

function OperationSwipeHarness({ mode }: { mode: OpMode }) {
  useOperationSwipe(mode);
  return null;
}

function renderOperationSwipe(mode: OpMode): void {
  mocks.beginRender();
  OperationSwipeHarness({ mode });
  mocks.flushEffects();
}

function touchEvent(
  phase: "start" | "move" | "end",
  clientX: number,
  clientY: number,
  target: EventTarget | null = null,
): TouchEvent {
  const touch = { clientX, clientY };
  return {
    target,
    touches: phase === "end" ? [] : [touch],
    changedTouches: phase === "end" ? [touch] : [],
  } as unknown as TouchEvent;
}

function dispatchTouch(
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  event: TouchEvent,
): void {
  const handlers = mocks.handlers.get(type);
  if (!handlers?.size) throw new Error(`${type} handler was not registered`);
  for (const handler of [...handlers]) handler(event);
}

function swipeLeft(): void {
  dispatchTouch("touchstart", touchEvent("start", 300, 100));
  dispatchTouch("touchmove", touchEvent("move", 220, 100));
  dispatchTouch("touchend", touchEvent("end", 220, 100));
}

describe("useOperationSwipe", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.handlers.clear();
    mocks.dispatchSwipeEnd.mockReset();
    mocks.dispatchSwipeProgress.mockReset();
    mocks.suppressSwipeClick.mockReset();
    mocks.resetRuntime();

    vi.stubGlobal("Element", SwipeTargetElement);
    vi.stubGlobal("window", { innerWidth: 390 });
    vi.stubGlobal("document", {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        const handlers = mocks.handlers.get(type) ?? new Set<EventListener>();
        handlers.add(handler);
        mocks.handlers.set(type, handlers);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        mocks.handlers.get(type)?.delete(handler);
      }),
    });
  });

  it("mode更新前の左2連続スワイプは pending target から次のrouteを計算する", () => {
    renderOperationSwipe("lend");

    swipeLeft();
    swipeLeft();

    expect(mocks.replace.mock.calls).toEqual([
      ["/staff/return"],
      ["/staff/fill"],
    ]);
    expect(mocks.dispatchSwipeEnd.mock.calls).toEqual([
      [{ key: "operations", committed: true, settledIndex: 1 }],
      [{ key: "operations", committed: true, settledIndex: 2 }],
    ]);
    expect(mocks.dispatchSwipeProgress.mock.calls).toEqual([
      [{ key: "operations", baseIndex: 0, offsetTabs: expect.any(Number) }],
      [{ key: "operations", baseIndex: 1, offsetTabs: expect.any(Number) }],
    ]);
  });

  it("1回だけの左スワイプは従来どおり隣へ遷移する", () => {
    renderOperationSwipe("lend");
    swipeLeft();

    expect(mocks.replace).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith("/staff/return");
  });

  it("commit 距離未満では遷移しない", () => {
    renderOperationSwipe("lend");
    dispatchTouch("touchstart", touchEvent("start", 300, 100));
    dispatchTouch("touchmove", touchEvent("move", 270, 100));
    dispatchTouch("touchend", touchEvent("end", 270, 100));

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.dispatchSwipeEnd).toHaveBeenCalledWith({
      key: "operations",
      committed: false,
    });
    expect(mocks.suppressSwipeClick).not.toHaveBeenCalled();
  });

  it("tabs Link は 40px で遷移して click を抑止し、39px ではどちらもしない", () => {
    renderOperationSwipe("lend");
    const tabsLink = new SwipeTargetElement(false, "tabs", "a") as unknown as EventTarget;

    dispatchTouch("touchstart", touchEvent("start", 300, 100, tabsLink));
    dispatchTouch("touchmove", touchEvent("move", 261, 100, tabsLink));
    dispatchTouch("touchend", touchEvent("end", 261, 100, tabsLink));

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.suppressSwipeClick).not.toHaveBeenCalled();

    dispatchTouch("touchstart", touchEvent("start", 300, 100, tabsLink));
    dispatchTouch("touchmove", touchEvent("move", 260, 100, tabsLink));
    dispatchTouch("touchend", touchEvent("end", 260, 100, tabsLink));

    expect(mocks.replace).toHaveBeenCalledWith("/staff/return");
    expect(mocks.suppressSwipeClick).toHaveBeenCalledOnce();
  });

  it("tabs Link の短い tap では route 切替も click 抑止もしない", () => {
    renderOperationSwipe("lend");
    const tabsLink = new SwipeTargetElement(false, "tabs", "a") as unknown as EventTarget;

    dispatchTouch("touchstart", touchEvent("start", 300, 100, tabsLink));
    dispatchTouch("touchend", touchEvent("end", 302, 102, tabsLink));

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.suppressSwipeClick).not.toHaveBeenCalled();
  });

  it("縦方向優先の gesture では遷移しない", () => {
    renderOperationSwipe("lend");
    dispatchTouch("touchstart", touchEvent("start", 300, 100));
    dispatchTouch("touchmove", touchEvent("move", 270, 150));
    dispatchTouch("touchend", touchEvent("end", 220, 180));

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.dispatchSwipeProgress).not.toHaveBeenCalled();
    expect(mocks.dispatchSwipeEnd).not.toHaveBeenCalled();
  });

  it("右端 edge と DrumRoll 内から始まる gesture を無視する", () => {
    renderOperationSwipe("lend");

    dispatchTouch("touchstart", touchEvent("start", 350, 100));
    dispatchTouch("touchmove", touchEvent("move", 200, 100));
    dispatchTouch("touchend", touchEvent("end", 200, 100));

    const drumRollTarget = new SwipeTargetElement(true) as unknown as EventTarget;
    dispatchTouch("touchstart", touchEvent("start", 300, 100, drumRollTarget));
    dispatchTouch("touchmove", touchEvent("move", 200, 100, drumRollTarget));
    dispatchTouch("touchend", touchEvent("end", 200, 100, drumRollTarget));

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.dispatchSwipeProgress).not.toHaveBeenCalled();
    expect(mocks.dispatchSwipeEnd).not.toHaveBeenCalled();
  });

  it("横 swipe の途中で cleanup されたら committed:false を dispatch する", () => {
    renderOperationSwipe("lend");
    dispatchTouch("touchstart", touchEvent("start", 300, 100));
    dispatchTouch("touchmove", touchEvent("move", 220, 100));

    mocks.unmount();

    expect(mocks.dispatchSwipeEnd).toHaveBeenCalledWith({
      key: "operations",
      committed: false,
    });
    expect([...mocks.handlers.values()].every((handlers) => handlers.size === 0)).toBe(true);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("touchcancel は進行中の横 swipe を従来どおり cancel する", () => {
    renderOperationSwipe("lend");
    dispatchTouch("touchstart", touchEvent("start", 300, 100));
    dispatchTouch("touchmove", touchEvent("move", 220, 100));
    dispatchTouch("touchcancel", touchEvent("move", 220, 100));
    dispatchTouch("touchend", touchEvent("end", 220, 100));

    expect(mocks.dispatchSwipeEnd.mock.calls).toEqual([
      [{ key: "operations", committed: false }],
    ]);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("rerender 後は listener を貼り替えず最新の rendered mode を読む", () => {
    renderOperationSwipe("lend");
    renderOperationSwipe("return");
    swipeLeft();

    expect(document.addEventListener).toHaveBeenCalledTimes(4);
    expect(document.removeEventListener).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/staff/fill");
  });
});
