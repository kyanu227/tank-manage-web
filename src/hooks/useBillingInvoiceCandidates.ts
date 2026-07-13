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
import { useTankDataRevisionState } from "@/hooks/useTankDataRevision";

export interface BillingInvoiceCandidatesState {
  bills: InvoiceCandidate[];
  selectedBillKey: string | null;
  setSelectedBillKey: Dispatch<SetStateAction<string | null>>;
  settings: BillingInvoiceSettings;
  setSettings: Dispatch<SetStateAction<BillingInvoiceSettings>>;
  settingsDraft: BillingInvoiceSettings;
  setSettingsDraft: Dispatch<SetStateAction<BillingInvoiceSettings>>;
  loading: boolean;
  revisionReady: boolean;
  revisionError: Error | null;
  candidatesFresh: boolean;
  candidateLoadError: Error | null;
  printReady: boolean;
}

export function useBillingInvoiceCandidates(period: string): BillingInvoiceCandidatesState {
  const revisionState = useTankDataRevisionState();
  const [bills, setBills] = useState<InvoiceCandidate[]>([]);
  const [selectedBillKey, setSelectedBillKey] = useState<string | null>(null);
  const [settings, setSettings] = useState<BillingInvoiceSettings>(DEFAULT_BILLING_INVOICE_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<BillingInvoiceSettings>(DEFAULT_BILLING_INVOICE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [candidateLoadError, setCandidateLoadError] = useState<Error | null>(null);
  const [loadedSnapshot, setLoadedSnapshot] = useState<{
    period: string;
    revision: number;
  } | null>(null);

  useEffect(() => {
    if (!revisionState.ready) {
      setBills([]);
      setSelectedBillKey(null);
      setLoadedSnapshot(null);
      setLoading(false);
      return;
    }

    let active = true;
    const requestedRevision = revisionState.revision;

    (async () => {
      setBills([]);
      setSelectedBillKey(null);
      setLoadedSnapshot(null);
      setLoading(true);
      setCandidateLoadError(null);
      try {
        const [logs, customers, invoiceSettings] = await Promise.all([
          logsRepository.getActiveLogs(),
          getBillingCustomerMasters(),
          // document不存在はserviceがdefault化する。read errorは印刷可能にせずthrowする。
          getBillingInvoiceSettings(),
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
        setLoadedSnapshot({ period, revision: requestedRevision });
        setSelectedBillKey((current) => {
          if (current && items.some((item) => item.key === current)) return current;
          return items[0]?.key ?? null;
        });
      } catch (error) {
        console.error(error);
        if (active) {
          setCandidateLoadError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [period, revisionState.ready, revisionState.revision]);

  const candidatesFresh = revisionState.ready
    && loadedSnapshot?.period === period
    && loadedSnapshot.revision === revisionState.revision;
  const printReady = candidatesFresh
    && !loading
    && candidateLoadError === null
    && revisionState.error === null;

  return {
    bills,
    selectedBillKey,
    setSelectedBillKey,
    settings,
    setSettings,
    settingsDraft,
    setSettingsDraft,
    loading,
    revisionReady: revisionState.ready,
    revisionError: revisionState.error,
    candidatesFresh,
    candidateLoadError,
    printReady,
  };
}
