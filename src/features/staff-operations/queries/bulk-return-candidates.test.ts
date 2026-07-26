import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tanksRepository } from "@/lib/firebase/repositories";
import type {
  BulkReturnGroupMeta,
  BulkTankDoc,
} from "@/features/staff-operations/types";
import {
  buildBulkReturnCandidateGroups,
  fetchBulkReturnCandidates,
  getBulkReturnGroupKeys,
  type BulkReturnCandidateGroups,
  type BulkTankWithTag,
} from "@/features/staff-operations/queries/bulk-return-candidates";

const mocks = vi.hoisted(() => ({
  getTanks: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories", () => ({
  tanksRepository: {
    getTanks: mocks.getTanks,
  },
}));

const NOW_MILLIS = 1785121200000;
const TODAY_START = 1785078000000;
const BEFORE_TODAY = 1785077999999;
const TODAY_END = 1785164399999;
const TOMORROW_START = 1785164400000;
const PAST_RECENT = 1784991600000;
const PAST_OLDER = 1784851200000;
const LONG_OLDER = 1784505600000;

const getTanksMock = vi.mocked(tanksRepository.getTanks);

function makeTank(
  overrides: Pick<BulkTankDoc, "id"> & Partial<BulkTankDoc>,
): BulkTankDoc {
  return {
    status: "lent",
    location: "Location",
    staff: "Staff",
    updatedAt: TODAY_START,
    ...overrides,
  };
}

function getOnlyMeta(result: BulkReturnCandidateGroups): BulkReturnGroupMeta {
  const metas = Object.values(result.groupMeta);
  expect(metas).toHaveLength(1);
  return metas[0];
}

function getOnlyTank(result: BulkReturnCandidateGroups): BulkTankWithTag {
  const tanks = Object.values(result.groupedTanks).flat();
  expect(tanks).toHaveLength(1);
  return tanks[0];
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("fetchBulkReturnCandidates", () => {
  beforeEach(() => {
    getTanksMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("2経路を統合しstatus query優先・legacy補完・除外・dedup・ID順を維持する", async () => {
    getTanksMock
      .mockResolvedValueOnce([
        makeTank({
          id: "B-02",
          customerId: "query-b",
          customerName: "Query B",
          location: "query-location",
          logNote: "[TAG:unused]",
        }),
        makeTank({
          id: "A-01",
          customerId: "query-a",
          customerName: "Query A",
        }),
      ])
      .mockResolvedValueOnce([
        makeTank({
          id: "B-02",
          status: "貸出中",
          customerId: "fallback-b",
          customerName: "Fallback B",
          location: "fallback-location",
          logNote: "[TAG:uncharged]",
        }),
        makeTank({
          id: "D-04",
          status: "未返却",
          customerId: "fallback-d",
          customerName: "Fallback D",
          updatedAt: LONG_OLDER,
        }),
        makeTank({
          id: "C-03",
          status: "貸出中",
          customerId: "fallback-c",
          customerName: "Fallback C",
        }),
        makeTank({ id: "E-05", status: "empty" }),
        makeTank({ id: "F-06", status: "filled" }),
        makeTank({ id: "G-07", status: "空" }),
        makeTank({ id: "H-08", status: "充填済み" }),
        makeTank({ id: "I-09", status: "invalid-status" }),
      ]);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW_MILLIS);

    const result = await fetchBulkReturnCandidates();

    expect(mocks.getTanks.mock.calls).toStrictEqual([
      [{ statusIn: ["lent", "unreturned"] }],
      [],
    ]);
    expect(nowSpy).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.groupedTanks)).toStrictEqual([
      "today_lent::customer:query-a",
      "today_lent::customer:query-b",
      "today_lent::customer:fallback-c",
      "long_term::customer:fallback-d",
    ]);
    expect(
      Object.values(result.groupedTanks)
        .flat()
        .map((tank) => tank.id),
    ).toStrictEqual(["A-01", "B-02", "C-03", "D-04"]);
    expect(
      Object.values(result.groupedTanks)
        .flat()
        .find((tank) => tank.id === "B-02"),
    ).toStrictEqual({
      id: "B-02",
      status: "lent",
      customerId: "query-b",
      customerName: "Query B",
      location: "query-location",
      staff: "Staff",
      updatedAt: TODAY_START,
      logNote: "[TAG:unused]",
      tag: "unused",
    });
    expect(Object.keys(result.groupedTanks)).not.toContain(
      "today_lent::customer:fallback-b",
    );
  });

  it("両repository readとcandidate統合完了後にDate.nowを1回だけ取得する", async () => {
    const codeRead = createDeferred<BulkTankDoc[]>();
    const allRead = createDeferred<BulkTankDoc[]>();
    getTanksMock
      .mockReturnValueOnce(codeRead.promise)
      .mockReturnValueOnce(allRead.promise);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW_MILLIS);

    const resultPromise = fetchBulkReturnCandidates();

    expect(mocks.getTanks.mock.calls).toStrictEqual([
      [{ statusIn: ["lent", "unreturned"] }],
      [],
    ]);
    expect(nowSpy).not.toHaveBeenCalled();

    codeRead.resolve([
      makeTank({
        id: "B-02",
        customerId: "customer-b",
        customerName: "Customer B",
      }),
    ]);
    await Promise.resolve();
    expect(nowSpy).not.toHaveBeenCalled();

    allRead.resolve([
      makeTank({
        id: "A-01",
        status: "貸出中",
        customerId: "customer-a",
        customerName: "Customer A",
      }),
    ]);
    const result = await resultPromise;

    expect(nowSpy).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.groupedTanks)).toStrictEqual([
      "today_lent::customer:customer-a",
      "today_lent::customer:customer-b",
    ]);
    expect(Object.values(result.groupMeta).map((meta) => meta.dateLabel)).toStrictEqual([
      "7/27 貸出分",
      "7/27 貸出分",
    ]);
  });
});

