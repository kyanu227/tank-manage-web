import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STAFF_SECTION_SWIPE_IGNORE_SELECTOR,
  STAFF_SWIPE_SURFACE_SELECTOR,
  canScrollStaffMenuForward,
  resolveStaffSwipeStartTarget,
  suppressNextStaffSwipeClick,
} from "./staff-section-tabs-events";

type Attributes = Record<string, string>;

class FakeElement {
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;

  constructor(
    readonly tagName = "div",
    readonly attributes: Attributes = {},
    parent?: FakeElement,
  ) {
    if (parent) {
      this.parentElement = parent;
      parent.children.push(this);
    }
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  private matches(selector: string) {
    if (selector === STAFF_SWIPE_SURFACE_SELECTOR) {
      return "data-staff-swipe-surface" in this.attributes;
    }
    if (selector === "a, button:not([disabled])") {
      return this.tagName === "a"
        || (this.tagName === "button" && !("disabled" in this.attributes));
    }
    if (selector === STAFF_SECTION_SWIPE_IGNORE_SELECTOR) {
      return this.attributes["data-swipe-ignore"] === "true"
        || this.attributes["data-drum-roll-option"] === "true"
        || this.tagName === "select"
        || this.tagName === "input"
        || this.tagName === "textarea"
        || this.attributes.role === "listbox";
    }
    return false;
  }
}

function surface(name: "header" | "tabs" | "confirm" | "menu" | "menu-backdrop") {
  return new FakeElement("div", { "data-staff-swipe-surface": name });
}

describe("staff swipe start target resolution", () => {
  beforeEach(() => {
    vi.stubGlobal("Element", FakeElement);
  });

  it("header spacer は許可し、chip と Chevron は ignore する", () => {
    const header = surface("header");
    const spacer = new FakeElement("div", {}, header);
    const chip = new FakeElement("button", { "data-swipe-ignore": "true" }, header);
    const chevron = new FakeElement("button", { "data-swipe-ignore": "true" }, header);

    expect(resolveStaffSwipeStartTarget(spacer as unknown as EventTarget)?.surface).toBe("header");
    expect(resolveStaffSwipeStartTarget(chip as unknown as EventTarget)).toBeNull();
    expect(resolveStaffSwipeStartTarget(chevron as unknown as EventTarget)).toBeNull();
  });

  it("tabs Link は通常の a でも tabs surface として許可する", () => {
    const tabs = surface("tabs");
    const link = new FakeElement("a", {}, tabs);
    const label = new FakeElement("span", {}, link);
    const resolved = resolveStaffSwipeStartTarget(label as unknown as EventTarget);

    expect(resolved?.surface).toBe("tabs");
    expect(resolved?.clickTarget).toBe(link);
  });

  it("A-OK button と wrapper 余白は confirm surface として許可する", () => {
    const confirm = surface("confirm");
    const button = new FakeElement("button", {}, confirm);
    const disabledButton = new FakeElement("button", { disabled: "" }, confirm);

    expect(resolveStaffSwipeStartTarget(button as unknown as EventTarget)).toMatchObject({
      surface: "confirm",
      clickTarget: button,
    });
    expect(resolveStaffSwipeStartTarget(confirm as unknown as EventTarget)).toMatchObject({
      surface: "confirm",
      clickTarget: null,
    });
    expect(resolveStaffSwipeStartTarget(disabledButton as unknown as EventTarget)).toMatchObject({
      surface: "confirm",
      clickTarget: null,
    });
  });

  it("surface 内でも戻る・DrumRoll・QuickSelect は ignore を優先する", () => {
    const confirm = surface("confirm");
    const back = new FakeElement("button", { "data-swipe-ignore": "true" }, confirm);
    const drum = new FakeElement("div", { "data-swipe-ignore": "true" }, confirm);
    const drumOption = new FakeElement("button", { "data-drum-roll-option": "true" }, confirm);
    const quickSelect = new FakeElement("div", { "data-swipe-ignore": "true" }, confirm);

    for (const target of [back, drum, drumOption, quickSelect]) {
      expect(resolveStaffSwipeStartTarget(target as unknown as EventTarget)).toBeNull();
    }
  });

  it.each([
    ["select", {}],
    ["input", {}],
    ["textarea", {}],
    ["div", { role: "listbox" }],
  ])("%s / listbox は surface 内でも ignore する", (tagName, attributes) => {
    const confirm = surface("confirm");
    const target = new FakeElement(tagName, attributes, confirm);
    expect(resolveStaffSwipeStartTarget(target as unknown as EventTarget)).toBeNull();
  });

  it("queue・list の scroll 領域は明示 surface がなければ対象外", () => {
    const queue = new FakeElement("div");
    const row = new FakeElement("div", {}, queue);
    expect(resolveStaffSwipeStartTarget(row as unknown as EventTarget)).toBeNull();
  });
});

describe("staff swipe click suppression", () => {
  it("capture phase の直後1回だけ click を抑止して listener を外す", () => {
    const listeners = new Set<EventListener>();
    const addEventListener = vi.fn((type: string, listener: EventListener) => {
      if (type === "click") listeners.add(listener);
    });
    const removeEventListener = vi.fn((type: string, listener: EventListener) => {
      if (type === "click") listeners.delete(listener);
    });
    vi.stubGlobal("document", { addEventListener, removeEventListener });

    suppressNextStaffSwipeClick(10_000);

    const first = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    for (const listener of [...listeners]) listener(first);

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(first.stopPropagation).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);

    const second = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    for (const listener of [...listeners]) listener(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(second.stopPropagation).not.toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      { capture: true, once: true },
    );
    expect(removeEventListener).toHaveBeenCalledWith("click", expect.any(Function), true);
  });
});

describe("staff menu scroll chaining", () => {
  it("scrollTop が下端未満のときだけ forward scroll を優先する", () => {
    expect(canScrollStaffMenuForward({
      scrollTop: 20,
      scrollHeight: 200,
      clientHeight: 100,
    } as HTMLElement)).toBe(true);
    expect(canScrollStaffMenuForward({
      scrollTop: 100,
      scrollHeight: 200,
      clientHeight: 100,
    } as HTMLElement)).toBe(false);
    expect(canScrollStaffMenuForward({
      scrollTop: 0,
      scrollHeight: 100,
      clientHeight: 100,
    } as HTMLElement)).toBe(false);
  });
});
