/**
 * このファイルは reproduction harness / characterization test であり、現在のバグ挙動を意図的に固定している。
 * 固定しているのは、mode 更新前に連続スワイプすると、両方のスワイプが同じ route を計算する挙動である。
 * 根本原因は、useOperationSwipe の effect が render 時の mode を閉包し、router.replace() 後の remount まで
 * handler が更新されないことにある。
 * bug fix の際は、この test を削除せず期待値を反転させること。
 * 例: lend から2回左スワイプした場合は、/staff/return → /staff/fill になるべきである。
 * この test が通っているからといって、現在の挙動が正しいわけではない。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpMode } from "../types";
import { useOperationSwipe } from "./useOperationSwipe";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  handlers: new Map<string, EventListener>(),
  dispatchSwipeEnd: vi.fn(),
  dispatchSwipeProgress: vi.fn(),
}));

vi.mock("react", () => ({
  useEffect(effect: () => void | (() => void)) {
    effect();
  },
  useRef<T>(initialValue: T) {
    return { current: initialValue };
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.replace,
  }),
}));

vi.mock("@/components/staff-section-tabs-events", () => ({
  STAFF_SECTION_SWIPE_COMMIT_DISTANCE_PX: 40,
  dispatchStaffSectionSwipeEnd: mocks.dispatchSwipeEnd,
  dispatchStaffSectionSwipeProgress: mocks.dispatchSwipeProgress,
  shouldIgnoreSwipeStart: () => false,
}));

function OperationSwipeHarness({ mode }: { mode: OpMode }) {
  useOperationSwipe(mode);
  return null;
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
  const handler = mocks.handlers.get(type);
  if (!handler) throw new Error(`${type} handler was not registered`);
  handler(event);
}

function swipeLeft(): void {
  dispatchTouch("touchstart", touchEvent("start", 300, 100));
  dispatchTouch("touchmove", touchEvent("move", 220, 100));
  dispatchTouch("touchend", touchEvent("end", 220, 100));
}

describe("useOperationSwipe high-speed route characterization", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.handlers.clear();
    mocks.dispatchSwipeEnd.mockReset();
    mocks.dispatchSwipeProgress.mockReset();

    vi.stubGlobal("window", { innerWidth: 390 });
    vi.stubGlobal("document", {
      addEventListener: vi.fn(
        (type: string, handler: EventListener) => {
          mocks.handlers.set(type, handler);
        },
      ),
      removeEventListener: vi.fn(),
    });
  });

  it("mode更新前の左2連続スワイプは両方とも元のmodeから同じrouteを計算する", () => {
    OperationSwipeHarness({ mode: "lend" });

    swipeLeft();
    swipeLeft();

    expect(mocks.replace.mock.calls).toEqual([
      ["/staff/return"],
      ["/staff/return"],
    ]);
    expect(mocks.dispatchSwipeEnd.mock.calls).toEqual([
      [{
        key: "operations",
        committed: true,
        settledIndex: 1,
      }],
      [{
        key: "operations",
        committed: true,
        settledIndex: 1,
      }],
    ]);
  });
});