describe("buildBulkReturnCandidateGroups date conversion", () => {
  it.each([
    ["finite number", LONG_OLDER, LONG_OLDER],
    ["zero", 0, null],
    ["Date", new Date(LONG_OLDER), LONG_OLDER],
    ["toMillis object", { toMillis: () => LONG_OLDER }, LONG_OLDER],
    ["NaN", Number.NaN, null],
    ["Infinity", Number.POSITIVE_INFINITY, null],
    ["null", null, null],
    ["undefined", undefined, null],
    ["invalid object", {}, null],
    ["invalid toMillis number", { toMillis: () => Number.NaN }, null],
    ["invalid toMillis type", { toMillis: () => "invalid" }, null],
  ])("%sを現行どおりmillisへ変換する", (_label, updatedAt, expected) => {
    const result = buildBulkReturnCandidateGroups([
      makeTank({
        id: "DATE-01",
        status: "unreturned",
        customerId: "date-customer",
        updatedAt,
      }),
    ], NOW_MILLIS);

    expect(getOnlyMeta(result).sortMillis).toBe(expected);
  });

  it("Invalid Dateは現行どおりNaNを維持する", () => {
    const result = buildBulkReturnCandidateGroups([
      makeTank({
        id: "INVALID-DATE-01",
        status: "lent",
        customerId: "invalid-date-customer",
        updatedAt: new Date(Number.NaN),
      }),
    ], NOW_MILLIS);
    const meta = getOnlyMeta(result);

    expect(meta.pool).toBe("unknown_lent");
    expect(Number.isNaN(meta.sortMillis)).toBe(true);
  });
});

