import type {
  BillingInvoiceSettings,
  BillingRoundingMode,
} from "@/lib/billing/settings";

export type BillingTankCategory = "steel10" | "steel12" | "aluminum";

export type BillingReturnAdjustment =
  | { type: "none" }
  | { type: "free"; reason: string }
  | { type: "discount"; rate: number; reason: string };

export type BillingSourceLine = {
  sourceLogId: string;
  tankId?: string;
  action: string;
  customerId?: string;
  customerName?: string;
  category: BillingTankCategory;
  quantity: number;
  returnAdjustment: BillingReturnAdjustment;
};

export type BillingUnitPrices = {
  price10: number;
  price12: number;
  priceAluminum: number;
};

export type BillingLineItem = {
  label: string;
  category: BillingTankCategory | "carry_over_extra";
  quantity: number;
  unitPrice: number;
  discountRate: number;
  amountBeforeDiscount: number;
  discountAmount: number;
  amount: number;
  sourceLogIds: string[];
  note?: string;
};

export type BillingTaxBreakdown = {
  taxRate: number;
  taxableSubtotal: number;
  tax: number;
  total: number;
};

export type BillingCalculationResult = {
  lineItems: BillingLineItem[];
  subtotal: number;
  discountTotal: number;
  taxBreakdown: BillingTaxBreakdown[];
  tax: number;
  total: number;
};

export type BillingLineInput = {
  count: number;
  unitPrice10: number;
  unitPrice12: number;
  unitPriceAluminum: number;
};

export type BillingInvoiceLineItem = {
  label: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
};

export type BillingLineBreakdown = {
  lineItems: BillingInvoiceLineItem[];
  quantity10: number;
  quantity12: number;
  quantityAluminum: number;
  unitPrice10: number;
  unitPrice12: number;
  unitPriceAluminum: number;
  subtotal10: number;
  subtotal12: number;
  subtotalAluminum: number;
  subtotal: number;
  tax: number;
  total: number;
};

export type CarryOverExtraInput = {
  sourceLogId: string;
  quantity: number;
  note?: string;
};

type CalculateBillingCandidateInput = {
  sourceLines: BillingSourceLine[];
  unitPrices: BillingUnitPrices;
  settings: BillingInvoiceSettings;
  carryOverExtras?: CarryOverExtraInput[];
};

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function safeQuantity(value: number): number {
  return Math.max(0, Math.trunc(safeNumber(value)));
}

function clampRate(value: number): number {
  return Math.min(1, Math.max(0, safeNumber(value)));
}

function moneyAmount(value: number): number {
  return Math.max(0, safeNumber(value));
}

export function roundBillingAmount(
  amount: number,
  roundingMode: BillingRoundingMode,
): number {
  if (!Number.isFinite(amount)) return 0;
  if (roundingMode === "ceil") return Math.ceil(amount);
  if (roundingMode === "round") return Math.round(amount);
  return Math.floor(amount);
}

export function calculateBillingCandidate({
  sourceLines,
  unitPrices,
  settings,
  carryOverExtras = [],
}: CalculateBillingCandidateInput): BillingCalculationResult {
  const lineItems: BillingLineItem[] = [];

  for (const sourceLine of sourceLines) {
    const quantity = safeQuantity(sourceLine.quantity);
    if (quantity <= 0) continue;

    const unitPrice = unitPriceForCategory(sourceLine.category, unitPrices);
    const amountBeforeDiscount = quantity * unitPrice;
    const adjustment = sourceLine.returnAdjustment;
    const discountRate =
      adjustment.type === "free"
        ? 1
        : adjustment.type === "discount"
          ? clampRate(adjustment.rate)
          : 0;
    const discountAmount = roundBillingAmount(
      amountBeforeDiscount * discountRate,
      settings.roundingMode,
    );
    const amount = Math.max(0, amountBeforeDiscount - discountAmount);

    lineItems.push({
      label: labelForCategory(sourceLine.category, settings),
      category: sourceLine.category,
      quantity,
      unitPrice,
      discountRate,
      amountBeforeDiscount,
      discountAmount,
      amount,
      sourceLogIds: [sourceLine.sourceLogId],
      note: adjustment.type === "none" ? undefined : adjustment.reason,
    });
  }

  if (settings.carryOverBillingMode === "monthly_extra") {
    for (const carryOverExtra of carryOverExtras) {
      const quantity = safeQuantity(carryOverExtra.quantity);
      const unitPrice = moneyAmount(settings.carryOverMonthlyExtraPrice);
      if (quantity <= 0 || unitPrice <= 0) continue;

      lineItems.push({
        label: "持ち越し追加料金",
        category: "carry_over_extra",
        quantity,
        unitPrice,
        discountRate: 0,
        amountBeforeDiscount: quantity * unitPrice,
        discountAmount: 0,
        amount: quantity * unitPrice,
        sourceLogIds: [carryOverExtra.sourceLogId],
        note: carryOverExtra.note,
      });
    }
  }

  const subtotalBeforeDiscount = lineItems.reduce(
    (sum, line) => sum + line.amountBeforeDiscount,
    0,
  );
  const discountTotal = lineItems.reduce((sum, line) => sum + line.discountAmount, 0);
  const subtotal = lineItems.reduce((sum, line) => sum + line.amount, 0);
  const taxBreakdown = calculateTaxBreakdown(subtotal, settings);
  const tax = taxBreakdown.reduce((sum, row) => sum + row.tax, 0);
  const total = taxBreakdown.reduce((sum, row) => sum + row.total, 0);

  return {
    lineItems,
    subtotal: subtotalBeforeDiscount - discountTotal,
    discountTotal,
    taxBreakdown,
    tax,
    total,
  };
}

