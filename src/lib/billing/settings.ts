export type BillingTaxMode = "exclusive" | "inclusive" | "none";
export type BillingRoundingMode = "floor" | "round" | "ceil";
export type ReturnBillingMode = "charge" | "free" | "discount";
export type CarryOverBillingMode = "no_extra" | "monthly_extra" | "daily_extra";
export type InvoiceDateMode = "issue_date" | "period_end";

export type BillingInvoiceSettings = {
  invoiceTitle: string;
  issuerName: string;
  issuerPostalCode: string;
  issuerAddress: string;
  issuerPhone: string;
  issuerRegistrationNumber: string;
  bankName: string;
  bankBranch: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  paymentDueText: string;
  greetingText: string;
  notes: string;
  footerText: string;
  recipientSuffix: string;
  /** 旧設定との読み取り互換用。新規表示は category 別 label を使う。 */
  invoiceItemLabel: string;
  invoiceItemLabel10: string;
  invoiceItemLabel12: string;
  invoiceItemLabelAluminum: string;
  taxRate: number;
  taxMode: BillingTaxMode;
  roundingMode: BillingRoundingMode;
  showTaxBreakdown: boolean;
  showUnitPrice: boolean;
  showLegacyWarning: boolean;
  showRegistrationNumberWarning: boolean;
  showInvoiceComplianceNotes: boolean;
  unusedReturnBillingMode: ReturnBillingMode;
  unusedReturnDiscountRate: number;
  unchargedReturnBillingMode: ReturnBillingMode;
  unchargedReturnDiscountRate: number;
  carryOverBillingMode: CarryOverBillingMode;
  carryOverMonthlyExtraPrice: number;
  carryOverDailyExtraPrice: number;
  invoiceDateMode: InvoiceDateMode;
};

export const DEFAULT_BILLING_INVOICE_SETTINGS: BillingInvoiceSettings = {
  invoiceTitle: "請求書",
  issuerName: "OKマリン",
  issuerPostalCode: "",
  issuerAddress: "",
  issuerPhone: "",
  issuerRegistrationNumber: "",
  bankName: "",
  bankBranch: "",
  bankAccountType: "普通",
  bankAccountNumber: "",
  bankAccountHolder: "",
  paymentDueText: "お支払い期限：当月末日",
  greetingText: "下記の通りご請求申し上げます。",
  notes: "",
  footerText: "",
  recipientSuffix: "御中",
  invoiceItemLabel: "タンク貸出料（10L換算）",
  invoiceItemLabel10: "タンク貸出料（10L）",
  invoiceItemLabel12: "タンク貸出料（12L）",
  invoiceItemLabelAluminum: "タンク貸出料（アルミ）",
  taxRate: 0.1,
  taxMode: "exclusive",
  roundingMode: "floor",
  showTaxBreakdown: true,
  showUnitPrice: true,
  showLegacyWarning: true,
  showRegistrationNumberWarning: true,
  showInvoiceComplianceNotes: true,
  unusedReturnBillingMode: "charge",
  unusedReturnDiscountRate: 0,
  unchargedReturnBillingMode: "charge",
  unchargedReturnDiscountRate: 0,
  carryOverBillingMode: "no_extra",
  carryOverMonthlyExtraPrice: 0,
  carryOverDailyExtraPrice: 0,
  invoiceDateMode: "issue_date",
};

const TAX_MODES: readonly BillingTaxMode[] = ["exclusive", "inclusive", "none"];
const ROUNDING_MODES: readonly BillingRoundingMode[] = ["floor", "round", "ceil"];
const RETURN_BILLING_MODES: readonly ReturnBillingMode[] = ["charge", "free", "discount"];
const CARRY_OVER_BILLING_MODES: readonly CarryOverBillingMode[] = [
  "no_extra",
  "monthly_extra",
  "daily_extra",
];
const INVOICE_DATE_MODES: readonly InvoiceDateMode[] = ["issue_date", "period_end"];

function trimString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function taxRateValue(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, numeric);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : fallback;
}

