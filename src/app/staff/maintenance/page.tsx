"use client";

import { useState, useEffect, useCallback } from "react";
import { Wrench, CheckCircle2, Send, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, doc, writeBatch, serverTimestamp } from "firebase/firestore";

type MaintMode = "repair" | "inspection";

interface TankItem {
  id: string;
  status: string;
  note: string;
  selected: boolean;
}

const MODES = {
  repair: {
    label: "修理済み",
    desc: "破損/不良/故障 → 空に変更",
    color: "#0ea5e9",
    bg: "#f0f9ff",
    targetStatuses: ["破損", "不良", "故障"],
    nextStatus: "空",
  },
  inspection: {
    label: "耐圧検査完了",
    desc: "期限切れタンクの検査完了処理",
    color: "#8b5cf6",
    bg: "#f5f3ff",
    targetStatuses: [],  // All tanks — filter by date in real implementation
    nextStatus: "空",
  },
} as const;

export default function MaintenancePage() {
  const [mode, setMode] = useState<MaintMode>("repair");
  const [tanks, setTanks] = useState<TankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const config = MODES[mode];

  const fetchTanks = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "tanks"));
      const items: TankItem[] = [];
      snap.forEach((d) => {
        const data = d.data();
        if (mode === "repair") {
          if (["破損", "不良", "故障"].includes(data.status)) {
            items.push({ id: d.id, status: data.status, note: data.note || "", selected: false });
          }
        } else {
          // For inspection, show all tanks (in real app, filter by date)
          items.push({ id: d.id, status: data.status, note: "", selected: false });
        }
      });
      setTanks(items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => { fetchTanks(); setResult(null); }, [fetchTanks]);

  const toggleSelect = (id: string) => {
    setTanks((prev) => prev.map((t) => t.id === id ? { ...t, selected: !t.selected } : t));
  };

  const selectAll = () => {
    const allSelected = tanks.every((t) => t.selected);
    setTanks((prev) => prev.map((t) => ({ ...t, selected: !allSelected })));
  };

  const selectedCount = tanks.filter((t) => t.selected).length;

  const handleSubmit = async () => {
    const selected = tanks.filter((t) => t.selected);
    if (selected.length === 0) return;
    if (!confirm(`${config.label}：${selected.length}本を処理しますか？`)) return;
    setSubmitting(true);
    try {
      const batch = writeBatch(db);
      selected.forEach((t) => {
        batch.set(doc(db, "tanks", t.id), {
          status: config.nextStatus, location: "倉庫", staff: "スタッフ",
          note: "", updatedAt: serverTimestamp(),
        }, { merge: true });
        batch.set(doc(collection(db, "logs")), {
          tankId: t.id, action: config.label, prevStatus: t.status,
          newStatus: config.nextStatus, location: "倉庫", staff: "スタッフ",
          timestamp: serverTimestamp(),
        });
      });
      await batch.commit();
      setResult({ success: true, message: `${selected.length}本の${config.label}を完了しました` });
      fetchTanks();
    } catch (e: any) {
      setResult({ success: false, message: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 16px 24px" }}>
      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "#f1f5f9", borderRadius: 12, padding: 4 }}>
        {(["repair", "inspection"] as MaintMode[]).map((m) => {
          const mc = MODES[m];
          const active = mode === m;
          return (
            <button key={m} onClick={() => setMode(m)}
              style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", background: active ? "#fff" : "transparent", color: active ? mc.color : "#94a3b8", fontWeight: active ? 700 : 500, fontSize: 13, cursor: "pointer", boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
              {mc.label}
            </button>
          );
        })}
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "16px 20px", background: config.bg, borderRadius: 16, border: `1.5px solid ${config.color}20` }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: config.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Wrench size={22} color="#fff" />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{config.label}</h1>
          <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{config.desc}</p>
        </div>
      </div>

      {/* Tank list */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>対象タンク ({tanks.length}本)</span>
          {tanks.length > 0 && (
            <button onClick={selectAll} style={{ fontSize: 12, fontWeight: 600, color: "#6366f1", background: "none", border: "none", cursor: "pointer" }}>
              {tanks.every((t) => t.selected) ? "全解除" : "全選択"}
            </button>
          )}
        </div>

        {loading ? (
          <p style={{ textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 14 }}>読み込み中…</p>
        ) : tanks.length === 0 ? (
          <p style={{ textAlign: "center", padding: 30, color: "#cbd5e1", fontSize: 14 }}>
            {mode === "repair" ? "修理待ちのタンクはありません" : "対象タンクはありません"}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {tanks.map((t) => (
              <div key={t.id} onClick={() => toggleSelect(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                  background: t.selected ? `${config.color}08` : "#f8fafc",
                  border: `1.5px solid ${t.selected ? config.color : "#e8eaed"}`,
                  transition: "all 0.15s",
                }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${t.selected ? config.color : "#cbd5e1"}`, background: t.selected ? config.color : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {t.selected && <CheckCircle2 size={14} color="#fff" />}
                </div>
                <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, color: "#0f172a", flex: 1 }}>{t.id}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{t.status}</span>
                {t.note && <span style={{ fontSize: 11, color: "#ef4444" }}>{t.note}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedCount > 0 && (
        <button onClick={handleSubmit} disabled={submitting}
          style={{ width: "100%", padding: "14px 0", borderRadius: 14, border: "none", background: config.color, color: "#fff", fontSize: 16, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: submitting ? 0.7 : 1, marginBottom: 16 }}>
          {submitting ? <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={18} />}
          {submitting ? "処理中…" : `${config.label}（${selectedCount}本）`}
        </button>
      )}

      {result && (
        <div style={{ padding: "16px 20px", borderRadius: 14, background: result.success ? "#ecfdf5" : "#fef2f2", border: `1px solid ${result.success ? "#bbf7d0" : "#fecaca"}`, display: "flex", alignItems: "center", gap: 10 }}>
          <CheckCircle2 size={20} color={result.success ? "#10b981" : "#ef4444"} />
          <span style={{ fontSize: 14, fontWeight: 600, color: result.success ? "#166534" : "#991b1b" }}>{result.message}</span>
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
