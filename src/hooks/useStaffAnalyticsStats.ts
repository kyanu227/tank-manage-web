"use client";

import { useEffect, useState } from "react";
import {
  buildStaffOperationStats,
  type StaffOperationStat,
} from "@/lib/analytics/operation-stats";
import { logsRepository } from "@/lib/firebase/repositories";
import { useTankDataRevisionState } from "@/hooks/useTankDataRevision";

export interface StaffAnalyticsStatsViewModel {
  stats: StaffOperationStat[];
  loading: boolean;
  error: Error | null;
}

export function useStaffAnalyticsStats(): StaffAnalyticsStatsViewModel {
  const revisionState = useTankDataRevisionState();
  const [stats, setStats] = useState<StaffOperationStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    setStats([]);
    setLoading(true);
    setError(null);
    if (!revisionState.ready) {
      if (revisionState.health === "error") {
        setError(revisionState.error ?? new Error("集計revisionを取得できません。"));
        setLoading(false);
      }
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const logs = await logsRepository.getActiveLogs();
        if (!active) return;
        setStats(buildStaffOperationStats(logs));
      } catch (error) {
        console.error(error);
        if (active) setError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [revisionState.error, revisionState.health, revisionState.ready, revisionState.revision]);

  return { stats, loading, error };
}
