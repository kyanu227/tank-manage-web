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
