import { collection, doc, getDocs, serverTimestamp, writeBatch, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { assertNotChangedSinceLoad, hasFieldChanges } from "@/lib/firebase/diff-write";
import { transactionsRepository } from "@/lib/firebase/repositories";
import type { OperationActor } from "@/lib/operation-context";
import type { CustomerUserStatus } from "@/lib/firebase/customer-user";

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

export async function listCustomerUsers(): Promise<PortalCustomerUser[]> {
  const snap = await getDocs(collection(db, "customerUsers"));
  const customerUsers: PortalCustomerUser[] = [];
  snap.forEach((u) => {
    const data = u.data() as Partial<PortalCustomerUser>;
    customerUsers.push({
      id: u.id,
      uid: data.uid || u.id,
      email: data.email || "",
      displayName: data.displayName || "",
      selfCompanyName: data.selfCompanyName || "",
      selfName: data.selfName || "",
      lineName: data.lineName || "",
      customerId: data.customerId || "",
      customerName: data.customerName || "",
      status: data.status || "pending_setup",
      setupCompleted: Boolean(data.setupCompleted),
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

  for (const assignment of assignments) {
    const customerId = assignment.customerId || "";
    const customerName = customerId ? (assignment.customerName || "") : "";
    const status = assignment.status === "disabled"
      ? "disabled"
      : customerId
        ? "active"
        : assignment.setupCompleted
          ? "pending"
          : "pending_setup";
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
      status,
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
      batch.update(doc(db, "transactions", item.id), {
        customerId,
        customerName,
        status: "pending_approval",
        linkedAt: serverTimestamp(),
        linkedByStaffId: actor.staffId,
        linkedByStaffName: actor.staffName,
        ...(actor.staffEmail ? { linkedByStaffEmail: actor.staffEmail } : {}),
        updatedAt: serverTimestamp(),
      });
    });
  }

  await batch.commit();
}
