"use client";

import { useState, useEffect, useCallback } from "react";
import { PieChart, Clock, Edit2, X, CheckCircle2, Undo2 } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, orderBy, limit, doc, writeBatch, serverTimestamp } from "firebase/firestore";
import { STATUS_COLORS } from "@/lib/tank-rules";
import { voidLog } from "@/lib/tank-operation";
import { getStaffName } from "@/hooks/useStaffSession";

interface TankSummary {
  [status: string]: number;
}

interface LogEntry {
  id: string;
  tankId: string;
  action: string;
  staff: string;
  location: string;
  timestamp: any;
  note: string;
  voided?: boolean;
  voidedAt?: any;
  voidedBy?: string;
  voidReason?: string;
  prevStatus?: string;
}

type LogFilter = "active" | "voided" | "all";

// STATUS_COLORS は @/lib/tank-rules から import

export default function StaffDashboard() {
  const [summary, setSummary] = useState<TankSummary>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalTanks, setTotalTanks] = useState(0);
  const [loading, setLoading] = useState(true);

  // Edit Modal State
  const [editingLog, setEditingLog] = useState<LogEntry | null>(null);
  const [editTankId, setEditTankId] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Log filter
  const [logFilter, setLogFilter] = useState<LogFilter>("active");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Tank summary
      const tankSnap = await getDocs(collection(db, "tanks"));
      const counts: TankSummary = {};
      let total = 0;
      tankSnap.forEach((d) => {
        const s = d.data().status || "不明";
        counts[s] = (counts[s] || 0) + 1;
        total++;
      });
      setSummary(counts);
      setTotalTanks(total);

      // Recent logs
      const logSnap = await getDocs(query(collection(db, "logs"), orderBy("timestamp", "desc"), limit(50)));
      const entries: LogEntry[] = [];
      logSnap.forEach((d) => entries.push({ id: d.id, ...d.data() } as LogEntry));
      setLogs(entries);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleVoid = async (log: LogEntry) => {
    const reason = prompt(
      "このログを取消しますか？\n\n物理削除ではなく論理削除（voided フラグ）です。\n取消後も監査のため記録は残ります。\n\n取消理由（任意）:",
      ""
    );
    if (reason === null) return; // キャンセル

    try {
      const staffName = getStaffName();

      // 巻き戻し先の location を推定
      let rollbackLocation = "倉庫";
      if (log.action.includes("返却")) rollbackLocation = log.location;

      await voidLog({
        logId: log.id,
        voidedBy: staffName,
        reason,
        rollbackTank: log.prevStatus
          ? {
              tankId: log.tankId,
              toStatus: log.prevStatus,
              toLocation: rollbackLocation,
            }
          : undefined,
      });

      fetchData();
    } catch (e: any) {
      alert("取消エラー: " + e.message);
    }
  };

  const startEdit = (log: LogEntry) => {
    setEditingLog(log);
    setEditTankId(log.tankId);
    setEditLocation(log.location);
  };

  const handleSaveEdit = async () => {
    if (!editingLog) return;
    if (!editTankId.trim() || !editLocation.trim()) {
      alert("必須項目が入力されていません");
      return;
    }

    setSavingEdit(true);
    try {
      const batch = writeBatch(db);
      const staffName = getStaffName();

      // 1. If tank ID changed, rollback old tank status, and update new tank status
      // Note: Full logic requires fetching both old and new tanks to swap properly in 'tanks', or just swapping history. 
      // For simplicity here, we ONLY update the log itself plus the current tank if they match.
      
      // Update Log
      const logRef = doc(db, "logs", editingLog.id);
      batch.update(logRef, {
        tankId: editTankId.toUpperCase(),
        location: editLocation,
      });

      // Update Tank (optimistic override)
      if (editingLog.tankId === editTankId.toUpperCase()) {
         batch.update(doc(db, "tanks", editTankId.toUpperCase()), { location: editLocation });
      }

      // Record edit in history
      batch.set(doc(collection(db, "edit_history")), {
        logId: editingLog.id,
        oldTankId: editingLog.tankId,
        newTankId: editTankId.toUpperCase(),
        oldLocation: editingLog.location,
        newLocation: editLocation,
        editedBy: staffName,
        editedAt: serverTimestamp(),
      });

      await batch.commit();
      setEditingLog(null);
      fetchData();
    } catch(e: any) {
      alert("編集エラー: " + e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const formatTime = (ts: any) => {
    if (!ts?.toDate) return "—";
    const d = ts.toDate();
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "16px 16px 24px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 4, letterSpacing: "-0.02em" }}>
        ダッシュボード
      </h1>
      <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20 }}>タンクステータス集計 + 操作ログ</p>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontSize: 14 }}>読み込み中…</div>
      ) : (
        <>
          {/* Status Summary */}
          <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <PieChart size={16} color="#6366f1" />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>ステータス別 ({totalTanks}本)</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {Object.entries(summary).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                <div
                  key={status}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 14px", borderRadius: 10,
                    background: "#f8fafc", border: "1px solid #e8eaed",
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

          {/* Recent Logs */}
          <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Clock size={16} color="#0ea5e9" />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b", flex: 1 }}>
                操作ログ ({logs.filter(l => logFilter === "all" ? true : logFilter === "voided" ? l.voided : !l.voided).length}件)
              </span>
              {/* Filter tabs */}
              <div style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 8, padding: 2 }}>
                {([
                  { id: "active", label: "有効" },
                  { id: "voided", label: "取消済" },
                  { id: "all", label: "全て" },
                ] as const).map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setLogFilter(f.id)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: "none",
                      background: logFilter === f.id ? "#fff" : "transparent",
                      color: logFilter === f.id ? "#0f172a" : "#94a3b8",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      boxShadow: logFilter === f.id ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            {(() => {
              const filtered = logs.filter((l) =>
                logFilter === "all" ? true : logFilter === "voided" ? l.voided : !l.voided
              );
              if (filtered.length === 0) {
                return <p style={{ fontSize: 13, color: "#cbd5e1", textAlign: "center", padding: 16 }}>
                  {logFilter === "voided" ? "取消済のログはありません" : "ログがありません"}
                </p>;
              }
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {filtered.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", borderRadius: 10,
                        background: log.voided ? "#fafbfc" : "#f8fafc",
                        border: `1px solid ${log.voided ? "#fecaca" : "#f1f5f9"}`,
                        opacity: log.voided ? 0.65 : 1,
                      }}
                    >
                      <span style={{
                        fontFamily: "monospace", fontSize: 14, fontWeight: 700,
                        color: "#0f172a", minWidth: 48,
                        textDecoration: log.voided ? "line-through" : "none",
                      }}>
                        {log.tankId}
                      </span>
                      <span
                        style={{
                          fontSize: 11, fontWeight: 700, padding: "2px 8px",
                          borderRadius: 6, background: STATUS_COLORS[log.action]
                            ? `${STATUS_COLORS[log.action]}18` : "#f1f5f9",
                          color: STATUS_COLORS[log.action] || "#64748b",
                          textDecoration: log.voided ? "line-through" : "none",
                        }}
                      >
                        {log.action}
                      </span>
                      {log.voided && (
                        <span style={{
                          fontSize: 10, fontWeight: 800, padding: "2px 6px",
                          borderRadius: 5, background: "#fef2f2", color: "#dc2626",
                          border: "1px solid #fecaca",
                        }}>
                          取消
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: "#94a3b8", flex: 1 }}>{log.location}</span>
                      <span style={{ fontSize: 11, color: "#cbd5e1", minWidth: 70, textAlign: "right" as const }}>
                        {formatTime(log.timestamp)}
                      </span>
                      {!log.voided && (
                        <>
                          <button
                            onClick={() => startEdit(log)}
                            style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", padding: 2 }}
                            title="編集"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleVoid(log)}
                            style={{ border: "none", background: "none", cursor: "pointer", color: "#cbd5e1", padding: 2 }}
                            title="取消"
                          >
                            <Undo2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* Edit Modal */}
      {editingLog && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(15, 23, 42, 0.4)", backdropFilter: "blur(4px)" }} onClick={() => setEditingLog(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 360, background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>ログ編集</h2>
              <button onClick={() => setEditingLog(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#64748b" }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>タンクID</label>
                <input
                  type="text"
                  value={editTankId}
                  onChange={(e) => setEditTankId(e.target.value.toUpperCase())}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 15, fontWeight: 600, color: "#0f172a", fontFamily: "monospace", textTransform: "uppercase" }}
                />
              </div>
              
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>場所 / 貸出先</label>
                <input
                  type="text"
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 15, fontWeight: 600, color: "#0f172a" }}
                />
              </div>

              <div style={{ background: "#f8fafc", padding: 12, borderRadius: 10, fontSize: 12, color: "#64748b", marginTop: 4 }}>
                <p style={{ margin: "0 0 4px 0", fontWeight: 700 }}>注意:</p>
                <p style={{ margin: 0 }}>タンクIDを変更した場合、現在そのタンクが持っている場所等のマスタデータは自動で巻き戻りません。必要に応じて個別に再登録してください。</p>
              </div>

              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", background: "#6366f1", color: "#fff", fontSize: 15, fontWeight: 700, marginTop: 8, cursor: savingEdit ? "wait" : "pointer", opacity: savingEdit ? 0.7 : 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}
              >
                {savingEdit ? "保存中..." : <><CheckCircle2 size={18} />変更を保存</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
