import type { OrderItem } from "@/lib/order-types";
import type {
  LinkedPortalIdentity,
  PortalIdentity,
} from "@/lib/portal";
import { transactionsRepository } from "@/lib/firebase/repositories";

export type PortalDeliveryType = "pickup" | "delivery";
export type PortalReturnCondition = "normal" | "unused" | "uncharged" | "keep";
export type PortalReturnSource = "customer_portal" | "auto_schedule";
export type PortalUnfilledSource = "customer_app" | "customer_portal";

export type CreatePortalOrderInput = {
  identity: PortalIdentity;
  items: OrderItem[];
  deliveryType: PortalDeliveryType;
  deliveryTargetName: string;
  note: string;
};

export type CreatePortalReturnRequestsInput = {
  identity: LinkedPortalIdentity;
  items: Array<{
    tankId: string;
    condition: PortalReturnCondition;
  }>;
  source: PortalReturnSource;
};

export type CreatePortalUnfilledReportsInput = {
  identity: LinkedPortalIdentity;
  tankIds: string[];
  source?: PortalUnfilledSource;
};

export async function createPortalOrder(
  input: CreatePortalOrderInput,
): Promise<string> {
  const items = normalizeOrderItems(input.items);
  if (items.length === 0) {
    throw new Error("Portal order requires at least one item.");
  }

  const note = input.note.trim();
  const deliveryTargetName = input.deliveryType === "delivery"
    ? input.deliveryTargetName.trim()
    : "";
  const requestedSnapshot = buildRequestedSnapshot(input.identity);

  return transactionsRepository.createTransaction({
    type: "order",
    status: input.identity.kind === "linked" ? "pending" : "pending_link",
    customerId: input.identity.kind === "linked" ? input.identity.customerId : null,
    customerName: input.identity.kind === "linked" ? input.identity.customerName : "",
    createdByUid: input.identity.customerUserUid,
    ...requestedSnapshot,
    items,
    deliveryType: input.deliveryType,
    deliveryTargetName,
    note,
    orderNote: note,
    deliveryNote: note,
    source: "customer_portal",
  });
}

export async function createPortalReturnRequests(
  input: CreatePortalReturnRequestsInput,
): Promise<string[]> {
  const items = input.items
    .map((item) => ({
      tankId: item.tankId.trim(),
      condition: item.condition,
    }))
    .filter((item) => item.tankId);

  if (items.length === 0) {
    throw new Error("Portal return requires at least one tank.");
  }

  return Promise.all(
    items.map((item) =>
      transactionsRepository.createTransaction({
        type: "return",
        status: "pending_return",
        tankId: item.tankId,
        condition: item.condition,
        customerId: input.identity.customerId,
        customerName: input.identity.customerName,
        createdByUid: input.identity.customerUserUid,
        source: input.source,
      }),
    ),
  );
}

export async function createPortalUnfilledReports(
  input: CreatePortalUnfilledReportsInput,
): Promise<string[]> {
  const tankIds = input.tankIds.map((tankId) => tankId.trim()).filter(Boolean);
  if (tankIds.length === 0) {
    throw new Error("Portal unfilled report requires at least one tank.");
  }

  return Promise.all(
    tankIds.map((tankId) =>
      transactionsRepository.createTransaction({
        type: "uncharged_report",
        status: "completed",
        tankId,
        customerId: input.identity.customerId,
        customerName: input.identity.customerName,
        createdByUid: input.identity.customerUserUid,
        source: input.source ?? "customer_app",
      }),
    ),
  );
}

function buildRequestedSnapshot(identity: PortalIdentity): {
  requestedCompanyName: string;
  requestedByName: string;
  requestedLineName: string;
} {
  if (identity.kind === "unlinked") {
    return {
      requestedCompanyName: identity.requestedCompanyName,
      requestedByName: identity.requestedByName,
      requestedLineName: identity.requestedLineName ?? "",
    };
  }

  return {
    requestedCompanyName: identity.selfCompanyName ?? "",
    requestedByName: identity.selfName ?? "",
    requestedLineName: identity.lineName ?? "",
  };
}

function normalizeOrderItems(items: OrderItem[]): OrderItem[] {
  return items
    .map((item) => ({
      tankType: item.tankType.trim(),
      quantity: Number(item.quantity) || 0,
    }))
    .filter((item) => item.tankType && item.quantity > 0);
}