describe("buildBulkReturnCandidateGroups date pool", () => {
  it.each([
    ["JST当日開始", "lent", TODAY_START, "today_lent", TODAY_START],
    ["JST当日終了", "lent", TODAY_END, "today_lent", TODAY_END],
    ["前日以前", "lent", BEFORE_TODAY, "past_lent", BEFORE_TODAY],
    ["updatedAtなし", "lent", undefined, "unknown_lent", null],
    ["未来日時", "lent", TOMORROW_START, "unknown_lent", TOMORROW_START],
    ["日時あり未返却", "unreturned", LONG_OLDER, "long_term", LONG_OLDER],
    ["日時なし未返却", "unreturned", undefined, "long_term", null],
  ])(
    "%sをJST固定poolへ分類する",
    (_label, status, updatedAt, expectedPool, expectedSortMillis) => {
      const result = buildBulkReturnCandidateGroups([
        makeTank({
          id: "POOL-01",
          status,
          customerId: "pool-customer",
          updatedAt,
        }),
      ], NOW_MILLIS);

      expect(getOnlyMeta(result).pool).toBe(expectedPool);
      expect(getOnlyMeta(result).sortMillis).toBe(expectedSortMillis);
    },
  );
});

describe("buildBulkReturnCandidateGroups identity and group key", () => {
  it("customerId・customerName・location・unknownのidentity keyを区別する", () => {
    const result = buildBulkReturnCandidateGroups([
      makeTank({
        id: "IDENTITY-01",
        customerId: " customer-1 ",
        customerName: " Display A ",
        location: "Ignored Location",
      }),
      makeTank({
        id: "IDENTITY-02",
        customerName: " 顧客A ",
        location: "Ignored Location",
      }),
      makeTank({
        id: "IDENTITY-03",
        location: "現場A",
      }),
      makeTank({
        id: "IDENTITY-04",
        location: "",
      }),
    ], NOW_MILLIS);

    expect(Object.keys(result.groupedTanks)).toStrictEqual([
      "today_lent::customer:customer-1",
      "today_lent::legacy-location:顧客A",
      "today_lent::legacy-location:現場A",
      "today_lent::legacy-location:__unknown__",
    ]);
    expect(result.groupMeta["today_lent::customer:customer-1"]).toMatchObject({
      location: "Display A",
      customerId: "customer-1",
      isLegacyCustomerIdentity: false,
    });
    expect(result.groupMeta["today_lent::legacy-location:顧客A"]).toMatchObject({
      location: "顧客A",
      isLegacyCustomerIdentity: true,
    });
    expect(result.groupMeta["today_lent::legacy-location:現場A"]).toMatchObject({
      location: "現場A",
      isLegacyCustomerIdentity: true,
    });
    expect(result.groupMeta["today_lent::legacy-location:__unknown__"]).toMatchObject({
      location: "不明",
      isLegacyCustomerIdentity: true,
    });
    expect(
      "customerId" in result.groupMeta["today_lent::legacy-location:顧客A"],
    ).toBe(false);
  });

  it("同名でもcustomerIdが異なれば別groupにする", () => {
    const result = buildBulkReturnCandidateGroups([
      makeTank({
        id: "CUSTOMER-01",
        customerId: "customer-a",
        customerName: "Same Name",
      }),
      makeTank({
        id: "CUSTOMER-02",
        customerId: "customer-b",
        customerName: "Same Name",
      }),
    ], NOW_MILLIS);

    expect(Object.keys(result.groupedTanks)).toStrictEqual([
      "today_lent::customer:customer-a",
      "today_lent::customer:customer-b",
    ]);
  });

  it("同customerIdでは不明名より具体名、具体名同士はlocaleCompare最小を選ぶ", () => {
    const forwardResult = buildBulkReturnCandidateGroups([
      makeTank({
        id: "STABLE-03",
        customerId: "stable-customer",
        customerName: "Zulu",
      }),
      makeTank({
        id: "STABLE-02",
        customerId: "stable-customer",
        customerName: "",
        location: "",
      }),
      makeTank({
        id: "STABLE-01",
        customerId: "stable-customer",
        customerName: "Alpha",
      }),
    ], NOW_MILLIS);
    const reverseResult = buildBulkReturnCandidateGroups([
      makeTank({
        id: "STABLE-01",
        customerId: "stable-customer",
        customerName: "Alpha",
      }),
      makeTank({
        id: "STABLE-03",
        customerId: "stable-customer",
        customerName: "Zulu",
      }),
      makeTank({
        id: "STABLE-02",
        customerId: "stable-customer",
        customerName: "",
        location: "",
      }),
    ], NOW_MILLIS);

    expect(
      forwardResult.groupMeta["today_lent::customer:stable-customer"].location,
    ).toBe("Alpha");
    expect(
      reverseResult.groupMeta["today_lent::customer:stable-customer"].location,
    ).toBe("Alpha");
  });
});

