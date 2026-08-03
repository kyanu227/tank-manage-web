import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStaffMenuGesture } from "./useStaffMenuGesture";

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

class FakeTarget {
  constructor(
    readonly surface:
      | "header"
      | "tabs"
      | "confirm"
      | "content"
      | "menu"
      | "menu-backdrop"
      | null,
    readonly clickable = false,
    readonly ignored = false,
    /** canScrollStaffContentBackward 用。上へ戻す余地がある状態を作る */
    readonly scrollTop = 0,
    readonly scrollHeight = 0,
    readonly clientHeight = 0,
  ) {}

  get parentElement(): FakeTarget | null {
    return null;
  }
}

const mocks = vi.hoisted(() => {
  const refSlots: Array<{ current: unknown }> = [];
  const effectSlots: EffectRecord[] = [];
  const pendingEffects: PendingEffect[] = [];
  let refCursor = 0;
  let effectCursor = 0;

  function depsChanged(
    previous: readonly unknown[] | undefined,
    next: readonly unknown[] | undefined,
  ) {
    if (!previous || !next || previous.length !== next.length) return true;
    return previous.some((value, index) => !Object.is(value, next[index]));
  }

  return {
    handlers: new Map<string, Set<EventListener>>(),
    suppressClick: vi.fn(),
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
    useEffect(effect: () => void | EffectCleanup, deps?: readonly unknown[]) {
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
    reset() {
      for (const record of effectSlots) record.cleanup?.();
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

vi.mock("@/components/staff-section-tabs-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/staff-section-tabs-events")>();
  return {
    ...actual,
    resolveStaffSwipeStartTarget: (eventTarget: EventTarget | null) => {
      const target = eventTarget as unknown as FakeTarget | null;
      if (!target?.surface || target.ignored) return null;
      return {
        surface: target.surface,
        surfaceElement: target,
        clickTarget: target.clickable ? target : null,
      };
    },
    suppressNextStaffSwipeClick: mocks.suppressClick,
  };
});

function StaffMenuGestureHarness({
  menuOpen,
  onOpen,
  onClose,
  scrollRegion,
}: {
  menuOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  scrollRegion: HTMLElement | null;
}) {
  useStaffMenuGesture({
    menuOpen,
    onOpen,
    onClose,
    scrollRegionRef: { current: scrollRegion },
  });
  return null;
}

function renderMenuGesture(
  menuOpen: boolean,
  onOpen: () => void,
  onClose: () => void,
  scrollRegion: HTMLElement | null = null,
) {
  mocks.beginRender();
  StaffMenuGestureHarness({ menuOpen, onOpen, onClose, scrollRegion });
  mocks.flushEffects();
}

function touchEvent(
  phase: "start" | "move" | "end",
  clientX: number,
  clientY: number,
  target: FakeTarget,
) {
  const touch = { clientX, clientY };
  return {
    target,
    touches: phase === "end" ? [] : [touch],
    changedTouches: phase === "end" ? [touch] : [],
  } as unknown as TouchEvent;
}

function dispatchTouch(
  type: "touchstart" | "touchmove" | "touchend",
  event: TouchEvent,
) {
  const handlers = mocks.handlers.get(type);
  if (!handlers?.size) throw new Error(`${type} handler was not registered`);
  for (const handler of [...handlers]) handler(event);
}

function swipe(target: FakeTarget, dy: number, dx = 0, startY = 100) {
  dispatchTouch("touchstart", touchEvent("start", 100, startY, target));
  dispatchTouch("touchmove", touchEvent("move", 100 + dx, startY + dy, target));
  dispatchTouch("touchend", touchEvent("end", 100 + dx, startY + dy, target));
}

describe("useStaffMenuGesture", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.handlers.clear();
    mocks.suppressClick.mockReset();
    vi.stubGlobal("Element", FakeTarget);
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

  it.each(["header", "tabs", "confirm"] as const)(
    "%s の下スワイプで menu を明示的に開く",
    (surface) => {
      const onOpen = vi.fn();
      renderMenuGesture(false, onOpen, vi.fn());

      swipe(new FakeTarget(surface), 40);

      expect(onOpen).toHaveBeenCalledOnce();
    },
  );

  it.each(["operations", "maintenance", "procurement"] as const)(
    "%s の StaffSectionTabs surface から同じ下スワイプ契約で開く",
    () => {
      const onOpen = vi.fn();
      renderMenuGesture(false, onOpen, vi.fn());

      swipe(new FakeTarget("tabs"), 40);

      expect(onOpen).toHaveBeenCalledOnce();
    },
  );

  it("A-OK button の短い tap は維持し、下スワイプ commit のときだけ click を抑止する", () => {
    const onOpen = vi.fn();
    const onClick = vi.fn();
    const confirmButton = new FakeTarget("confirm", true);
    renderMenuGesture(false, onOpen, vi.fn());

    swipe(confirmButton, 9);
    onClick();
    expect(onClick).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(mocks.suppressClick).not.toHaveBeenCalled();

    swipe(confirmButton, 40);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(mocks.suppressClick).toHaveBeenCalledOnce();
  });

  it("tabs Link は短い tap で抑止せず、下スワイプ commit では抑止する", () => {
    const onOpen = vi.fn();
    const tabsLink = new FakeTarget("tabs", true);
    renderMenuGesture(false, onOpen, vi.fn());

    swipe(tabsLink, 39);
    expect(onOpen).not.toHaveBeenCalled();
    expect(mocks.suppressClick).not.toHaveBeenCalled();

    swipe(tabsLink, 40);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(mocks.suppressClick).toHaveBeenCalledOnce();
  });

  it("DrumRoll / QuickSelect 等の ignored target では menu を開かない", () => {
    const onOpen = vi.fn();
    renderMenuGesture(false, onOpen, vi.fn());

    swipe(new FakeTarget("confirm", false, true), 80);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("x 軸へ lock した gesture では menu を開かない", () => {
    const onOpen = vi.fn();
    const tabs = new FakeTarget("tabs");
    renderMenuGesture(false, onOpen, vi.fn());

    dispatchTouch("touchstart", touchEvent("start", 100, 100, tabs));
    dispatchTouch("touchmove", touchEvent("move", 111, 100, tabs));
    dispatchTouch("touchend", touchEvent("end", 111, 180, tabs));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it.each(["menu-backdrop", "menu"] as const)(
    "%s の上スワイプで menu を閉じる",
    (surface) => {
      const onClose = vi.fn();
      renderMenuGesture(true, vi.fn(), onClose);

      swipe(new FakeTarget(surface), -40);

      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it("navigation に下方向の scroll 余地がある間は close より scroll を優先する", () => {
    const onClose = vi.fn();
    const navTarget = new FakeTarget("menu", true);
    const scrollRegion = {
      scrollTop: 20,
      scrollHeight: 200,
      clientHeight: 100,
      contains: (target: EventTarget) => (target as unknown) === (navTarget as unknown),
    } as unknown as HTMLElement;
    renderMenuGesture(true, vi.fn(), onClose, scrollRegion);

    swipe(navTarget, -60);
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.suppressClick).not.toHaveBeenCalled();

    Object.assign(scrollRegion, { scrollTop: 100 });
    swipe(navTarget, -60);
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.suppressClick).toHaveBeenCalledOnce();
  });

  it("A-OK を持たない画面でも、上部の本文領域からの下スワイプで開く", () => {
    const onOpen = vi.fn();
    renderMenuGesture(false, onOpen, vi.fn());

    swipe(new FakeTarget("content"), 40, 0, 100);

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("本文領域は上端の帯より下から始めた場合は開かない", () => {
    const onOpen = vi.fn();
    renderMenuGesture(false, onOpen, vi.fn());

    swipe(new FakeTarget("content"), 40, 0, 300);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("本文領域の a / button 上から始めた場合は開かない", () => {
    const onOpen = vi.fn();
    renderMenuGesture(false, onOpen, vi.fn());

    swipe(new FakeTarget("content", true), 40, 0, 100);

    expect(onOpen).not.toHaveBeenCalled();
    expect(mocks.suppressClick).not.toHaveBeenCalled();
  });

  it("まだ上へスクロールできる本文領域では、開くよりスクロールを優先する", () => {
    const onOpen = vi.fn();
    renderMenuGesture(false, onOpen, vi.fn());

    swipe(new FakeTarget("content", false, false, 120, 800, 400), 40, 0, 100);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("touch listener は passive のまま登録する", () => {
    renderMenuGesture(false, vi.fn(), vi.fn());
    expect(document.addEventListener).toHaveBeenCalledWith(
      "touchstart",
      expect.any(Function),
      { passive: true },
    );
    expect(document.addEventListener).toHaveBeenCalledWith(
      "touchend",
      expect.any(Function),
      { passive: true },
    );
  });
});
