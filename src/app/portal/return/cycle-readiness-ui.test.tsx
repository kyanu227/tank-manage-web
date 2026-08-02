import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

type CapturedEffect = () => void | (() => void);

const mocks = vi.hoisted(() => ({
  effects: [] as CapturedEffect[],
  stateValues: [] as unknown[],
  stateIndex: 0,
  createPortalReturnRequests: vi.fn(async () => ["return-request-1"]),
  getPortalAutoReturnSchedule: vi.fn(async () => ({
    autoReturnHour: 0,
    autoReturnMinute: 0,
  })),
  getPortalCurrentLentTanks: vi.fn(async () => []),
  getPortalIdentityFromStorage: vi.fn(),
  isLinkedPortalIdentity: vi.fn(
    (identity: unknown) => (
      typeof identity === "object"
      && identity !== null
      && "kind" in identity
      && identity.kind === "linked"
    ),
  ),
  push: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useCallback<T>(callback: T): T {
      return callback;
    },
    useEffect(effect: CapturedEffect): void {
      mocks.effects.push(effect);
    },
    useState<T>(): [T, ReturnType<typeof vi.fn>] {
      const value = mocks.stateValues[mocks.stateIndex] as T;
      mocks.stateIndex += 1;
      return [value, vi.fn()];
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
}));

vi.mock("@/lib/firebase/admin-settings", () => ({
  getPortalAutoReturnSchedule: mocks.getPortalAutoReturnSchedule,
}));

vi.mock("@/lib/firebase/portal-transaction-service", () => ({
  createPortalReturnRequests: mocks.createPortalReturnRequests,
}));

vi.mock("@/lib/portal/customer-reads", () => ({
  getPortalCurrentLentTanks: mocks.getPortalCurrentLentTanks,
}));

vi.mock("@/lib/portal", () => ({
  getPortalIdentityFromStorage: mocks.getPortalIdentityFromStorage,
  isLinkedPortalIdentity: mocks.isLinkedPortalIdentity,
}));

import { isValidElement } from "react";
import CustomerReturnPage from "./page";

const LINKED_IDENTITY = {
  kind: "linked",
  customerUserUid: "customer-user-1",
  customerId: "customer-1",
  customerName: "テスト顧客",
} as const;

type TestTank = Readonly<{
  id: string;
  lentAt: null;
  condition: "normal";
  customerId: unknown;
  latestLogId: unknown;
}>;

function createTank(
  id: string,
  overrides: Partial<TestTank> = {},
): TestTank {
  return {
    id,
    lentAt: null,
    condition: "normal",
    customerId: LINKED_IDENTITY.customerId,
    latestLogId: `log-${id}`,
    ...overrides,
  };
}

function createEmptyLocalStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function renderPage(
  tanks: readonly TestTank[],
  scheduleTime: string | null = null,
): ReactElement {
  mocks.stateValues.splice(
    0,
    mocks.stateValues.length,
    tanks,
    false,
    false,
    false,
    scheduleTime,
    false,
    LINKED_IDENTITY,
  );
  mocks.stateIndex = 0;
  return CustomerReturnPage();
}

function getNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join("");
  if (!isValidElement<{ children?: ReactNode }>(node)) return "";
  return getNodeText(node.props.children);
}

function getElements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(getElements);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...getElements(node.props.children)];
}

function getSubmitButton(page: ReactElement): ReactElement<{
  disabled?: boolean;
  onClick?: () => void | Promise<void>;
}> {
  const button = getElements(page).find((element) => (
    element.type === "button"
    && getNodeText(element).includes("返却申請する")
  ));
  if (!button) throw new Error("Submit button not found");
  return button as ReactElement<{
    disabled?: boolean;
    onClick?: () => void | Promise<void>;
  }>;
}

describe("portal return cycle readiness UI", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
    vi.stubGlobal("localStorage", createEmptyLocalStorage());
    mocks.effects.length = 0;
    mocks.createPortalReturnRequests.mockClear();
    mocks.push.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("不成立 tank があれば button を disabled にし、ID と理由を表示する", () => {
    const page = renderPage([
      createTank("VALID-01"),
      createTank("INVALID-01", { latestLogId: null }),
    ]);

    expect(getSubmitButton(page).props.disabled).toBe(true);
    expect(getNodeText(page)).toContain("返却申請できないタンクが含まれています。");
    expect(getNodeText(page)).toContain("対象: INVALID-01");
    expect(getNodeText(page)).toContain("最新操作IDがありません");
  });

  it("disabled button の handler を直接呼んでも valid tank だけを部分送信しない", async () => {
    const page = renderPage([
      createTank("VALID-01"),
      createTank("INVALID-01", { customerId: "other-customer" }),
    ]);

    await getSubmitButton(page).props.onClick?.();

    expect(mocks.createPortalReturnRequests).toHaveBeenCalledTimes(0);
  });

  it("不成立時は auto-return を発火せず localStorage 完了フラグも立てない", async () => {
    renderPage([
      createTank("INVALID-01", { latestLogId: undefined }),
    ], "00:00");
    const autoReturnEffect = mocks.effects[1];
    if (!autoReturnEffect) throw new Error("Auto-return effect not captured");

    expect(autoReturnEffect()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1200);

    expect(mocks.createPortalReturnRequests).toHaveBeenCalledTimes(0);
    expect(localStorage.length).toBe(0);
  });

  it("全件 ready なら従来どおり全件を marker 付きで送信できる", async () => {
    const page = renderPage([
      createTank("TANK-01", { latestLogId: "log-01" }),
      createTank("TANK-02", { latestLogId: "log-02" }),
    ]);
    const submitButton = getSubmitButton(page);

    expect(submitButton.props.disabled).toBe(false);
    await submitButton.props.onClick?.();

    expect(mocks.createPortalReturnRequests).toHaveBeenCalledTimes(1);
    expect(mocks.createPortalReturnRequests).toHaveBeenCalledWith({
      identity: LINKED_IDENTITY,
      items: [
        {
          tankId: "TANK-01",
          condition: "normal",
          customerId: LINKED_IDENTITY.customerId,
          expectedLatestLogId: "log-01",
        },
        {
          tankId: "TANK-02",
          condition: "normal",
          customerId: LINKED_IDENTITY.customerId,
          expectedLatestLogId: "log-02",
        },
      ],
      source: "customer_portal",
    });
  });
});
