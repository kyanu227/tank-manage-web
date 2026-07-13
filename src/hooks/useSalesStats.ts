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
import { useTankDataRevisionState } from "@/hooks/useTankDataRevision";

export interface SalesStatsViewModel {
  dailyStats: DailyOperationStat[];
  monthlyStats: MonthlyStat[];
  groupedMonthly: [string, MonthlyStat[]][];
  staleMonthlyCount: number;
  unknownMonthlyCount: number;
  dailyError: Error | null;
  monthlyError: Error | null;
  loadingDaily: boolean;
  loadingMonthly: boolean;
  todayStat: DailyOperationStat | undefined;
  yesterdayStat: DailyOperationStat | undefined;
  todayTotal: number;
  yesterdayTotal: number;
  ratio: number;
}

export function useSalesStats(): SalesStatsViewModel {
  const revisionState = useTankDataRevisionState();
  const [dailyStats, setDailyStats] = useState<DailyOperationStat[]>([]);
  const [loadingDaily, setLoadingDaily] = useState(true);
  const [dailyError, setDailyError] = useState<Error | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStat[]>([]);
  const [loadingMonthly, setLoadingMonthly] = useState(true);
  const [monthlyError, setMonthlyError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    setDailyStats([]);
    setLoadingDaily(true);
    setDailyError(null);
    if (!revisionState.ready) {
      if (revisionState.health === "error") {
        setDailyError(revisionState.error ?? new Error("集計revisionを取得できません。"));
        setLoadingDaily(false);
      }
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const logs = await logsRepository.getActiveLogs({ limit: 3000 });
        if (!active) return;
        setDailyStats(buildDailyOperationStats(logs, { limit: 30 }));
      } catch (error) {
        console.error(error);
        if (active) {
          setDailyError(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        if (active) setLoadingDaily(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [revisionState.error, revisionState.health, revisionState.ready, revisionState.revision]);

  useEffect(() => {
    let active = true;

    setMonthlyStats([]);
    setLoadingMonthly(true);
    setMonthlyError(null);
    if (!revisionState.ready) {
      if (revisionState.health === "error") {
        setMonthlyError(revisionState.error ?? new Error("集計revisionを取得できません。"));
        setLoadingMonthly(false);
      }
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const stats = await getMonthlyStats();
        if (!active) return;
        setMonthlyStats(stats);
      } catch (error) {
        console.error("Failed to load monthly stats", error);
        if (active) {
          setMonthlyError(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        if (active) setLoadingMonthly(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [revisionState.error, revisionState.health, revisionState.ready, revisionState.revision]);

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
    monthlyStats.filter(
      (stat) => stat.revisionStatus === "known" && !stat.isStale,
    ).forEach((stat) => {
      if (!map.has(stat.month)) map.set(stat.month, []);
      map.get(stat.month)!.push(stat);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [monthlyStats]);
  const staleMonthlyCount = monthlyStats.filter((stat) => stat.isStale).length;
  const unknownMonthlyCount = monthlyStats.filter(
    (stat) => stat.revisionStatus === "unknown",
  ).length;

  return {
    dailyStats,
    monthlyStats,
    groupedMonthly,
    staleMonthlyCount,
    unknownMonthlyCount,
    dailyError,
    monthlyError,
    loadingDaily,
    loadingMonthly,
    todayStat,
    yesterdayStat,
    todayTotal,
    yesterdayTotal,
    ratio,
  };
}
