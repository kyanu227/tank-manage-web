"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { transactionsRepository } from "@/lib/firebase/repositories";
import type { OrderStatus } from "@/lib/order-types";

const PENDING_STATUSES: OrderStatus[] = ["pending", "pending_approval"];

export function usePendingOrderCount(): number | null {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const lists = await Promise.all(
          PENDING_STATUSES.map((status) => transactionsRepository.getOrders({ status }))
        );
        if (!cancelled) setCount(lists.flat().length);
      } catch (e) {
        console.warn("usePendingOrderCount fetch failed:", e);
        if (!cancelled) setCount(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return count;
}
