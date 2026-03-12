"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowDownToLine, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, doc, writeBatch, serverTimestamp, query, where } from "firebase/firestore";

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
  { id: "defect", label: "未充填", color: "#ef4444", bg: "#fef2f2", borderColor: "#fca5a5" },
];

export default function BulkReturnPage() {
  const [loading, setLoading] = useState(true);
  const [groupedTanks, setGroupedTanks] = useState<Record<string, (TankDoc & { tag: TagType })[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [returning, setReturning] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all tanks that are currently lent out
      const q = query(collection(db, "tanks"), where("status", "in", ["貸出中", "未返却"]));
      const snap = await getDocs(q);
      
      const groups: Record<string, (TankDoc & { tag: TagType })[]> = {};
      
      snap.forEach((d) => {
        const data = d.data();
        const loc = data.location || "不明";
        if (!groups[loc]) groups[loc] = [];
        
        let tag: TagType = "normal";
        if (data.logNote === "[TAG:unused]") tag = "unused";
        if (data.logNote === "[TAG:defect]") tag = "defect";
        
        groups[loc].push({ id: d.id, ...data, tag } as any);
      });

      // Sort tanks within each group by ID
      Object.keys(groups).forEach(loc => {
        groups[loc].sort((a, b) => a.id.localeCompare(b.id));
      });

      setGroupedTanks(groups);
      
      // Expand all by default if there are few, or just the first one
      const newExpanded: Record<string, boolean> = {};
      Object.keys(groups).forEach(loc => newExpanded[loc] = true);
      setExpanded(newExpanded);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleExpand = (loc: string) => {
    setExpanded(prev => ({ ...prev, [loc]: !prev[loc] }));
  };

  const updateTag = async (loc: string, tankId: string, newTag: TagType) => {
    // Optimistic UI update
    setGroupedTanks(prev => {
      const g = { ...prev };
      g[loc] = g[loc].map(t => (t.id === tankId ? { ...t, tag: newTag } : t));
      return g;
    });

    try {
      let logNote = "";
      if (newTag === "unused") logNote = "[TAG:unused]";
      if (newTag === "defect") logNote = "[TAG:defect]";

      const ref = doc(db, "tanks", tankId);
      await writeBatch(db).update(ref, { logNote }).commit();
    } catch (e) {
      console.error("Failed to update tag", e);
      fetchData(); // Rollback
    }
  };

  const handleBulkReturnForLocation = async (loc: string) => {
    const tanksToReturn = groupedTanks[loc];
    if (!tanksToReturn || tanksToReturn.length === 0) return;

    if (!confirm(`${loc} の貸出中タンク全 ${tanksToReturn.length} 本を一括返却しますか？\n(タグ付けに応じて処理されます)`)) return;

    setReturning(prev => ({ ...prev, [loc]: true }));
    try {
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";
      const batch = writeBatch(db);

      tanksToReturn.forEach((tank) => {
        let nextStatus = "空";
        let logAction = "返却";

        if (tank.tag === "unused") {
          nextStatus = "充填済み";
          logAction = "未使用返却";
        } else if (tank.tag === "defect") {
          nextStatus = "空";
          logAction = "返却(未充填)"; // Gas missing but wasn't properly filled by us
        }

        // Update tank
        batch.set(doc(db, "tanks", tank.id), {
          status: nextStatus,
          location: "倉庫",
          staff: staffName,
          logNote: "",
          updatedAt: serverTimestamp(),
        }, { merge: true });

        // Build new log entry
        batch.set(doc(collection(db, "logs")), {
          tankId: tank.id,
          action: logAction,
          prevStatus: tank.status,
          newStatus: nextStatus,
          location: "倉庫",
          staff: staffName,
          note: "",
          timestamp: serverTimestamp(),
        });
      });

      await batch.commit();
      alert(`${loc} の一括返却が完了しました。`);
      fetchData(); // Refresh all data

    } catch (e: any) {
      alert("エラー: " + e.message);
    } finally {
      setReturning(prev => ({ ...prev, [loc]: false }));
    }
  };

  const locationKeys = Object.keys(groupedTanks).sort();

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 16px 24px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 4, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 8 }}>
          <ArrowDownToLine size={24} color="#0ea5e9" />
          一括返却
        </h1>
        <p style={{ fontSize: 13, color: "#94a3b8" }}>貸出先ごとに現在貸出中のタンクをまとめて返却処理します</p>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <Loader2 size={24} style={{ animation: "spin 1s linear infinite", color: "#64748b" }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>読み込み中…</span>
        </div>
      ) : locationKeys.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 40, textAlign: "center" }}>
          <CheckCircle2 size={40} color="#10b981" style={{ marginBottom: 16, opacity: 0.8 }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: "#334155" }}>貸出中のタンクはありません</p>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>すべて返却済みです</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {locationKeys.map(loc => {
            const tanks = groupedTanks[loc];
            const isExpanded = expanded[loc];
            const isReturning = returning[loc];

            return (
              <div key={loc} style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, overflow: "hidden" }}>
                
                {/* Accordion Header */}
                <div 
                  onClick={() => toggleExpand(loc)}
                  style={{ 
                    padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
                    cursor: "pointer", userSelect: "none", background: isExpanded ? "#f8fafc" : "#fff",
                    borderBottom: isExpanded ? "1px solid #e8eaed" : "none", transition: "background 0.2s"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ padding: 4, background: "#e0f2fe", borderRadius: 8, color: "#0284c7" }}>
                      {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0 }}>{loc}</h3>
                      <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0 0", fontWeight: 600 }}>
                        {tanks.length}本 貸出中
                      </p>
                    </div>
                  </div>
                  
                  {/* Action Button */}
                  <div onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handleBulkReturnForLocation(loc)}
                      disabled={isReturning}
                      style={{
                        padding: "8px 16px", borderRadius: 10, border: "none",
                        background: isReturning ? "#e2e8f0" : "#0f172a",
                        color: isReturning ? "#94a3b8" : "#fff",
                        fontSize: 13, fontWeight: 700, cursor: isReturning ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
                        boxShadow: isReturning ? "none" : "0 2px 4px rgba(0,0,0,0.1)"
                      }}
                    >
                      {isReturning ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <ArrowDownToLine size={16} />}
                      {loc}分を一括返却
                    </button>
                  </div>
                </div>

                {/* Accordion Body */}
                {isExpanded && (
                  <div style={{ padding: "16px 20px", background: "#fff" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                      {tanks.map(tank => (
                        <div key={tank.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", border: "1px solid #f1f5f9", borderRadius: 12, background: "#f8fafc" }}>
                          
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: "#1e293b", letterSpacing: "0.05em" }}>
                              {tank.id}
                            </span>
                            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginTop: 2 }}>
                              {tank.staff}
                            </span>
                          </div>

                          {/* Tag Selector */}
                          <div style={{ display: "flex", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 2, flexShrink: 0 }}>
                            {TAGS.map((tag) => {
                              const active = tank.tag === tag.id;
                              return (
                                <button
                                  key={tag.id}
                                  onClick={() => updateTag(loc, tank.id, tag.id)}
                                  style={{
                                    padding: "6px 10px", border: "none", borderRadius: 6,
                                    background: active ? tag.bg : "transparent",
                                    color: active ? tag.color : "#94a3b8",
                                    fontSize: 11, fontWeight: active ? 800 : 600,
                                    cursor: "pointer", transition: "all 0.15s",
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
