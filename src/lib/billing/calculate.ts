import type {
  BillingInvoiceSettings,
  BillingRoundingMode,
} from "@/lib/billing/settings";

export type BillingLineInput = {
  count: number;
  unitPrice10: number;
  unitPrice12: number;
  unitPriceAluminum: number;
};

export type BillingLineBreakdown = {
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

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
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

export function calculateBillingLineBreakdown(
  input: BillingLineInput,
  settings: BillingInvoiceSettings,
): BillingLineBreakdown {
  const quantity10 = Math.max(0, Math.trunc(safeNumber(input.count)));
  const quantity12 = 0;
  const quantityAluminum = 0;
  const unitPrice10 = Math.max(0, safeNumber(input.unitPrice10));
  const unitPrice12 = Math.max(0, safeNumber(input.unitPrice12));
  const unitPriceAluminum = Math.max(0, safeNumber(input.unitPriceAluminum));
  const subtotal10 = quantity10 * unitPrice10;
  const subtotal12 = quantity12 * unitPrice12;
  const subtotalAluminum = quantityAluminum * unitPriceAluminum;
  const subtotal = subtotal10 + subtotal12 + subtotalAluminum;
  const taxRate = Math.min(1, Math.max(0, safeNumber(settings.taxRate)));

  if (settings.taxMode === "none" || taxRate === 0) {
    return {
      quantity10,
      quantity12,
      quantityAluminum,
      unitPrice10,
      unitPrice12,
      unitPriceAluminum,
      subtotal10,
      subtotal12,
      subtotalAluminum,
      subtotal,
      tax: 0,
      total: subtotal,
    };
  }

  if (settings.taxMode === "inclusive") {
    const tax = roundBillingAmount(
      subtotal * taxRate / (1 + taxRate),
      settings.roundingMode,
    );
    return {
      quantity10,
      quantity12,
      quantityAluminum,
      unitPrice10,
      unitPrice12,
      unitPriceAluminum,
      subtotal10,
      subtotal12,
      subtotalAluminum,
      subtotal,
      tax,
      total: subtotal,
    };
  }

  const tax = roundBillingAmount(subtotal * taxRate, settings.roundingMode);
  return {
    quantity10,
    quantity12,
    quantityAluminum,
    unitPrice10,
    unitPrice12,
    unitPriceAluminum,
    subtotal10,
    subtotal12,
    subtotalAluminum,
    subtotal,
    tax,
    total: subtotal + tax,
  };
}
