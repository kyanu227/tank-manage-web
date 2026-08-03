import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PendingOrder } from "@/lib/order-types";
import { MODE_CONFIG } from "../constants";
import type { UseManualTankOperationResult } from "../hooks/useManualTankOperation";
import type { UseOrderFulfillmentResult } from "../hooks/useOrderFulfillment";
import type { UseReturnTagProcessingResult } from "../hooks/useReturnTagProcessing";
import type { ReturnGroup } from "../types";
import ManualOperationPanel from "./ManualOperationPanel";
import OrderFulfillmentScreen from "./OrderFulfillmentScreen";
import OrderListPanel, { getOrderActionView, getOrderStatusView } from "./OrderListPanel";
import ReturnRequestList from "./ReturnRequestList";
import ReturnTagProcessingScreen from "./ReturnTagProcessingScreen";

const JAPANESE_TEXT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff々〆〤ヶ]/u;

function createOrder(overrides: Partial<PendingOrder> = {}): PendingOrder {
  return {
    id: "order-1",
    customerId: "customer-1",
    customerName: "Ocean Shop",
    status: "approved",
    items: [{ tankType: "Steel 10L", quantity: 1 }],
    deliveryType: "delivery",
    deliveryTargetName: "North Pier",
    note: "Leave at reception",
    createdAt: { toMillis: () => Date.UTC(2026, 0, 1, 16, 0) },
    ...overrides,
  };
}

function createManualResult(
  overrides: Partial<UseManualTankOperationResult> = {},
): UseManualTankOperationResult {
  return {
    returnTag: "normal",
    setReturnTag: vi.fn(),
    opQueue: [],
    activePrefix: null,
    setActivePrefix: vi.fn(),
    inputValue: "",
    inputRef: { current: null },
    lastAdded: null,
    submitting: false,
    validCount: 0,
    focusInput: vi.fn(),
    handleInputChange: vi.fn(),
    handleManualOkTrigger: vi.fn(),
    removeFromQueue: vi.fn(),
    clearQueue: vi.fn(),
    handleSubmit: vi.fn(async () => undefined),
    reset: vi.fn(),
    ...overrides,
  };
}

function createOrderResult(
  order: PendingOrder,
  overrides: Partial<UseOrderFulfillmentResult> = {},
): UseOrderFulfillmentResult {
  return {
    ordersLoading: false,
    pendingOrders: [order],
    selectedOrder: order,
    scannedTanks: [],
    orderActivePrefix: null,
    setOrderActivePrefix: vi.fn(),
    orderInputValue: "",
    orderInputRef: { current: null },
    orderLastAdded: null,
    orderSubmitting: false,
    approvingOrderId: null,
    fetchOrders: vi.fn(async () => undefined),
    approveOrder: vi.fn(async () => undefined),
    openFulfillment: vi.fn(),
    closeFulfillment: vi.fn(),
    orderFocusInput: vi.fn(),
    handleOrderInputChange: vi.fn(),
    handleOrderOkTrigger: vi.fn(),
    removeScannedTank: vi.fn(),
    fulfillOrder: vi.fn(async () => undefined),
    ...overrides,
    ordersLoadFailed: overrides.ordersLoadFailed ?? false,
  };
}

function createReturnGroup(): ReturnGroup {
  return {
    customerId: "customer-1",
    customerName: "Ocean Shop",
    items: [{
      id: "return-1",
      customerId: "customer-1",
      customerName: "Ocean Shop",
      tankId: "A-01",
      condition: "unused",
      createdAt: { toMillis: () => Date.UTC(2026, 0, 1, 16, 0) },
    }],
  };
}

function createReturnProcessingResult(
  group: ReturnGroup,
  selected: boolean,
): UseReturnTagProcessingResult {
  return {
    pendingReturnTagsLoading: false,
    pendingReturnTagsLoadFailed: false,
    returnGroups: [group],
    selectedReturnGroup: group,
    setSelectedReturnGroup: vi.fn(),
    returnTagSelections: {
      "return-1": { selected, condition: "unused" },
    },
    setReturnTagSelections: vi.fn(),
    returnConfirmationSubmitting: false,
    fetchPendingReturnTags: vi.fn(async () => undefined),
    openReturnTagGroup: vi.fn(),
    confirmSelectedReturnRequests: vi.fn(async () => undefined),
  };
}

