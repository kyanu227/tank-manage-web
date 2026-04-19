"use client";

import { useCallback, useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export function useDestinations() {
  const [destinations, setDestinations] = useState<string[]>([]);
  const [selectedDest, setSelectedDest] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchDestinations = useCallback(async () => {
    setLoading(true);
    try {
      const custSnap = await getDocs(collection(db, "customers"));
      const dests: string[] = [];
      custSnap.forEach((d) => {
        const data = d.data();
        if (data.isActive !== false) dests.push(data.name);
      });
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
    selectedDest,
    setSelectedDest,
    loading,
    fetchDestinations,
  };
}
