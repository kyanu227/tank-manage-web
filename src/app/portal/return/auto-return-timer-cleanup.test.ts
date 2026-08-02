import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import CustomerReturnPage from "./page";

const LINKED_IDENTITY = {
  kind: "linked",
  customerUserUid: "customer-user-1",
  customerId: "customer-1",
  customerName: "テスト顧客",
} as const;

const READY_STATE_VALUES = [
  [{
    id: "tank-1",
    lentAt: null,
    condition: "normal",
    customerId: LINKED_IDENTITY.customerId,
    latestLogId: "log-1",
  }],
  false,
  false,
  false,
  "00:00",
  false,
  LINKED_IDENTITY,
];

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

function captureAutoReturnEffect(): CapturedEffect {
  const firstEffectIndex = mocks.effects.length;
  mocks.stateIndex = 0;
  CustomerReturnPage();

  const renderedEffects = mocks.effects.slice(firstEffectIndex);
  if (renderedEffects.length !== 2) {
    throw new Error(`Expected two page effects, received ${renderedEffects.length}`);
  }
  return renderedEffects[1];
}

function runAutoReturnEffect(): void | (() => void) {
  return captureAutoReturnEffect()();
}

function requireCleanup(
  effectResult: void | (() => void),
): () => void {
  if (typeof effectResult !== "function") {
    throw new Error("Auto-return effect did not return a cleanup");
  }
  return effectResult;
}

describe("portal auto-return timer cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
    vi.stubGlobal("localStorage", createEmptyLocalStorage());

    mocks.effects.length = 0;
    mocks.stateValues.splice(0, mocks.stateValues.length, ...READY_STATE_VALUES);
    mocks.stateIndex = 0;
    mocks.createPortalReturnRequests.mockClear();
    mocks.push.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("cleanup 後は 1200ms 経過しても business write を実行しない", async () => {
    const cleanup = requireCleanup(runAutoReturnEffect());

    cleanup();
    await vi.advanceTimersByTimeAsync(1200);

    expect(mocks.createPortalReturnRequests).toHaveBeenCalledTimes(0);
  });

  it("cleanup 後の effect 再実行では新しい timer だけが発火する", async () => {
    const firstCleanup = requireCleanup(runAutoReturnEffect());
    firstCleanup();

    requireCleanup(runAutoReturnEffect());
    await vi.advanceTimersByTimeAsync(1200);

    expect(mocks.createPortalReturnRequests).toHaveBeenCalledTimes(1);
  });

  it("cleanup しなければ 1200ms 後に従来どおり business write を実行する", async () => {
    requireCleanup(runAutoReturnEffect());

    await vi.advanceTimersByTimeAsync(1200);

    expect(mocks.createPortalReturnRequests).toHaveBeenCalledTimes(1);
  });
});
