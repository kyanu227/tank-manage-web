"use client";

import { useState, useEffect } from "react";
import { User, TrendingUp, Award, Clock } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, orderBy, limit, where } from "firebase/firestore";

interface LogEntry {
  tankId: string;
  action: string;
  timestamp: any;
  location: string;
}

export default function MyPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState({ lend: 0, return: 0, fill: 0, other: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "logs"), where("logStatus", "==", "active"), orderBy("timestamp", "desc"), limit(100)));
        const entries: LogEntry[] = [];
        const counts = { lend: 0, return: 0, fill: 0, other: 0 };
        snap.forEach((d) => {
          const data = d.data() as LogEntry;
          entries.push(data);
          if (data.action === "貸出") counts.lend++;
          else if (data.action === "返却" || data.action?.includes("返却")) counts.return++;
          else if (data.action === "充填") counts.fill++;
          else counts.other++;
        });
        setLogs(entries);
        setStats(counts);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  const formatTime = (ts: any) => {
    if (!ts?.toDate) return "—";
    const d = ts.toDate();
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const STAT_CARDS = [
    { label: "貸出", value: stats.lend, color: "#6366f1", bg: "#eef2ff" },
    { label: "返却", value: stats.return, color: "#0ea5e9", bg: "#f0f9ff" },
    { label: "充填", value: stats.fill, color: "#10b981", bg: "#ecfdf5" },
    { label: "その他", value: stats.other, color: "#f59e0b", bg: "#fffbeb" },
  ];

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 16px 24px" }}>
      {/* Profile */}
      <div style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 20, padding: "28px 24px", marginBottom: 20, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <User size={26} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800 }}>スタッフ</h1>
            <p style={{ fontSize: 12, opacity: 0.8 }}>ランク: レギュラー</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "12px 14px" }}>
            <p style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>今月のスコア</p>
            <p style={{ fontSize: 24, fontWeight: 800 }}>—</p>
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "12px 14px" }}>
            <p style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>報酬見込み</p>
            <p style={{ fontSize: 24, fontWeight: 800 }}>—</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
        {STAT_CARDS.map((s) => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "16px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <TrendingUp size={16} color={s.color} />
            </div>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const }}>{s.label}</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{loading ? "—" : s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Clock size={16} color="#64748b" />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>最近の作業 (直近100件)</span>
        </div>
        {loading ? (
          <p style={{ textAlign: "center", padding: 20, color: "#94a3b8", fontSize: 14 }}>読み込み中…</p>
        ) : logs.length === 0 ? (
          <p style={{ textAlign: "center", padding: 20, color: "#cbd5e1", fontSize: 14 }}>ログがありません</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {logs.slice(0, 30).map((log, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#f8fafc" }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#0f172a", minWidth: 44 }}>{log.tankId}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#6366f1", background: "#eef2ff", padding: "2px 8px", borderRadius: 6 }}>{log.action}</span>
                <span style={{ flex: 1, fontSize: 11, color: "#94a3b8" }}>{log.location}</span>
                <span style={{ fontSize: 10, color: "#cbd5e1" }}>{formatTime(log.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