function expectNoJapaneseChrome(html: string): void {
  expect(JAPANESE_TEXT_PATTERN.test(html)).toBe(false);
}

describe("core staff operation screens", () => {
  it("renders the manual operation chrome in English with singular count copy", () => {
    const manual = createManualResult({
      opQueue: [{ uid: "queue-1", tankId: "A-01", status: "stored", valid: true, tag: "normal" }],
      activePrefix: "A",
      validCount: 1,
    });
    const html = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "fill",
      config: MODE_CONFIG.fill,
      operationLabel: "Fill",
      locale: "en",
      prefixes: ["A"],
      manual,
    }));

    expect(html).toContain("Submission list");
    expect(html).toContain("Run Fill for 1 tank");
    expect(html).toContain('aria-label="Tank number"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('data-staff-swipe-surface="confirm"');
    expectNoJapaneseChrome(html);
  });

  it("keeps the manual return back action outside the confirm swipe contract", () => {
    const html = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "return",
      config: MODE_CONFIG.return,
      operationLabel: "Return",
      locale: "en",
      prefixes: ["A"],
      manual: createManualResult({ activePrefix: "A" }),
      onBack: vi.fn(),
    }));

    expect(html).toContain('data-staff-swipe-surface="confirm"');
    expect(html).toMatch(/<button[^>]*data-swipe-ignore="true"[^>]*aria-label="Back"/u);
  });

  it("shows the clear-all action only while the submission list has items", () => {
    const emptyHtml = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "fill",
      config: MODE_CONFIG.fill,
      operationLabel: "Fill",
      locale: "en",
      prefixes: ["A"],
      manual: createManualResult({ activePrefix: "A" }),
    }));
    const filledHtml = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "fill",
      config: MODE_CONFIG.fill,
      operationLabel: "Fill",
      locale: "en",
      prefixes: ["A"],
      manual: createManualResult({
        opQueue: [{ uid: "queue-1", tankId: "A-01", status: "stored", valid: true, tag: "normal" }],
        activePrefix: "A",
        validCount: 1,
      }),
    }));
    const submittingHtml = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "fill",
      config: MODE_CONFIG.fill,
      operationLabel: "Fill",
      locale: "en",
      prefixes: ["A"],
      manual: createManualResult({
        opQueue: [{ uid: "queue-1", tankId: "A-01", status: "stored", valid: true, tag: "normal" }],
        activePrefix: "A",
        validCount: 1,
        submitting: true,
      }),
    }));

    expect(emptyHtml).not.toContain("Clear all");
    // 0 件でも枠・legend・送信位置は維持する
    expect(emptyHtml).toContain("Submission list");
    expect(emptyHtml).toContain("Run Fill for 0 tanks");
    expect(filledHtml).toContain("Clear all");
    expect(filledHtml).toContain('aria-label="Clear the submission list (tap again to confirm)"');
    // 送信中は全削除も送信も実行できない
    expect(submittingHtml).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Clear the submission list \(tap again to confirm\)"/u);
    expect(submittingHtml).toContain('aria-busy="true"');
    expectNoJapaneseChrome(emptyHtml);
    expectNoJapaneseChrome(filledHtml);
  });

  it("keeps the destination prompt muted and localized when no customer is selected", () => {
    const jaHtml = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "lend",
      config: MODE_CONFIG.lend,
      operationLabel: "貸出",
      locale: "ja",
      prefixes: ["A"],
      customerOptions: [{ value: "customer-1", label: "Ocean Shop" }],
      selectedCustomerId: "",
      setSelectedCustomerId: vi.fn(),
      manual: createManualResult({ activePrefix: "A" }),
    }));
    const enHtml = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "lend",
      config: MODE_CONFIG.lend,
      operationLabel: "Lend",
      locale: "en",
      prefixes: ["A"],
      customerOptions: [{ value: "customer-1", label: "Ocean Shop" }],
      selectedCustomerId: "",
      setSelectedCustomerId: vi.fn(),
      manual: createManualResult({ activePrefix: "A" }),
    }));

    const selectedHtml = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "lend",
      config: MODE_CONFIG.lend,
      operationLabel: "Lend",
      locale: "en",
      prefixes: ["A"],
      customerOptions: [{ value: "customer-1", label: "Ocean Shop" }],
      selectedCustomerId: "customer-1",
      setSelectedCustomerId: vi.fn(),
      manual: createManualResult({ activePrefix: "A" }),
    }));

    expect(jaHtml).toContain("貸出先を選択してください");
    expect(enHtml).toContain("Please select a destination");
    // 未選択のときはラベルを畳み、選択後にだけ出す
    expect(enHtml).not.toContain(">Destination<");
    expect(selectedHtml).toContain(">Destination<");
    expect(selectedHtml).toContain("Ocean Shop");
    expectNoJapaneseChrome(enHtml);
    expectNoJapaneseChrome(selectedHtml);
  });

  it("labels every manual return queue row with its tag, including untagged rows", () => {
    const html = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "return",
      config: MODE_CONFIG.return,
      operationLabel: "返却",
      locale: "ja",
      prefixes: ["A"],
      manual: createManualResult({
        opQueue: [
          { uid: "queue-1", tankId: "A-01", status: "lent", valid: true, tag: "normal" },
          { uid: "queue-2", tankId: "A-02", status: "lent", valid: true, tag: "keep" },
        ],
        activePrefix: "A",
        validCount: 2,
      }),
    }));

    expect(html).toContain("通常");
    // 用語の正本は「持ち越し」。「預かり」は使わない
    expect(html).toContain("持ち越し");
    expect(html).not.toContain("預かり");
  });

  it("renders operation data loading and failure states in English", () => {
    const loadingHtml = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "fill",
      config: MODE_CONFIG.fill,
      operationLabel: "Fill",
      locale: "en",
      prefixes: [],
      manual: createManualResult(),
      dataLoading: true,
    }));
    const failureHtml = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "fill",
      config: MODE_CONFIG.fill,
      operationLabel: "Fill",
      locale: "en",
      prefixes: [],
      manual: createManualResult(),
      dataLoadFailed: true,
      retryData: vi.fn(),
    }));

    expect(loadingHtml).toContain('role="status"');
    expect(loadingHtml).toContain("Loading tank data");
    expect(failureHtml).toContain('role="alert"');
    expect(failureHtml).toContain("The data required for this operation could not be loaded.");
    expect(failureHtml).toContain("Retry");
    expectNoJapaneseChrome(loadingHtml);
    expectNoJapaneseChrome(failureHtml);

    const emptyCustomersHtml = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "lend",
      config: MODE_CONFIG.lend,
      operationLabel: "Lend",
      locale: "en",
      prefixes: ["A"],
      customerOptions: [],
      setSelectedCustomerId: vi.fn(),
      manual: createManualResult(),
    }));
    expect(emptyCustomersHtml).toContain("No active customers are available.");
    expectNoJapaneseChrome(emptyCustomersHtml);
  });

  it("renders order list states, dates, quantities, and accessibility text in English", () => {
    const order = createOrder();
    const html = renderToStaticMarkup(createElement(OrderListPanel, {
      ordersLoading: false,
      pendingOrders: [order],
      approveOrder: vi.fn(async () => undefined),
      approvingOrderId: null,
      openFulfillment: vi.fn(),
      locale: "en",
    }));
    const loadingHtml = renderToStaticMarkup(createElement(OrderListPanel, {
      ordersLoading: true,
      pendingOrders: [],
      approveOrder: vi.fn(async () => undefined),
      approvingOrderId: null,
      openFulfillment: vi.fn(),
      locale: "en",
    }));

    expect(html).toContain("Approved");
    expect(html).toContain("Jan 2");
    expect(html).toContain("1 tank");
    expect(html).toContain("Deliver to: North Pier");
    expect(html).toContain("Note: Leave at reception");
    expect(html).toContain("Enter tanks");
    expect(loadingHtml).toContain('role="status"');
    expect(loadingHtml).toContain('aria-label="Loading orders"');
    expectNoJapaneseChrome(html);
    expectNoJapaneseChrome(loadingHtml);
  });

  it("distinguishes localized load failures from empty states", () => {
    const orderErrorHtml = renderToStaticMarkup(createElement(OrderListPanel, {
      ordersLoading: false,
      ordersLoadFailed: true,
      pendingOrders: [],
      approveOrder: vi.fn(async () => undefined),
      approvingOrderId: null,
      openFulfillment: vi.fn(),
      retryOrders: vi.fn(),
      locale: "en",
    }));
    const returnErrorHtml = renderToStaticMarkup(createElement(ReturnRequestList, {
      pendingReturnTagsLoading: false,
      loadFailed: true,
      returnGroups: [],
      openReturnTagGroup: vi.fn(),
      retry: vi.fn(),
      locale: "en",
    }));

    expect(orderErrorHtml).toContain('role="alert"');
    expect(orderErrorHtml).toContain("Orders could not be loaded.");
    expect(orderErrorHtml).toContain("Retry");
    expect(orderErrorHtml).not.toContain("There are no orders requiring action");
    expect(returnErrorHtml).toContain('role="alert"');
    expect(returnErrorHtml).toContain("Return requests could not be loaded.");
    expect(returnErrorHtml).not.toContain("There are no return tags waiting for processing.");
    expectNoJapaneseChrome(orderErrorHtml);
    expectNoJapaneseChrome(returnErrorHtml);
  });

  it("renders order fulfillment in English without changing customer or tank-type data", () => {
    const order = createOrder();
    const html = renderToStaticMarkup(createElement(OrderFulfillmentScreen, {
      selectedOrder: order,
      prefixes: ["A"],
      allTanks: {},
      fulfillment: createOrderResult(order),
      locale: "en",
    }));

    expect(html).toContain("Ocean Shop");
    expect(html).toContain("Steel 10L");
    expect(html).toContain("× 1 tank");
    expect(html).toContain("Scan 1 more tank");
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('aria-label="Tank number"');
    expect(html).toContain('data-staff-swipe-surface="confirm"');
    expect(html).toMatch(/<button[^>]*data-swipe-ignore="true"[^>]*aria-label="Back"/u);
    expectNoJapaneseChrome(html);
  });

  it("renders return request and processing states in English with stable tag codes", () => {
    const group = createReturnGroup();
    const requestHtml = renderToStaticMarkup(createElement(ReturnRequestList, {
      pendingReturnTagsLoading: false,
      returnGroups: [group],
      openReturnTagGroup: vi.fn(),
      locale: "en",
    }));
    const processingHtml = renderToStaticMarkup(createElement(ReturnTagProcessingScreen, {
      selectedReturnGroup: group,
      returnTagProcessing: createReturnProcessingResult(group, true),
      locale: "en",
    }));

    expect(requestHtml).toContain("1 customer / 1 tank");
    expect(requestHtml).toContain("Unused");
    expect(requestHtml).toContain("Review return tags for Ocean Shop");
    expect(processingHtml).toContain("Return tag processing");
    expect(processingHtml).toContain("Process 1 return tag");
    expect(processingHtml).toContain('aria-label="Remove A-01 from processing"');
    expect(processingHtml).toContain('aria-pressed="true"');
    expect(processingHtml).toContain('aria-busy="false"');
    expectNoJapaneseChrome(requestHtml);
    expectNoJapaneseChrome(processingHtml);
  });

  it.each([
    {
      locale: "ja" as const,
      processingTitle: "返却タグ処理",
      unknownTag: "不明なタグ（既存の処理規則が適用されます） (legacy_condition)",
      selectionLabel: "A-01を処理対象から外す",
      processLabel: "1件の返却タグを処理する",
    },
    {
      locale: "en" as const,
      processingTitle: "Return tag processing",
      unknownTag: "Unknown tag (the existing processing rule will be applied) (legacy_condition)",
      selectionLabel: "Remove A-01 from processing",
      processLabel: "Process 1 return tag",
    },
  ])("$locale keeps an unknown legacy return condition visible and processable", ({
    locale,
    processingTitle,
    unknownTag,
    selectionLabel,
    processLabel,
  }) => {
    const group = createReturnGroup();
    (group.items[0] as unknown as { condition: unknown }).condition = "legacy_condition";
    const processing = createReturnProcessingResult(group, true);
    (processing.returnTagSelections["return-1"] as unknown as { condition: unknown }).condition = "legacy_condition";

    const html = renderToStaticMarkup(createElement(ReturnRequestList, {
      pendingReturnTagsLoading: false,
      returnGroups: [group],
      openReturnTagGroup: vi.fn(),
      locale,
    }));
    const processingHtml = renderToStaticMarkup(createElement(ReturnTagProcessingScreen, {
      selectedReturnGroup: group,
      returnTagProcessing: processing,
      locale,
    }));

    expect(html).toContain(`A-01 ${unknownTag}`);
    expect(processingHtml).toContain(unknownTag);
    expect(processingHtml).toContain(`${processingTitle} — 1/1`);
    expect(processingHtml).toContain(`aria-label="${selectionLabel}"`);
    expect(processingHtml).toContain('aria-pressed="true"');
    expect(processingHtml).toContain(processLabel);
    expect(processingHtml).toContain("cursor:pointer");
    expect(processingHtml).not.toContain("cursor:not-allowed");
    expect(processingHtml).not.toContain("opacity:0.55");
    expect(processingHtml).not.toContain("disabled");
    if (locale === "en") {
      expectNoJapaneseChrome(html);
      expectNoJapaneseChrome(processingHtml);
    }
  });

  it("preserves the existing Japanese operation copy", () => {
    const order = createOrder();
    const orderHtml = renderToStaticMarkup(createElement(OrderListPanel, {
      ordersLoading: false,
      pendingOrders: [order],
      approveOrder: vi.fn(async () => undefined),
      approvingOrderId: null,
      openFulfillment: vi.fn(),
      locale: "ja",
    }));
    const fulfillmentHtml = renderToStaticMarkup(createElement(OrderFulfillmentScreen, {
      selectedOrder: order,
      prefixes: ["A"],
      allTanks: {},
      fulfillment: createOrderResult(order),
      locale: "ja",
    }));

    expect(orderHtml).toContain("承認済み");
    expect(orderHtml).toContain("配達先: North Pier");
    expect(orderHtml).toContain("× 1本");
    expect(fulfillmentHtml).toContain("あと 1 本スキャンしてください");

    const manualHtml = renderToStaticMarkup(createElement(ManualOperationPanel, {
      mode: "fill",
      config: MODE_CONFIG.fill,
      operationLabel: "充填",
      locale: "ja",
      prefixes: ["A"],
      manual: createManualResult({
        opQueue: [{
          uid: "queue-1",
          tankId: "A-01",
          status: "lent",
          valid: true,
          recoveryCandidate: true,
          tag: "normal",
        }],
        activePrefix: "A",
        validCount: 1,
      }),
    }));
    expect(manualHtml).toContain("現在: 貸出中 ・自動補完確認が必要");
  });
});

describe("order display discriminants", () => {
  it.each([
    [createOrder({ customerId: "", status: "pending_link" }), "disabled", "Awaiting customer link"],
    [createOrder({ status: "pending" }), "approve", "Not approved"],
    [createOrder({ status: "pending_approval" }), "approve", "Awaiting approval"],
    [createOrder({ status: "approved" }), "fulfill", "Approved"],
    [createOrder({ status: "completed" }), "disabled", "Completed"],
  ] as const)("keeps action kind while localizing status", (order, kind, label) => {
    expect(getOrderActionView(order, "en").kind).toBe(kind);
    expect(getOrderStatusView(order, "en").label).toBe(label);
  });
});
