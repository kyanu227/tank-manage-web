export type BillingTaxMode = "exclusive" | "inclusive" | "none";
export type BillingRoundingMode = "floor" | "round" | "ceil";

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
  invoiceItemLabel: string;
  taxRate: number;
  taxMode: BillingTaxMode;
  roundingMode: BillingRoundingMode;
  showTaxBreakdown: boolean;
  showUnitPrice: boolean;
  showLegacyWarning: boolean;
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
  taxRate: 0.1,
  taxMode: "exclusive",
  roundingMode: "floor",
  showTaxBreakdown: true,
  showUnitPrice: true,
  showLegacyWarning: true,
};

const TAX_MODES: readonly BillingTaxMode[] = ["exclusive", "inclusive", "none"];
const ROUNDING_MODES: readonly BillingRoundingMode[] = ["floor", "round", "ceil"];

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
    invoiceItemLabel: trimString(source.invoiceItemLabel, defaults.invoiceItemLabel)
      || defaults.invoiceItemLabel,
    taxRate: taxRateValue(source.taxRate, defaults.taxRate),
    taxMode: enumValue(source.taxMode, TAX_MODES, defaults.taxMode),
    roundingMode: enumValue(source.roundingMode, ROUNDING_MODES, defaults.roundingMode),
    showTaxBreakdown: booleanValue(source.showTaxBreakdown, defaults.showTaxBreakdown),
    showUnitPrice: booleanValue(source.showUnitPrice, defaults.showUnitPrice),
    showLegacyWarning: booleanValue(source.showLegacyWarning, defaults.showLegacyWarning),
  };
}
