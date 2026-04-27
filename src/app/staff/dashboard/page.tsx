"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Edit2,
  Factory,
  Flame,
  Inbox,
  Loader2,
  PackageCheck,
  PackageX,
  ShieldAlert,
  ShieldCheck,
  Square,
  Timer,
  Truck,
  Undo2,
  Users,
  X,
} from "lucide-react";
import {
  collection,
  getDocs,
} from "firebase/firestore";
import {
  logsRepository,
  transactionsRepository,
} from "@/lib/firebase/repositories";
import PrefixNumberPicker from "@/components/PrefixNumberPicker";
import { getStaffName, useStaffSession } from "@/hooks/useStaffSession";
import { useInspectionSettings } from "@/hooks/useInspectionSettings";
import { useTanks } from "@/hooks/useTanks";
import {
  applyLogCorrection,
  voidLog,
  type LogCorrectionPatch,
  type StaffCorrectionRole,
  type TankSnapshot,
} from "@/lib/tank-operation";
import { db } from "@/lib/firebase/config";
import {
  ACTION,
  STATUS,
  STATUS_COLORS,
  type TankAction,
} from "@/lib/tank-rules";

interface TankSummary {
  [status: string]: number;
}

type DateValue = Date | number | string | { toDate: () => Date } | { toMillis: () => number } | null;
type LogStatus = "active" | "superseded" | "voided";

interface LogEntry {
  id: string;
  tankId: string;
  action: string;
  transitionAction?: string;
  staff?: string;
  location?: string;
  timestamp?: DateValue;
  originalAt?: DateValue;
  revisionCreatedAt?: DateValue;
  note?: string;
  logNote?: string;
  logStatus?: LogStatus;
  logKind?: string;
  rootLogId?: string;
  revision?: number;
  editedBy?: string;
  editReason?: string;
  voidedBy?: string;
  voidReason?: string;
  voidedAt?: DateValue;
  prevTankSnapshot?: TankSnapshot;
  nextTankSnapshot?: TankSnapshot;
}

interface EditForm {
  tankId: string | null;
  reason: string;
}
const LIMIT_MS = 72 * 60 * 60 * 1000;
const ACTION_OPTIONS = Object.values(ACTION) as TankAction[];

