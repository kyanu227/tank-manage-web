"use client";

import { useState, useEffect } from "react";
import { Users, Award, TrendingUp } from "lucide-react";
import { logsRepository } from "@/lib/firebase/repositories";

interface StaffStat { key: string; name: string; lend: number; return_: number; fill: number; total: number; }

export default function StaffAnalyticsPage() {
  const [stats, setStats] = useState<StaffStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const logs = await logsRepository.getActiveLogs();
        const staffMap: Record<string, { name: string; lend: number; return_: number; fill: number }> = {};
        logs.forEach((log) => {
          const key = log.staffId || "不明";
          if (!staffMap[key]) staffMap[key] = { name: log.staffName || "不明", lend: 0, return_: 0, fill: 0 };
          if (log.action === "貸出") staffMap[key].lend++;
          else if (log.action?.includes("返却")) staffMap[key].return_++;
          else if (log.action === "充填") staffMap[key].fill++;
        });
        const sorted = Object.entries(staffMap)
          .map(([key, v]) => ({ name: v.name, key, lend: v.lend, return_: v.return_, fill: v.fill, total: v.lend + v.return_ + v.fill }))
          .sort((a, b) => b.total - a.total);
        setStats(sorted);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 4 }}>スタッフ実績</h1>
      <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 24 }}>スタッフごとの操作件数ランキング</p>

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>読み込み中…</div>
      ) : stats.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 40, textAlign: "center", color: "#cbd5e1" }}>ログがありません</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {stats.map((s, i) => (
            <div key={s.key} style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "18px 20px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
                background: i === 0 ? "#fef3c7" : i === 1 ? "#f1f5f9" : i === 2 ? "#fef2f2" : "#f8fafc",
                color: i === 0 ? "#d97706" : i === 1 ? "#64748b" : i === 2 ? "#b45309" : "#94a3b8",
                fontWeight: 800, fontSize: 14,
              }}>
                {i < 3 ? <Award size={18} /> : i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{s.name}</p>
                <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#6366f1" }}>貸出 {s.lend}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#0ea5e9" }}>返却 {s.return_}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#10b981" }}>充填 {s.fill}</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{s.total}</p>
                <p style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8" }}>操作</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
