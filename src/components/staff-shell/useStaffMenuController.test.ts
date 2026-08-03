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

  function buildRefs() {
    const setActive = (element: unknown) => {
      (document as unknown as { activeElement: Element | null }).activeElement = element as Element;
    };
    const trigger = { focus: vi.fn(() => setActive(trigger)) };
    const first = { focus: vi.fn(() => setActive(first)) };
    const last = { focus: vi.fn(() => setActive(last)) };
    const sheet = {
      focus: vi.fn(() => setActive(sheet)),
      querySelectorAll: () => [first, last],
    };
    return { trigger, first, last, sheet };
  }

  it("明示 open は既に開いていても閉じず、focus trap・Escape・focus return を維持する", () => {
    const { trigger, first, last, sheet } = buildRefs();

    let controller = renderController();
    controller.triggerRef.current = trigger as unknown as HTMLButtonElement;
    controller.sheetRef.current = sheet as unknown as HTMLDivElement;

    controller.openMenu();
    controller = renderController();
    expect(controller.open).toBe(true);
    // 開いた直後は sheet 自体を受け皿にする（操作要素へ移すとリングが出る）
    expect(sheet.focus).toHaveBeenCalledOnce();
    expect(first.focus).not.toHaveBeenCalled();

    controller.openMenu();
    controller = renderController();
    expect(controller.open).toBe(true);

    // sheet にフォーカスがある初期状態からの Tab は先頭要素へ入る
    const tabFromSheet = { key: "Tab", shiftKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    (document as unknown as { dispatchKey: (event: KeyboardEvent) => void }).dispatchKey(tabFromSheet);
    expect(tabFromSheet.preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();

    // 末尾からの Tab は先頭へ巻き戻る
    (document as unknown as { activeElement: Element | null }).activeElement = last as unknown as Element;
    const tabFromLast = { key: "Tab", shiftKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    (document as unknown as { dispatchKey: (event: KeyboardEvent) => void }).dispatchKey(tabFromLast);
    expect(tabFromLast.preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledTimes(2);

    const escape = { key: "Escape", shiftKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    (document as unknown as { dispatchKey: (event: KeyboardEvent) => void }).dispatchKey(escape);
    expect(escape.preventDefault).toHaveBeenCalledOnce();

    controller = renderController();
    expect(controller.open).toBe(false);
    // Escape で閉じたときだけ Chevron へ戻す
    expect(trigger.focus).toHaveBeenCalledOnce();
  });

  it("ポインター操作で閉じたときは Chevron へ focus を戻さない", () => {
    const { trigger, sheet } = buildRefs();

    let controller = renderController();
    controller.triggerRef.current = trigger as unknown as HTMLButtonElement;
    controller.sheetRef.current = sheet as unknown as HTMLDivElement;

    controller.openMenu();
    controller = renderController();
    expect(controller.open).toBe(true);

    // backdrop タップ / ジェスチャー / ナビゲーション選択に相当
    controller.close();
    controller = renderController();
    expect(controller.open).toBe(false);
    // プログラム的 focus() は :focus-visible を立ててリングを出すため戻さない
    expect(trigger.focus).not.toHaveBeenCalled();
  });
});
