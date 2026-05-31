"use client";

import { useState, useEffect } from "react";
import { User, TrendingUp, Clock, Mail } from "lucide-react";
import type { Timestamp } from "firebase/firestore";
import { logsRepository } from "@/lib/firebase/repositories";
import { useStaffProfile } from "@/hooks/useStaffProfile";
import { useStaffLocale } from "@/hooks/useStaffSession";
import { updateOwnStaffLocale } from "@/lib/firebase/staff-locale-service";
import { normalizeLocale, SUPPORTED_LOCALES, type Locale } from "@/lib/locale";

interface LogEntry {
  tankId: string;
  action: string;
  timestamp?: Timestamp;
  location: string;
}

const LOCALE_LABELS: Record<Locale, string> = {
  ja: "日本語",
  en: "English",
};

export default function MyPage() {
  const {
    profile,
    session,
    loading: profileLoading,
    error: profileError,
  } = useStaffProfile();
  const currentLocale = useStaffLocale();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState({ lend: 0, return: 0, fill: 0, other: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedLocale, setSelectedLocale] = useState<Locale>(currentLocale);
  const [localeSaving, setLocaleSaving] = useState(false);
  const [localeMessage, setLocaleMessage] = useState("");
  const [localeError, setLocaleError] = useState("");
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
  const localeChanged = selectedLocale !== currentLocale;

  const handleSaveLocale = async () => {
    setLocaleSaving(true);
    setLocaleMessage("");
    setLocaleError("");
    try {
      const result = await updateOwnStaffLocale(selectedLocale);
      setSelectedLocale(result.locale);
      setLocaleMessage("表示言語を保存しました。");
    } catch (e) {
      setLocaleError(e instanceof Error
        ? e.message
        : "表示言語を保存できませんでした。再ログインしてからお試しください。");
    } finally {
      setLocaleSaving(false);
    }
  };

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

      {/* Settings */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 18, marginBottom: 20 }}>
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>表示設定</p>
          <p style={{ marginTop: 3, fontSize: 11, color: "#64748b" }}>このスタッフアカウントの表示言語を保存します。</p>
        </div>
        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
          表示言語
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={selectedLocale}
            onChange={(e) => {
              setSelectedLocale(normalizeLocale(e.target.value));
              setLocaleMessage("");
              setLocaleError("");
            }}
            disabled={localeSaving}
            style={{ flex: 1, minWidth: 0, height: 40, border: "1px solid #cbd5e1", borderRadius: 10, padding: "0 12px", fontSize: 13, fontWeight: 700, color: "#0f172a", background: "#fff" }}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <option key={locale} value={locale}>{LOCALE_LABELS[locale]}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSaveLocale}
            disabled={localeSaving || !localeChanged}
            style={{ height: 40, border: "none", borderRadius: 10, padding: "0 14px", fontSize: 12, fontWeight: 800, color: localeSaving || !localeChanged ? "#94a3b8" : "#fff", background: localeSaving || !localeChanged ? "#e2e8f0" : "#2563eb", cursor: localeSaving || !localeChanged ? "not-allowed" : "pointer" }}
          >
            {localeSaving ? "保存中…" : "保存"}
          </button>
        </div>
        {localeMessage && (
          <p style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: "#047857" }}>{localeMessage}</p>
        )}
        {localeError && (
          <p style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: "#dc2626" }}>{localeError}</p>
        )}
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