describe("buildBulkReturnCandidateGroups tag restoration", () => {
  it.each([
    ["lent unused", "lent", "[TAG:unused]", "unused"],
    ["lent uncharged", "lent", "[TAG:uncharged]", "uncharged"],
    ["legacy lent keep", "貸出中", "[TAG:keep]", "keep"],
    ["unreturned keep", "unreturned", "[TAG:keep]", "normal"],
    ["unreturned unused", "unreturned", "[TAG:unused]", "unused"],
    ["legacy unreturned uncharged", "未返却", "[TAG:uncharged]", "uncharged"],
    ["markerなし", "lent", undefined, "normal"],
    ["不明marker", "lent", "[TAG:unknown]", "normal"],
  ])("%sをexact tagへ復元する", (_label, status, logNote, expectedTag) => {
    const result = buildBulkReturnCandidateGroups([
      makeTank({
        id: "TAG-01",
        status,
        customerId: "tag-customer",
        logNote,
      }),
    ], NOW_MILLIS);

    expect(getOnlyTank(result).tag).toBe(expectedTag);
  });
});

describe("buildBulkReturnCandidateGroups sortMillis merging", () => {
  it("past_lentは同groupの最大millisを保持する", () => {
    const forwardResult = buildBulkReturnCandidateGroups([
      makeTank({ id: "PAST-01", customerId: "past", updatedAt: PAST_OLDER }),
      makeTank({ id: "PAST-02", customerId: "past", updatedAt: PAST_RECENT }),
    ], NOW_MILLIS);
    const reverseResult = buildBulkReturnCandidateGroups([
      makeTank({ id: "PAST-02", customerId: "past", updatedAt: PAST_RECENT }),
      makeTank({ id: "PAST-01", customerId: "past", updatedAt: PAST_OLDER }),
    ], NOW_MILLIS);

    expect(
      forwardResult.groupMeta["past_lent::customer:past"].sortMillis,
    ).toBe(PAST_RECENT);
    expect(
      reverseResult.groupMeta["past_lent::customer:past"].sortMillis,
    ).toBe(PAST_RECENT);
  });

  it("long_termは同groupの最小millisを保持する", () => {
    const forwardResult = buildBulkReturnCandidateGroups([
      makeTank({
        id: "LONG-01",
        status: "unreturned",
        customerId: "long",
        updatedAt: PAST_RECENT,
      }),
      makeTank({
        id: "LONG-02",
        status: "unreturned",
        customerId: "long",
        updatedAt: LONG_OLDER,
      }),
    ], NOW_MILLIS);
    const reverseResult = buildBulkReturnCandidateGroups([
      makeTank({
        id: "LONG-02",
        status: "unreturned",
        customerId: "long",
        updatedAt: LONG_OLDER,
      }),
      makeTank({
        id: "LONG-01",
        status: "unreturned",
        customerId: "long",
        updatedAt: PAST_RECENT,
      }),
    ], NOW_MILLIS);

    expect(
      forwardResult.groupMeta["long_term::customer:long"].sortMillis,
    ).toBe(LONG_OLDER);
    expect(
      reverseResult.groupMeta["long_term::customer:long"].sortMillis,
    ).toBe(LONG_OLDER);
  });

  it("today_lentは同groupの最小millisを保持する", () => {
    const forwardResult = buildBulkReturnCandidateGroups([
      makeTank({
        id: "TODAY-01",
        customerId: "today",
        updatedAt: TODAY_START + 200,
      }),
      makeTank({
        id: "TODAY-02",
        customerId: "today",
        updatedAt: TODAY_START + 100,
      }),
    ], NOW_MILLIS);
    const reverseResult = buildBulkReturnCandidateGroups([
      makeTank({
        id: "TODAY-02",
        customerId: "today",
        updatedAt: TODAY_START + 100,
      }),
      makeTank({
        id: "TODAY-01",
        customerId: "today",
        updatedAt: TODAY_START + 200,
      }),
    ], NOW_MILLIS);

    expect(forwardResult.groupMeta["today_lent::customer:today"].sortMillis).toBe(
      TODAY_START + 100,
    );
    expect(reverseResult.groupMeta["today_lent::customer:today"].sortMillis).toBe(
      TODAY_START + 100,
    );
  });

  it("nullは有効なlong_term millisを上書きしない", () => {
    const result = buildBulkReturnCandidateGroups([
      makeTank({
        id: "NULL-01",
        status: "unreturned",
        customerId: "nullable",
        updatedAt: null,
      }),
      makeTank({
        id: "NULL-02",
        status: "unreturned",
        customerId: "nullable",
        updatedAt: LONG_OLDER,
      }),
      makeTank({
        id: "NULL-03",
        status: "unreturned",
        customerId: "nullable",
        updatedAt: undefined,
      }),
    ], NOW_MILLIS);

    expect(result.groupMeta["long_term::customer:nullable"].sortMillis).toBe(
      LONG_OLDER,
    );
  });

  it("同groupのmillisがすべてnullならnullを維持する", () => {
    const result = buildBulkReturnCandidateGroups([
      makeTank({
        id: "NULL-ONLY-01",
        status: "unreturned",
        customerId: "null-only",
        updatedAt: null,
      }),
      makeTank({
        id: "NULL-ONLY-02",
        status: "unreturned",
        customerId: "null-only",
        updatedAt: undefined,
      }),
    ], NOW_MILLIS);

    expect(result.groupMeta["long_term::customer:null-only"].sortMillis).toBeNull();
  });

  it("unknown_lentではnullと未来日時を統合して有効millisを保持する", () => {
    const result = buildBulkReturnCandidateGroups([
      makeTank({
        id: "UNKNOWN-01",
        customerId: "unknown",
        updatedAt: undefined,
      }),
      makeTank({
        id: "UNKNOWN-02",
        customerId: "unknown",
        updatedAt: TOMORROW_START,
      }),
    ], NOW_MILLIS);

    expect(result.groupMeta["unknown_lent::customer:unknown"].sortMillis).toBe(
      TOMORROW_START,
    );
  });
});

