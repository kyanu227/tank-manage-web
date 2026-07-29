import { listActiveCustomerSnapshots } from "@/lib/firebase/customers-service";
import {
  logsRepository,
  transactionsRepository,
} from "@/lib/firebase/repositories";
import type { TransactionDoc } from "@/lib/firebase/repositories/types";
import type { CustomerSnapshot } from "@/lib/operation-context";
import { timestampToMillis } from "@/features/staff-dashboard/timestamp";
import type { DashboardLogEntry } from "./dashboard-read-model";

export type StaffDashboardSourceData = {
  logs: DashboardLogEntry[];
  customerOptions: CustomerSnapshot[];
  unfilledReports: TransactionDoc[];
};

export async function fetchStaffDashboardSourceData(
): Promise<StaffDashboardSourceData> {
  const [
    logs,
    customers,
    unfilledReports,
  ] = await Promise.all([
    logsRepository.getActiveLogs({
      orderBy: null,
    }),
    listActiveCustomerSnapshots(),
    transactionsRepository.getUnchargedReports(),
  ]);

  const entries = logs as unknown as DashboardLogEntry[];
  const dashboardLogs = entries.slice(0, 200);
  const customerOptions = customers;
  const sortedReports = [...unfilledReports].sort(
    (a, b) =>
      (timestampToMillis(b.createdAt) ?? 0)
      - (timestampToMillis(a.createdAt) ?? 0),
  );
  const dashboardUnfilledReports = sortedReports.slice(0, 10);

  return {
    logs: dashboardLogs,
    customerOptions,
    unfilledReports: dashboardUnfilledReports,
  };
}

export async function fetchStaffDashboardLogHistory(
  rootLogId: string,
): Promise<DashboardLogEntry[]> {
  const entries = (
    await logsRepository.getLogsByRoot(rootLogId)
  ) as unknown as DashboardLogEntry[];

  entries.sort(
    (a, b) =>
      (a.revision ?? 0)
      - (b.revision ?? 0),
  );

  return entries;
}
