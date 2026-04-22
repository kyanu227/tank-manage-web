"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
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
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Truck,
  Undo2,
  Users,
  X,
} from "lucide-react";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
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
  getNextStatus,
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
  transitionAction: TankAction;
  location: string;
  staff: string;
  note: string;
  logNote: string;
  reason: string;
}

const ACTION_OPTIONS = Object.values(ACTION) as TankAction[];
const LIMIT_MS = 72 * 60 * 60 * 1000;

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
  const [pendingOrders, setPendingOrders] = useState(0);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  const [editingLog, setEditingLog] = useState<LogEntry | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [voidingLog, setVoidingLog] = useState<LogEntry | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [savingVoid, setSavingVoid] = useState(false);

  const [expandedRootId, setExpandedRootId] = useState<string | null>(null);
  const [historyByRoot, setHistoryByRoot] = useState<Record<string, LogEntry[]>>({});
  const [historyLoadingRoot, setHistoryLoadingRoot] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const [logSnap, orderSnap, returnSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, "logs"),
            where("logStatus", "==", "active")
          )
        ),
        getDocs(
          query(
            collection(db, "transactions"),
            where("type", "==", "order"),
            where("status", "==", "pending")
          )
        ),
        getDocs(
          query(
            collection(db, "transactions"),
            where("type", "==", "return"),
            where("status", "==", "pending_approval")
          )
        ),
      ]);

      const entries: LogEntry[] = [];
      logSnap.forEach((d) => entries.push({ id: d.id, ...d.data() } as LogEntry));
      entries.sort((a, b) => {
        const aTime = timestampToMillis(a.originalAt ?? a.timestamp) ?? 0;
        const bTime = timestampToMillis(b.originalAt ?? b.timestamp) ?? 0;
        return bTime - aTime;
      });
      setLogs(entries.slice(0, 50));
      setPendingOrders(orderSnap.size);
      setPendingReturns(returnSnap.size);
    } catch (e) {
      console.error(e);
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  const openEdit = (log: LogEntry) => {
    const transitionAction = toTankAction(log.transitionAction ?? log.action);
    if (!transitionAction) {
      alert("このログの操作種別を判定できません");
      return;
    }
    setEditingLog(log);
    setEditForm({
      tankId: log.tankId,
      transitionAction,
      location: log.location ?? "",
      staff: log.staff ?? "",
      note: log.note ?? "",
      logNote: log.logNote ?? "",
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
        transitionAction: editForm.transitionAction,
        location: editForm.location,
        staff: editForm.staff,
        note: editForm.note,
        logNote: editForm.logNote,
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
      const snap = await getDocs(
        query(
          collection(db, "logs"),
          where("rootLogId", "==", rootId)
        )
      );
      const entries: LogEntry[] = [];
      snap.forEach((d) => entries.push({ id: d.id, ...d.data() } as LogEntry));
      entries.sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0));
      setHistoryByRoot((prev) => ({ ...prev, [rootId]: entries }));
    } catch (e: unknown) {
      alert("履歴取得エラー: " + errorMessage(e));
    } finally {
      setHistoryLoadingRoot(null);
    }
  };

  const handleRevert = async (activeLog: LogEntry, sourceLog: LogEntry) => {
    const reason = prompt(`v${sourceLog.revision ?? "-"} の状態に戻す理由を入力してください（5文字以上）`, "");
    if (reason === null) return;
    if (reason.trim().length < 5) {
      alert("理由は5文字以上で入力してください");
      return;
    }

    setRevertingId(sourceLog.id);
    try {
      await applyLogCorrection({
        targetLogId: activeLog.id,
        mode: "revert",
        sourceLogId: sourceLog.id,
        reason,
        editedBy: getStaffName(),
        editedByRole: correctionRole,
      });
      setHistoryByRoot({});
      setExpandedRootId(null);
      await refreshAfterCorrection();
    } catch (e: unknown) {
      alert("復元エラー: " + errorMessage(e));
    } finally {
      setRevertingId(null);
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
                <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>権限: {correctionRole}</span>
              </div>

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
                        <div className="dashboard-log-row">
                          <span
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
                          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
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
                            style={{
                              fontSize: 11,
                              color: "#94a3b8",
                              fontFamily: "ui-monospace, SFMono-Regular, monospace",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatTime(log.originalAt ?? log.timestamp)}
                          </span>
                          {isTankLog ? (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                              <IconTextButton label="編集" icon={<Edit2 size={13} />} disabled={!canModify} onClick={() => openEdit(log)} />
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
                          ) : (
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", padding: "2px 6px", borderRadius: 4, background: "#fff", border: "1px solid #e2e8f0" }}>
                              {log.logKind || "-"}
                            </span>
                          )}
                        </div>

                        {isExpanded && (
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
                                  const canRevert = canModify && rev.id !== log.id && rev.logKind === "tank" && rev.logStatus !== "voided";
                                  return (
                                    <div
                                      key={rev.id}
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "52px 1fr auto",
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
                                      <button
                                        type="button"
                                        onClick={() => handleRevert(log, rev)}
                                        disabled={!canRevert || revertingId === rev.id}
                                        style={{
                                          border: "1px solid #dbeafe",
                                          background: canRevert ? "#eff6ff" : "#f8fafc",
                                          color: canRevert ? "#2563eb" : "#cbd5e1",
                                          borderRadius: 8,
                                          padding: "7px 10px",
                                          fontSize: 11,
                                          fontWeight: 800,
                                          cursor: canRevert ? "pointer" : "not-allowed",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 5,
                                        }}
                                      >
                                        {revertingId === rev.id ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <RotateCcw size={13} />}
                                        戻す
                                      </button>
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
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>ログ編集</h2>
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

            <label style={labelStyle}>
              操作種別
              <select
                value={editForm.transitionAction}
                onChange={(e) =>
                  setEditForm((prev) => (prev ? { ...prev, transitionAction: e.target.value as TankAction } : prev))
                }
                style={inputStyle}
              >
                {ACTION_OPTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>算出ステータス</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{getNextStatus(editForm.transitionAction)}</span>
            </div>

            <label style={labelStyle}>
              場所 / 貸出先
              <input
                value={editForm.location}
                onChange={(e) => setEditForm((prev) => (prev ? { ...prev, location: e.target.value } : prev))}
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              スタッフ
              <input
                value={editForm.staff}
                onChange={(e) => setEditForm((prev) => (prev ? { ...prev, staff: e.target.value } : prev))}
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              メモ
              <textarea
                value={editForm.note}
                onChange={(e) => setEditForm((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
                rows={2}
                style={{ ...inputStyle, resize: "vertical", minHeight: 68 }}
              />
            </label>

            <label style={labelStyle}>
              タンクタグ
              <input
                value={editForm.logNote}
                onChange={(e) => setEditForm((prev) => (prev ? { ...prev, logNote: e.target.value } : prev))}
                style={inputStyle}
              />
            </label>

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
              disabled={savingEdit || !editForm.tankId || editForm.reason.trim().length < 5}
              style={primaryButtonStyle(savingEdit || !editForm.tankId || editForm.reason.trim().length < 5)}
            >
              {savingEdit ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={18} />}
              {savingEdit ? "保存中..." : "保存"}
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

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .dashboard-log-row {
          display: grid;
          grid-template-columns: auto auto 1fr auto auto;
          gap: 8px;
          align-items: center;
          padding: 9px 10px;
        }

        @media (max-width: 720px) {
          .dashboard-log-row {
            grid-template-columns: auto auto 1fr;
          }
          .dashboard-log-row > span:nth-child(4),
          .dashboard-log-row > div:nth-child(5),
          .dashboard-log-row > span:nth-child(5) {
            grid-column: 1 / -1;
          }
          .dashboard-log-row > div:nth-child(5) {
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