describe("buildBulkReturnCandidateGroups group meta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("4 poolのexact meta label・identity・millisを固定する", () => {
    const result = buildBulkReturnCandidateGroups([
      makeTank({
        id: "META-TODAY",
        customerId: "customer-today",
        customerName: "Today Customer",
        updatedAt: TODAY_START,
      }),
      makeTank({
        id: "META-PAST",
        customerName: "Past Customer",
        updatedAt: PAST_RECENT,
      }),
      makeTank({
        id: "META-UNKNOWN",
        location: "Unknown Location",
        updatedAt: undefined,
      }),
      makeTank({
        id: "META-LONG",
        status: "unreturned",
        customerId: "customer-long",
        customerName: "Long Customer",
        updatedAt: LONG_OLDER,
      }),
      makeTank({
        id: "META-LONG-NULL",
        status: "unreturned",
        customerName: "Long Unknown Date",
        updatedAt: undefined,
      }),
    ], NOW_MILLIS);

    expect(result.groupMeta).toStrictEqual({
      "today_lent::customer:customer-today": {
        key: "today_lent::customer:customer-today",
        location: "Today Customer",
        customerId: "customer-today",
        isLegacyCustomerIdentity: false,
        pool: "today_lent",
        poolLabel: "本日貸出",
        dateLabel: "7/27 貸出分",
        sortMillis: TODAY_START,
      },
      "past_lent::legacy-location:Past Customer": {
        key: "past_lent::legacy-location:Past Customer",
        location: "Past Customer",
        isLegacyCustomerIdentity: true,
        pool: "past_lent",
        poolLabel: "前日以前",
        dateLabel: "7/26 以前",
        sortMillis: PAST_RECENT,
      },
      "unknown_lent::legacy-location:Unknown Location": {
        key: "unknown_lent::legacy-location:Unknown Location",
        location: "Unknown Location",
        isLegacyCustomerIdentity: true,
        pool: "unknown_lent",
        poolLabel: "日付不明",
        dateLabel: "貸出日不明",
        sortMillis: null,
      },
      "long_term::customer:customer-long": {
        key: "long_term::customer:customer-long",
        location: "Long Customer",
        customerId: "customer-long",
        isLegacyCustomerIdentity: false,
        pool: "long_term",
        poolLabel: "長期貸出",
        dateLabel: "7/20 から未返却",
        sortMillis: LONG_OLDER,
      },
      "long_term::legacy-location:Long Unknown Date": {
        key: "long_term::legacy-location:Long Unknown Date",
        location: "Long Unknown Date",
        isLegacyCustomerIdentity: true,
        pool: "long_term",
        poolLabel: "長期貸出",
        dateLabel: "未返却",
        sortMillis: null,
      },
    });
  });

  it("日付formatへja-JPとAsia/Tokyoを明示する", () => {
    const OriginalDateTimeFormat = Intl.DateTimeFormat;
    const dateTimeFormatSpy = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(function DateTimeFormat(
        ...args: Parameters<typeof Intl.DateTimeFormat>
      ) {
        return new OriginalDateTimeFormat(...args);
      } as typeof Intl.DateTimeFormat);

    buildBulkReturnCandidateGroups([
      makeTank({
        id: "TIMEZONE-01",
        customerId: "timezone",
        updatedAt: TODAY_START,
      }),
    ], NOW_MILLIS);

    expect(dateTimeFormatSpy).toHaveBeenCalledWith("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
    });
  });
});

