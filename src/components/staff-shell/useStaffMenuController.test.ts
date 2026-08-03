import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStaffMenuController } from "./useStaffMenuController";

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
  const stateSlots: unknown[] = [];
  const refSlots: Array<{ current: unknown }> = [];
  const effectSlots: EffectRecord[] = [];
  const pendingEffects: PendingEffect[] = [];
  let stateCursor = 0;
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
    beginRender() {
      stateCursor = 0;
      refCursor = 0;
      effectCursor = 0;
    },
    useState<T>(initialValue: T): [T, (value: T | ((current: T) => T)) => void] {
      const index = stateCursor;
      stateCursor += 1;
      if (!(index in stateSlots)) stateSlots[index] = initialValue;
      return [
        stateSlots[index] as T,
        (value) => {
          const current = stateSlots[index] as T;
          stateSlots[index] = typeof value === "function"
            ? (value as (current: T) => T)(current)
            : value;
        },
      ];
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
      stateSlots.length = 0;
      refSlots.length = 0;
      effectSlots.length = 0;
      pendingEffects.length = 0;
      stateCursor = 0;
      refCursor = 0;
      effectCursor = 0;
    },
  };
});

vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: mocks.useEffect,
  useRef: mocks.useRef,
  useState: mocks.useState,
}));

function StaffMenuControllerHarness({ pathname }: { pathname: string }) {
  return useStaffMenuController(pathname);
}

function renderController(pathname = "/staff/lend") {
  mocks.beginRender();
  const controller = StaffMenuControllerHarness({ pathname });
  mocks.flushEffects();
  return controller;
}

describe("useStaffMenuController", () => {
  beforeEach(() => {
    mocks.reset();
    const listeners = new Map<string, Set<EventListener>>();
    vi.stubGlobal("document", {
      activeElement: null,
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        const handlers = listeners.get(type) ?? new Set<EventListener>();
        handlers.add(handler);
        listeners.set(type, handlers);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.get(type)?.delete(handler);
      }),
      dispatchKey(event: KeyboardEvent) {
        for (const handler of [...(listeners.get("keydown") ?? [])]) handler(event);
      },
    });
  });

  it("明示 open は既に開いていても閉じず、focus trap・Escape・focus return を維持する", () => {
    const trigger = {
      focus: vi.fn(() => {
        (document as unknown as { activeElement: Element | null }).activeElement = trigger as unknown as Element;
      }),
    };
    const first = {
      focus: vi.fn(() => {
        (document as unknown as { activeElement: Element | null }).activeElement = first as unknown as Element;
      }),
    };
    const last = {
      focus: vi.fn(() => {
        (document as unknown as { activeElement: Element | null }).activeElement = last as unknown as Element;
      }),
    };
    const sheet = {
      querySelectorAll: () => [first, last],
    };

    let controller = renderController();
    controller.triggerRef.current = trigger as unknown as HTMLButtonElement;
    controller.sheetRef.current = sheet as unknown as HTMLDivElement;

    controller.openMenu();
    controller = renderController();
    expect(controller.open).toBe(true);
    expect(first.focus).toHaveBeenCalledOnce();

    controller.openMenu();
    controller = renderController();
    expect(controller.open).toBe(true);

    (document as unknown as { activeElement: Element | null }).activeElement = last as unknown as Element;
    const tab = {
      key: "Tab",
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    (document as unknown as { dispatchKey: (event: KeyboardEvent) => void }).dispatchKey(tab);
    expect(tab.preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledTimes(2);

    const escape = {
      key: "Escape",
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    (document as unknown as { dispatchKey: (event: KeyboardEvent) => void }).dispatchKey(escape);
    expect(escape.preventDefault).toHaveBeenCalledOnce();

    controller = renderController();
    expect(controller.open).toBe(false);
    expect(trigger.focus).toHaveBeenCalledOnce();
  });
});
