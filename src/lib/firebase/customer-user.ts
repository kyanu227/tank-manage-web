import type { User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./config";

export type CustomerUserStatus = "pending_setup" | "pending" | "active" | "disabled";

export interface CustomerUserDoc {
  uid: string;
  email: string;
  displayName: string;
  selfCompanyName: string;
  selfName: string;
  lineName?: string;
  customerId?: string | null;
  customerName?: string;
  setupCompleted: boolean;
  disabled: boolean;
  status: CustomerUserStatus;
}

export interface CustomerPortalSession {
  uid: string;
  customerUserUid?: string;
  customerId?: string | null;
  customerName?: string;
  name: string;
  selfCompanyName?: string;
  selfName?: string;
  lineName?: string;
  status?: CustomerUserStatus;
}

export function computeCustomerUserStatus(input: {
  disabled?: boolean;
  setupCompleted?: boolean;
  customerId?: string | null;
}): CustomerUserStatus {
  if (input.disabled === true) return "disabled";
  if (input.setupCompleted !== true) return "pending_setup";
  return input.customerId ? "active" : "pending";
}

export async function ensureCustomerUser(user: User): Promise<CustomerUserDoc> {
  const ref = doc(db, "customerUsers", user.uid);
  const snap = await getDoc(ref);
  const email = user.email ?? "";
  const displayName = user.displayName ?? "";

  if (!snap.exists()) {
    const created: CustomerUserDoc = {
      uid: user.uid,
      email,
      displayName,
      selfCompanyName: "",
      selfName: displayName,
      customerId: null,
      customerName: "",
      setupCompleted: false,
      disabled: false,
      status: "pending_setup",
    };
    await setDoc(ref, {
      uid: created.uid,
      email: created.email,
      displayName: created.displayName,
      selfCompanyName: created.selfCompanyName,
      selfName: created.selfName,
      customerId: null,
      customerName: "",
      setupCompleted: false,
      disabled: false,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return created;
  }

  const current = snap.data() as Partial<CustomerUserDoc>;
  await setDoc(ref, {
    email,
    displayName,
    lastLoginAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return normalizeCustomerUser({
    ...current,
    uid: user.uid,
    email,
    displayName,
  });
}

export function normalizeCustomerUser(data: Partial<CustomerUserDoc>): CustomerUserDoc {
  const setupCompleted = data.setupCompleted === true;
  const disabled = data.disabled === true;
  const customerId = data.customerId || null;
  const status = computeCustomerUserStatus({ disabled, setupCompleted, customerId });

  return {
    uid: data.uid ?? "",
    email: data.email ?? "",
    displayName: data.displayName ?? "",
    selfCompanyName: data.selfCompanyName ?? "",
    selfName: data.selfName ?? "",
    lineName: data.lineName ?? "",
    customerId,
    customerName: data.customerName ?? "",
    setupCompleted,
    disabled,
    status,
  };
}

export function needsCustomerUserSetup(user: CustomerUserDoc): boolean {
  return !user.setupCompleted || !user.selfCompanyName.trim() || !user.selfName.trim();
}

export function buildCustomerPortalSession(user: CustomerUserDoc): CustomerPortalSession {
  const name = user.customerName || user.selfCompanyName || "お客様";
  return {
    uid: user.customerId || user.uid,
    customerUserUid: user.uid,
    customerId: user.customerId || null,
    customerName: user.customerName || "",
    name,
    selfCompanyName: user.selfCompanyName,
    selfName: user.selfName,
    lineName: user.lineName || "",
    status: user.status,
  };
}

export function saveCustomerPortalSession(user: CustomerUserDoc): CustomerPortalSession {
  const session = buildCustomerPortalSession(user);
  if (typeof window !== "undefined") {
    localStorage.setItem("customerSession", JSON.stringify(session));
  }
  return session;
}