describe("bulk return candidate sorting", () => {
  it("group内tankをID昇順にする", () => {
    const result = buildBulkReturnCandidateGroups([
      makeTank({ id: "C-03", customerId: "sort-customer" }),
      makeTank({ id: "A-01", customerId: "sort-customer" }),
      makeTank({ id: "B-02", customerId: "sort-customer" }),
    ], NOW_MILLIS);

    expect(
      result.groupedTanks["today_lent::customer:sort-customer"].map(
        (tank) => tank.id,
      ),
    ).toStrictEqual(["A-01", "B-02", "C-03"]);
  });

  it("pool・past降順・long昇順・today/unknown location・null位置でkeyをsortする", () => {
    const inputKeys = [
      "long-null",
      "unknown-b",
      "past-old",
      "today-b",
      "long-new",
      "past-null",
      "unknown-a",
      "today-a",
      "long-old",
      "past-new",
    ];
    const groupedTanks = Object.fromEntries(
      inputKeys.map((key) => [key, []]),
    ) as Record<string, BulkTankWithTag[]>;
    const groupMeta: Record<string, BulkReturnGroupMeta> = {
      "today-a": {
        key: "today-a",
        location: "A",
        isLegacyCustomerIdentity: true,
        pool: "today_lent",
        poolLabel: "本日貸出",
        dateLabel: "7/27 貸出分",
        sortMillis: TODAY_START,
      },
      "today-b": {
        key: "today-b",
        location: "B",
        isLegacyCustomerIdentity: true,
        pool: "today_lent",
        poolLabel: "本日貸出",
        dateLabel: "7/27 貸出分",
        sortMillis: TODAY_START,
      },
      "past-new": {
        key: "past-new",
        location: "C",
        isLegacyCustomerIdentity: true,
        pool: "past_lent",
        poolLabel: "前日以前",
        dateLabel: "7/26 以前",
        sortMillis: 300,
      },
      "past-old": {
        key: "past-old",
        location: "A",
        isLegacyCustomerIdentity: true,
        pool: "past_lent",
        poolLabel: "前日以前",
        dateLabel: "7/24 以前",
        sortMillis: 200,
      },
      "past-null": {
        key: "past-null",
        location: "B",
        isLegacyCustomerIdentity: true,
        pool: "past_lent",
        poolLabel: "前日以前",
        dateLabel: "前日以前の貸出中",
        sortMillis: null,
      },
      "unknown-a": {
        key: "unknown-a",
        location: "A",
        isLegacyCustomerIdentity: true,
        pool: "unknown_lent",
        poolLabel: "日付不明",
        dateLabel: "貸出日不明",
        sortMillis: null,
      },
      "unknown-b": {
        key: "unknown-b",
        location: "B",
        isLegacyCustomerIdentity: true,
        pool: "unknown_lent",
        poolLabel: "日付不明",
        dateLabel: "貸出日不明",
        sortMillis: null,
      },
      "long-old": {
        key: "long-old",
        location: "C",
        isLegacyCustomerIdentity: true,
        pool: "long_term",
        poolLabel: "長期貸出",
        dateLabel: "7/20 から未返却",
        sortMillis: 100,
      },
      "long-new": {
        key: "long-new",
        location: "A",
        isLegacyCustomerIdentity: true,
        pool: "long_term",
        poolLabel: "長期貸出",
        dateLabel: "7/26 から未返却",
        sortMillis: 400,
      },
      "long-null": {
        key: "long-null",
        location: "B",
        isLegacyCustomerIdentity: true,
        pool: "long_term",
        poolLabel: "長期貸出",
        dateLabel: "未返却",
        sortMillis: null,
      },
    };

    expect(getBulkReturnGroupKeys(groupedTanks, groupMeta)).toStrictEqual([
      "today-a",
      "today-b",
      "past-new",
      "past-old",
      "past-null",
      "unknown-a",
      "unknown-b",
      "long-old",
      "long-new",
      "long-null",
    ]);
  });
});

