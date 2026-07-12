"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addLocalDays,
  buildDailyOperationStats,
  toLocalDateKey,
  type DailyOperationStat,
} from "@/lib/analytics/operation-stats";
import { getMonthlyStats, type MonthlyStat } from "@/lib/firebase/monthly-stats-service";
import { logsRepository } from "@/lib/firebase/repositories";
import { useTankDataRevision } from "@/hooks/useTankDataRevision";

export interface SalesStatsViewModel {
  dailyStats: DailyOperationStat[];
  monthlyStats: MonthlyStat[];
  groupedMonthly: [string, MonthlyStat[]][];
  staleMonthlyCount: number;
  loadingDaily: boolean;
  loadingMonthly: boolean;
  todayStat: DailyOperationStat | undefined;
  yesterdayStat: DailyOperationStat | undefined;
  todayTotal: number;
  yesterdayTotal: number;
  ratio: number;
}

export function useSalesStats(): SalesStatsViewModel {
  const tankDataRevision = useTankDataRevision();
  const [dailyStats, setDailyStats] = useState<DailyOperationStat[]>([]);
  const [loadingDaily, setLoadingDaily] = useState(true);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStat[]>([]);
  const [loadingMonthly, setLoadingMonthly] = useState(true);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const logs = await logsRepository.getActiveLogs({ limit: 3000 });
        if (!active) return;
        setDailyStats(buildDailyOperationStats(logs, { limit: 30 }));
      } catch (error) {
        console.error(error);
      } finally {
        if (active) setLoadingDaily(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [tankDataRevision]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const stats = await getMonthlyStats();
        if (!active) return;
        setMonthlyStats(stats);
      } catch (error) {
        console.error("Failed to load monthly stats", error);
      } finally {
        if (active) setLoadingMonthly(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [tankDataRevision]);

  const todayKey = toLocalDateKey(new Date());
  const yesterdayKey = toLocalDateKey(addLocalDays(new Date(), -1));
  const todayStat = dailyStats.find((stat) => stat.date === todayKey);
  const yesterdayStat = dailyStats.find((stat) => stat.date === yesterdayKey);
  const todayTotal = todayStat?.total || 0;
  const yesterdayTotal = yesterdayStat?.total || 0;
  const ratio = yesterdayTotal > 0
    ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100)
    : 0;

  const groupedMonthly = useMemo(() => {
    const map = new Map<string, MonthlyStat[]>();
    monthlyStats.filter((stat) => !stat.isStale).forEach((stat) => {
      if (!map.has(stat.month)) map.set(stat.month, []);
      map.get(stat.month)!.push(stat);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [monthlyStats]);
  const staleMonthlyCount = monthlyStats.filter((stat) => stat.isStale).length;

  return {
    dailyStats,
    monthlyStats,
    groupedMonthly,
    staleMonthlyCount,
    loadingDaily,
    loadingMonthly,
    todayStat,
    yesterdayStat,
    todayTotal,
    yesterdayTotal,
    ratio,
  };
}
