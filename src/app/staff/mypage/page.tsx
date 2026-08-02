"use client";

import { useState, useEffect } from "react";
import { User, TrendingUp, Clock, Mail } from "lucide-react";
import type { Timestamp } from "firebase/firestore";
import { logsRepository } from "@/lib/firebase/repositories";
import { useStaffProfile } from "@/hooks/useStaffProfile";
import { useStaffLocale } from "@/hooks/useStaffSession";
import { useTankDataRevision } from "@/hooks/useTankDataRevision";
import {
  isFillActionCode,
  isLendActionCode,
  isReturnActionCode,
} from "@/lib/tank-action-status-codes";
import {
  getOperationOccurredAt,
  projectOfficialAggregationEvent,
} from "@/lib/tank-transition-projections";
import { getLegacyTankActionLabel } from "@/lib/tank-action-status-labels";
import {
  formatMyPageTime,
  formatMyPageLocation,
  formatProfileDescription,
  formatRecentWorkTitle,
  formatStaffProfileName,
  formatStaffProfileRank,
  getMyPageText,
} from "@/features/staff-dashboard/mypage-i18n";

interface LogEntry {
  tankId: string;
  action: string;
  transitionAction?: string;
  timestamp?: Timestamp;
  location: string;
  customerId?: string;
  customerName?: string;
}

export default function MyPage() {
  const tankDataRevision = useTankDataRevision();
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
  const [logsLoadFailed, setLogsLoadFailed] = useState(false);
  const [logsLoadVersion, setLogsLoadVersion] = useState(0);
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
      setLogsLoadFailed(false);
      try {
        // 必要 index: logs(logStatus Asc, staffId Asc, timestamp Desc, __name__ Desc)
        const fetched = await logsRepository.getActiveLogsByStaffId(staffId, { limit: 100 });
        const entries: LogEntry[] = [];
        const counts = { lend: 0, return: 0, fill: 0, other: 0 };
        fetched.forEach((log) => {
          const action = log.action ?? "";
          const officialEvent = projectOfficialAggregationEvent(log);
          entries.push({
            tankId: log.tankId ?? "",
            action,
            transitionAction: log.transitionAction,
            timestamp: getOperationOccurredAt(log),
            location: log.location ?? "",
            customerId: log.customerId,
            customerName: log.customerName,
          });
          if (!officialEvent) return;
          if (isLendActionCode(officialEvent.action)) counts.lend++;
          else if (isReturnActionCode(officialEvent.action)) counts.return++;
          else if (isFillActionCode(officialEvent.action)) counts.fill++;
          else counts.other++;
        });
        if (cancelled) return;
        setLogs(entries);
        setStats(counts);
      } catch (e) {
        console.error("getActiveLogsByStaffId failed", e);
        if (!cancelled) setLogsLoadFailed(true);
      }
      finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profileLoading, staffId, tankDataRevision, logsLoadVersion]);

  const formatTime = (ts?: Timestamp) => {
    if (!ts?.toDate) return "—";
    const d = ts.toDate();
    return formatMyPageTime(d, currentLocale);
  };

  const STAT_CARDS = [
    { label: getMyPageText("lend", currentLocale), value: stats.lend, color: "#6366f1", bg: "#eef2ff" },
    { label: getMyPageText("return", currentLocale), value: stats.return, color: "#0ea5e9", bg: "#f0f9ff" },
    { label: getMyPageText("fill", currentLocale), value: stats.fill, color: "#10b981", bg: "#ecfdf5" },
    { label: getMyPageText("other", currentLocale), value: stats.other, color: "#f59e0b", bg: "#fffbeb" },
  ];

  const displayName = profile
    ? formatStaffProfileName(
        profile.name,
        currentLocale,
        profile.generatedFallbacks?.name === true,
      )
    : getMyPageText("staff", currentLocale);
  const displayRole = profile?.role || session?.role || "";
  const displayRank = profile
    ? formatStaffProfileRank(
        profile.rank,
        currentLocale,
        profile.generatedFallbacks?.rank === true,
      )
    : "";
  const displayEmail = profile?.email || session?.email || "";
  const profileTitle = profileLoading && !profile ? getMyPageText("loading", currentLocale) : displayName;
  const profileDescription = profileLoading && !profile
    ? getMyPageText("profileChecking", currentLocale)
    : formatProfileDescription(displayRole, displayRank, currentLocale);

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
          <p role="alert" style={{ marginBottom: 12, fontSize: 11, fontWeight: 700, color: "#fee2e2" }}>
            {currentLocale === "ja" ? profileError : getMyPageText("profileLoadFailure", currentLocale)}
          </p>
        )}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "12px 14px" }}>
            <p style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>{getMyPageText("monthlyScore", currentLocale)}</p>
            <p style={{ fontSize: 24, fontWeight: 800 }}>—</p>
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "12px 14px" }}>
            <p style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>{getMyPageText("estimatedReward", currentLocale)}</p>
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
          <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>{formatRecentWorkTitle(100, currentLocale)}</span>
        </div>
        {logsLoadFailed && logs.length > 0 && (
          <div role="alert" style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 8, color: "#9a3412", background: "#fff7ed", border: "1px solid #fed7aa", fontSize: 11 }}>
            {getMyPageText("logsLoadFailure", currentLocale)}
            <button type="button" onClick={() => setLogsLoadVersion((value) => value + 1)} style={{ marginLeft: 8 }}>
              {getMyPageText("retry", currentLocale)}
            </button>
          </div>
        )}
        {loading ? (
          <p role="status" aria-live="polite" style={{ textAlign: "center", padding: 20, color: "#94a3b8", fontSize: 14 }}>
            {getMyPageText("loading", currentLocale)}
          </p>
        ) : logsLoadFailed && logs.length === 0 ? (
          <div role="alert" style={{ textAlign: "center", padding: 20, color: "#991b1b", fontSize: 14 }}>
            <p>{getMyPageText("logsLoadFailure", currentLocale)}</p>
            <button type="button" onClick={() => setLogsLoadVersion((value) => value + 1)}>
              {getMyPageText("retry", currentLocale)}
            </button>
          </div>
        ) : logs.length === 0 ? (
          <p style={{ textAlign: "center", padding: 20, color: "#cbd5e1", fontSize: 14 }}>
            {getMyPageText("noLogs", currentLocale)}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {logs.slice(0, 30).map((log, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#f8fafc" }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#0f172a", minWidth: 44 }}>{log.tankId}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#6366f1", background: "#eef2ff", padding: "2px 8px", borderRadius: 6 }}>
                  {getLegacyTankActionLabel(log.action, currentLocale)
                    ?? (currentLocale === "ja" ? log.action : getMyPageText("unknownAction", currentLocale))}
                </span>
                <span style={{ flex: 1, fontSize: 11, color: "#94a3b8" }}>{formatMyPageLocation(log, currentLocale)}</span>
                <span style={{ fontSize: 10, color: "#cbd5e1" }}>{formatTime(log.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
