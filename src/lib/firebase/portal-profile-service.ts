import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export type CompleteCustomerUserSetupInput = {
  uid: string;
  selfCompanyName: string;
  selfName: string;
  lineName?: string;
};

export type CompleteCustomerUserSetupResult = {
  selfCompanyName: string;
  selfName: string;
  lineName: string;
  setupCompleted: true;
};

export async function completeCustomerUserSetup(
  input: CompleteCustomerUserSetupInput,
): Promise<CompleteCustomerUserSetupResult> {
  const uid = input.uid.trim();
  const selfCompanyName = input.selfCompanyName.trim();
  const selfName = input.selfName.trim();
  const lineName = input.lineName?.trim() ?? "";

  if (!uid) {
    throw new Error("Customer user uid is required.");
  }
  if (!selfCompanyName || !selfName) {
    throw new Error("Company name and self name are required.");
  }

  const profile: CompleteCustomerUserSetupResult = {
    selfCompanyName,
    selfName,
    lineName,
    setupCompleted: true,
  };

  await updateDoc(doc(db, "customerUsers", uid), {
    ...profile,
    updatedAt: serverTimestamp(),
  });

  return profile;
}
