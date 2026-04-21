"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit2,
  Loader2,
  PieChart,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import PrefixNumberPicker from "@/components/PrefixNumberPicker";
import { getStaffName, useStaffSession } from "@/hooks/useStaffSession";
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
  STATUS_COLORS,
  getNextStatus,
  type TankAction,
} from "@/lib/tank-rules";

interface TankSummary {
  [status: string]: number;
}

type LogStatus = "active" | "superseded" | "voided";

interface LogEntry {
  id: string;
  tankId: string;
  action: string;
  transitionAction?: string;
  staff?: string;
  location?: string;
  timestamp?: any;
  originalAt?: any;
  revisionCreatedAt?: any;
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
  voidedAt?: any;
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
  const correctionRole = useMemo(() => normalizeCorrectionRole(session?.role), [session?.role]);
  const { tanks } = useTanks();
  const tankIds = useMemo(() => tanks.map((t) => t.id), [tanks]);

  const [summary, setSummary] = useState<TankSummary>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalTanks, setTotalTanks] = useState(0);
  const [loading, setLoading] = useState(true);

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
    setLoading(true);
    try {
      const tankSnap = await getDocs(collection(db, "tanks"));
      const counts: TankSummary = {};
      let total = 0;
      tankSnap.forEach((d) => {
        const s = String(d.data().status || "不明");
        counts[s] = (counts[s] || 0) + 1;
        total++;
      });
      setSummary(counts);
      setTotalTanks(total);

      const logSnap = await getDocs(
        query(
          collection(db, "logs"),
          where("logStatus", "==", "active"),
          orderBy("originalAt", "desc"),
          limit(50)
        )
      );
      const entries: LogEntry[] = [];
      logSnap.forEach((d) => entries.push({ id: d.id, ...d.data() } as LogEntry));
      setLogs(entries);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      await fetchData();
    } catch (e: any) {
      alert("編集エラー: " + e.message);
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
      await fetchData();
    } catch (e: any) {
      alert("取消エラー: " + e.message);
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
          where("rootLogId", "==", rootId),
          orderBy("revision", "asc")
        )
      );
      const entries: LogEntry[] = [];
      snap.forEach((d) => entries.push({ id: d.id, ...d.data() } as LogEntry));
      setHistoryByRoot((prev) => ({ ...prev, [rootId]: entries }));
    } catch (e: any) {
      alert("履歴取得エラー: " + e.message);
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
      await fetchData();
    } catch (e: any) {
      alert("復元エラー: " + e.message);
    } finally {
      setRevertingId(null);
    }
  };

  const formatTime = (ts: any) => {
    if (!ts?.toDate) return "-";
    const d = ts.toDate();
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 16px 24px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>
        ダッシュボード
      </h1>
      <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20 }}>タンクステータス集計 + 操作ログ</p>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontSize: 14 }}>読み込み中...</div>
      ) : (
        <>
          <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <PieChart size={16} color="#2563eb" />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>ステータス別 ({totalTanks}本)</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {Object.entries(summary).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                <div
                  key={status}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "#f8fafc",
                    border: "1px solid #e8eaed",
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: STATUS_COLORS[status] || "#cbd5e1" }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>{status}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{count}</span>
                </div>
              ))}
            </div>
            {totalTanks === 0 && (
              <p style={{ fontSize: 13, color: "#cbd5e1", textAlign: "center", padding: 16 }}>タンクが未登録です</p>
            )}
          </div>

          <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Clock size={16} color="#0ea5e9" />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b", flex: 1 }}>
                操作ログ ({logs.length}件)
              </span>
            </div>

            {logs.length === 0 ? (
              <p style={{ fontSize: 13, color: "#cbd5e1", textAlign: "center", padding: 16 }}>ログがありません</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {logs.map((log) => {
                  const rootId = log.rootLogId ?? log.id;
                  const isExpanded = expandedRootId === rootId;
                  const canModify = canModifyLog(log, correctionRole);
                  const isTankLog = log.logKind === "tank";
                  const history = historyByRoot[rootId] ?? [];
                  const historyLoading = historyLoadingRoot === rootId;

                  return (
                    <div key={log.id} style={{ border: "1px solid #f1f5f9", borderRadius: 10, background: "#f8fafc", overflow: "hidden" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 800, color: "#0f172a", minWidth: 54 }}>
                          {log.tankId}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 800,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: "#eef2ff",
                            color: "#4338ca",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {log.action}
                        </span>
                        <span style={{ fontSize: 12, color: "#64748b", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {log.location || "-"}
                        </span>
                        <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 76, textAlign: "right" }}>
                          {formatTime(log.originalAt ?? log.timestamp)}
                        </span>
                        {isTankLog && (
                          <>
                            <IconTextButton
                              label="編集"
                              icon={<Edit2 size={13} />}
                              disabled={!canModify}
                              onClick={() => openEdit(log)}
                            />
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
                          </>
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
                                const canRevert =
                                  canModify &&
                                  rev.id !== log.id &&
                                  rev.logKind === "tank" &&
                                  rev.logStatus !== "voided";
                                return (
                                  <div key={rev.id} style={{ display: "grid", gridTemplateColumns: "52px 1fr auto", gap: 10, alignItems: "center", padding: 10, borderRadius: 8, border: "1px solid #f1f5f9", background: "#fafafa" }}>
                                    <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>
                                      v{rev.revision ?? "-"}
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                        <span style={{ fontSize: 12, fontWeight: 800, color: statusColor(rev.logStatus) }}>
                                          {statusLabel(rev.logStatus)}
                                        </span>
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
              onChange={(tankId) => setEditForm((prev) => prev ? { ...prev, tankId } : prev)}
              accentColor="#2563eb"
            />

            <label style={labelStyle}>
              操作種別
              <select
                value={editForm.transitionAction}
                onChange={(e) => setEditForm((prev) => prev ? { ...prev, transitionAction: e.target.value as TankAction } : prev)}
                style={inputStyle}
              >
                {ACTION_OPTIONS.map((action) => (
                  <option key={action} value={action}>{action}</option>
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
                onChange={(e) => setEditForm((prev) => prev ? { ...prev, location: e.target.value } : prev)}
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              スタッフ
              <input
                value={editForm.staff}
                onChange={(e) => setEditForm((prev) => prev ? { ...prev, staff: e.target.value } : prev)}
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              メモ
              <textarea
                value={editForm.note}
                onChange={(e) => setEditForm((prev) => prev ? { ...prev, note: e.target.value } : prev)}
                rows={2}
                style={{ ...inputStyle, resize: "vertical", minHeight: 68 }}
              />
            </label>

            <label style={labelStyle}>
              タンクタグ
              <input
                value={editForm.logNote}
                onChange={(e) => setEditForm((prev) => prev ? { ...prev, logNote: e.target.value } : prev)}
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              編集理由
              <textarea
                value={editForm.reason}
                onChange={(e) => setEditForm((prev) => prev ? { ...prev, reason: e.target.value } : prev)}
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
              <span style={{ fontFamily: "monospace", fontWeight: 900, color: "#0f172a" }}>{voidingLog.tankId}</span>
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

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
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
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, border: "none", background: "rgba(15, 23, 42, 0.42)", backdropFilter: "blur(4px)", cursor: "pointer" }}
      />
      <div style={{ position: "relative", width: "100%", maxWidth: 440, maxHeight: "88vh", overflowY: "auto", background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 20px 45px rgba(15, 23, 42, 0.18)" }}>
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
  if (!value) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return null;
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
