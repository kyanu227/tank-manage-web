import {
  calculateBillingCandidate,
  type BillingLineItem,
  type BillingReturnAdjustment,
  type BillingSourceLine,
  type BillingTaxBreakdown,
} from "@/lib/billing/calculate";
import type { BillingInvoiceSettings } from "@/lib/billing/settings";
import { collectBillingSourceLogMatches } from "@/lib/billing/source-logs";
import {
  buildCustomerIdentityGroup,
  normalizeCustomerIdentityText,
} from "@/lib/customer-identity-read";
import type { LogDoc } from "@/lib/firebase/repositories/types";
import {
  assertOfficialAggregationSchemaReady,
  collectPendingTransitionReviewImpact,
} from "@/lib/tank-transition-projections";

export type BillingCustomerMaster = {
  customerId: string;
  customerName: string;
  formalName: string;
  price10: number;
  price12: number;
  priceAluminum: number;
};

export type InvoiceCandidate = {
  key: string;
  period: string;
  customerId?: string;
  customerName: string;
  customerFormalName?: string;
  recipientName: string;
  isLegacy: boolean;
  pricingResolved: boolean;
  lendCount: number;
  sourceLogIds: string[];
  lineItems: BillingLineItem[];
  subtotal: number;
  discountTotal: number;
  taxBreakdown: BillingTaxBreakdown[];
  tax: number;
  total: number;
  warnings: string[];
  /** pending recoveryが残る間は請求書印刷を禁止する。 */
  printBlocked: boolean;
  printBlockReasons: string[];
};

type BuildInvoiceCandidatesInput = {
  logs: LogDoc[];
  customers: BillingCustomerMaster[];
  period: string;
  settings: BillingInvoiceSettings;
};

type InvoiceCandidateGroup = {
  key: string;
  period: string;
  customerId?: string;
  customerName: string;
  customerFormalName?: string;
  recipientName: string;
  isLegacy: boolean;
  pricing?: BillingCustomerMaster;
  sourceLines: BillingSourceLine[];
  carryOverExtras: Array<{ sourceLogId: string; quantity: number; note?: string }>;
  sourceLogIds: Set<string>;
  warnings: Set<string>;
  printBlockReasons: Set<string>;
};

export function buildInvoiceCandidates({
  logs,
  customers,
  period,
  settings,
}: BuildInvoiceCandidatesInput): InvoiceCandidate[] {
  assertOfficialAggregationSchemaReady(logs);
  const customerById = new Map(customers.map((customer) => [customer.customerId, customer]));
  const customersByName = buildCustomerNameIndex(customers);
  const groups = new Map<string, InvoiceCandidateGroup>();
  const matches = collectBillingSourceLogMatches(logs, period);
  const pendingImpact = collectPendingTransitionReviewImpact(logs);

  for (const match of matches) {
    const lendLog = match.lendLog;
    const lendEvent = match.lendEvent;
    const customerId = normalizeCustomerIdentityText(
      lendEvent.customerId ?? lendLog.customerId,
    );
    const customerMaster = customerId ? customerById.get(customerId) : undefined;
    const identity = buildCustomerIdentityGroup(
      {
        customerId: lendEvent.customerId ?? lendLog.customerId,
        customerName: lendEvent.customerName ?? lendLog.customerName,
        location: lendEvent.location ?? lendLog.location,
      },
      { currentCustomerName: customerMaster?.customerName },
    );
    const group = getOrCreateGroup({
      groups,
      identityKey: identity.key,
      period,
      customerId: identity.customerId,
      customerName: identity.displayName,
      isLegacy: identity.isLegacy,
      pricing: resolvePricing(identity.customerId, identity.displayName, customerById, customersByName),
    });
    const returnAdjustment = buildReturnAdjustment(
      match.matchedReturn?.actionCode,
      settings,
    );

    group.sourceLines.push({
      sourceLogId: lendLog.id,
      tankId: lendEvent.tankId ?? lendLog.tankId,
      action: match.lendActionCode,
      customerId: identity.customerId,
      customerName: identity.displayName,
      category: "steel10",
      quantity: 1,
      returnAdjustment,
    });
    group.sourceLogIds.add(lendLog.id);

    if (match.matchedReturn) {
      group.sourceLogIds.add(match.matchedReturn.logId);
      if (match.matchedReturn.actionCode === "carry_over") {
        group.carryOverExtras.push({
          sourceLogId: match.matchedReturn.logId,
          quantity: 1,
          note: "持ち越し",
        });
        if (settings.carryOverBillingMode === "daily_extra") {
          group.warnings.add("持ち越し日額追加は日数未確定のため請求候補には未適用です。");
        }
      }
    }
  }

  const affectedCustomerIds = new Set(pendingImpact.affectedCustomerIds);
  for (const group of groups.values()) {
    if (pendingImpact.hasUnknownAffectedCustomer) {
      group.printBlockReasons.add(
        "影響顧客を特定できない未レビューの例外操作があるため、印刷できません。",
      );
    }
    if (group.customerId && affectedCustomerIds.has(group.customerId)) {
      group.printBlockReasons.add(
        "この顧客に未レビューの例外操作があるため、集計承認または除外の完了まで印刷できません。",
      );
    }
  }

  return Array.from(groups.values())
    .map((group) => buildCandidate(group, settings))
    .sort((a, b) => b.total - a.total || a.recipientName.localeCompare(b.recipientName));
}

