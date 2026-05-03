import { collection, doc, getDocs, serverTimestamp, writeBatch, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { assertNotChangedSinceLoad, hasFieldChanges } from "@/lib/firebase/diff-write";
import { transactionsRepository } from "@/lib/firebase/repositories";
import type { OperationActor } from "@/lib/operation-context";
import {
  computeCustomerUserStatus,
  type CustomerUserStatus,
} from "@/lib/firebase/customer-user";

export interface PortalCustomerUser {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  selfCompanyName: string;
  selfName: string;
  lineName?: string;
  customerId?: string | null;
  customerName?: string;
  status: CustomerUserStatus;
  setupCompleted: boolean;
  updatedAt?: unknown;
}

export interface CustomerUserAssignment {
  id: string;
  uid: string;
  email?: string;
  customerId?: string | null;
  customerName?: string;
  status: CustomerUserStatus;
  setupCompleted: boolean;
  updatedAt?: unknown;
}

interface CustomerLinkSnapshot {
  id: string;
  name?: string;
  companyName?: string;
  email?: string;
}

export async function listCustomerUsers(): Promise<PortalCustomerUser[]> {
  const snap = await getDocs(collection(db, "customerUsers"));
  const customerUsers: PortalCustomerUser[] = [];
  snap.forEach((u) => {
    const data = u.data() as Partial<PortalCustomerUser> & { disabled?: boolean };
    const customerId = data.customerId || "";
    const setupCompleted = Boolean(data.setupCompleted);
    customerUsers.push({
      id: u.id,
      uid: data.uid || u.id,
      email: data.email || "",
      displayName: data.displayName || "",
      selfCompanyName: data.selfCompanyName || "",
      selfName: data.selfName || "",
      lineName: data.lineName || "",
      customerId,
      customerName: data.customerName || "",
      status: computeCustomerUserStatus({
        disabled: data.disabled === true,
        setupCompleted,
        customerId,
      }),
      setupCompleted,
      updatedAt: data.updatedAt,
    });
  });
  return customerUsers;
}

export async function linkCustomerUsersToCustomers({
  assignments,
  actor,
}: {
  assignments: CustomerUserAssignment[];
  actor: OperationActor;
}): Promise<void> {
  const batch = writeBatch(db);
  const customerUserSnap = await getDocs(collection(db, "customerUsers"));
  const currentCustomerUsers = new Map(customerUserSnap.docs.map((d) => [d.id, d.data()]));
  const customerSnap = await getDocs(collection(db, "customers"));
  const currentCustomers = new Map<string, CustomerLinkSnapshot>();
  customerSnap.forEach((customerDoc) => {
    const data = customerDoc.data() as Partial<CustomerLinkSnapshot>;
    currentCustomers.set(customerDoc.id, {
      id: customerDoc.id,
      name: data.name || "",
      companyName: data.companyName || "",
      email: data.email || "",
    });
  });

  for (const assignment of assignments) {
    const customerId = assignment.customerId || "";
    const linkedCustomer = customerId ? currentCustomers.get(customerId) : undefined;
    if (customerId && !linkedCustomer) {
      throw new Error(`紐付け先の顧客「${customerId}」は他の操作で削除されています。再読込してください。`);
    }
    const customerName = customerId
      ? buildCustomerLocationName(linkedCustomer, assignment.customerName || customerId)
      : "";
    const current = currentCustomerUsers.get(assignment.id);
    if (!current) {
      throw new Error(`ポータル利用者「${assignment.email || assignment.id}」は他の操作で削除されています。再読込してください。`);
    }
    assertNotChangedSinceLoad(
      assignment as unknown as DocumentData,
      current,
      `ポータル利用者「${assignment.email || assignment.id}」`
    );

    const payload = {
      customerId: customerId || null,
      customerName,
    };

    if (hasFieldChanges(current, payload)) {
      batch.set(doc(db, "customerUsers", assignment.id), {
        ...payload,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    const previousCustomerId = current.customerId || "";
    if (!customerId || previousCustomerId === customerId) continue;

    const pendingItems = await transactionsRepository.findPendingLinksByUid(assignment.uid);
    pendingItems.forEach((item) => {
      if (item.type !== "order") return;
      if (item.customerId && item.customerId !== customerId) return;

      transactionsRepository.updateTransactionInBatch(batch, item.id, {
        customerId,
        customerName,
        status: "pending",
        linkedAt: serverTimestamp(),
        linkedByStaffId: actor.staffId,
        linkedByStaffName: actor.staffName,
        ...(actor.staffEmail ? { linkedByStaffEmail: actor.staffEmail } : {}),
      });
    });
  }

  await batch.commit();
}

function buildCustomerLocationName(
  customer: CustomerLinkSnapshot | undefined,
  fallback: string,
): string {
  const name = customer?.name?.trim();
  if (name) return name;

  const companyName = customer?.companyName?.trim();
  if (companyName) return companyName;

  return fallback.trim();
}
