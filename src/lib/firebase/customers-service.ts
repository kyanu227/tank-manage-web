import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import type { CustomerSnapshot } from "@/lib/operation-context";
import { db } from "@/lib/firebase/config";

export interface CustomerWriteInput {
  name: string;
  companyName: string;
  formalName: string;
  price10: number;
  price12: number;
  priceAluminum: number;
  isActive: boolean;
}

export interface CustomerManagementRow {
  id: string;
  name: string;
  email?: string;
  companyName: string;
  formalName: string;
  price10: number;
  price12: number;
  priceAluminum: number;
  isActive: boolean;
  createdAt?: unknown;
}

export async function createCustomer(input: CustomerWriteInput): Promise<string> {
  const ref = await addDoc(collection(db, "customers"), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateCustomer(
  customerId: string,
  input: CustomerWriteInput,
): Promise<void> {
  await updateDoc(doc(db, "customers", customerId), {
    ...input,
    updatedAt: serverTimestamp(),
  });
}

export async function listCustomersForManagement(): Promise<CustomerManagementRow[]> {
  const customers = await listCustomerManagementRows();
  return customers.sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));
}

export async function listCustomersForPortalUserLinking(): Promise<CustomerManagementRow[]> {
  return listCustomerManagementRows();
}

async function listCustomerManagementRows(): Promise<CustomerManagementRow[]> {
  const snap = await getDocs(collection(db, "customers"));
  const customers: CustomerManagementRow[] = [];

  snap.forEach((docSnap) => {
    customers.push(normalizeCustomerManagementRow(docSnap.id, docSnap.data()));
  });

  return customers;
}

export async function listActiveCustomerSnapshots(): Promise<CustomerSnapshot[]> {
  const snap = await getDocs(collection(db, "customers"));
  const customers: CustomerSnapshot[] = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.isActive === false) return;
    const customerName = String(data.name || data.companyName || "").trim();
    if (customerName) {
      customers.push({ customerId: docSnap.id, customerName });
    }
  });

  customers.sort((a, b) => a.customerName.localeCompare(b.customerName));
  return customers;
}

function normalizeCustomerManagementRow(
  id: string,
  data: Record<string, unknown>,
): CustomerManagementRow {
  const name = toText(data.name).trim() || toText(data.companyName).trim();
  const companyName = toText(data.companyName).trim() || name;
  const email = toText(data.email).trim();

  return {
    id,
    name,
    ...(email ? { email } : {}),
    companyName,
    formalName: toText(data.formalName).trim(),
    price10: toNumber(data.price10),
    price12: toNumber(data.price12),
    priceAluminum: toNumber(data.priceAluminum),
    isActive: data.isActive !== false,
    createdAt: data.createdAt,
  };
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function createdAtMillis(value: unknown): number {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : 0;
  }

  if (value && typeof value === "object" && "toMillis" in value) {
    const timestamp = value as { toMillis?: unknown };
    if (typeof timestamp.toMillis === "function") {
      try {
        const millis = timestamp.toMillis();
        return Number.isFinite(millis) ? millis : 0;
      } catch {
        return 0;
      }
    }
  }

  return 0;
}