function buildCandidate(
  group: InvoiceCandidateGroup,
  settings: BillingInvoiceSettings,
): InvoiceCandidate {
  const calculation = calculateBillingCandidate({
    sourceLines: group.sourceLines,
    unitPrices: {
      price10: group.pricing?.price10 ?? 0,
      price12: group.pricing?.price12 ?? 0,
      priceAluminum: group.pricing?.priceAluminum ?? 0,
    },
    settings,
    carryOverExtras: group.carryOverExtras,
  });
  const warnings = new Set(group.warnings);
  group.printBlockReasons.forEach((reason) => warnings.add(reason));

  if (group.isLegacy) {
    warnings.add("旧形式データのため、顧客IDではなく過去の貸出先名で集計しています。");
  }
  if (!group.pricing) {
    warnings.add("単価が解決できないため、金額が0円になっています。顧客管理の単価設定を確認してください。");
  }

  return {
    key: group.key,
    period: group.period,
    customerId: group.customerId,
    customerName: group.customerName,
    customerFormalName: group.customerFormalName,
    recipientName: group.recipientName,
    isLegacy: group.isLegacy,
    pricingResolved: Boolean(group.pricing),
    lendCount: group.sourceLines.length,
    sourceLogIds: Array.from(group.sourceLogIds),
    lineItems: calculation.lineItems,
    subtotal: calculation.subtotal,
    discountTotal: calculation.discountTotal,
    taxBreakdown: calculation.taxBreakdown,
    tax: calculation.tax,
    total: calculation.total,
    warnings: Array.from(warnings),
    printBlocked: group.printBlockReasons.size > 0,
    printBlockReasons: Array.from(group.printBlockReasons),
  };
}

function getOrCreateGroup({
  groups,
  identityKey,
  period,
  customerId,
  customerName,
  isLegacy,
  pricing,
}: {
  groups: Map<string, InvoiceCandidateGroup>;
  identityKey: string;
  period: string;
  customerId?: string;
  customerName: string;
  isLegacy: boolean;
  pricing?: BillingCustomerMaster;
}): InvoiceCandidateGroup {
  const existing = groups.get(identityKey);
  if (existing) return existing;

  const recipientName = pricing?.formalName || pricing?.customerName || customerName;
  const group: InvoiceCandidateGroup = {
    key: identityKey,
    period,
    customerId,
    customerName,
    customerFormalName: pricing?.formalName,
    recipientName,
    isLegacy,
    pricing,
    sourceLines: [],
    carryOverExtras: [],
    sourceLogIds: new Set(),
    warnings: new Set(),
    printBlockReasons: new Set(),
  };
  groups.set(identityKey, group);
  return group;
}

function resolvePricing(
  customerId: string | undefined,
  displayName: string,
  customerById: Map<string, BillingCustomerMaster>,
  customersByName: Map<string, BillingCustomerMaster[]>,
): BillingCustomerMaster | undefined {
  if (customerId) return customerById.get(customerId);
  const candidates = customersByName.get(displayName) ?? [];
  return candidates.length === 1 ? candidates[0] : undefined;
}

function buildReturnAdjustment(
  returnActionCode: string | undefined,
  settings: BillingInvoiceSettings,
): BillingReturnAdjustment {
  if (returnActionCode === "return_unused") {
    return returnAdjustmentFromMode(
      settings.unusedReturnBillingMode,
      settings.unusedReturnDiscountRate,
      "未使用返却",
    );
  }
  if (returnActionCode === "return_uncharged") {
    return returnAdjustmentFromMode(
      settings.unchargedReturnBillingMode,
      settings.unchargedReturnDiscountRate,
      "未充填返却",
    );
  }
  return { type: "none" };
}

function returnAdjustmentFromMode(
  mode: BillingInvoiceSettings["unusedReturnBillingMode"],
  discountRate: number,
  reasonLabel: string,
): BillingReturnAdjustment {
  if (mode === "free") return { type: "free", reason: `${reasonLabel}: 無料` };
  if (mode === "discount") {
    return {
      type: "discount",
      rate: discountRate,
      reason: `${reasonLabel}: ${Math.round(discountRate * 1000) / 10}%割引`,
    };
  }
  return { type: "none" };
}

function buildCustomerNameIndex(
  customers: BillingCustomerMaster[],
): Map<string, BillingCustomerMaster[]> {
  const index = new Map<string, BillingCustomerMaster[]>();
  for (const customer of customers) {
    addCustomerNameIndex(index, customer.customerName, customer);
    addCustomerNameIndex(index, customer.formalName, customer);
  }
  return index;
}

function addCustomerNameIndex(
  index: Map<string, BillingCustomerMaster[]>,
  name: unknown,
  customer: BillingCustomerMaster,
) {
  const normalized = normalizeCustomerIdentityText(name);
  if (!normalized) return;
  const current = index.get(normalized) ?? [];
  if (!current.some((item) => item.customerId === customer.customerId)) {
    current.push(customer);
  }
  index.set(normalized, current);
}