export function normalizeBillingInvoiceSettings(
  input: Partial<Record<keyof BillingInvoiceSettings, unknown>> | null | undefined,
): BillingInvoiceSettings {
  const defaults = DEFAULT_BILLING_INVOICE_SETTINGS;
  const source = input ?? {};
  const legacyItemLabel = trimString(source.invoiceItemLabel, defaults.invoiceItemLabel)
    || defaults.invoiceItemLabel;

  return {
    invoiceTitle: trimString(source.invoiceTitle, defaults.invoiceTitle) || defaults.invoiceTitle,
    issuerName: trimString(source.issuerName, defaults.issuerName),
    issuerPostalCode: trimString(source.issuerPostalCode, defaults.issuerPostalCode),
    issuerAddress: trimString(source.issuerAddress, defaults.issuerAddress),
    issuerPhone: trimString(source.issuerPhone, defaults.issuerPhone),
    issuerRegistrationNumber: trimString(
      source.issuerRegistrationNumber,
      defaults.issuerRegistrationNumber,
    ),
    bankName: trimString(source.bankName, defaults.bankName),
    bankBranch: trimString(source.bankBranch, defaults.bankBranch),
    bankAccountType: trimString(source.bankAccountType, defaults.bankAccountType),
    bankAccountNumber: trimString(source.bankAccountNumber, defaults.bankAccountNumber),
    bankAccountHolder: trimString(source.bankAccountHolder, defaults.bankAccountHolder),
    paymentDueText: trimString(source.paymentDueText, defaults.paymentDueText),
    greetingText: trimString(source.greetingText, defaults.greetingText),
    notes: trimString(source.notes, defaults.notes),
    footerText: trimString(source.footerText, defaults.footerText),
    recipientSuffix: trimString(source.recipientSuffix, defaults.recipientSuffix),
    invoiceItemLabel: legacyItemLabel,
    invoiceItemLabel10: trimString(source.invoiceItemLabel10, legacyItemLabel)
      || defaults.invoiceItemLabel10,
    invoiceItemLabel12: trimString(source.invoiceItemLabel12, defaults.invoiceItemLabel12)
      || defaults.invoiceItemLabel12,
    invoiceItemLabelAluminum: trimString(
      source.invoiceItemLabelAluminum,
      defaults.invoiceItemLabelAluminum,
    ) || defaults.invoiceItemLabelAluminum,
    taxRate: taxRateValue(source.taxRate, defaults.taxRate),
    taxMode: enumValue(source.taxMode, TAX_MODES, defaults.taxMode),
    roundingMode: enumValue(source.roundingMode, ROUNDING_MODES, defaults.roundingMode),
    showTaxBreakdown: booleanValue(source.showTaxBreakdown, defaults.showTaxBreakdown),
    showUnitPrice: booleanValue(source.showUnitPrice, defaults.showUnitPrice),
    showLegacyWarning: booleanValue(source.showLegacyWarning, defaults.showLegacyWarning),
    showRegistrationNumberWarning: booleanValue(
      source.showRegistrationNumberWarning,
      defaults.showRegistrationNumberWarning,
    ),
    showInvoiceComplianceNotes: booleanValue(
      source.showInvoiceComplianceNotes,
      defaults.showInvoiceComplianceNotes,
    ),
    unusedReturnBillingMode: enumValue(
      source.unusedReturnBillingMode,
      RETURN_BILLING_MODES,
      defaults.unusedReturnBillingMode,
    ),
    unusedReturnDiscountRate: taxRateValue(
      source.unusedReturnDiscountRate,
      defaults.unusedReturnDiscountRate,
    ),
    unchargedReturnBillingMode: enumValue(
      source.unchargedReturnBillingMode,
      RETURN_BILLING_MODES,
      defaults.unchargedReturnBillingMode,
    ),
    unchargedReturnDiscountRate: taxRateValue(
      source.unchargedReturnDiscountRate,
      defaults.unchargedReturnDiscountRate,
    ),
    carryOverBillingMode: enumValue(
      source.carryOverBillingMode,
      CARRY_OVER_BILLING_MODES,
      defaults.carryOverBillingMode,
    ),
    carryOverMonthlyExtraPrice: nonNegativeNumber(
      source.carryOverMonthlyExtraPrice,
      defaults.carryOverMonthlyExtraPrice,
    ),
    carryOverDailyExtraPrice: nonNegativeNumber(
      source.carryOverDailyExtraPrice,
      defaults.carryOverDailyExtraPrice,
    ),
    invoiceDateMode: enumValue(
      source.invoiceDateMode,
      INVOICE_DATE_MODES,
      defaults.invoiceDateMode,
    ),
  };
}
