"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomerSnapshot } from "@/lib/operation-context";
import { listActiveCustomerSnapshots } from "@/lib/firebase/customers-service";

export function useCustomerOptions() {
  const [customerOptions, setCustomerOptions] = useState<CustomerSnapshot[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const selectedCustomer = useMemo<CustomerSnapshot | null>(() => {
    if (!selectedCustomerId) return null;
    return customerOptions.find((option) => option.customerId === selectedCustomerId) ?? null;
  }, [customerOptions, selectedCustomerId]);

  const customerSelectOptions = useMemo(
    () => customerOptions.map((customer) => ({ value: customer.customerId, label: customer.customerName })),
    [customerOptions]
  );

  const fetchCustomerOptions = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const customers = await listActiveCustomerSnapshots();
      setCustomerOptions(customers);
      const customerIds = customers.map((customer) => customer.customerId);
      // 初期状態は未選択のまま置く（先頭の貸出先を勝手に選ばない）。
      // 選択済みの貸出先が削除された場合だけ未選択へ戻す。
      setSelectedCustomerId((prev) => (prev && customerIds.includes(prev) ? prev : ""));
    } catch (e) {
      console.error(e);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomerOptions();
  }, [fetchCustomerOptions]);

  return {
    customerOptions,
    customerSelectOptions,
    selectedCustomerId,
    selectedCustomer,
    selectedCustomerName: selectedCustomer?.customerName ?? "",
    setSelectedCustomerId,
    loading,
    loadFailed,
    fetchCustomerOptions,
  };
}
