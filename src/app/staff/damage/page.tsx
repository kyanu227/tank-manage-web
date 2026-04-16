"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Send, CheckCircle2, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";
import { STATUS, ACTION } from "@/lib/tank-rules";
import { applyBulkTankOperations } from "@/lib/tank-operation";

export default function DamageReportPage() {
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [selectedPrefix, setSelectedPrefix] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [queue, setQueue] = useState<{ uid: string; tankId: string }[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "tanks"));
      const pSet = new Set<string>();
      snap.forEach((d) => {
        const m = d.id.match(/^([A-Z]+)/i);
        if (m) pSet.add(m[1].toUpperCase());
      });
      setPrefixes(Array.from(pSet).sort());
    })();
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, "");
    if (val.length > 2) return;
    setInputValue(val);
    if (val.length === 2 && selectedPrefix) {
      const tankId = `${selectedPrefix}-${val}`;
      if (!queue.some((q) => q.tankId === tankId)) {
        setQueue((prev) => [...prev, { uid: `${Date.now()}`, tankId }]);
      }
      setInputValue("");
    }
  };

  const handleSubmit = async () => {
    if (queue.length === 0) return;
    if (!confirm(`${queue.length}本の破損報告を送信しますか？`)) return;
    setSubmitting(true);
    try {
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";
      await applyBulkTankOperations(
        queue.map((item) => ({
          tankId: item.tankId,
          transitionAction: ACTION.DAMAGE_REPORT,
          staff: staffName,
          location: "倉庫",
          logNote: note,
        }))
      );
      setResult({ success: true, message: `${queue.length}本の破損報告を完了しました` });
      setQueue([]);
      setNote("");
    } catch (e: any) {
      setResult({ success: false, message: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 16px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "16px 20px", background: "#fef2f2", borderRadius: 16, border: "1.5px solid #fecaca" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <AlertTriangle size={22} color="#fff" />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>破損報告</h1>
          <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>ステータスを「破損」に変更します</p>
        </div>
      </div>

      {/* ID Input */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>タンクID</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {prefixes.map((p) => (
            <button key={p} onClick={() => { setSelectedPrefix(p); setInputValue(""); }}
              style={{ width: 44, height: 44, borderRadius: 10, fontSize: 17, fontWeight: 800, fontFamily: "monospace", border: "1.5px solid", borderColor: selectedPrefix === p ? "#ef4444" : "#e2e8f0", background: selectedPrefix === p ? "#ef4444" : "#fff", color: selectedPrefix === p ? "#fff" : "#475569", cursor: "pointer" }}>
              {p}
            </button>
          ))}
        </div>
        {selectedPrefix && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ background: "#f1f5f9", borderRadius: 10, padding: "12px 16px", fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: "#0f172a" }}>{selectedPrefix} -</div>
            <input type="tel" inputMode="numeric" placeholder="00" value={inputValue} onChange={handleInput} autoFocus autoComplete="off"
              style={{ flex: 1, border: "1.5px solid #ef4444", borderRadius: 10, padding: "12px 16px", fontSize: 24, fontWeight: 800, fontFamily: "monospace", textAlign: "center" as const, color: "#0f172a", outline: "none", height: 52 }} />
          </div>
        )}
      </div>

      {/* Note */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>破損内容（備考）</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: バルブ不良、タンク凹み等"
          style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", fontSize: 14, resize: "vertical", minHeight: 60, outline: "none", fontFamily: "inherit" }} />
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>キュー ({queue.length}本)</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {queue.map((q) => (
              <span key={q.uid} onClick={() => setQueue((prev) => prev.filter((x) => x.uid !== q.uid))}
                style={{ padding: "6px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontFamily: "monospace", fontWeight: 700, fontSize: 14, color: "#991b1b", cursor: "pointer" }}>
                {q.tankId} ✕
              </span>
            ))}
          </div>
        </div>
      )}

      {queue.length > 0 && (
        <button onClick={handleSubmit} disabled={submitting}
          style={{ width: "100%", padding: "14px 0", borderRadius: 14, border: "none", background: "#ef4444", color: "#fff", fontSize: 16, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: submitting ? 0.7 : 1, marginBottom: 16 }}>
          {submitting ? <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={18} />}
          {submitting ? "送信中…" : `破損報告（${queue.length}本）`}
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
