import {
  buildCustomerIdentityGroup,
  normalizeCustomerIdentityText,
} from "@/lib/customer-identity-read";
import type { TransactionDoc } from "@/lib/firebase/repositories/types";
import type { Locale } from "@/lib/locale";
import type { CustomerSnapshot } from "@/lib/operation-context";
import {
  LEGACY_UNKNOWN_TANK_STATUS_KEY,
  coerceTankActionCode,
  coerceTankStatusCode,
} from "@/lib/tank-action-status-codes";
import type { TankSnapshot } from "@/lib/tank-operation";
import type { TankDoc } from "@/lib/tank-types";
import {
  formatDashboardActionLabel,
  getDashboardText,
} from "@/features/staff-dashboard/i18n";
import { timestampToMillis } from "@/features/staff-dashboard/timestamp";

type DashboardDateValue =
  | Date
  | number
  | string
  | { toDate: () => Date }
  | { toMillis: () => number }
  | null;

type DashboardLogStatus = "active" | "superseded" | "voided";

export interface DashboardLogEntry {
  id: string;
  tankId: string;
  action: string;
  transitionAction?: string;
  staffId?: string;
  staffName?: string;
  staffEmail?: string;
  customerId?: string;
  customerName?: string;
  location?: string;
  timestamp?: DashboardDateValue;
  originalAt?: DashboardDateValue;
  revisionCreatedAt?: DashboardDateValue;
  note?: string;
  logNote?: string;
  logStatus?: DashboardLogStatus;
  logKind?: string;
  transitionPlan?: { kind?: "direct" | "recovery" };
  transitionReviewStatus?: "not_required" | "pending" | "approved" | "excluded";
  rootLogId?: string;
  revision?: number;
  editedByStaffId?: string;
  editedByStaffName?: string;
  editedByStaffEmail?: string;
  editReason?: string;
  voidedByStaffId?: string;
  voidedByStaffName?: string;
  voidedByStaffEmail?: string;
  voidReason?: string;
  voidedAt?: DashboardDateValue;
  prevTankSnapshot?: TankSnapshot;
  nextTankSnapshot?: TankSnapshot;
}

export type DashboardLogSortOrder = "desc" | "asc";

export type DashboardTankSummary = Record<string, number>;

export type DashboardCustomerIdentitySummary = {
  key: string;
  customerId?: string;
  displayName: string;
  lent: number;
  unreturned: number;
  total: number;
  isLegacy: boolean;
};

type DashboardCustomerIdentityAggregate =
  DashboardCustomerIdentitySummary & {
    sortKey: string;
  };

const LEGACY_UNKNOWN_CUSTOMER_KEY =
  "legacy-location:__unknown__";

export type DashboardTodayStats = {
  total: number;
  breakdown: Array<{
    key: string;
    action: string;
    count: number;
  }>;
};

export type StaffDashboardReadModel = {
  totalTanks: number;
  tankSummary: DashboardTankSummary;
  byLocation: DashboardCustomerIdentitySummary[];
  todayStats: DashboardTodayStats;
  recentUnfilledReports: TransactionDoc[];
};

export type BuildStaffDashboardReadModelInput = {
  tanks: readonly TankDoc[];
  logs: readonly DashboardLogEntry[];
  customerOptions: readonly CustomerSnapshot[];
  unfilledReports: readonly TransactionDoc[];
  staffLocale: Locale;
  nowMillis: number;
};

export function buildStaffDashboardReadModel(
  input: BuildStaffDashboardReadModelInput,
): StaffDashboardReadModel {
  const {
    tanks,
    logs,
    customerOptions,
    unfilledReports,
    staffLocale,
    nowMillis,
  } = input;
  const locale = staffLocale;

  const counts: DashboardTankSummary = {};
  tanks.forEach((tank) => {
    const status =
      coerceTankStatusCode(tank.status)
      ?? tank.status
      ?? LEGACY_UNKNOWN_TANK_STATUS_KEY;

    counts[status] = (counts[status] || 0) + 1;
  });

  const customerNameById = new Map<string, string>();
  customerOptions.forEach((customer) => {
    customerNameById.set(
      customer.customerId,
      customer.customerName,
    );
  });

  const locationGroups = new Map<
    string,
    DashboardCustomerIdentityAggregate
  >();

  tanks.forEach((tank) => {
    const statusCode = coerceTankStatusCode(tank.status);
    if (
      statusCode !== "lent"
      && statusCode !== "unreturned"
    ) {
      return;
    }

    const customerId =
      normalizeCustomerIdentityText(tank.customerId);

    const identity = buildCustomerIdentityGroup(
      {
        customerId: tank.customerId,
        customerName: tank.customerName,
        location: tank.location,
      },
      {
        currentCustomerName: customerId
          ? customerNameById.get(customerId)
          : undefined,
        unknownCustomerLabel: getDashboardText("unknownCustomer", "ja"),
        legacyUnknownLabel: getDashboardText("unknown", "ja"),
      },
    );

    const current = locationGroups.get(identity.key) ?? {
      key: identity.key,
      customerId: identity.customerId,
      displayName: identity.displayName,
      sortKey: identity.key === LEGACY_UNKNOWN_CUSTOMER_KEY
        ? identity.key
        : identity.displayName,
      lent: 0,
      unreturned: 0,
      total: 0,
      isLegacy: identity.isLegacy,
    };

    if (statusCode === "lent") {
      current.lent += 1;
    } else {
      current.unreturned += 1;
    }

    current.total = current.lent + current.unreturned;
    locationGroups.set(identity.key, current);
  });

  const byLocation = Array.from(locationGroups.values())
    .sort(
      (a, b) =>
        b.total - a.total
        || a.sortKey.localeCompare(b.sortKey),
    )
    .map((group): DashboardCustomerIdentitySummary => ({
      key: group.key,
      customerId: group.customerId,
      displayName: group.key === LEGACY_UNKNOWN_CUSTOMER_KEY
        ? (locale === "ja" ? "未設定" : "Not set")
        : group.displayName,
      lent: group.lent,
      unreturned: group.unreturned,
      total: group.total,
      isLegacy: group.isLegacy,
    }));

  const now = new Date(nowMillis);
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();

  const byAction = new Map<
    string,
    { key: string; action: string; count: number }
  >();
  let total = 0;

  logs.forEach((log) => {
    const ms = timestampToMillis(
      log.originalAt ?? log.timestamp,
    );
    if (ms == null || ms < startOfDay) return;

    total += 1;
    const key = coerceTankActionCode(log.action) ?? (log.action || "__unknown__");
    const current = byAction.get(key) ?? {
      key,
      action: formatDashboardActionLabel(log.action, locale),
      count: 0,
    };
    current.count += 1;
    byAction.set(key, current);
  });

  const breakdown = Array.from(byAction.values())
    .sort(
      (a, b) =>
        b.count - a.count
        || a.key.localeCompare(b.key),
    );

  return {
    totalTanks: tanks.length,
    tankSummary: counts,
    byLocation,
    todayStats: {
      total,
      breakdown,
    },
    recentUnfilledReports: unfilledReports.slice(0, 5),
  };
}

export function sortStaffDashboardLogs(
  logs: readonly DashboardLogEntry[],
  order: DashboardLogSortOrder,
): DashboardLogEntry[] {
  const copy = [...logs];

  copy.sort((a, b) => {
    const aTime =
      timestampToMillis(a.originalAt ?? a.timestamp)
      ?? 0;

    const bTime =
      timestampToMillis(b.originalAt ?? b.timestamp)
      ?? 0;

    return order === "desc"
      ? bTime - aTime
      : aTime - bTime;
  });

  return copy;
}
