"use client";

import { useState, useEffect } from "react";
import { Wallet, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, doc, writeBatch, serverTimestamp } from "firebase/firestore";

interface PriceRow { uid: string; action: string; base: number; score: number; }
interface RankRow { uid: string; name: string; minScore: number; }

export default function MoneySettingsPage() {
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [ranks, setRanks] = useState<RankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const pSnap = await getDocs(collection(db, "priceMaster"));
        const pList: PriceRow[] = [];
        pSnap.forEach((d) => pList.push({ uid: d.id, ...d.data() } as PriceRow));
        setPrices(pList);

        const rSnap = await getDocs(collection(db, "rankMaster"));
        const rList: RankRow[] = [];
        rSnap.forEach((d) => rList.push({ uid: d.id, ...d.data() } as RankRow));
        setRanks(rList.sort((a, b) => b.minScore - a.minScore));
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  const addPrice = () => setPrices((p) => [...p, { uid: `new_${Date.now()}`, action: "", base: 0, score: 0 }]);
  const updatePrice = (uid: string, f: string, v: any) => setPrices((p) => p.map((r) => r.uid === uid ? { ...r, [f]: v } : r));
  const removePrice = (uid: string) => setPrices((p) => p.filter((r) => r.uid !== uid));

  const addRank = () => setRanks((r) => [...r, { uid: `new_${Date.now()}`, name: "", minScore: 0 }]);
  const updateRank = (uid: string, f: string, v: any) => setRanks((r) => r.map((rr) => rr.uid === uid ? { ...rr, [f]: v } : rr));
  const removeRank = (uid: string) => setRanks((r) => r.filter((rr) => rr.uid !== uid));

  const handleSave = async () => {
    if (!confirm("金銭・ランク設定を保存しますか？")) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      // Clear and rewrite prices
      const pOld = await getDocs(collection(db, "priceMaster"));
      pOld.forEach((d) => batch.delete(d.ref));
      prices.forEach((p) => {
        const id = p.uid.startsWith("new_") ? `price_${Date.now()}_${Math.random().toString(36).slice(2, 5)}` : p.uid;
        batch.set(doc(db, "priceMaster", id), { action: p.action, base: Number(p.base), score: Number(p.score), updatedAt: serverTimestamp() });
      });
      // Clear and rewrite ranks
      const rOld = await getDocs(collection(db, "rankMaster"));
      rOld.forEach((d) => batch.delete(d.ref));
      ranks.forEach((r) => {
        const id = r.uid.startsWith("new_") ? `rank_${Date.now()}_${Math.random().toString(36).slice(2, 5)}` : r.uid;
        batch.set(doc(db, "rankMaster", id), { name: r.name, minScore: Number(r.minScore), updatedAt: serverTimestamp() });
      });
      await batch.commit();
      alert("金銭・ランク設定を保存しました。");
    } catch (e: any) {
      alert("保存エラー: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 500, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", background: "#fff", color: "#1e293b" };

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>読み込み中…</div>;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 4 }}>金銭・ランク設定</h1>
      <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 24 }}>操作単価とランク条件の管理</p>

      {/* Price master */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: 8 }}>
            <Wallet size={16} color="#6366f1" /> 単価マスタ
          </h2>
          <button onClick={addPrice} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <Plus size={14} /> 追加
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 400 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                {["操作名", "基本単価", "スコア", ""].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p.uid} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 10px" }}><input value={p.action} onChange={(e) => updatePrice(p.uid, "action", e.target.value)} placeholder="例: 貸出" style={{ ...inputStyle, fontWeight: 700 }} /></td>
                  <td style={{ padding: "8px 10px" }}><input type="number" value={p.base} onChange={(e) => updatePrice(p.uid, "base", e.target.value)} style={{ ...inputStyle, textAlign: "right", fontFamily: "monospace" }} /></td>
                  <td style={{ padding: "8px 10px" }}><input type="number" value={p.score} onChange={(e) => updatePrice(p.uid, "score", e.target.value)} style={{ ...inputStyle, textAlign: "right", fontFamily: "monospace" }} /></td>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}><button onClick={() => removePrice(p.uid)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444" }}><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rank master */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: 8 }}>🏅 ランク条件</h2>
          <button onClick={addRank} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <Plus size={14} /> 追加
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ranks.map((r) => (
            <div key={r.uid} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={r.name} onChange={(e) => updateRank(r.uid, "name", e.target.value)} placeholder="ランク名" style={{ ...inputStyle, fontWeight: 700, flex: 1 }} />
              <input type="number" value={r.minScore} onChange={(e) => updateRank(r.uid, "minScore", e.target.value)} placeholder="必要スコア" style={{ ...inputStyle, textAlign: "right", fontFamily: "monospace", width: 120 }} />
              <button onClick={() => removeRank(r.uid)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444" }}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", borderRadius: 12, border: "none", background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.7 : 1 }}>
        {saving ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={16} />}
        {saving ? "保存中…" : "金銭・ランク設定を保存"}
      </button>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
