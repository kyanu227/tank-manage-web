"use client";

import { useEffect, useState } from "react";
import {
  buildStaffOperationStats,
  type StaffOperationStat,
} from "@/lib/analytics/operation-stats";
import { logsRepository } from "@/lib/firebase/repositories";
import { useTankDataRevision } from "@/hooks/useTankDataRevision";

export interface StaffAnalyticsStatsViewModel {
  stats: StaffOperationStat[];
  loading: boolean;
}

export function useStaffAnalyticsStats(): StaffAnalyticsStatsViewModel {
  const tankDataRevision = useTankDataRevision();
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
  }, [tankDataRevision]);

  return { stats, loading };
}
