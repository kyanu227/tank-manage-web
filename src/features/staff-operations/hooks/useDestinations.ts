"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { CustomerSnapshot } from "@/lib/operation-context";

interface CustomerOption {
  id: string;
  name: string;
  isActive: boolean;
}

export function useDestinations() {
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const selectedCustomer = useMemo<CustomerSnapshot | null>(() => {
    if (!selectedCustomerId) return null;
    const customer = customerOptions.find((option) => option.id === selectedCustomerId);
    return customer ? { customerId: customer.id, customerName: customer.name } : null;
  }, [customerOptions, selectedCustomerId]);

  const customerSelectOptions = useMemo(
    () => customerOptions.map((customer) => ({ value: customer.id, label: customer.name })),
    [customerOptions]
  );

  const fetchDestinations = useCallback(async () => {
    setLoading(true);
    try {
      const custSnap = await getDocs(collection(db, "customers"));
      const customers: CustomerOption[] = [];
      custSnap.forEach((d) => {
        const data = d.data();
        const name = String(data.name || "").trim();
        if (data.isActive !== false && name) {
          customers.push({ id: d.id, name, isActive: true });
        }
      });
      setCustomerOptions(customers);
      const customerIds = customers.map((customer) => customer.id);
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
