"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomerSnapshot } from "@/lib/operation-context";
import { listActiveCustomerSnapshots } from "@/lib/firebase/customers-service";

export function useDestinations() {
  const [customerOptions, setCustomerOptions] = useState<CustomerSnapshot[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const selectedCustomer = useMemo<CustomerSnapshot | null>(() => {
    if (!selectedCustomerId) return null;
    return customerOptions.find((option) => option.customerId === selectedCustomerId) ?? null;
  }, [customerOptions, selectedCustomerId]);

  const customerSelectOptions = useMemo(
    () => customerOptions.map((customer) => ({ value: customer.customerId, label: customer.customerName })),
    [customerOptions]
  );

  const fetchDestinations = useCallback(async () => {
    setLoading(true);
    try {
      const customers = await listActiveCustomerSnapshots();
      setCustomerOptions(customers);
      const customerIds = customers.map((customer) => customer.customerId);
      // 現在の選択先が削除された／まだ未選択な場合のみ先頭にリセット。
      // 既に有効な選択先が入っていればユーザーの選択を維持する。
      setSelectedCustomerId((prev) => {
        if (prev && customerIds.includes(prev)) return prev;
        return customerIds[0] ?? "";
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDestinations();
  }, [fetchDestinations]);

  return {
    customerOptions,
    customerSelectOptions,
    selectedCustomerId,
    selectedCustomer,
    selectedCustomerName: selectedCustomer?.customerName ?? "",
    setSelectedCustomerId,
    loading,
    fetchDestinations,
  };
}
