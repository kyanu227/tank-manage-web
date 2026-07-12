import type { LogDoc } from "@/lib/firebase/repositories/types";
import {
  isFillActionCode,
  isLendActionCode,
  isReturnActionCode,
  type TankActionCode,
} from "@/lib/tank-action-status-codes";
import { projectOfficialAggregationEvent } from "@/lib/tank-transition-projections";

export interface DailyOperationStat {
  date: string;
  lend: number;
  return_: number;
  fill: number;
  total: number;
}

export interface StaffOperationStat {
  key: string;
  name: string;
  lend: number;
  return_: number;
  fill: number;
  total: number;
}

type ActionCounts = {
  lend: number;
  return_: number;
  fill: number;
};

export function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

export function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function buildDailyOperationStats(
  logs: LogDoc[],
  options: { limit?: number } = {},
): DailyOperationStat[] {
  const limit = options.limit ?? 30;
  const dateMap = new Map<string, ActionCounts>();

  logs.forEach((log) => {
    const event = projectOfficialAggregationEvent(log);
    if (!event?.occurredAt?.toDate) return;
    const key = toLocalDateKey(event.occurredAt.toDate());
    const counts = dateMap.get(key) ?? { lend: 0, return_: 0, fill: 0 };
    if (!incrementActionCounts(counts, event.action)) return;
    dateMap.set(key, counts);
  });

  return Array.from(dateMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, limit)
    .map(([date, counts]) => ({
      date,
      ...counts,
      total: counts.lend + counts.return_ + counts.fill,
    }));
}

export function buildStaffOperationStats(logs: LogDoc[]): StaffOperationStat[] {
  const staffMap = new Map<string, ActionCounts & { name: string }>();

  logs.forEach((log) => {
    const event = projectOfficialAggregationEvent(log);
    if (!event) return;
    const key = log.staffId || "不明";
    const counts = staffMap.get(key) ?? {
      name: log.staffName || "不明",
      lend: 0,
      return_: 0,
      fill: 0,
    };
    if (!incrementActionCounts(counts, event.action)) return;
    staffMap.set(key, counts);
  });

  return Array.from(staffMap.entries())
    .map(([key, counts]) => ({
      key,
      name: counts.name,
      lend: counts.lend,
      return_: counts.return_,
      fill: counts.fill,
      total: counts.lend + counts.return_ + counts.fill,
    }))
    .sort((a, b) => b.total - a.total);
}

function incrementActionCounts(counts: ActionCounts, action: TankActionCode): boolean {
  if (isLendActionCode(action)) counts.lend += 1;
  else if (isReturnActionCode(action)) counts.return_ += 1;
  else if (isFillActionCode(action)) counts.fill += 1;
  else return false;
  return true;
}
