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

export type CustomerIdentityDisplayLabelKind =
  | "unknown_customer"
  | "legacy_unknown_customer";

export class CustomerIdentityDisplayLabelRequiredError extends Error {
  readonly code = "customer_identity_display_label_required";
  readonly labelKind: CustomerIdentityDisplayLabelKind;

  constructor(labelKind: CustomerIdentityDisplayLabelKind) {
    super();
    this.name = "CustomerIdentityDisplayLabelRequiredError";
    this.labelKind = labelKind;
  }
}

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
      ?? requireDisplayLabel(
        options?.unknownCustomerLabel,
        "unknown_customer",
      );

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
  const displayName =
    legacyName
    ?? requireDisplayLabel(
      options?.legacyUnknownLabel,
      "legacy_unknown_customer",
    );

  return {
    key: `legacy-location:${legacyName ?? UNKNOWN_CUSTOMER_KEY}`,
    displayName,
    isLegacy: true,
  };
}

function requireDisplayLabel(
  label: string | undefined,
  labelKind: CustomerIdentityDisplayLabelKind,
): string {
  if (label !== undefined) return label;
  throw new CustomerIdentityDisplayLabelRequiredError(labelKind);
}
