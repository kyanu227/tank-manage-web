import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MaintenanceMode } from "../constants";
import { useMaintenanceSwipe } from "./useMaintenanceSwipe";

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
  };
});

function MaintenanceSwipeHarness({ mode }: { mode: MaintenanceMode }) {
  useMaintenanceSwipe(mode);
  return null;
}

function renderMaintenanceSwipe(mode: MaintenanceMode): void {
  mocks.beginRender();
  MaintenanceSwipeHarness({ mode });
  mocks.flushEffects();
}

function touchEvent(
  phase: "start" | "move" | "end",
  clientX: number,
  clientY: number,
): TouchEvent {
  const touch = { clientX, clientY };
  return {
    target: null,
    touches: phase === "end" ? [] : [touch],
    changedTouches: phase === "end" ? [touch] : [],
  } as unknown as TouchEvent;
}

function dispatchTouch(
  type: "touchstart" | "touchmove" | "touchend",
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

describe("useMaintenanceSwipe", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.handlers.clear();
    mocks.dispatchSwipeEnd.mockReset();
    mocks.dispatchSwipeProgress.mockReset();
    mocks.resetRuntime();

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

  it("mode更新前の左2連続スワイプを pending target から順に遷移する", () => {
    renderMaintenanceSwipe("damage");

    swipeLeft();
    swipeLeft();

    expect(mocks.replace.mock.calls).toEqual([
      ["/staff/repair"],
      ["/staff/inspection"],
    ]);
    expect(mocks.dispatchSwipeEnd.mock.calls).toEqual([
      [{ key: "maintenance", committed: true, settledIndex: 1 }],
      [{ key: "maintenance", committed: true, settledIndex: 2 }],
    ]);
    expect(mocks.dispatchSwipeProgress.mock.calls).toEqual([
      [{ key: "maintenance", baseIndex: 0, offsetTabs: expect.any(Number) }],
      [{ key: "maintenance", baseIndex: 1, offsetTabs: expect.any(Number) }],
    ]);
  });

  it("横 swipe の途中で cleanup されたら committed:false を dispatch する", () => {
    renderMaintenanceSwipe("damage");
    dispatchTouch("touchstart", touchEvent("start", 300, 100));
    dispatchTouch("touchmove", touchEvent("move", 220, 100));

    mocks.unmount();

    expect(mocks.dispatchSwipeEnd).toHaveBeenCalledWith({
      key: "maintenance",
      committed: false,
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
