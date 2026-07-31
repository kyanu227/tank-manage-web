"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TransactionDoc } from "@/lib/firebase/repositories/types";
import { requireStaffIdentity, useStaffLocale, useStaffSession } from "@/hooks/useStaffSession";
import { useTanks } from "@/hooks/useTanks";
import type { StaffCorrectionRole } from "@/lib/tank-operation";
import type { CustomerSnapshot } from "@/lib/operation-context";
import { DashboardCorrectionModals } from "@/features/staff-dashboard/components/DashboardCorrectionModals";
import { DashboardLogsSection } from "@/features/staff-dashboard/components/DashboardLogsSection";
import { DashboardOperationsSummary } from "@/features/staff-dashboard/components/DashboardOperationsSummary";
import { DashboardStatusSummary } from "@/features/staff-dashboard/components/DashboardStatusSummary";
import { StaffDashboardView } from "@/features/staff-dashboard/components/StaffDashboardView";
import {
  formatDashboardActionLabel,
  formatDashboardDateTime,
  formatDashboardLocationOption,
  formatDashboardLogLocation,
  formatDashboardLogKind,
  formatDashboardPartialFailure,
  formatDashboardReportSource,
  formatDashboardReportStatus,
  formatDashboardTankId,
  formatDashboardTankStatusLabel,
  formatDashboardUpdateSuccess,
  formatDashboardVoidSuccess,
  getDashboardText,
} from "@/features/staff-dashboard/i18n";
import { timestampToMillis, toDate } from "@/features/staff-dashboard/timestamp";
import {
  fetchStaffDashboardLogHistory,
  fetchStaffDashboardSourceData,
} from "@/features/staff-dashboard/queries/dashboard-query";
import {
  buildStaffDashboardReadModel,
  sortStaffDashboardLogs,
  type DashboardLogEntry,
  type DashboardLogSortOrder,
} from "@/features/staff-dashboard/queries/dashboard-read-model";
import {
  correctDashboardLogLocations,
  correctDashboardLogTankId,
  voidDashboardLog,
  voidDashboardLogs,
} from "@/features/staff-dashboard/services/log-correction-workflow";
import { STATUS_COLORS } from "@/lib/tank-rules";
import {
  coerceTankActionCode,
  coerceTankStatusCode,
  tankStatusCodeToLegacyStatus,
  type TankActionCode,
} from "@/lib/tank-action-status-codes";
import { getDashboardActionBadgeTone } from "@/lib/tank-action-status-display";
import type { Locale } from "@/lib/locale";
import { getStaffGenericErrorMessage } from "@/lib/staff-display";

interface EditForm {
  tankId: string | null;
  reason: string;
}

type BulkLocationOption = {
  value: string;
  location: string;
  customer: CustomerSnapshot | null;
};
type BulkLocationMode = "lend" | "inhouse" | null;

const LIMIT_MS = 72 * 60 * 60 * 1000;
const IN_HOUSE_LOCATION_VALUE = "__inhouse__";

