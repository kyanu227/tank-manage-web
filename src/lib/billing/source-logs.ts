import type { LogDoc } from "@/lib/firebase/repositories/types";
import {
  projectOfficialAggregationEvent,
  projectRentalCycleEvents,
  type OfficialAggregationEvent,
  type ProjectedRentalCycleEvent,
} from "@/lib/tank-transition-projections";
import {
  isLendActionCode,
  normalizeTankActionCode,
  type TankActionCode,
} from "@/lib/tank-action-status-codes";

export type BillingMatchedReturn = {
  logId: string;
  eventId: string;
  actionCode: "return" | "return_unused" | "return_uncharged" | "carry_over";
};

export type BillingSourceLogMatch = {
  lendLog: LogDoc;
  lendEvent: ProjectedRentalCycleEvent;
  lendActionCode: "lend" | "order_lend";
  matchedReturn?: BillingMatchedReturn;
};

type ProjectedCycleSource = {
  log: LogDoc;
  event: ProjectedRentalCycleEvent | OfficialAggregationEvent;
};

type ProjectedRentalCycleSource = {
  log: LogDoc;
  event: ProjectedRentalCycleEvent;
};

type OpenRentalCycle = {
  source: ProjectedRentalCycleSource;
  matchedReturn?: BillingMatchedReturn;
};

const RETURN_MATCH_ACTION_CODES: readonly BillingMatchedReturn["actionCode"][] = [
  "return",
  "return_unused",
  "return_uncharged",
  "carry_over",
];

/**
 * 全stepから貸出サイクルを先に構成し、正式集計可能な貸出開始だけを請求元にする。
 * pending/excluded recoveryのstepもサイクル境界としては残るため、
 * 後続返却がさらに古い貸出へ誤対応しない。
 */
export function collectBillingSourceLogMatches(
  logs: LogDoc[],
  period: string,
): BillingSourceLogMatch[] {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return [];

  const sources = logs.flatMap((log) => {
    const cycleEvents: Array<ProjectedRentalCycleEvent | OfficialAggregationEvent> = [
      ...projectRentalCycleEvents(log),
    ];
    const officialEvent = projectOfficialAggregationEvent(log);
    // carry_overは状態上サイクルを閉じないが、既存請求仕様では貸出に対する
    // 月次追加料金の境界として扱うため、請求用event列へだけ追加する。
    if (officialEvent?.action === "carry_over") cycleEvents.push(officialEvent);
    return cycleEvents.map((event) => ({ log, event }));
  });
  sources.sort(compareRentalCycleSources);

  const activeCycleByTank = new Map<string, OpenRentalCycle>();
  const cycles: OpenRentalCycle[] = [];

  for (const source of sources) {
    const tankId = source.event.tankId?.trim();
    if (!tankId) continue;

    if (source.event.action === "carry_over") {
      const openCycle = activeCycleByTank.get(tankId);
      if (!openCycle) continue;
      openCycle.matchedReturn = {
        logId: source.log.id,
        eventId: projectedEventId(source.event),
        actionCode: "carry_over",
      };
      activeCycleByTank.delete(tankId);
      continue;
    }
    if (!isProjectedRentalCycleEvent(source.event)) continue;
    const rentalSource: ProjectedRentalCycleSource = {
      log: source.log,
      event: source.event,
    };

    if (source.event.businessEffect === "rental_open") {
      const cycle: OpenRentalCycle = { source: rentalSource };
      cycles.push(cycle);
      activeCycleByTank.set(tankId, cycle);
      continue;
    }

    const openCycle = activeCycleByTank.get(tankId);
    if (!openCycle) continue;

    const actionCode = toMatchedReturnActionCode(source.event);
    if (actionCode) {
      openCycle.matchedReturn = {
        logId: source.log.id,
        eventId: projectedEventId(source.event),
        actionCode,
      };
    }
    activeCycleByTank.delete(tankId);
  }

  return cycles.flatMap((cycle): BillingSourceLogMatch[] => {
    const { log, event } = cycle.source;
    const topLevelAction = normalizeTankActionCode(log.action);
    const actionCode = topLevelAction === "order_lend" ? "order_lend" : event.action;
    if (!isLendActionCode(actionCode) || !isLendSourceActionCode(actionCode)) return [];

    const occurredAt = timestampMillis(event);
    if (!occurredAt || !isInPeriod(occurredAt, year, month)) return [];

    const officialEvent = projectOfficialAggregationEvent(log);
    if (!officialEvent || projectedEventId(officialEvent) !== projectedEventId(event)) {
      return [];
    }

    return [{
      lendLog: log,
      lendEvent: event,
      lendActionCode: actionCode,
      matchedReturn: cycle.matchedReturn,
    }];
  });
}

function toMatchedReturnActionCode(
  event: ProjectedRentalCycleEvent,
): BillingMatchedReturn["actionCode"] | null {
  // system返却は貸出サイクルを閉じるが、割引・件数の正式操作にはしない。
  if (event.actorType === "system") return "return";
  return isReturnMatchActionCode(event.action) ? event.action : null;
}

function isReturnMatchActionCode(
  code: TankActionCode | null | undefined,
): code is BillingMatchedReturn["actionCode"] {
  return code != null
    && RETURN_MATCH_ACTION_CODES.includes(code as BillingMatchedReturn["actionCode"]);
}

function isLendSourceActionCode(
  code: TankActionCode | null | undefined,
): code is "lend" | "order_lend" {
  return code === "lend" || code === "order_lend";
}

function compareRentalCycleSources(
  a: ProjectedCycleSource,
  b: ProjectedCycleSource,
): number {
  const timestampOrder = compareTimestamps(a.event, b.event);
  if (timestampOrder !== 0) return timestampOrder;

  if (a.log.id === b.log.id) return a.event.stepIndex - b.event.stepIndex;
  return a.log.id.localeCompare(b.log.id);
}

function isProjectedRentalCycleEvent(
  event: ProjectedRentalCycleEvent | OfficialAggregationEvent,
): event is ProjectedRentalCycleEvent {
  return event.businessEffect === "rental_open" || event.businessEffect === "rental_close";
}

function compareTimestamps(
  a: ProjectedRentalCycleEvent | OfficialAggregationEvent,
  b: ProjectedRentalCycleEvent | OfficialAggregationEvent,
): number {
  const aSeconds = a.occurredAt?.seconds ?? 0;
  const bSeconds = b.occurredAt?.seconds ?? 0;
  if (aSeconds !== bSeconds) return aSeconds - bSeconds;

  const aNanos = a.occurredAt?.nanoseconds ?? 0;
  const bNanos = b.occurredAt?.nanoseconds ?? 0;
  return aNanos - bNanos;
}

function projectedEventId(event: {
  logId: string;
  stepIndex: number;
}): string {
  return `${event.logId}:${event.stepIndex}`;
}

function isInPeriod(timestamp: number, year: number, month: number): boolean {
  const date = new Date(timestamp);
  return date.getFullYear() === year && date.getMonth() + 1 === month;
}

function timestampMillis(event: ProjectedRentalCycleEvent | OfficialAggregationEvent): number {
  if (!event.occurredAt?.toDate) return 0;
  return event.occurredAt.toDate().getTime();
}
