"use client";

import { useState, useEffect, useMemo } from "react";
import { BarChart3, TrendingUp, Calendar, Archive } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, orderBy, limit, where } from "firebase/firestore";

interface DailyStat { date: string; lend: number; return_: number; fill: number; total: number; }
interface MonthlyStat { id: string; month: string; location: string; lends: number; returns: number; unused: number; defaults: number; }

export default function SalesPage() {
  const [tab, setTab] = useState<"daily" | "monthly">("daily");
  
  // Daily Stats State
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [loadingDaily, setLoadingDaily] = useState(true);

  // Monthly Stats State
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStat[]>([]);
  const [loadingMonthly, setLoadingMonthly] = useState(true);

  // Fetch Daily Stats (Last 30 Days)
  useEffect(() => {
    (async () => {
      try {
        // Only fetch a reasonable amount of recent logs for daily stats
        const snap = await getDocs(query(collection(db, "logs"), where("logStatus", "==", "active"), orderBy("timestamp", "desc"), limit(3000)));
        const dateMap: Record<string, { lend: number; return_: number; fill: number }> = {};
        snap.forEach((d) => {
          const data = d.data();
          if (!data.timestamp?.toDate) return;
          const dt = data.timestamp.toDate();
          const key = `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
          if (!dateMap[key]) dateMap[key] = { lend: 0, return_: 0, fill: 0 };
          if (data.action === "貸出") dateMap[key].lend++;
          else if (data.action?.includes("返却")) dateMap[key].return_++;
          else if (data.action === "充填") dateMap[key].fill++;
        });
        const sorted = Object.entries(dateMap).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30)
          .map(([date, v]) => ({ date, ...v, total: v.lend + v.return_ + v.fill }));
        setDailyStats(sorted);
      } catch (e) { console.error(e); }
      finally { setLoadingDaily(false); }
    })();
  }, []);

  // Fetch Monthly Stats (Archived Data)
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "monthly_stats"), orderBy("month", "desc")));
        const list: MonthlyStat[] = [];
        snap.forEach(d => {
          list.push({ id: d.id, ...d.data() } as MonthlyStat);
        });
        setMonthlyStats(list);
      } catch (e) { console.error("Failed to load monthly stats", e); }
      finally { setLoadingMonthly(false); }
    })();
  }, []);

  const todayTotal = dailyStats[0]?.total || 0;
  const yesterdayTotal = dailyStats[1]?.total || 0;
  const ratio = yesterdayTotal > 0 ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100) : 0;

  // Group monthly stats by month for accordion/table display
  const groupedMonthly = useMemo(() => {
    const map = new Map<string, MonthlyStat[]>();
    monthlyStats.forEach(stat => {
      if (!map.has(stat.month)) map.set(stat.month, []);
      map.get(stat.month)!.push(stat);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0])); // sort desc
  }, [monthlyStats]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 4 }}>売上統計</h1>
          <p style={{ fontSize: 14, color: "#94a3b8" }}>操作件数の集計とアーカイブ</p>
        </div>
        
        {/* Tab Toggle */}
        <div style={{ display: "flex", background: "#f1f5f9", padding: 4, borderRadius: 12 }}>
          <button
            onClick={() => setTab("daily")}
            style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, border: "none",
              display: "flex", alignItems: "center", gap: 6, cursor: "pointer", transition: "all 0.2s",
              background: tab === "daily" ? "#fff" : "transparent",
              color: tab === "daily" ? "#0f172a" : "#64748b",
              boxShadow: tab === "daily" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            <BarChart3 size={16} /> 直近の日次推移
          </button>
          <button
            onClick={() => setTab("monthly")}
            style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, border: "none",
              display: "flex", alignItems: "center", gap: 6, cursor: "pointer", transition: "all 0.2s",
              background: tab === "monthly" ? "#fff" : "transparent",
              color: tab === "monthly" ? "#0f172a" : "#64748b",
              boxShadow: tab === "monthly" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            <Archive size={16} /> 月間アーカイブ
          </button>
        </div>
      </div>

      {tab === "daily" && (
        <>
          {loadingDaily ? (
            <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>読み込み中…</div>
          ) : (
            <>
              {/* Daily KPI */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "20px 16px" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>本日の操作数</p>
                  <p style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{todayTotal}</p>
                  <p style={{ fontSize: 12, color: ratio > 0 ? "#10b981" : ratio < 0 ? "#ef4444" : "#94a3b8", fontWeight: 600, marginTop: 4 }}>
                    {ratio > 0 ? `↑ +${ratio}%` : ratio < 0 ? `↓ ${ratio}%` : "± 0%"} 前日比
                  </p>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "20px 16px" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>本日の貸出</p>
                  <p style={{ fontSize: 28, fontWeight: 800, color: "#6366f1" }}>{dailyStats[0]?.lend || 0}</p>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "20px 16px" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>本日の返却</p>
                  <p style={{ fontSize: 28, fontWeight: 800, color: "#0ea5e9" }}>{dailyStats[0]?.return_ || 0}</p>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "20px 16px" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>本日の充填</p>
                  <p style={{ fontSize: 28, fontWeight: 800, color: "#10b981" }}>{dailyStats[0]?.fill || 0}</p>
                </div>
              </div>

              {/* Daily table */}
              <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24 }}>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                  <Calendar size={16} color="#6366f1" /> 日別推移（直近30日）
                </h2>
                {dailyStats.length === 0 ? (
                  <p style={{ textAlign: "center", padding: 20, color: "#cbd5e1", fontSize: 14 }}>ログがありません</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                          {["日付", "貸出", "返却", "充填", "合計"].map((h) => (
                            <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dailyStats.map((s) => (
                          <tr key={s.date} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: "#334155" }}>{s.date}</td>
                            <td style={{ padding: "10px 12px", fontSize: 14, fontWeight: 700, color: "#6366f1" }}>{s.lend}</td>
                            <td style={{ padding: "10px 12px", fontSize: 14, fontWeight: 700, color: "#0ea5e9" }}>{s.return_}</td>
                            <td style={{ padding: "10px 12px", fontSize: 14, fontWeight: 700, color: "#10b981" }}>{s.fill}</td>
                            <td style={{ padding: "10px 12px", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{s.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {tab === "monthly" && (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24, minHeight: 400 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <Archive size={16} color="#8b5cf6" /> 過去の月間実績（顧客別）
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 24 }}>
            ※毎月15日に前々月の統計データが自動集計されてここに追加されます。
          </p>

          {loadingMonthly ? (
            <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>アーカイブを読み込み中…</div>
          ) : groupedMonthly.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center", color: "#cbd5e1" }}>
              <Archive size={32} style={{ opacity: 0.5, marginBottom: 12 }} />
              <p>まだアーカイブされた月間データがありません。</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {groupedMonthly.map(([month, stats]) => (
                <div key={month} style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ background: "#f8fafc", padding: "12px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1e293b", letterSpacing: "0.05em" }}>{month}</h3>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", background: "#e2e8f0", padding: "2px 8px", borderRadius: 12 }}>
                      計 {stats.reduce((acc, curr) => acc + curr.lends, 0)} 貸出
                    </span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#fff", borderBottom: "2px solid #e8eaed" }}>
                          {["顧客名", "貸出計", "返却計", "未使用", "未充填/破損"].map((h) => (
                            <th key={h} style={{ padding: "10px 16px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stats.map((s) => (
                          <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9", background: "#fff" }}>
                            <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "#334155" }}>{s.location}</td>
                            <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 800, color: "#6366f1" }}>{s.lends}</td>
                            <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700, color: "#0ea5e9" }}>{s.returns}</td>
                            <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 600, color: "#f59e0b" }}>{s.unused}</td>
                            <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 600, color: "#ef4444" }}>{s.defaults}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