export default function StaffDashboard() {
  const session = useStaffSession();
  const staffLocale = useStaffLocale();
  const correctionRole = useMemo(
    () => normalizeCorrectionRole(session?.role),
    [session?.role]
  );
  const { tanks, loading: tanksLoading, loadFailed: tanksLoadFailed, refetch: refetchTanks } = useTanks();
  const tankIds = useMemo(() => tanks.map((t) => t.id), [tanks]);

  const [logs, setLogs] = useState<DashboardLogEntry[]>([]);
  const [unfilledReports, setUnfilledReports] = useState<TransactionDoc[]>([]);
  const [customerOptions, setCustomerOptions] = useState<CustomerSnapshot[]>([]);
  const [logSortOrder, setLogSortOrder] = useState<DashboardLogSortOrder>("desc");
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardLoadFailed, setDashboardLoadFailed] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);

  const [editingLog, setEditingLog] = useState<DashboardLogEntry | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [voidingLog, setVoidingLog] = useState<DashboardLogEntry | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [savingVoid, setSavingVoid] = useState(false);

  const [bulkLocationModalOpen, setBulkLocationModalOpen] = useState(false);
  const [bulkLocationValue, setBulkLocationValue] = useState("");
  const [bulkLocationReason, setBulkLocationReason] = useState("");
  const [savingBulkLocation, setSavingBulkLocation] = useState(false);

  const [bulkVoidModalOpen, setBulkVoidModalOpen] = useState(false);
  const [bulkVoidReason, setBulkVoidReason] = useState("");
  const [savingBulkVoid, setSavingBulkVoid] = useState(false);

  const [expandedRootId, setExpandedRootId] = useState<string | null>(null);
  const [historyByRoot, setHistoryByRoot] = useState<Record<string, DashboardLogEntry[]>>({});
  const [historyLoadingRoot, setHistoryLoadingRoot] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardLoadFailed(false);
    try {
      const source = await fetchStaffDashboardSourceData();
      setLogs(source.logs);
      setUnfilledReports(source.unfilledReports);
      setCustomerOptions(source.customerOptions);
    } catch (e) {
      console.error("fetchStaffDashboardSourceData failed", e);
      setDashboardLoadFailed(true);
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setSelectedLogIds((prev) => prev.filter((id) => logs.some((log) => log.id === id)));
  }, [logs]);

  const todayInputs = useMemo(
    () => ({
      logs,
      staffLocale,
      nowMillis: new Date().getTime(),
    }),
    [logs, staffLocale],
  );

  const dashboardReadModel = useMemo(
    () =>
      buildStaffDashboardReadModel({
        tanks,
        logs: todayInputs.logs,
        customerOptions,
        unfilledReports,
        staffLocale: todayInputs.staffLocale,
        nowMillis: todayInputs.nowMillis,
      }),
    [tanks, customerOptions, unfilledReports, todayInputs],
  );

  const {
    totalTanks,
    tankSummary: summary,
    byLocation,
    todayStats,
    recentUnfilledReports,
  } = dashboardReadModel;

  const sortedLogs = useMemo(
    () => sortStaffDashboardLogs(logs, logSortOrder),
    [logs, logSortOrder],
  );

  const loading = dashboardLoading || tanksLoading;

  const refreshAfterCorrection = async () => {
    await Promise.all([fetchData(), refetchTanks()]);
  };

  const selectedLogs = useMemo(
    () => logs.filter((log) => selectedLogIds.includes(log.id)),
    [logs, selectedLogIds]
  );

  const allSelectableLogIds = useMemo(
    () =>
      logs
        .filter((log) => log.logKind === "tank" && canModifyLog(log, correctionRole))
        .map((log) => log.id),
    [logs, correctionRole]
  );

  const bulkLocationMode = useMemo(() => {
    if (selectedLogs.length === 0) return null;
    if (selectedLogs.some((log) => canCorrectLogReason(log, correctionRole) != null)) {
      return null;
    }
    const actions = selectedLogs.map((log) => toTankActionCode(log.transitionAction ?? log.action));
    if (actions.some((action) => action == null)) return null;
    if (actions.every((action) => action === "lend")) return "lend";
    if (actions.every((action) => action === "inhouse_use" || action === "inhouse_use_retro")) {
      return "inhouse";
    }
    return null;
  }, [correctionRole, selectedLogs]);

  const bulkLocationOptions = useMemo<BulkLocationOption[]>(() => {
    if (bulkLocationMode === "lend") {
      return customerOptions.map((customer) => ({
        value: customer.customerId,
        location: customer.customerName,
        customer,
      }));
    }
    if (bulkLocationMode === "inhouse") {
      return [{ value: IN_HOUSE_LOCATION_VALUE, location: "自社", customer: null }];
    }
    return [];
  }, [bulkLocationMode, customerOptions]);

  const openEdit = (log: DashboardLogEntry) => {
    if (canCorrectLogReason(log, correctionRole)) return;
    setEditingLog(log);
    setEditForm({
      tankId: log.tankId,
      reason: "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editingLog || !editForm || !editForm.tankId) return;
    if (editForm.reason.trim().length < 5) return;

    setSavingEdit(true);
    try {
      await correctDashboardLogTankId({
        targetLogId: editingLog.id,
        tankId: editForm.tankId,
        reason: editForm.reason,
        editedByRole: correctionRole,
        resolveActor: requireStaffIdentity,
      });
      setEditingLog(null);
      setEditForm(null);
      setHistoryByRoot({});
      setExpandedRootId(null);
      await refreshAfterCorrection();
    } catch (e: unknown) {
      console.error("correctDashboardLogTankId failed", e);
      alert(staffLocale === "ja"
        ? `${getDashboardText("correctionFailure", staffLocale)}: ${errorMessage(e)}`
        : getStaffGenericErrorMessage(staffLocale));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleVoid = async () => {
    if (!voidingLog || voidReason.trim().length < 5) return;

    setSavingVoid(true);
    try {
      await voidDashboardLog({
        logId: voidingLog.id,
        reason: voidReason,
        voidedByRole: correctionRole,
        resolveActor: requireStaffIdentity,
      });
      setVoidingLog(null);
      setVoidReason("");
      setHistoryByRoot({});
      setExpandedRootId(null);
      await refreshAfterCorrection();
    } catch (e: unknown) {
      console.error("voidDashboardLog failed", e);
      alert(staffLocale === "ja"
        ? `${getDashboardText("voidFailure", staffLocale)}: ${errorMessage(e)}`
        : getStaffGenericErrorMessage(staffLocale));
    } finally {
      setSavingVoid(false);
    }
  };

  const toggleEditMode = () => {
    setIsEditMode((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedLogIds([]);
        setExpandedRootId(null);
      }
      return next;
    });
  };

  const toggleLogSelection = (logId: string) => {
    setSelectedLogIds((prev) =>
      prev.includes(logId) ? prev.filter((id) => id !== logId) : [...prev, logId]
    );
  };

  const selectAllLogs = () => {
    setSelectedLogIds(allSelectableLogIds);
  };

  const clearSelectedLogs = () => {
    setSelectedLogIds([]);
  };

  const openBulkLocationModal = () => {
    if (bulkLocationOptions.length === 0) return;
    setBulkLocationValue((prev) => {
      if (prev && bulkLocationOptions.some((option) => option.value === prev)) return prev;
      return bulkLocationOptions[0]?.value ?? "";
    });
    setBulkLocationReason("");
    setBulkLocationModalOpen(true);
  };

  const handleBulkLocationChange = async () => {
    if (!bulkLocationValue || bulkLocationReason.trim().length < 5 || selectedLogs.length === 0) return;

    setSavingBulkLocation(true);
    try {
      const selectedOption = bulkLocationOptions.find((option) => option.value === bulkLocationValue);
      if (!selectedOption) {
        alert(getDashboardText("missingDestination", staffLocale));
        return;
      }
      const failures = await correctDashboardLogLocations({
        logs: selectedLogs,
        location: selectedOption.location,
        customer: selectedOption.customer,
        reason: bulkLocationReason,
        editedByRole: correctionRole,
        resolveActor: requireStaffIdentity,
      });

      setBulkLocationModalOpen(false);
      setSelectedLogIds([]);
      setExpandedRootId(null);
      setHistoryByRoot({});
      await refreshAfterCorrection();

      if (failures.length > 0) {
        console.error("correctDashboardLogLocations partial failure", failures);
        alert(formatDashboardPartialFailure("location", failures, staffLocale));
        return;
      }
      alert(formatDashboardUpdateSuccess(selectedLogs.length, staffLocale));
    } catch (e: unknown) {
      console.error("correctDashboardLogLocations failed", e);
      alert(staffLocale === "ja" ? errorMessage(e) : getStaffGenericErrorMessage(staffLocale));
    } finally {
      setSavingBulkLocation(false);
    }
  };

  const handleBulkVoid = async () => {
    if (bulkVoidReason.trim().length < 5 || selectedLogs.length === 0) return;

    setSavingBulkVoid(true);
    try {
      const failures = await voidDashboardLogs({
        logs: selectedLogs,
        reason: bulkVoidReason,
        voidedByRole: correctionRole,
        resolveActor: requireStaffIdentity,
      });

      setBulkVoidModalOpen(false);
      setBulkVoidReason("");
      setSelectedLogIds([]);
      setExpandedRootId(null);
      setHistoryByRoot({});
      await refreshAfterCorrection();

      if (failures.length > 0) {
        console.error("voidDashboardLogs partial failure", failures);
        alert(formatDashboardPartialFailure("void", failures, staffLocale));
        return;
      }
      alert(formatDashboardVoidSuccess(selectedLogs.length, staffLocale));
    } catch (e: unknown) {
      console.error("voidDashboardLogs failed", e);
      alert(staffLocale === "ja" ? errorMessage(e) : getStaffGenericErrorMessage(staffLocale));
    } finally {
      setSavingBulkVoid(false);
    }
  };

  const toggleHistory = async (log: DashboardLogEntry) => {
    const rootId = log.rootLogId ?? log.id;
    if (expandedRootId === rootId) {
      setExpandedRootId(null);
      return;
    }
    setExpandedRootId(rootId);
    if (historyByRoot[rootId]) return;

    setHistoryLoadingRoot(rootId);
    try {
      const entries = await fetchStaffDashboardLogHistory(rootId);
      setHistoryByRoot((prev) => ({ ...prev, [rootId]: entries }));
    } catch (e: unknown) {
      console.error("fetchStaffDashboardLogHistory failed", e);
      alert(staffLocale === "ja"
        ? `${getDashboardText("historyFailure", staffLocale)}: ${errorMessage(e)}`
        : getDashboardText("historyFailure", staffLocale));
    } finally {
      setHistoryLoadingRoot(null);
    }
  };

  const editDisabledReason = getEditDisabledReason(editForm, editingLog, savingEdit, staffLocale);
  const voidDisabledReason = getVoidDisabledReason(voidReason, savingVoid, staffLocale);
  const bulkLocationUnavailableReason = getBulkLocationUnavailableReason(
    selectedLogIds.length,
    bulkLocationMode,
    customerOptions.length,
    bulkLocationOptions.length,
    staffLocale,
  );

  const statusItems = loading
    ? []
    : Object.entries(summary)
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => ({
          key: status,
          label: formatDashboardTankStatusLabel(status, staffLocale),
          count,
          color: tankStatusColor(status),
        }));

  const customerLoans = loading
    ? []
    : byLocation.map((row) => ({
        key: row.key,
        displayName: row.displayName,
        lent: row.lent,
        unreturned: row.unreturned,
      }));

  const todayOperations = loading
    ? []
    : todayStats.breakdown.map((row) => ({
        key: row.key,
        action: row.action,
        count: row.count,
      }));

  const reportRows = loading
    ? []
    : recentUnfilledReports.map((report) => ({
        id: report.id,
        tankId: report.tankId || "-",
        customerName: report.customerName || getDashboardText("customerNotSet", staffLocale),
        customerTitle: report.customerName || "",
        statusLabel: formatDashboardReportStatus(report.status, staffLocale),
        timeLabel: formatTime(report.createdAt, staffLocale),
        sourceLabel: formatDashboardReportSource(report.source, staffLocale),
      }));

  const logRows = loading
    ? []
    : sortedLogs.map((log) => {
        const rootId = log.rootLogId ?? log.id;

        const modifyDisabledReason =
          canModifyLogReason(log, correctionRole, staffLocale);

        const correctionDisabledReason =
          canCorrectLogReason(log, correctionRole, staffLocale);

        const history =
          historyByRoot[rootId] ?? [];

        return {
          id: log.id,
          tankId: formatDashboardTankId(log.tankId, log.logKind, staffLocale),
          actionLabel:
            formatDashboardActionLabel(log.action, staffLocale),
          actionBackground: actionBg(log.action),
          actionForeground: actionFg(log.action),
          locationLabel: formatDashboardLogLocation(log, staffLocale),
          staffLabel: log.staffName || "-",
          timeLabel:
            formatTime(log.originalAt ?? log.timestamp, staffLocale),
          isTankLog: log.logKind === "tank",
          logKindLabel: formatDashboardLogKind(log.logKind, staffLocale),
          isSelected:
            selectedLogIds.includes(log.id),
          canModify:
            modifyDisabledReason == null,
          modifyDisabledReason,
          canCorrect:
            correctionDisabledReason == null,
          correctionDisabledReason,
          isExpanded:
            expandedRootId === rootId,
          historyLoading:
            historyLoadingRoot === rootId,
          historyEntries: history.map((rev) => ({
            id: rev.id,
            revisionLabel:
              `v${rev.revision ?? "-"}`,
            statusLabel:
              statusLabel(rev.logStatus, staffLocale),
            statusColor:
              statusColor(rev.logStatus),
            actionLabel:
              formatDashboardActionLabel(
                rev.action,
                staffLocale,
              ),
            timeLabel:
              formatTime(
                rev.revisionCreatedAt,
                staffLocale,
              ),
            editMetadata:
              rev.editedByStaffName
                || rev.editReason
                ? `${
                    rev.editedByStaffName || "-"
                  } / ${
                    rev.editReason || "-"
                  }`
                : null,
            voidMetadata:
              rev.logStatus === "voided"
                ? `${
                    rev.voidedByStaffName || "-"
                  } / ${
                    rev.voidReason || "-"
                  }`
                : null,
          })),
        };
      });

  const idCorrectionModal =
    editingLog && editForm
      ? {
          tankIds,
          selectedTankId: editForm.tankId,
          reason: editForm.reason,
          saving: savingEdit,
          confirmDisabled:
            Boolean(editDisabledReason),
          disabledReason:
            editDisabledReason,
          onTankIdChange: (tankId: string | null) =>
            setEditForm((prev) =>
              prev
                ? { ...prev, tankId }
                : prev
            ),
          onReasonChange: (reason: string) =>
            setEditForm((prev) =>
              prev
                ? { ...prev, reason }
                : prev
            ),
          onConfirm: handleSaveEdit,
          onClose: () => {
            if (savingEdit) return;
            setEditingLog(null);
          },
        }
      : null;

  const singleVoidModal = voidingLog
    ? {
        targetTankId: voidingLog.tankId,
        actionLabel:
          formatDashboardActionLabel(
            voidingLog.action,
            staffLocale,
          ),
        reason: voidReason,
        saving: savingVoid,
        confirmDisabled:
          Boolean(voidDisabledReason),
        disabledReason:
          voidDisabledReason,
        onReasonChange: setVoidReason,
        onConfirm: handleVoid,
        onClose: () => {
          if (savingVoid) return;
          setVoidingLog(null);
        },
      }
    : null;

  const bulkLocationModal =
    bulkLocationModalOpen
      ? {
          selectedCount:
            selectedLogs.length,
          options:
            bulkLocationOptions.map(
              (option) => ({
                value: option.value,
                label: formatDashboardLocationOption(
                  option.location,
                  option.customer === null,
                  staffLocale,
                ),
              }),
            ),
          selectedValue:
            bulkLocationValue,
          reason:
            bulkLocationReason,
          saving:
            savingBulkLocation,
          confirmDisabled:
            savingBulkLocation
            || !bulkLocationValue
            || bulkLocationReason
              .trim().length < 5,
          onValueChange:
            setBulkLocationValue,
          onReasonChange:
            setBulkLocationReason,
          onConfirm:
            handleBulkLocationChange,
          onClose: () => {
            if (savingBulkLocation) return;
            setBulkLocationModalOpen(false);
          },
        }
      : null;

  const bulkVoidModal =
    bulkVoidModalOpen
      ? {
          selectedCount:
            selectedLogs.length,
          reason:
            bulkVoidReason,
          saving:
            savingBulkVoid,
          confirmDisabled:
            savingBulkVoid
            || bulkVoidReason
              .trim().length < 5,
          onReasonChange:
            setBulkVoidReason,
          onConfirm:
            handleBulkVoid,
          onClose: () => {
            if (savingBulkVoid) return;
            setBulkVoidModalOpen(false);
          },
        }
      : null;

  return (
    <StaffDashboardView
      staffName={session?.name ?? null}
      loading={loading}
      locale={staffLocale}
      loadFailed={(dashboardLoadFailed && logs.length === 0) || (tanksLoadFailed && tanks.length === 0)}
      showLoadWarning={(dashboardLoadFailed && logs.length > 0) || (tanksLoadFailed && tanks.length > 0)}
      onRetry={() => { void Promise.all([fetchData(), refetchTanks()]); }}
      overlays={
        <DashboardCorrectionModals
          idCorrection={idCorrectionModal}
          singleVoid={singleVoidModal}
          bulkLocation={bulkLocationModal}
          bulkVoid={bulkVoidModal}
          locale={staffLocale}
        />
      }
    >
      <DashboardStatusSummary
        totalTanks={totalTanks}
        items={statusItems}
        locale={staffLocale}
      />

      <DashboardOperationsSummary
        customerLoans={customerLoans}
        todayTotal={todayStats.total}
        todayOperations={todayOperations}
        unfilledReportCount={
          unfilledReports.length
        }
        recentUnfilledReports={
          reportRows
        }
        locale={staffLocale}
      />

      <DashboardLogsSection
        activeLogCount={logs.length}
        rows={logRows}
        sortOrder={logSortOrder}
        isEditMode={isEditMode}
        selectedCount={
          selectedLogIds.length
        }
        bulkLocationDisabled={
          selectedLogIds.length === 0
          || bulkLocationOptions.length === 0
        }
        bulkVoidDisabled={
          selectedLogIds.length === 0
        }
        bulkLocationUnavailableReason={
          bulkLocationUnavailableReason
        }
        onToggleSort={() =>
          setLogSortOrder((prev) =>
            prev === "desc"
              ? "asc"
              : "desc"
          )
        }
        onToggleEditMode={
          toggleEditMode
        }
        onSelectAll={selectAllLogs}
        onClearSelection={
          clearSelectedLogs
        }
        onOpenBulkLocation={
          openBulkLocationModal
        }
        onOpenBulkVoid={() => {
          setBulkVoidReason("");
          setBulkVoidModalOpen(true);
        }}
        onToggleSelection={
          toggleLogSelection
        }
        onOpenEdit={(logId) => {
          const log =
            logs.find((entry) => entry.id === logId);

          if (!log) return;
          openEdit(log);
        }}
        onOpenVoid={(logId) => {
          const log =
            logs.find((entry) => entry.id === logId);

          if (!log) return;
          setVoidingLog(log);
          setVoidReason("");
        }}
        onToggleHistory={async (logId) => {
          const log =
            logs.find((entry) => entry.id === logId);

          if (!log) return;
          await toggleHistory(log);
        }}
        locale={staffLocale}
      />
    </StaffDashboardView>
  );
}

function normalizeCorrectionRole(role?: string): StaffCorrectionRole {
  if (role === "admin" || role === "管理者") return "管理者";
  if (role === "準管理者") return "準管理者";
  return "一般";
}

function toTankActionCode(value: unknown): TankActionCode | null {
  return typeof value === "string" ? coerceTankActionCode(value) : null;
}

function tankStatusColor(status: string): string {
  const code = coerceTankStatusCode(status);
  const legacyStatus = code ? tankStatusCodeToLegacyStatus(code) : status;
  return STATUS_COLORS[legacyStatus] || "#cbd5e1";
}

function canModifyLog(log: DashboardLogEntry, role: StaffCorrectionRole): boolean {
  return canModifyLogReason(log, role) == null;
}

function canCorrectLogReason(log: DashboardLogEntry, role: StaffCorrectionRole, locale: Locale = "ja"): string | null {
  const baseReason = canModifyLogReason(log, role, locale);
  if (baseReason) return baseReason;
  if (!log.transitionPlan?.kind) {
    return getDashboardText("transitionPlanMissing", locale);
  }
  if (log.transitionPlan?.kind === "recovery") {
    return getDashboardText("recoveryCorrectionBlocked", locale);
  }
  if (log.transitionReviewStatus && log.transitionReviewStatus !== "not_required") {
    return getDashboardText("reviewCorrectionBlocked", locale);
  }
  return null;
}

function canModifyLogReason(log: DashboardLogEntry, role: StaffCorrectionRole, locale: Locale = "ja"): string | null {
  if (log.logKind !== "tank") return getDashboardText("notTankLog", locale);
  if (log.logStatus && log.logStatus !== "active") return getDashboardText("inactiveLog", locale);
  if (role === "管理者" || role === "準管理者") return null;
  const ms = timestampToMillis(log.revisionCreatedAt);
  if (ms == null) return getDashboardText("missingCreatedAt", locale);
  if (Date.now() - ms > LIMIT_MS) return getDashboardText("editExpired", locale);
  return null;
}

function getEditDisabledReason(
  editForm: EditForm | null,
  editingLog: DashboardLogEntry | null,
  savingEdit: boolean,
  locale: Locale = "ja",
): string | null {
  if (savingEdit) return getDashboardText("saveInProgress", locale);
  if (!editingLog || !editForm) return getDashboardText("editTargetMissing", locale);
  if (!editForm.tankId) return getDashboardText("selectTankId", locale);
  if (editForm.tankId === editingLog.tankId) {
    return getDashboardText("sameTankId", locale);
  }
  if (editForm.reason.trim().length < 5) return getDashboardText("reasonFiveChars", locale);
  return null;
}

function getVoidDisabledReason(voidReason: string, savingVoid: boolean, locale: Locale = "ja"): string | null {
  if (savingVoid) return getDashboardText("saveInProgress", locale);
  if (voidReason.trim().length < 5) return getDashboardText("voidReasonFiveChars", locale);
  return null;
}

function getBulkLocationUnavailableReason(
  selectedLogCount: number,
  bulkLocationMode: BulkLocationMode,
  customerOptionCount: number,
  bulkLocationOptionCount: number,
  locale: Locale = "ja",
): string | null {
  if (selectedLogCount === 0 || bulkLocationOptionCount > 0) return null;
  if (bulkLocationMode === "lend" && customerOptionCount === 0) {
    return getDashboardText("noCustomerOptions", locale);
  }
  if (bulkLocationMode === "inhouse") {
    return getDashboardText("inhouseDestinationMissing", locale);
  }
  return getDashboardText("incompatibleLocationSelection", locale);
}

function formatTime(value: unknown, locale: Locale = "ja"): string {
  const date = toDate(value);
  if (!date) return "-";
  return formatDashboardDateTime(date, locale);
}

function statusLabel(status?: DashboardLogEntry["logStatus"], locale: Locale = "ja"): string {
  if (status === "active") return getDashboardText("active", locale);
  if (status === "superseded") return getDashboardText("superseded", locale);
  if (status === "voided") return getDashboardText("voided", locale);
  return getDashboardText("unknown", locale);
}

function statusColor(status?: DashboardLogEntry["logStatus"]): string {
  if (status === "active") return "#16a34a";
  if (status === "superseded") return "#64748b";
  if (status === "voided") return "#dc2626";
  return "#94a3b8";
}

function actionBg(action?: string): string {
  return getDashboardActionBadgeTone(action).background;
}

function actionFg(action?: string): string {
  return getDashboardActionBadgeTone(action).color;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
