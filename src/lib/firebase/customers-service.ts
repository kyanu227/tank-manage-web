import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
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