describe("buildBulkReturnCandidateGroups invalid status and purity", () => {
  beforeEach(() => {
    getTanksMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("不正statusでexact errorを投げる", () => {
    expect(() => buildBulkReturnCandidateGroups([
      makeTank({
        id: "BAD-01",
        status: "invalid",
      }),
    ], NOW_MILLIS)).toThrowError(/^\[BAD-01\] status が不正です$/);
  });

  it("repository・Date.nowを呼ばず入力配列とtankを変更しない", () => {
    const tankA = makeTank({
      id: "PURE-02",
      customerId: "pure",
    });
    const tankB = makeTank({
      id: "PURE-01",
      customerId: "pure",
    });
    const input: readonly BulkTankDoc[] = [tankA, tankB];
    const nowSpy = vi.spyOn(Date, "now");

    buildBulkReturnCandidateGroups(input, NOW_MILLIS);

    expect(getTanksMock).not.toHaveBeenCalled();
    expect(nowSpy).not.toHaveBeenCalled();
    expect(input).toStrictEqual([tankA, tankB]);
    expect(tankA).toStrictEqual({
      id: "PURE-02",
      status: "lent",
      customerId: "pure",
      location: "Location",
      staff: "Staff",
      updatedAt: TODAY_START,
    });
    expect(tankB).toStrictEqual({
      id: "PURE-01",
      status: "lent",
      customerId: "pure",
      location: "Location",
      staff: "Staff",
      updatedAt: TODAY_START,
    });
  });
});
