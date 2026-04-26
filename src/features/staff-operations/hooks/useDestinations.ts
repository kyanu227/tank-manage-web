"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

interface CustomerOption {
  id: string;
  name: string;
  isActive: boolean;
}

export function useDestinations() {
  const [destinations, setDestinations] = useState<string[]>([]);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedDest, setSelectedDest] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const selectedCustomerId = useMemo(() => {
    if (!selectedDest) return null;
    return customerOptions.find((customer) => customer.name === selectedDest)?.id ?? null;
  }, [customerOptions, selectedDest]);

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
      const dests = customers.map((customer) => customer.name);
      setCustomerOptions(customers);
      setDestinations(dests);
      // 現在の選択先が削除された／まだ未選択な場合のみ先頭にリセット。
      // 既に有効な選択先が入っていればユーザーの選択を維持する。
      setSelectedDest((prev) => {
        if (prev && dests.includes(prev)) return prev;
        return dests[0] ?? "";
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
    destinations,
    customerOptions,
    selectedDest,
    selectedCustomerId,
    setSelectedDest,
    loading,
    fetchDestinations,
  };
}
