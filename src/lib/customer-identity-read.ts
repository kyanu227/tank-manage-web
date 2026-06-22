export type CustomerIdentityGroup = {
  key: string;
  customerId?: string;
  displayName: string;
  isLegacy: boolean;
};

type CustomerIdentitySource = {
  customerId?: unknown;
  customerName?: unknown;
  location?: unknown;
};

type CustomerIdentityGroupOptions = {
  currentCustomerName?: unknown;
  unknownCustomerLabel?: string;
  legacyUnknownLabel?: string;
};

const UNKNOWN_CUSTOMER_KEY = "__unknown__";

export function normalizeCustomerIdentityText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

export function buildCustomerIdentityGroup(
  source: CustomerIdentitySource,
  options?: CustomerIdentityGroupOptions,
): CustomerIdentityGroup {
  const customerId = normalizeCustomerIdentityText(source.customerId);

  if (customerId) {
    const displayName =
      normalizeCustomerIdentityText(options?.currentCustomerName)
      ?? normalizeCustomerIdentityText(source.customerName)
      ?? normalizeCustomerIdentityText(source.location)
      ?? options?.unknownCustomerLabel
      ?? "不明な顧客";

    return {
      key: `customer:${customerId}`,
      customerId,
      displayName,
      isLegacy: false,
    };
  }

  const legacyName =
    normalizeCustomerIdentityText(source.customerName)
    ?? normalizeCustomerIdentityText(source.location);
  const displayName = legacyName ?? options?.legacyUnknownLabel ?? "不明";

  return {
    key: `legacy-location:${legacyName ?? UNKNOWN_CUSTOMER_KEY}`,
    displayName,
    isLegacy: true,
  };
}
