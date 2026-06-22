import type { LogDoc } from "@/lib/firebase/repositories/types";
import {
  coerceTankLogActionCode,
  isLendActionCode,
  type TankActionCode,
} from "@/lib/tank-action-status-codes";

export type BillingMatchedReturn = {
  logId: string;
  actionCode: "return" | "return_unused" | "return_uncharged" | "carry_over";
};

export type BillingSourceLogMatch = {
  lendLog: LogDoc;
  lendActionCode: "lend" | "order_lend";
  matchedReturn?: BillingMatchedReturn;
};

const RETURN_MATCH_ACTION_CODES: readonly BillingMatchedReturn["actionCode"][] = [
  "return",
  "return_unused",
  "return_uncharged",
  "carry_over",
];

export function collectBillingSourceLogMatches(
  logs: LogDoc[],
  period: string,
): BillingSourceLogMatch[] {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return [];

  const sortedLogs = [...logs].sort((a, b) => logMillis(a) - logMillis(b));
  const returnCandidates = sortedLogs.filter((log) => {
    const actionCode = coerceTankLogActionCode(log.action, log.transitionAction);
    return isReturnMatchActionCode(actionCode) && Boolean(log.tankId);
  });
  const usedReturnIds = new Set<string>();

  return sortedLogs.flatMap((log): BillingSourceLogMatch[] => {
    const actionCode = coerceTankLogActionCode(log.action, log.transitionAction);
    const timestamp = logMillis(log);
    if (!isLendActionCode(actionCode) || !isLendSourceActionCode(actionCode)) return [];
    if (!timestamp || !isInPeriod(timestamp, year, month)) return [];

    const matchedReturn = findMatchedReturn(
      log,
      returnCandidates,
      usedReturnIds,
    );
    if (matchedReturn) {
      usedReturnIds.add(matchedReturn.logId);
    }

    return [{
      lendLog: log,
      lendActionCode: actionCode,
      matchedReturn,
    }];
  });
}

function findMatchedReturn(
  lendLog: LogDoc,
  returnCandidates: LogDoc[],
  usedReturnIds: Set<string>,
): BillingMatchedReturn | undefined {
  const lendTimestamp = logMillis(lendLog);
  if (!lendTimestamp || !lendLog.tankId) return undefined;

  for (const returnLog of returnCandidates) {
    if (usedReturnIds.has(returnLog.id)) continue;
    if (returnLog.tankId !== lendLog.tankId) continue;

    const returnTimestamp = logMillis(returnLog);
    if (!returnTimestamp || returnTimestamp <= lendTimestamp) continue;
    if (
      lendLog.customerId
      && returnLog.customerId
      && lendLog.customerId !== returnLog.customerId
    ) {
      continue;
    }

    const actionCode = coerceTankLogActionCode(
      returnLog.action,
      returnLog.transitionAction,
    );
    if (!isReturnMatchActionCode(actionCode)) continue;

    return {
      logId: returnLog.id,
      actionCode,
    };
  }

  return undefined;
}

function isReturnMatchActionCode(
  code: TankActionCode | null | undefined,
): code is BillingMatchedReturn["actionCode"] {
  return code != null && RETURN_MATCH_ACTION_CODES.includes(code as BillingMatchedReturn["actionCode"]);
}

function isLendSourceActionCode(
  code: TankActionCode | null | undefined,
): code is "lend" | "order_lend" {
  return code === "lend" || code === "order_lend";
}

function isInPeriod(timestamp: number, year: number, month: number): boolean {
  const date = new Date(timestamp);
  return date.getFullYear() === year && date.getMonth() + 1 === month;
}

function logMillis(log: LogDoc): number {
  const value = log.timestamp;
  if (!value?.toDate) return 0;
  return value.toDate().getTime();
}
