"use client";

import { useState, useEffect } from "react";
import { Package, Clock, Activity, ShoppingCart, RotateCcw, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";

interface LogEntry { action: string; timestamp: any; tankId: string; staff: string; }

export default function PortalPage() {
  const [rentedTanks, setRentedTanks] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sessionStr = localStorage.getItem("customerSession");
    if (!sessionStr) return;
    const session = JSON.parse(sessionStr);
    const customerName = session.name;

    const fetchData = async () => {
      try {
        const tankSnap = await getDocs(query(collection(db, "tanks"), where("location", "==", customerName), where("status", "==", "貸出中")));
        const tanks: string[] = [];
        tankSnap.forEach((d) => tanks.push(d.id));
        setRentedTanks(tanks.sort());

        const logSnap = await getDocs(query(collection(db, "logs"), where("logStatus", "==", "active"), where("location", "==", customerName), orderBy("timestamp", "desc"), limit(30)));
        const recentLogs: LogEntry[] = [];
        logSnap.forEach((d) => recentLogs.push(d.data() as LogEntry));
        setLogs(recentLogs);
      } catch (e) {
        console.error("Portal fetch error", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const formatTime = (ts: any) => {
    if (!ts?.toDate) return "—";
    const d = ts.toDate();
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>
        読み込み中…
      </div>
    );
  }

  return (
    <div style={{
      height: "100%",
      display: "flex", flexDirection: "column",
      padding: "2dvh 4vw",
      gap: "1.8dvh",
      overflow: "hidden",
      boxSizing: "border-box",
    }}>

      {/* Action buttons */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        gap: "3vw", flexShrink: 0,
      }}>
        {[
          { href: "/portal/order",    icon: ShoppingCart,  label: "発注",   color: "#6366f1", bg: "#eef2ff" },
          { href: "/portal/return",   icon: RotateCcw,     label: "返却",   color: "#0ea5e9", bg: "#e0f2fe" },
          { href: "/portal/unfilled", icon: AlertTriangle, label: "未充填", color: "#f59e0b", bg: "#fef3c7" },
        ].map(({ href, icon: Icon, label, color, bg }) => (
          <Link
            key={href}
            href={href}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: "1dvh", padding: "2dvh 2vw", borderRadius: 14,
              background: "#fff", border: "1px solid #e8eaed",
              textDecoration: "none",
            }}
          >
            <div style={{ width: "clamp(32px, 10vw, 44px)", height: "clamp(32px, 10vw, 44px)", borderRadius: 10, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={20} color={color} />
            </div>
            <span style={{ fontSize: "clamp(11px, 3.2vw, 13px)", fontWeight: 700, color: "#334155" }}>{label}</span>
          </Link>
        ))}
      </div>

      {/* KPI */}
      <div style={{
        background: "linear-gradient(135deg, #0f172a, #1e293b)",
        borderRadius: 16, padding: "2dvh 5vw",
        color: "#fff", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <p style={{ fontSize: "clamp(10px, 2.8vw, 12px)", fontWeight: 600, opacity: 0.8, marginBottom: "0.6dvh", display: "flex", alignItems: "center", gap: 5 }}>
            <Package size={13} color="#38bdf8" /> 現在の貸出中タンク
          </p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: "clamp(28px, 8dvh, 40px)", fontWeight: 800, lineHeight: 1 }}>{rentedTanks.length}</span>
            <span style={{ fontSize: "clamp(12px, 3.5vw, 15px)", fontWeight: 600, opacity: 0.8 }}>本</span>
          </div>
        </div>
        {rentedTanks.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxWidth: "55%", justifyContent: "flex-end", overflow: "hidden", maxHeight: "9dvh" }}>
            {rentedTanks.slice(0, 8).map((id) => (
              <span key={id} style={{
                background: "rgba(56,189,248,0.15)", color: "#38bdf8",
                border: "1px solid rgba(56,189,248,0.3)",
                padding: "3px 8px", borderRadius: 6,
                fontSize: "clamp(10px, 2.5vw, 12px)", fontWeight: 700, fontFamily: "monospace",
              }}>
                {id}
              </span>
            ))}
            {rentedTanks.length > 8 && (
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", alignSelf: "center" }}>+{rentedTanks.length - 8}</span>
            )}
          </div>
        )}
      </div>

      {/* Recent History — takes remaining space, no scroll */}
      <div style={{
        flex: 1, minHeight: 0,
        background: "#fff", border: "1px solid #e8eaed", borderRadius: 14,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        <h2 style={{
          fontSize: "clamp(11px, 3vw, 13px)", fontWeight: 700, color: "#334155",
          padding: "1.5dvh 4vw", borderBottom: "1px solid #f1f5f9",
          display: "flex", alignItems: "center", gap: 6, flexShrink: 0, margin: 0,
        }}>
          <Clock size={14} color="#6366f1" /> 最近の履歴
        </h2>
        <div style={{ flex: 1, overflow: "hidden", padding: "1dvh 3vw", display: "flex", flexDirection: "column", gap: "1dvh" }}>
          {logs.length === 0 ? (
            <p style={{ textAlign: "center", padding: "3dvh 0", color: "#cbd5e1", fontSize: 13 }}>履歴がありません</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "2.5vw",
                padding: "1dvh 3vw", borderRadius: 10,
                background: "#f8fafc", border: "1px solid #f1f5f9",
                flexShrink: 0,
              }}>
                <span style={{ fontSize: "clamp(9px, 2.4vw, 11px)", color: "#94a3b8", minWidth: "9vw" }}>{formatTime(log.timestamp)}</span>
                <span style={{
                  fontSize: "clamp(9px, 2.4vw, 11px)", fontWeight: 700,
                  padding: "3px 6px", borderRadius: 5,
                  color: log.action === "貸出" ? "#6366f1" : "#ef4444",
                  background: log.action === "貸出" ? "#eef2ff" : "#fee2e2",
                  flexShrink: 0,
                }}>
                  {log.action}
                </span>
                <span style={{ flex: 1, fontFamily: "monospace", fontSize: "clamp(11px, 3vw, 13px)", fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.tankId}</span>
                <span style={{ fontSize: "clamp(9px, 2.4vw, 10px)", color: "#cbd5e1", flexShrink: 0, whiteSpace: "nowrap" }}>{log.staff}</span>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
