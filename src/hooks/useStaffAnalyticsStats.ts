"use client";

import { useEffect, useState } from "react";
import {
  buildStaffOperationStats,
  type StaffOperationStat,
} from "@/lib/analytics/operation-stats";
import { logsRepository } from "@/lib/firebase/repositories";

export interface StaffAnalyticsStatsViewModel {
  stats: StaffOperationStat[];
  loading: boolean;
}

export function useStaffAnalyticsStats(): StaffAnalyticsStatsViewModel {
  const [stats, setStats] = useState<StaffOperationStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const logs = await logsRepository.getActiveLogs();
        if (!active) return;
        setStats(buildStaffOperationStats(logs));
      } catch (error) {
        console.error(error);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return { stats, loading };
}
