import { collection, getDocs } from "firebase/firestore";
import type { BillingCustomerMaster } from "@/lib/billing/invoice-candidate";
import { normalizeCustomerIdentityText } from "@/lib/customer-identity-read";
import { db } from "@/lib/firebase/config";

export async function getBillingCustomerMasters(): Promise<BillingCustomerMaster[]> {
  const snap = await getDocs(collection(db, "customers"));
  const customers: BillingCustomerMaster[] = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const customerName =
      normalizeCustomerIdentityText(data.name)
      ?? normalizeCustomerIdentityText(data.companyName)
      ?? docSnap.id;
    const formalName = normalizeCustomerIdentityText(data.formalName) ?? "";

    customers.push({
      customerId: docSnap.id,
      customerName,
      formalName,
      price10: Number(data.price10) || 0,
      price12: Number(data.price12) || 0,
      priceAluminum: Number(data.priceAluminum) || 0,
    });
  });

  return customers;
}
