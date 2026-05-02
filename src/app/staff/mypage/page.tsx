"use client";

import { useState, useEffect } from "react";
import { User, TrendingUp, Clock, Mail } from "lucide-react";
import type { Timestamp } from "firebase/firestore";
import { logsRepository } from "@/lib/firebase/repositories";
import { useStaffProfile } from "@/hooks/useStaffProfile";

interface LogEntry {
  tankId: string;
  action: string;
  timestamp?: Timestamp;
  location: string;
}

export default function MyPage() {
  const {
    profile,
    session,
    loading: profileLoading,
    error: profileError,
  } = useStaffProfile();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState({ lend: 0, return: 0, fill: 0, other: 0 });
  const [loading, setLoading] = useState(true);
  const staffId = profile?.staffId || session?.id?.trim() || "";

  useEffect(() => {
    if (profileLoading && !staffId) return;

    if (!staffId) {
      // staffId が取れない場合は全体ログへ fallback せず、自分のログなしとして扱う。
      setLogs([]);
      setStats({ lend: 0, return: 0, fill: 0, other: 0 });
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        // 必要 index: logs(logStatus Asc, staffId Asc, timestamp Desc, __name__ Desc)
        const fetched = await logsRepository.getActiveLogsByStaffId(staffId, { limit: 100 });
        const entries: LogEntry[] = [];
        const counts = { lend: 0, return: 0, fill: 0, other: 0 };
        fetched.forEach((log) => {
          const action = log.action ?? "";
          entries.push({
            tankId: log.tankId ?? "",
            action,
            timestamp: log.timestamp,
            location: log.location ?? "",
          });
          if (action === "貸出") counts.lend++;
          else if (action === "返却" || action.includes("返却")) counts.return++;
          else if (action === "充填") counts.fill++;
          else counts.other++;
        });
        if (cancelled) return;
        setLogs(entries);
        setStats(counts);
      } catch (e) { console.error(e); }
      finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profileLoading, staffId]);

  const formatTime = (ts?: Timestamp) => {
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

  const displayName = profile?.name || session?.name || "スタッフ";
  const displayRole = profile?.role || session?.role || "";
  const displayRank = profile?.rank || session?.rank || "";
  const displayEmail = profile?.email || session?.email || "";
  const profileTitle = profileLoading && !profile && !session ? "読み込み中…" : displayName;
  const profileDescription = profileLoading && !profile
    ? "プロフィール確認中…"
    : [
        displayRole || "権限未設定",
        displayRank ? `ランク: ${displayRank}` : "ランク未設定",
      ].join(" / ");

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 16px 24px" }}>
      {/* Profile */}
      <div style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 20, padding: "28px 24px", marginBottom: 20, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <User size={26} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profileTitle}</h1>
            <p style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{profileDescription}</p>
            {displayEmail && (
              <p
                style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, opacity: 0.75, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={displayEmail}
              >
                <Mail size={12} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{displayEmail}</span>
              </p>
            )}
          </div>
        </div>
        {profileError && (
          <p style={{ marginBottom: 12, fontSize: 11, fontWeight: 700, color: "#fee2e2" }}>{profileError}</p>
        )}
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
