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
import { getLegacyTankActionLabel, getLegacyTankStatusLabel } from "@/lib/tank-action-status-labels";
import type { Locale } from "@/lib/locale";

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
  const { tanks, loading: tanksLoading, refetch: refetchTanks } = useTanks();
  const tankIds = useMemo(() => tanks.map((t) => t.id), [tanks]);

  const [logs, setLogs] = useState<DashboardLogEntry[]>([]);
  const [unfilledReports, setUnfilledReports] = useState<TransactionDoc[]>([]);
  const [customerOptions, setCustomerOptions] = useState<CustomerSnapshot[]>([]);
  const [logSortOrder, setLogSortOrder] = useState<DashboardLogSortOrder>("desc");
  const [dashboardLoading, setDashboardLoading] = useState(true);
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
    try {
      const source = await fetchStaffDashboardSourceData();
      setLogs(source.logs);
      setUnfilledReports(source.unfilledReports);
      setCustomerOptions(source.customerOptions);
    } catch (e) {
      console.error(e);
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
      alert("編集エラー: " + errorMessage(e));
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
      alert("取消エラー: " + errorMessage(e));
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
        alert("貸出先が選択されていません");
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
        alert(`貸出先変更は一部失敗しました。\n${failures.join("\n")}`);
        return;
      }
      alert(`${selectedLogs.length}件の貸出先を更新しました。`);
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
        alert(`一括取消は一部失敗しました。\n${failures.join("\n")}`);
        return;
      }
      alert(`${selectedLogs.length}件を取り消しました。`);
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
      alert("履歴取得エラー: " + errorMessage(e));
    } finally {
      setHistoryLoadingRoot(null);
    }
  };

  const editDisabledReason = getEditDisabledReason(editForm, editingLog, savingEdit);
  const voidDisabledReason = getVoidDisabledReason(voidReason, savingVoid);
  const bulkLocationUnavailableReason = getBulkLocationUnavailableReason(
    selectedLogIds.length,
    bulkLocationMode,
    customerOptions.length,
    bulkLocationOptions.length
  );

  const statusItems = loading
    ? []
    : Object.entries(summary)
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => ({
          key: status,
          label: getLegacyTankStatusLabel(status) ?? status,
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
        action: row.action,
        count: row.count,
      }));

  const reportRows = loading
    ? []
    : recentUnfilledReports.map((report) => ({
        id: report.id,
        tankId: report.tankId || "-",
        customerName: report.customerName || "顧客未設定",
        customerTitle: report.customerName || "",
        statusLabel: formatReportStatus(report.status),
        timeLabel: formatTime(report.createdAt),
        sourceLabel: formatReportSource(report.source),
      }));

  const logRows = loading
    ? []
    : sortedLogs.map((log) => {
        const rootId = log.rootLogId ?? log.id;

        const modifyDisabledReason =
          canModifyLogReason(log, correctionRole);

        const correctionDisabledReason =
          canCorrectLogReason(log, correctionRole);

        const history =
          historyByRoot[rootId] ?? [];

        return {
          id: log.id,
          tankId: log.tankId,
          actionLabel:
            formatActionLabel(log.action, staffLocale),
          actionBackground: actionBg(log.action),
          actionForeground: actionFg(log.action),
          locationLabel: log.location || "-",
          staffLabel: log.staffName || "-",
          timeLabel:
            formatTime(log.originalAt ?? log.timestamp),
          isTankLog: log.logKind === "tank",
          logKindLabel: log.logKind || "-",
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
              statusLabel(rev.logStatus),
            statusColor:
              statusColor(rev.logStatus),
            actionLabel:
              formatActionLabel(
                rev.action,
                staffLocale,
              ),
            timeLabel:
              formatTime(
                rev.revisionCreatedAt,
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
          formatActionLabel(
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
                label: option.location,
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
      overlays={
        <DashboardCorrectionModals
          idCorrection={idCorrectionModal}
          singleVoid={singleVoidModal}
          bulkLocation={bulkLocationModal}
          bulkVoid={bulkVoidModal}
        />
      }
    >
      <DashboardStatusSummary
        totalTanks={totalTanks}
        items={statusItems}
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

function formatActionLabel(action: string | null | undefined, locale: Locale): string {
  return getLegacyTankActionLabel(action, locale) ?? action ?? "不明";
}

function tankStatusColor(status: string): string {
  const code = coerceTankStatusCode(status);
  const legacyStatus = code ? tankStatusCodeToLegacyStatus(code) : status;
  return STATUS_COLORS[legacyStatus] || "#cbd5e1";
}

function canModifyLog(log: DashboardLogEntry, role: StaffCorrectionRole): boolean {
  return canModifyLogReason(log, role) == null;
}

function canCorrectLogReason(log: DashboardLogEntry, role: StaffCorrectionRole): string | null {
  const baseReason = canModifyLogReason(log, role);
  if (baseReason) return baseReason;
  if (!log.transitionPlan?.kind) {
    return "transitionPlanを確認できないログは訂正できません";
  }
  if (log.transitionPlan?.kind === "recovery") {
    return "自動補完ログは取消後に正しい操作を再実行してください";
  }
  if (log.transitionReviewStatus && log.transitionReviewStatus !== "not_required") {
    return "集計レビュー対象のログは直接訂正できません";
  }
  return null;
}

function canModifyLogReason(log: DashboardLogEntry, role: StaffCorrectionRole): string | null {
  if (log.logKind !== "tank") return "タンク操作ログではありません";
  if (log.logStatus && log.logStatus !== "active") return "有効なログではありません";
  if (role === "管理者" || role === "準管理者") return null;
  const ms = timestampToMillis(log.revisionCreatedAt);
  if (ms == null) return "作成日時が取得できず期限判定できません";
  if (Date.now() - ms > LIMIT_MS) return "一般スタッフの編集可能期限を超過しています";
  return null;
}

function getEditDisabledReason(
  editForm: EditForm | null,
  editingLog: DashboardLogEntry | null,
  savingEdit: boolean
): string | null {
  if (savingEdit) return "保存中です";
  if (!editingLog || !editForm) return "編集対象を確認できません";
  if (!editForm.tankId) return "タンクIDを選択してください";
  if (editForm.tankId === editingLog.tankId) {
    return "変更前と同じタンクIDです。別のタンクIDを選択してください";
  }
  if (editForm.reason.trim().length < 5) return "理由を5文字以上入力してください";
  return null;
}

function getVoidDisabledReason(voidReason: string, savingVoid: boolean): string | null {
  if (savingVoid) return "保存中です";
  if (voidReason.trim().length < 5) return "取消理由を5文字以上入力してください";
  return null;
}

function getBulkLocationUnavailableReason(
  selectedLogCount: number,
  bulkLocationMode: BulkLocationMode,
  customerOptionCount: number,
  bulkLocationOptionCount: number
): string | null {
  if (selectedLogCount === 0 || bulkLocationOptionCount > 0) return null;
  if (bulkLocationMode === "lend" && customerOptionCount === 0) {
    return "有効な貸出先候補がありません。顧客マスタに有効な貸出先があるか確認してください。";
  }
  if (bulkLocationMode === "inhouse") {
    return "自社利用の変更先を確認できません。選択を解除して再度選び直してください。";
  }
  return "貸出先変更は貸出ログだけ、または自社利用ログだけを選択した場合に使えます。返却・充填・混在選択では使えません。";
}

function timestampToMillis(value: unknown): number | null {
  const date = toDate(value);
  return date ? date.getTime() : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return new Date((value as { toMillis: () => number }).toMillis());
  }
  if (typeof value === "string") {
    const date = new Date(value.replace(/-/g, "/"));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function formatTime(value: unknown): string {
  const date = toDate(value);
  if (!date) return "-";
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatReportSource(source?: string): string {
  if (source === "customer_portal") return "顧客ポータル";
  if (source === "customer_app") return "顧客アプリ";
  if (!source) return "source未設定";
  return source;
}

function formatReportStatus(status?: string): string {
  if (status === "completed") return "記録済み";
  if (!status) return "status未設定";
  return status;
}

function statusLabel(status?: DashboardLogEntry["logStatus"]): string {
  if (status === "active") return "有効";
  if (status === "superseded") return "置換済";
  if (status === "voided") return "取消済";
  return "不明";
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
