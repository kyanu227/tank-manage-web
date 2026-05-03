import type {
  CustomerPortalSession,
  CustomerUserStatus,
} from "@/lib/firebase/customer-user";

const CUSTOMER_USER_STATUSES = new Set<CustomerUserStatus>([
  "pending_setup",
  "pending",
  "active",
  "disabled",
]);

export type LinkedPortalIdentity = {
  kind: "linked";
  customerUserUid: string;
  customerId: string;
  customerName: string;
  selfCompanyName?: string;
  selfName?: string;
  lineName?: string;
  status?: CustomerUserStatus;
};

export type UnlinkedPortalIdentity = {
  kind: "unlinked";
  customerUserUid: string;
  customerId: null;
  customerName: "";
  requestedCompanyName: string;
  requestedByName: string;
  requestedLineName?: string;
  selfCompanyName?: string;
  selfName?: string;
  lineName?: string;
  status?: CustomerUserStatus;
};

export type PortalIdentity = LinkedPortalIdentity | UnlinkedPortalIdentity;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringOrEmpty(value: unknown): string {
  return optionalString(value) ?? "";
}

function normalizeOptionalText(value: unknown): string | undefined {
  const text = optionalString(value)?.trim();
  return text ? text : undefined;
}

function normalizeStatus(value: unknown): CustomerUserStatus | undefined {
  return typeof value === "string" && CUSTOMER_USER_STATUSES.has(value as CustomerUserStatus)
    ? value as CustomerUserStatus
    : undefined;
}

export function parseCustomerPortalSession(raw: string | null): CustomerPortalSession | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const uid = stringOrEmpty(parsed.uid).trim();
    const customerUserUid = normalizeOptionalText(parsed.customerUserUid);
    const customerId = normalizeOptionalText(parsed.customerId) ?? null;
    const customerName = stringOrEmpty(parsed.customerName);
    const name = stringOrEmpty(parsed.name);

    if (!uid && !customerUserUid) return null;

    return {
      uid,
      customerUserUid,
      customerId,
      customerName,
      name,
      selfCompanyName: optionalString(parsed.selfCompanyName),
      selfName: optionalString(parsed.selfName),
      lineName: optionalString(parsed.lineName),
      status: normalizeStatus(parsed.status),
    };
  } catch {
    return null;
  }
}

export function buildPortalIdentityFromSession(
  session: CustomerPortalSession,
): PortalIdentity | null {
  const customerUserUid = (session.customerUserUid || session.uid || "").trim();
  if (!customerUserUid) return null;

  const customerId = (session.customerId || "").trim();
  const customerName = (session.customerName || "").trim();
  const selfCompanyName = session.selfCompanyName?.trim();
  const selfName = session.selfName?.trim();
  const lineName = session.lineName?.trim();

  if (customerId && customerName) {
    return {
      kind: "linked",
      customerUserUid,
      customerId,
      customerName,
      ...(selfCompanyName ? { selfCompanyName } : {}),
      ...(selfName ? { selfName } : {}),
      ...(lineName ? { lineName } : {}),
      ...(session.status ? { status: session.status } : {}),
    };
  }

  return {
    kind: "unlinked",
    customerUserUid,
    customerId: null,
    customerName: "",
    requestedCompanyName: selfCompanyName || session.name?.trim() || "未確認",
    requestedByName: selfName || "",
    requestedLineName: lineName || "",
    ...(selfCompanyName ? { selfCompanyName } : {}),
    ...(selfName ? { selfName } : {}),
    ...(lineName ? { lineName } : {}),
    ...(session.status ? { status: session.status } : {}),
  };
}

export function getPortalIdentityFromStorage(): PortalIdentity | null {
  if (typeof window === "undefined") return null;

  try {
    const session = parseCustomerPortalSession(localStorage.getItem("customerSession"));
    return session ? buildPortalIdentityFromSession(session) : null;
  } catch {
    return null;
  }
}

export function isLinkedPortalIdentity(
  identity: PortalIdentity | null,
): identity is LinkedPortalIdentity {
  return identity?.kind === "linked";
}

export function isUnlinkedPortalIdentity(
  identity: PortalIdentity | null,
): identity is UnlinkedPortalIdentity {
  return identity?.kind === "unlinked";
}

export function requireLinkedPortalIdentity(
  identity: PortalIdentity | null,
): LinkedPortalIdentity {
  if (isLinkedPortalIdentity(identity)) return identity;
  throw new Error("Customer portal identity is not linked to a customer.");
}
