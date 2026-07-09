"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  buildInvoiceCandidates,
  type InvoiceCandidate,
} from "@/lib/billing/invoice-candidate";
import {
  DEFAULT_BILLING_INVOICE_SETTINGS,
  normalizeBillingInvoiceSettings,
  type BillingInvoiceSettings,
} from "@/lib/billing/settings";
import { getBillingCustomerMasters } from "@/lib/firebase/billing-customers-service";
import { getBillingInvoiceSettings } from "@/lib/firebase/billing-settings-service";
import { logsRepository } from "@/lib/firebase/repositories";

export interface BillingInvoiceCandidatesState {
  bills: InvoiceCandidate[];
  selectedBillKey: string | null;
  setSelectedBillKey: Dispatch<SetStateAction<string | null>>;
  settings: BillingInvoiceSettings;
  setSettings: Dispatch<SetStateAction<BillingInvoiceSettings>>;
  settingsDraft: BillingInvoiceSettings;
  setSettingsDraft: Dispatch<SetStateAction<BillingInvoiceSettings>>;
  loading: boolean;
}

export function useBillingInvoiceCandidates(period: string): BillingInvoiceCandidatesState {
  const [bills, setBills] = useState<InvoiceCandidate[]>([]);
  const [selectedBillKey, setSelectedBillKey] = useState<string | null>(null);
  const [settings, setSettings] = useState<BillingInvoiceSettings>(DEFAULT_BILLING_INVOICE_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<BillingInvoiceSettings>(DEFAULT_BILLING_INVOICE_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      try {
        const [logs, customers, invoiceSettings] = await Promise.all([
          logsRepository.getActiveLogs(),
          getBillingCustomerMasters(),
          getBillingInvoiceSettings().catch((error) => {
            console.error("Fetch billing invoice settings error:", error);
            return DEFAULT_BILLING_INVOICE_SETTINGS;
          }),
        ]);
        if (!active) return;

        const normalizedSettings = normalizeBillingInvoiceSettings(invoiceSettings);
        setSettings(normalizedSettings);
        setSettingsDraft(normalizedSettings);

        const items = buildInvoiceCandidates({
          logs,
          customers,
          period,
          settings: normalizedSettings,
        });
        setBills(items);
        setSelectedBillKey((current) => {
          if (current && items.some((item) => item.key === current)) return current;
          return items[0]?.key ?? null;
        });
      } catch (error) {
        console.error(error);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [period]);

  return {
    bills,
    selectedBillKey,
    setSelectedBillKey,
    settings,
    setSettings,
    settingsDraft,
    setSettingsDraft,
    loading,
  };
}
