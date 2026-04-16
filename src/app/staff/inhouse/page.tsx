"use client";

import { useState, useEffect, useCallback } from "react";
import { Wrench, Plus, CheckCircle2, AlertCircle, X, Search, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, doc, writeBatch, query, where } from "firebase/firestore";
import { STATUS, ACTION, resolveReturnAction, type ReturnTag, RETURN_TAG } from "@/lib/tank-rules";
import { applyTankOperation, applyBulkTankOperations } from "@/lib/tank-operation";

interface TankDoc {
  id: string;
  status: string;
  location: string;
  staff: string;
  updatedAt: any;
  logNote?: string;
}

type TagType = "normal" | "unused" | "defect";

const TAGS: { id: TagType; label: string; color: string; bg: string; borderColor: string }[] = [
  { id: "normal", label: "通常", color: "#64748b", bg: "#f1f5f9", borderColor: "#e2e8f0" },
  { id: "unused", label: "未使用", color: "#10b981", bg: "#ecfdf5", borderColor: "#6ee7b7" },
  { id: "defect", label: "不備", color: "#ef4444", bg: "#fef2f2", borderColor: "#fca5a5" },
];

export default function InHousePage() {
  const [inHouseTanks, setInHouseTanks] = useState<(TankDoc & { tag: TagType })[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Retro reporting state
  const [inputValue, setInputValue] = useState("");
  const [reportResult, setReportResult] = useState<{ success: boolean; message: string } | null>(null);
  const [reporting, setReporting] = useState(false);

  // Return state
  const [returning, setReturning] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "tanks"), where("status", "==", STATUS.IN_HOUSE));
      const snap = await getDocs(q);
      const tanks: (TankDoc & { tag: TagType })[] = [];
      snap.forEach((d) => {
        const data = d.data();
        let tag: TagType = "normal";
        if (data.logNote === "[TAG:unused]") tag = "unused";
        if (data.logNote === "[TAG:defect]") tag = "defect";
        tanks.push({ id: d.id, ...data, tag } as any);
      });
      // Sort by ID
      tanks.sort((a, b) => a.id.localeCompare(b.id));
      setInHouseTanks(tanks);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateTag = async (tankId: string, newTag: TagType) => {
    // Optimistic UI update
    setInHouseTanks((prev) => prev.map((t) => (t.id === tankId ? { ...t, tag: newTag } : t)));
    try {
      let logNote = "";
      if (newTag === "unused") logNote = "[TAG:unused]";
      if (newTag === "defect") logNote = "[TAG:defect]";

      const ref = doc(db, "tanks", tankId);
      await writeBatch(db).update(ref, { logNote }).commit();
    } catch (e) {
      console.error("Failed to update tag", e);
      fetchData(); // rollback
    }
  };

  const handleRetroReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue) return;

    const tankId = inputValue.toUpperCase().trim();
    if (!/^[A-Z]+-\d{2}$/.test(tankId)) {
      setReportResult({ success: false, message: "ID形式が正しくありません (例: A-01)" });
      return;
    }

    setReporting(true);
    try {
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";

      // Check current status
      const snap = await getDocs(query(collection(db, "tanks"), where("__name__", "==", tankId)));
      if (snap.empty) {
        setReportResult({ success: false, message: "タンクが見つかりません" });
        setReporting(false);
        return;
      }

      const data = snap.docs[0].data();

      if (data.status === STATUS.IN_HOUSE) {
        setReportResult({ success: true, message: `${tankId} は既に自社利用中です` });
        setInputValue("");
        setReporting(false);
        return;
      }

      await applyTankOperation({
        tankId,
        transitionAction: ACTION.IN_HOUSE_USE_RETRO,
        currentStatus: data.status,
        staff: staffName,
        location: "自社",
        logNote: "事後報告",
      });

      setInputValue("");
      setReportResult({ success: true, message: `${tankId} の事後報告を完了しました` });
      fetchData();
    } catch (e: any) {
      setReportResult({ success: false, message: "エラー: " + e.message });
    } finally {
      setReporting(false);
    }
  };

  const handleBulkReturn = async () => {
    if (inHouseTanks.length === 0) return;
    if (!confirm(`自社利用中のタンク全 ${inHouseTanks.length} 本を一括返却しますか？\n(タグ付けに応じて処理されます)`)) return;

    setReturning(true);
    try {
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";

      await applyBulkTankOperations(
        inHouseTanks.map((tank) => {
          const tag = (tank.tag || RETURN_TAG.NORMAL) as ReturnTag;
          return {
            tankId: tank.id,
            transitionAction: resolveReturnAction(tag, STATUS.IN_HOUSE),
            currentStatus: STATUS.IN_HOUSE,
            staff: staffName,
            location: "倉庫",
          };
        })
      );

      alert("一括返却が完了しました。");
      fetchData();
    } catch (e: any) {
      alert("エラー: " + e.message);
    } finally {
      setReturning(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 16px 24px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 4, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 8 }}>
          <Wrench size={24} color="#6366f1" />
          自社管理
        </h1>
        <p style={{ fontSize: 13, color: "#94a3b8" }}>自社で利用したタンクの事後報告と返却確定を行います</p>
      </div>

      {/* Retro Report Section */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "#334155", marginBottom: 12 }}>事後報告 (利用開始)</h2>
        <form onSubmit={handleRetroReport} style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value.toUpperCase())}
              placeholder="例: A-01"
              style={{
                width: "100%", padding: "12px 14px 12px 38px", fontSize: 16, fontWeight: 700,
                fontFamily: "monospace", border: "1px solid #e2e8f0", borderRadius: 10,
                outline: "none", color: "#0f172a", textTransform: "uppercase",
              }}
            />
            <Search size={18} color="#94a3b8" style={{ position: "absolute", left: 14, top: 15 }} />
          </div>
          <button
            type="submit"
            disabled={reporting || !inputValue}
            style={{
              padding: "0 20px", borderRadius: 10, border: "none", background: reporting || !inputValue ? "#c7d2fe" : "#6366f1",
              color: "#fff", fontSize: 14, fontWeight: 700, cursor: reporting || !inputValue ? "not-allowed" : "pointer",
              transition: "all 0.15s", whiteSpace: "nowrap",
            }}
          >
            {reporting ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : "追加"}
          </button>
        </form>

        {reportResult && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, background: reportResult.success ? "#ecfdf5" : "#fef2f2", border: `1px solid ${reportResult.success ? "#bbf7d0" : "#fecaca"}` }}>
            {reportResult.success ? <CheckCircle2 size={16} color="#10b981" /> : <AlertCircle size={16} color="#ef4444" />}
            <span style={{ fontSize: 13, fontWeight: 600, color: reportResult.success ? "#166534" : "#991b1b" }}>{reportResult.message}</span>
          </div>
        )}
      </div>

      {/* Return Section */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#334155" }}>利用中タンク ({inHouseTanks.length}本)</h2>
          <button
            onClick={handleBulkReturn}
            disabled={inHouseTanks.length === 0 || returning}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: inHouseTanks.length === 0 || returning ? "#e2e8f0" : "#0f172a",
              color: inHouseTanks.length === 0 || returning ? "#94a3b8" : "#fff",
              fontSize: 13, fontWeight: 700, cursor: inHouseTanks.length === 0 || returning ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {returning ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={14} />}
            全て返却確定
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>読み込み中…</div>
        ) : inHouseTanks.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#cbd5e1", fontSize: 13 }}>利用中のタンクはありません</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {inHouseTanks.map((tank) => (
              <div key={tank.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "#f8fafc", borderRadius: 12, border: "1px solid #f1f5f9" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: "#0f172a", letterSpacing: "0.05em" }}>
                    {tank.id}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{tank.staff}</div>
                </div>

                {/* Tag Selector */}
                <div style={{ display: "flex", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 2 }}>
                  {TAGS.map((tag) => {
                    const active = tank.tag === tag.id;
                    return (
                      <button
                        key={tag.id}
                        onClick={() => updateTag(tank.id, tag.id)}
                        style={{
                          padding: "6px 12px", border: "none", borderRadius: 6,
                          background: active ? tag.bg : "transparent",
                          color: active ? tag.color : "#94a3b8",
                          fontSize: 12, fontWeight: active ? 700 : 500,
                          cursor: "pointer", transition: "all 0.1s",
                        }}
                      >
                        {tag.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