function calculateTaxBreakdown(
  subtotal: number,
  settings: BillingInvoiceSettings,
): BillingTaxBreakdown[] {
  const safeSubtotal = moneyAmount(subtotal);
  const taxRate = clampRate(settings.taxRate);

  if (settings.taxMode === "none" || taxRate === 0) {
    return [{
      taxRate: 0,
      taxableSubtotal: safeSubtotal,
      tax: 0,
      total: safeSubtotal,
    }];
  }

  if (settings.taxMode === "inclusive") {
    const tax = roundBillingAmount(
      safeSubtotal * taxRate / (1 + taxRate),
      settings.roundingMode,
    );
    return [{
      taxRate,
      taxableSubtotal: safeSubtotal - tax,
      tax,
      total: safeSubtotal,
    }];
  }

  const tax = roundBillingAmount(safeSubtotal * taxRate, settings.roundingMode);
  return [{
    taxRate,
    taxableSubtotal: safeSubtotal,
    tax,
    total: safeSubtotal + tax,
  }];
}

function unitPriceForCategory(
  category: BillingTankCategory,
  unitPrices: BillingUnitPrices,
): number {
  if (category === "steel12") return moneyAmount(unitPrices.price12);
  if (category === "aluminum") return moneyAmount(unitPrices.priceAluminum);
  return moneyAmount(unitPrices.price10);
}

function labelForCategory(
  category: BillingTankCategory,
  settings: BillingInvoiceSettings,
): string {
  if (category === "steel12") return settings.invoiceItemLabel12;
  if (category === "aluminum") return settings.invoiceItemLabelAluminum;
  return settings.invoiceItemLabel10;
}

export function calculateBillingLineBreakdown(
  input: BillingLineInput,
  settings: BillingInvoiceSettings,
): BillingLineBreakdown {
  const quantity10 = safeQuantity(input.count);
  const quantity12 = 0;
  const quantityAluminum = 0;
  const result = calculateBillingCandidate({
    sourceLines: quantity10 > 0
      ? [{
        sourceLogId: "legacy",
        action: "lend",
        category: "steel10",
        quantity: quantity10,
        returnAdjustment: { type: "none" },
      }]
      : [],
    unitPrices: {
      price10: input.unitPrice10,
      price12: input.unitPrice12,
      priceAluminum: input.unitPriceAluminum,
    },
    settings,
  });
  const subtotal10 = result.lineItems
    .filter((line) => line.category === "steel10")
    .reduce((sum, line) => sum + line.amount, 0);

  return {
    lineItems: result.lineItems.map((line) => ({
      label: line.label,
      quantity: line.quantity,
      unit: "本",
      unitPrice: line.unitPrice,
      amount: line.amount,
    })),
    quantity10,
    quantity12,
    quantityAluminum,
    unitPrice10: moneyAmount(input.unitPrice10),
    unitPrice12: moneyAmount(input.unitPrice12),
    unitPriceAluminum: moneyAmount(input.unitPriceAluminum),
    subtotal10,
    subtotal12: 0,
    subtotalAluminum: 0,
    subtotal: result.subtotal,
    tax: result.tax,
    total: result.total,
  };
}