export default function StaffDashboard() {
  const session = useStaffSession();
  const correctionRole = useMemo(
    () => normalizeCorrectionRole(session?.role),
    [session?.role]
  );
  const { tanks, loading: tanksLoading, refetch: refetchTanks } = useTanks();
  const { settings: inspectionSettings, loading: settingsLoading } = useInspectionSettings();
  const tankIds = useMemo(() => tanks.map((t) => t.id), [tanks]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [customerDestinations, setCustomerDestinations] = useState<string[]>([]);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);

  const [editingLog, setEditingLog] = useState<LogEntry | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [voidingLog, setVoidingLog] = useState<LogEntry | null>(null);
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
  const [historyByRoot, setHistoryByRoot] = useState<Record<string, LogEntry[]>>({});
  const [historyLoadingRoot, setHistoryLoadingRoot] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const [logs, ordersByStatus, returns, customerSnap] = await Promise.all([
        // orderBy: null は Firestore 側で timestamp desc を付けない指定。
        // dashboard はクライアントで originalAt ?? timestamp で再ソートするため、
        // timestamp フィールドを持たない revision ログ等の取りこぼしを防ぐ。
        logsRepository.getActiveLogs({ orderBy: null }),
        Promise.all(
          (["pending", "pending_approval", "pending_link"] as const).map((status) =>
            transactionsRepository.getOrders({ status })
          )
        ),
        transactionsRepository.getReturns({ status: "pending_approval" }),
        getDocs(collection(db, "customers")),
      ]);

      const entries = logs as unknown as LogEntry[];
      entries.sort((a, b) => {
        const aTime = timestampToMillis(a.originalAt ?? a.timestamp) ?? 0;
        const bTime = timestampToMillis(b.originalAt ?? b.timestamp) ?? 0;
        return bTime - aTime;
      });
      setLogs(entries.slice(0, 50));

      const destinationSet = new Set<string>(["倉庫", "自社"]);
      customerSnap.forEach((d) => {
        const data = d.data();
        if (data.isActive === false) return;
        const name = String(data.name || data.companyName || "").trim();
        if (name) destinationSet.add(name);
      });
      entries.forEach((entry) => {
        const location = String(entry.location || "").trim();
        if (location) destinationSet.add(location);
      });
      setCustomerDestinations(Array.from(destinationSet).sort((a, b) => a.localeCompare(b)));

      setPendingOrders(ordersByStatus.flat().length);
      setPendingReturns(returns.length);
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

  const summary = useMemo<TankSummary>(() => {
    const counts: TankSummary = {};
    tanks.forEach((tank) => {
      const status = tank.status || "不明";
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [tanks]);

  const totalTanks = tanks.length;
  const damagedCount = (summary[STATUS.DAMAGED] ?? 0) + (summary[STATUS.DEFECTIVE] ?? 0);
  const filledCount = summary[STATUS.FILLED] ?? 0;
  const emptyCount = summary[STATUS.EMPTY] ?? 0;
  const lentCount = (summary[STATUS.LENT] ?? 0) + (summary[STATUS.UNRETURNED] ?? 0);
  const inHouseCount = summary[STATUS.IN_HOUSE] ?? 0;
  const disposedCount = summary[STATUS.DISPOSED] ?? 0;
  const unreturnedCount = summary[STATUS.UNRETURNED] ?? 0;

  const { expiredCount, nearExpiryCount } = useMemo(() => {
    const now = new Date();
    const alertDate = new Date();
    alertDate.setMonth(alertDate.getMonth() + inspectionSettings.alertMonths);
    let expired = 0;
    let near = 0;

    tanks.forEach((tank) => {
      if (tank.status === STATUS.DISPOSED) return;
      const date = toDate(tank.nextMaintenanceDate);
      if (!date) return;
      if (date.getTime() < now.getTime()) expired += 1;
      else if (date.getTime() <= alertDate.getTime()) near += 1;
    });

    return { expiredCount: expired, nearExpiryCount: near };
  }, [inspectionSettings.alertMonths, tanks]);

  const byLocation = useMemo(() => {
    const map: Record<string, { lent: number; unreturned: number }> = {};
    tanks.forEach((tank) => {
      if (tank.status !== STATUS.LENT && tank.status !== STATUS.UNRETURNED) return;
      const location = (tank.location || "未設定").trim() || "未設定";
      if (!map[location]) map[location] = { lent: 0, unreturned: 0 };
      if (tank.status === STATUS.LENT) map[location].lent += 1;
      else map[location].unreturned += 1;
    });

    return Object.entries(map)
      .map(([location, value]) => ({
        location,
        ...value,
        total: value.lent + value.unreturned,
      }))
      .sort((a, b) => b.total - a.total || a.location.localeCompare(b.location));
  }, [tanks]);

  const todayStats = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const byAction: Record<string, number> = {};
    let total = 0;

    logs.forEach((log) => {
      const ms = timestampToMillis(log.originalAt ?? log.timestamp);
      if (ms == null || ms < startOfDay) return;
      total += 1;
      const key = log.action || "不明";
      byAction[key] = (byAction[key] || 0) + 1;
    });

    const breakdown = Object.entries(byAction)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action));
    return { total, breakdown };
  }, [logs]);

  const loading = dashboardLoading || tanksLoading || settingsLoading;

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
    const actions = selectedLogs.map((log) => toTankAction(log.transitionAction ?? log.action));
    if (actions.some((action) => action == null)) return null;
    if (actions.every((action) => action === ACTION.LEND)) return "lend";
    if (actions.every((action) => action === ACTION.IN_HOUSE_USE || action === ACTION.IN_HOUSE_USE_RETRO)) {
      return "inhouse";
    }
    return null;
  }, [selectedLogs]);

  const bulkLocationOptions = useMemo(() => {
    if (bulkLocationMode === "lend") {
      return customerDestinations.filter((location) => location !== "倉庫" && location !== "自社");
    }
    if (bulkLocationMode === "inhouse") {
      return ["自社"];
    }
    return [];
  }, [bulkLocationMode, customerDestinations]);

  const openEdit = (log: LogEntry) => {
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
      const patch: LogCorrectionPatch = {
        tankId: editForm.tankId,
      };
      await applyLogCorrection({
        targetLogId: editingLog.id,
        mode: "replace",
        patch,
        reason: editForm.reason,
        editedBy: getStaffName(),
        editedByRole: correctionRole,
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
      await voidLog({
        logId: voidingLog.id,
        voidedBy: getStaffName(),
        voidedByRole: correctionRole,
        reason: voidReason,
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
      if (prev && bulkLocationOptions.includes(prev)) return prev;
      return bulkLocationOptions[0] ?? "";
    });
    setBulkLocationReason("");
    setBulkLocationModalOpen(true);
  };

  const handleBulkLocationChange = async () => {
    if (!bulkLocationValue || bulkLocationReason.trim().length < 5 || selectedLogs.length === 0) return;

    setSavingBulkLocation(true);
    try {
      const failures: string[] = [];
      for (const log of selectedLogs) {
        try {
          await applyLogCorrection({
            targetLogId: log.id,
            mode: "replace",
            patch: { location: bulkLocationValue },
            reason: bulkLocationReason,
            editedBy: getStaffName(),
            editedByRole: correctionRole,
          });
        } catch (e: unknown) {
          failures.push(`${log.tankId}: ${errorMessage(e)}`);
        }
      }

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
      const failures: string[] = [];
      for (const log of selectedLogs) {
        try {
          await voidLog({
            logId: log.id,
            voidedBy: getStaffName(),
            voidedByRole: correctionRole,
            reason: bulkVoidReason,
          });
        } catch (e: unknown) {
          failures.push(`${log.tankId}: ${errorMessage(e)}`);
        }
      }

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

  const toggleHistory = async (log: LogEntry) => {
    const rootId = log.rootLogId ?? log.id;
    if (expandedRootId === rootId) {
      setExpandedRootId(null);
      return;
    }
    setExpandedRootId(rootId);
    if (historyByRoot[rootId]) return;

    setHistoryLoadingRoot(rootId);
    try {
      const entries = (await logsRepository.getLogsByRoot(rootId)) as unknown as LogEntry[];
      entries.sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0));
      setHistoryByRoot((prev) => ({ ...prev, [rootId]: entries }));
    } catch (e: unknown) {
      alert("履歴取得エラー: " + errorMessage(e));
    } finally {
      setHistoryLoadingRoot(null);
    }
  };

  return (
    <div style={{ minHeight: "100%", background: "#f8fafc", padding: "14px 14px 32px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 14,
            padding: "0 4px",
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
              ダッシュボード
            </h1>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              今すぐ対応が必要な業務 / 稼働状況 / 操作ログ
            </p>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, whiteSpace: "nowrap" }}>
            {session?.name ? `${session.name} さん` : ""}
          </div>
        </div>

        {loading ? (
          <div
            style={{
              textAlign: "center",
              padding: 60,
              color: "#94a3b8",
              fontSize: 14,
              background: "#fff",
              borderRadius: 16,
              border: "1px solid #e8eaed",
            }}
          >
            <Loader2 size={22} style={{ animation: "spin 1s linear infinite", verticalAlign: "middle", marginRight: 8 }} />
            読み込み中...
          </div>
        ) : (
          <>
            <SectionLabel icon={<AlertTriangle size={14} />} title="今すぐ対応" tone="alert" />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 10,
                marginBottom: 22,
              }}
            >
              <AlertCard
                icon={<Inbox size={18} />}
                label="未処理受注"
                value={pendingOrders}
                tone={pendingOrders > 0 ? "red" : "neutral"}
                href="/staff/lend"
              />
              <AlertCard
                icon={<PackageCheck size={18} />}
                label="返却承認待ち"
                value={pendingReturns}
                tone={pendingReturns > 0 ? "orange" : "neutral"}
                href="/staff/return"
              />
              <AlertCard
                icon={<ShieldAlert size={18} />}
                label="破損 / 不良"
                value={damagedCount}
                tone={damagedCount > 0 ? "red" : "neutral"}
                href="/staff/repair"
                subValue={
                  damagedCount > 0
                    ? `破損 ${summary[STATUS.DAMAGED] ?? 0} / 不良 ${summary[STATUS.DEFECTIVE] ?? 0}`
                    : undefined
                }
              />
              <AlertCard
                icon={<Timer size={18} />}
                label="耐圧期限切れ"
                value={expiredCount}
                tone={expiredCount > 0 ? "red" : "neutral"}
                href="/staff/inspection"
              />
              <AlertCard
                icon={<ShieldCheck size={18} />}
                label="耐圧期限間近"
                value={nearExpiryCount}
                tone={nearExpiryCount > 0 ? "amber" : "neutral"}
                href="/staff/inspection"
                subValue={`${inspectionSettings.alertMonths}ヶ月以内`}
              />
            </div>

            <SectionLabel icon={<Factory size={14} />} title="タンク稼働状況" />
            <div
              style={{
                background: "#fff",
                border: "1px solid #e8eaed",
                borderRadius: 14,
                padding: "14px 16px",
                marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>総本数</span>
                <span
                  style={{
                    fontSize: 26,
                    fontWeight: 900,
                    color: "#0f172a",
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  }}
                >
                  {totalTanks}
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginLeft: 4 }}>本</span>
                </span>
              </div>
              <StatusStackBar summary={summary} total={totalTanks} />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <StatCard icon={<Flame size={18} />} label="貸出可能" sublabel="充填済み" value={filledCount} color={STATUS_COLORS[STATUS.FILLED]} />
              <StatCard icon={<PackageX size={18} />} label="充填待ち" sublabel="空" value={emptyCount} color={STATUS_COLORS[STATUS.EMPTY]} />
              <StatCard
                icon={<Truck size={18} />}
                label="貸出中"
                sublabel={unreturnedCount > 0 ? `未返却 ${unreturnedCount} 含む` : "貸出中 + 未返却"}
                value={lentCount}
                color={STATUS_COLORS[STATUS.LENT]}
                accent={unreturnedCount > 0 ? STATUS_COLORS[STATUS.UNRETURNED] : undefined}
              />
              <StatCard icon={<Building2 size={18} />} label="自社利用中" value={inHouseCount} color={STATUS_COLORS[STATUS.IN_HOUSE]} />
              <StatCard icon={<X size={18} />} label="破棄" value={disposedCount} color={STATUS_COLORS[STATUS.DISPOSED]} muted />
            </div>

            <div
              style={{
                background: "#fff",
                border: "1px solid #e8eaed",
                borderRadius: 14,
                padding: "14px 16px",
                marginBottom: 22,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", marginBottom: 10, letterSpacing: "0.04em" }}>
                ステータス別内訳
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(summary)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => (
                    <div
                      key={status}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 12px",
                        borderRadius: 8,
                        background: "#f8fafc",
                        border: "1px solid #eef2f7",
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[status] || "#cbd5e1" }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>{status}</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                        {count}
                      </span>
                    </div>
                  ))}
                {totalTanks === 0 && <span style={{ fontSize: 12, color: "#cbd5e1", padding: 4 }}>タンクが未登録です</span>}
              </div>
            </div>

            <SectionLabel icon={<ClipboardList size={14} />} title="業務状況" />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 10,
                marginBottom: 22,
              }}
            >
              <DashboardPanel
                icon={<Users size={14} color="#3b82f6" />}
                title="貸出先別"
                badge={`${byLocation.length}件`}
                emptyText="貸出中のタンクはありません"
                isEmpty={byLocation.length === 0}
              >
                {byLocation.map((row) => (
                  <div
                    key={row.location}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "#f8fafc",
                      border: "1px solid #eef2f7",
                    }}
                  >
                    <span
                      title={row.location}
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#0f172a",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.location}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#3b82f6", background: "#eff6ff", padding: "2px 8px", borderRadius: 6 }}>
                      貸出 {row.lent}
                    </span>
                    {row.unreturned > 0 ? (
                      <span style={{ fontSize: 11, fontWeight: 800, color: "#a78bfa", background: "#f5f3ff", padding: "2px 8px", borderRadius: 6 }}>
                        未返却 {row.unreturned}
                      </span>
                    ) : (
                      <span style={{ width: 60 }} />
                    )}
                  </div>
                ))}
              </DashboardPanel>

              <DashboardPanel
                icon={<Clock size={14} color="#0ea5e9" />}
                title="今日の操作"
                badge={`${todayStats.total}件`}
                emptyText="本日の操作はまだありません"
                isEmpty={todayStats.breakdown.length === 0}
              >
                {todayStats.breakdown.map((row) => (
                  <div
                    key={row.action}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "#f8fafc",
                      border: "1px solid #eef2f7",
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>{row.action}</span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: "#0f172a",
                        fontFamily: "ui-monospace, SFMono-Regular, monospace",
                        minWidth: 28,
                        textAlign: "right",
                      }}
                    >
                      {row.count}
                    </span>
                  </div>
                ))}
              </DashboardPanel>
            </div>

            <SectionLabel icon={<Clock size={14} />} title="最近の操作ログ" />
            <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.04em", flex: 1 }}>
                  直近 {logs.length} 件（active）
                </span>
                <button
                  type="button"
                  onClick={toggleEditMode}
                  style={{
                    border: "1px solid #dbeafe",
                    background: isEditMode ? "#eff6ff" : "#fff",
                    color: "#2563eb",
                    borderRadius: 8,
                    padding: "7px 11px",
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    whiteSpace: "nowrap",
                  }}
                >
                  {isEditMode ? <CheckSquare size={13} /> : <Edit2 size={13} />}
                  {isEditMode ? "完了" : "編集"}
                </button>
              </div>

              {isEditMode && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    alignItems: "center",
                    marginBottom: 12,
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#334155", marginRight: 4 }}>
                    選択 {selectedLogIds.length} 件
                  </span>
                  <button type="button" onClick={selectAllLogs} style={miniActionButtonStyle()}>
                    全選択
                  </button>
                  <button type="button" onClick={clearSelectedLogs} style={miniActionButtonStyle()}>
                    選択解除
                  </button>
                  <button
                    type="button"
                    onClick={openBulkLocationModal}
                    disabled={selectedLogIds.length === 0 || bulkLocationOptions.length === 0}
                    style={miniActionButtonStyle(selectedLogIds.length === 0 || bulkLocationOptions.length === 0)}
                  >
                    貸出先変更
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkVoidReason("");
                      setBulkVoidModalOpen(true);
                    }}
                    disabled={selectedLogIds.length === 0}
                    style={dangerMiniButtonStyle(selectedLogIds.length === 0)}
                  >
                    一括取消
                  </button>
                  {selectedLogIds.length > 0 && bulkLocationOptions.length === 0 && (
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>
                      貸出先変更は貸出ログまたは自社利用ログだけ選択してください
                    </span>
                  )}
                </div>
              )}

              {logs.length === 0 ? (
                <p style={{ fontSize: 13, color: "#cbd5e1", textAlign: "center", padding: 20 }}>ログがありません</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {logs.map((log) => {
                    const rootId = log.rootLogId ?? log.id;
                    const isExpanded = expandedRootId === rootId;
                    const canModify = canModifyLog(log, correctionRole);
                    const isTankLog = log.logKind === "tank";
                    const history = historyByRoot[rootId] ?? [];
                    const historyLoading = historyLoadingRoot === rootId;

                    return (
                      <div key={log.id} style={{ border: "1px solid #eef2f7", borderRadius: 10, background: "#f8fafc", overflow: "hidden" }}>
                        <div className={`dashboard-log-row${isEditMode ? " dashboard-log-row--editing" : ""}`}>
                          {isEditMode ? (
                            <button
                              type="button"
                              onClick={() => toggleLogSelection(log.id)}
                              disabled={!canModify}
                              title={canModify ? "選択" : "期限外または対象外"}
                              className="dashboard-log-checkbox"
                              style={{
                                border: "none",
                                background: "transparent",
                                color: canModify
                                  ? (selectedLogIds.includes(log.id) ? "#2563eb" : "#94a3b8")
                                  : "#cbd5e1",
                                padding: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: canModify ? "pointer" : "not-allowed",
                              }}
                            >
                              {selectedLogIds.includes(log.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                            </button>
                          ) : null}
                          <span
                            className="dashboard-log-id"
                            style={{
                              fontFamily: "ui-monospace, SFMono-Regular, monospace",
                              fontSize: 13,
                              fontWeight: 800,
                              color: "#0f172a",
                              minWidth: 54,
                            }}
                          >
                            {log.tankId}
                          </span>
                          <span
                            className="dashboard-log-action"
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              padding: "3px 8px",
                              borderRadius: 6,
                              background: actionBg(log.action),
                              color: actionFg(log.action),
                              whiteSpace: "nowrap",
                            }}
                          >
                            {log.action}
                          </span>
                          <div className="dashboard-log-body" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                            <span
                              style={{
                                fontSize: 12,
                                color: "#334155",
                                fontWeight: 600,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {log.location || "-"}
                            </span>
                            <span style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {log.staff || "-"}
                            </span>
                          </div>
                          <span
                            className="dashboard-log-time"
                            style={{
                              fontSize: 11,
                              color: "#94a3b8",
                              fontFamily: "ui-monospace, SFMono-Regular, monospace",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatTime(log.originalAt ?? log.timestamp)}
                          </span>
                          {isTankLog && isEditMode ? (
                            <div className="dashboard-log-actions" style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                              <IconTextButton label="ID変更" icon={<Edit2 size={13} />} disabled={!canModify} onClick={() => openEdit(log)} />
                              <IconTextButton
                                label="取消"
                                icon={<Undo2 size={13} />}
                                disabled={!canModify}
                                onClick={() => {
                                  setVoidingLog(log);
                                  setVoidReason("");
                                }}
                              />
                              <IconTextButton
                                label="履歴"
                                icon={isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                onClick={() => toggleHistory(log)}
                              />
                            </div>
                          ) : !isTankLog ? (
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", padding: "2px 6px", borderRadius: 4, background: "#fff", border: "1px solid #e2e8f0" }}>
                              {log.logKind || "-"}
                            </span>
                          ) : null}
                        </div>

                        {isEditMode && isExpanded && (
                          <div style={{ borderTop: "1px solid #e2e8f0", background: "#fff", padding: 12 }}>
                            {historyLoading ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 12 }}>
                                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> 履歴を読み込み中...
                              </div>
                            ) : history.length === 0 ? (
                              <p style={{ color: "#cbd5e1", fontSize: 12, margin: 0 }}>履歴がありません</p>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {history.map((rev) => {
                                  return (
                                    <div
                                      key={rev.id}
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "52px 1fr",
                                        gap: 10,
                                        alignItems: "center",
                                        padding: 10,
                                        borderRadius: 8,
                                        border: "1px solid #f1f5f9",
                                        background: "#fafafa",
                                      }}
                                    >
                                      <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>v{rev.revision ?? "-"}</div>
                                      <div style={{ minWidth: 0 }}>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                          <span style={{ fontSize: 12, fontWeight: 800, color: statusColor(rev.logStatus) }}>{statusLabel(rev.logStatus)}</span>
                                          <span style={{ fontSize: 12, color: "#64748b" }}>{rev.action}</span>
                                          <span style={{ fontSize: 12, color: "#94a3b8" }}>{formatTime(rev.revisionCreatedAt)}</span>
                                        </div>
                                        {(rev.editedBy || rev.editReason) && (
                                          <div style={{ marginTop: 4, fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {rev.editedBy || "-"} / {rev.editReason || "-"}
                                          </div>
                                        )}
                                        {rev.logStatus === "voided" && (
                                          <div style={{ marginTop: 4, fontSize: 11, color: "#dc2626", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {rev.voidedBy || "-"} / {rev.voidReason || "-"}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {editingLog && editForm && (
        <Modal onClose={() => !savingEdit && setEditingLog(null)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>タンクID変更</h2>
            <button type="button" onClick={() => setEditingLog(null)} style={iconButtonStyle} disabled={savingEdit}>
              <X size={20} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FieldLabel label="タンクID" />
            <PrefixNumberPicker
              tankIds={tankIds}
              value={editForm.tankId}
              onChange={(tankId) => setEditForm((prev) => (prev ? { ...prev, tankId } : prev))}
              accentColor="#2563eb"
            />
            <div style={{ padding: "9px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
              タンクIDだけを変更します。操作種別・貸出先・メモなどは変更しません。
            </div>

            <label style={labelStyle}>
              編集理由
              <textarea
                value={editForm.reason}
                onChange={(e) => setEditForm((prev) => (prev ? { ...prev, reason: e.target.value } : prev))}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", minHeight: 78 }}
              />
            </label>

            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={savingEdit || !editForm.tankId || editForm.tankId === editingLog.tankId || editForm.reason.trim().length < 5}
              style={primaryButtonStyle(savingEdit || !editForm.tankId || editForm.tankId === editingLog.tankId || editForm.reason.trim().length < 5)}
            >
              {savingEdit ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={18} />}
              {savingEdit ? "保存中..." : "ID変更"}
            </button>
          </div>
        </Modal>
      )}

      {voidingLog && (
        <Modal onClose={() => !savingVoid && setVoidingLog(null)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>ログ取消</h2>
            <button type="button" onClick={() => setVoidingLog(null)} style={iconButtonStyle} disabled={savingVoid}>
              <X size={20} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: 12, borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 900, color: "#0f172a" }}>{voidingLog.tankId}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#334155" }}>{voidingLog.action}</span>
            </div>
            <label style={labelStyle}>
              取消理由
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
              />
            </label>
            <button
              type="button"
              onClick={handleVoid}
              disabled={savingVoid || voidReason.trim().length < 5}
              style={dangerButtonStyle(savingVoid || voidReason.trim().length < 5)}
            >
              {savingVoid ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Undo2 size={18} />}
              {savingVoid ? "取消中..." : "取消"}
            </button>
          </div>
        </Modal>
      )}

      {bulkLocationModalOpen && (
        <Modal onClose={() => !savingBulkLocation && setBulkLocationModalOpen(false)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>貸出先変更</h2>
            <button type="button" onClick={() => setBulkLocationModalOpen(false)} style={iconButtonStyle} disabled={savingBulkLocation}>
              <X size={20} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
              選択中 {selectedLogs.length} 件の貸出先をまとめて変更します。
            </div>
            <label style={labelStyle}>
              貸出先
              <select
                value={bulkLocationValue}
                onChange={(e) => setBulkLocationValue(e.target.value)}
                style={inputStyle}
              >
                {bulkLocationOptions.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              変更理由
              <textarea
                value={bulkLocationReason}
                onChange={(e) => setBulkLocationReason(e.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
              />
            </label>
            <button
              type="button"
              onClick={handleBulkLocationChange}
              disabled={savingBulkLocation || !bulkLocationValue || bulkLocationReason.trim().length < 5}
              style={primaryButtonStyle(savingBulkLocation || !bulkLocationValue || bulkLocationReason.trim().length < 5)}
            >
              {savingBulkLocation ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Building2 size={18} />}
              {savingBulkLocation ? "更新中..." : "貸出先変更"}
            </button>
          </div>
        </Modal>
      )}

      {bulkVoidModalOpen && (
        <Modal onClose={() => !savingBulkVoid && setBulkVoidModalOpen(false)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>一括取消</h2>
            <button type="button" onClick={() => setBulkVoidModalOpen(false)} style={iconButtonStyle} disabled={savingBulkVoid}>
              <X size={20} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12, color: "#991b1b", lineHeight: 1.6 }}>
              選択中 {selectedLogs.length} 件のログを取り消します。
            </div>
            <label style={labelStyle}>
              取消理由
              <textarea
                value={bulkVoidReason}
                onChange={(e) => setBulkVoidReason(e.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
              />
            </label>
            <button
              type="button"
              onClick={handleBulkVoid}
              disabled={savingBulkVoid || bulkVoidReason.trim().length < 5}
              style={dangerButtonStyle(savingBulkVoid || bulkVoidReason.trim().length < 5)}
            >
              {savingBulkVoid ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Undo2 size={18} />}
              {savingBulkVoid ? "取消中..." : "一括取消"}
            </button>
          </div>
        </Modal>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .dashboard-log-row {
          display: grid;
          grid-template-columns: auto auto 1fr auto;
          gap: 8px;
          align-items: center;
          padding: 9px 10px;
        }

        .dashboard-log-row--editing {
          grid-template-columns: 20px auto auto 1fr auto auto;
        }

        @media (max-width: 720px) {
          .dashboard-log-row {
            grid-template-columns: auto auto 1fr;
          }
          .dashboard-log-row--editing {
            grid-template-columns: 20px auto auto 1fr;
          }
          .dashboard-log-time,
          .dashboard-log-actions {
            grid-column: 1 / -1;
          }
          .dashboard-log-row--editing .dashboard-log-time,
          .dashboard-log-row--editing .dashboard-log-actions {
            grid-column: 2 / -1;
          }
          .dashboard-log-actions {
            justify-content: flex-start !important;
          }
        }
      `}</style>
    </div>
  );
}

function SectionLabel({
  icon,
  title,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  tone?: "alert";
}) {
  const color = tone === "alert" ? "#dc2626" : "#475569";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 4px 10px" }}>
      <span style={{ color, display: "flex" }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 800, color, letterSpacing: "0.06em" }}>{title}</span>
      <div style={{ flex: 1, height: 1, background: "#e2e8f0", marginLeft: 4 }} />
    </div>
  );
}

function AlertCard({
  icon,
  label,
  value,
  tone,
  href,
  subValue,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "red" | "orange" | "amber" | "neutral";
  href: string;
  subValue?: string;
}) {
  const palette = {
    red: {
      bg: "#fef2f2",
      border: "#fecaca",
      iconBg: "#fee2e2",
      iconFg: "#dc2626",
      valueFg: "#991b1b",
    },
    orange: {
      bg: "#fff7ed",
      border: "#fed7aa",
      iconBg: "#ffedd5",
      iconFg: "#ea580c",
      valueFg: "#9a3412",
    },
    amber: {
      bg: "#fffbeb",
      border: "#fde68a",
      iconBg: "#fef3c7",
      iconFg: "#d97706",
      valueFg: "#92400e",
    },
    neutral: {
      bg: "#fff",
      border: "#e8eaed",
      iconBg: "#f1f5f9",
      iconFg: "#94a3b8",
      valueFg: "#334155",
    },
  }[tone];

  return (
    <Link href={href} style={{ textDecoration: "none", display: "block", height: "100%" }}>
      <div
        style={{
          position: "relative",
          padding: "14px 14px 12px",
          borderRadius: 14,
          background: palette.bg,
          border: `1px solid ${palette.border}`,
          cursor: "pointer",
          height: "100%",
          boxSizing: "border-box",
          transition: "transform 0.15s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: palette.iconBg,
              color: palette.iconFg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: "#334155", lineHeight: 1.2 }}>{label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
          <span
            style={{
              fontSize: 28,
              fontWeight: 900,
              color: palette.valueFg,
              lineHeight: 1,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          >
            {value}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>件</span>
        </div>
        {subValue && <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: "#64748b" }}>{subValue}</div>}
      </div>
    </Link>
  );
}

function StatCard({
  icon,
  label,
  sublabel,
  value,
  color,
  accent,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  value: number;
  color: string;
  accent?: string;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        padding: "12px 14px",
        borderRadius: 12,
        background: "#fff",
        border: "1px solid #e8eaed",
        opacity: muted ? 0.75 : 1,
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ color, display: "flex" }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#334155" }}>{label}</span>
        {accent && <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent }} />}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 900,
            color: "#0f172a",
            lineHeight: 1,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
          }}
        >
          {value}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>本</span>
      </div>
      {sublabel && (
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            fontWeight: 700,
            color: "#94a3b8",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}

function DashboardPanel({
  icon,
  title,
  badge,
  emptyText,
  isEmpty,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge: string;
  emptyText: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {icon}
        <span style={{ fontSize: 12, fontWeight: 800, color: "#334155", flex: 1 }}>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>{badge}</span>
      </div>
      {isEmpty ? (
        <div style={{ fontSize: 12, color: "#cbd5e1", padding: "18px 0", textAlign: "center" }}>{emptyText}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>{children}</div>
      )}
    </div>
  );
}

function StatusStackBar({ summary, total }: { summary: TankSummary; total: number }) {
  if (total === 0) {
    return <div style={{ height: 10, borderRadius: 6, background: "#f1f5f9" }} />;
  }

  const order = [
    STATUS.FILLED,
    STATUS.EMPTY,
    STATUS.LENT,
    STATUS.UNRETURNED,
    STATUS.IN_HOUSE,
    STATUS.DAMAGED,
    STATUS.DEFECTIVE,
    STATUS.DISPOSED,
  ];
  const segments = order
    .map((status) => ({
      status,
      count: summary[status] ?? 0,
      color: STATUS_COLORS[status] || "#cbd5e1",
    }))
    .filter((segment) => segment.count > 0);

  return (
    <div
      style={{
        display: "flex",
        height: 10,
        borderRadius: 6,
        overflow: "hidden",
        background: "#f1f5f9",
      }}
      title={segments.map((segment) => `${segment.status}: ${segment.count}`).join(" / ")}
    >
      {segments.map((segment) => (
        <div key={segment.status} style={{ width: `${(segment.count / total) * 100}%`, background: segment.color }} />
      ))}
    </div>
  );
}

function IconTextButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "期限外または対象外" : label}
      style={{
        border: "1px solid #e2e8f0",
        background: disabled ? "#f8fafc" : "#fff",
        color: disabled ? "#cbd5e1" : "#475569",
        borderRadius: 8,
        padding: "6px 8px",
        fontSize: 11,
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        gap: 4,
        minHeight: 30,
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "rgba(15, 23, 42, 0.42)",
          backdropFilter: "blur(4px)",
          cursor: "pointer",
        }}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 440,
          maxHeight: "88vh",
          overflowY: "auto",
          background: "#fff",
          borderRadius: 16,
          padding: 22,
          boxShadow: "0 20px 45px rgba(15, 23, 42, 0.18)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", marginBottom: -6 }}>{label}</div>;
}

function normalizeCorrectionRole(role?: string): StaffCorrectionRole {
  if (role === "admin" || role === "管理者") return "管理者";
  if (role === "準管理者") return "準管理者";
  return "一般";
}

function toTankAction(value: unknown): TankAction | null {
  if (typeof value !== "string") return null;
  return ACTION_OPTIONS.includes(value as TankAction) ? (value as TankAction) : null;
}

function canModifyLog(log: LogEntry, role: StaffCorrectionRole): boolean {
  if (log.logKind !== "tank") return false;
  if (role === "管理者" || role === "準管理者") return true;
  const ms = timestampToMillis(log.revisionCreatedAt);
  return ms != null && Date.now() - ms <= LIMIT_MS;
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

function statusLabel(status?: LogStatus): string {
  if (status === "active") return "有効";
  if (status === "superseded") return "置換済";
  if (status === "voided") return "取消済";
  return "不明";
}

function statusColor(status?: LogStatus): string {
  if (status === "active") return "#16a34a";
  if (status === "superseded") return "#64748b";
  if (status === "voided") return "#dc2626";
  return "#94a3b8";
}

function actionBg(action?: string): string {
  if (!action) return "#f1f5f9";
  if (action.includes("破損") || action.includes("破棄")) return "#fef2f2";
  if (action.includes("返却")) return "#eff6ff";
  if (action.includes("貸出")) return "#eef2ff";
  if (action.includes("充填")) return "#ecfdf5";
  if (action.includes("自社")) return "#fffbeb";
  if (action.includes("耐圧") || action.includes("修理")) return "#f5f3ff";
  return "#f1f5f9";
}

function actionFg(action?: string): string {
  if (!action) return "#475569";
  if (action.includes("破損") || action.includes("破棄")) return "#b91c1c";
  if (action.includes("返却")) return "#1d4ed8";
  if (action.includes("貸出")) return "#4338ca";
  if (action.includes("充填")) return "#047857";
  if (action.includes("自社")) return "#b45309";
  if (action.includes("耐圧") || action.includes("修理")) return "#6d28d9";
  return "#475569";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 12,
  fontWeight: 800,
  color: "#64748b",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #dbe3ef",
  fontSize: 16,
  color: "#0f172a",
  fontWeight: 600,
  outline: "none",
  fontFamily: "inherit",
};

const iconButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#64748b",
  cursor: "pointer",
  padding: 4,
  display: "flex",
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: 14,
    borderRadius: 10,
    border: "none",
    background: disabled ? "#e2e8f0" : "#2563eb",
    color: disabled ? "#94a3b8" : "#fff",
    fontSize: 15,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  };
}

function dangerButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    ...primaryButtonStyle(disabled),
    background: disabled ? "#e2e8f0" : "#dc2626",
  };
}

function miniActionButtonStyle(disabled = false): React.CSSProperties {
  return {
    border: "1px solid #dbeafe",
    background: disabled ? "#f8fafc" : "#fff",
    color: disabled ? "#cbd5e1" : "#2563eb",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
  };
}

function dangerMiniButtonStyle(disabled = false): React.CSSProperties {
  return {
    ...miniActionButtonStyle(disabled),
    border: `1px solid ${disabled ? "#e2e8f0" : "#fecaca"}`,
    color: disabled ? "#cbd5e1" : "#dc2626",
  };
}
