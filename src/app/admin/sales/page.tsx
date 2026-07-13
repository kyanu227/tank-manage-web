"use client";

import { useState } from "react";
import { BarChart3, Calendar, Archive } from "lucide-react";
import { useSalesStats } from "@/hooks/useSalesStats";

export default function SalesPage() {
  const [tab, setTab] = useState<"daily" | "monthly">("daily");
  const {
    dailyStats,
    groupedMonthly,
    staleMonthlyCount,
    unknownMonthlyCount,
    dailyError,
    monthlyError,
    loadingDaily,
    loadingMonthly,
    todayStat,
    todayTotal,
    ratio,
  } = useSalesStats();

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
          {dailyError ? (
            <div style={{ padding: "12px 14px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 12, lineHeight: 1.6 }}>
              正式集計を表示できません: {dailyError.message}
            </div>
          ) : loadingDaily ? (
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
                  <p style={{ fontSize: 28, fontWeight: 800, color: "#6366f1" }}>{todayStat?.lend || 0}</p>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "20px 16px" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>本日の返却</p>
                  <p style={{ fontSize: 28, fontWeight: 800, color: "#0ea5e9" }}>{todayStat?.return_ || 0}</p>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "20px 16px" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>本日の充填</p>
                  <p style={{ fontSize: 28, fontWeight: 800, color: "#10b981" }}>{todayStat?.fill || 0}</p>
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

          {monthlyError && (
            <div style={{ padding: "12px 14px", marginBottom: 18, borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 12, lineHeight: 1.6 }}>
              月次集計を表示できません: {monthlyError.message}
            </div>
          )}

          {staleMonthlyCount > 0 && (
            <div style={{ padding: "10px 12px", marginBottom: 18, borderRadius: 10, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 12, lineHeight: 1.6 }}>
              例外操作レビュー後に再生成されていない月次アーカイブが {staleMonthlyCount}件あります。
              古い集計値は表示から除外しています。
            </div>
          )}

          {unknownMonthlyCount > 0 && (
            <div style={{ padding: "10px 12px", marginBottom: 18, borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", fontSize: 12, lineHeight: 1.6 }}>
              正式集計revisionを確認できない月次アーカイブが {unknownMonthlyCount}件あります。
              現在の正式集計との一致を確認できないため、値は表示から除外しています。
            </div>
          )}

          {monthlyError ? null : loadingMonthly ? (
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
