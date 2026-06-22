import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  normalizeBillingInvoiceSettings,
  type BillingInvoiceSettings,
} from "@/lib/billing/settings";

const BILLING_INVOICE_SETTINGS_REF = doc(db, "settings", "billingInvoice");

export async function getBillingInvoiceSettings(): Promise<BillingInvoiceSettings> {
  const snap = await getDoc(BILLING_INVOICE_SETTINGS_REF);
  if (!snap.exists()) return normalizeBillingInvoiceSettings(null);
  return normalizeBillingInvoiceSettings(snap.data());
}

export async function saveBillingInvoiceSettings(
  settings: BillingInvoiceSettings,
): Promise<void> {
  const normalized = normalizeBillingInvoiceSettings(settings);
  if (!normalized.invoiceTitle) {
    throw new Error("請求書タイトルは必須です。");
  }

  await setDoc(
    BILLING_INVOICE_SETTINGS_REF,
    {
      ...normalized,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
