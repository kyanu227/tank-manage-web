"use client";

import { useState, useEffect } from "react";
import { Package, Clock, Activity } from "lucide-react";
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
        // Fetch rented tanks
        const tankSnap = await getDocs(query(collection(db, "tanks"), where("location", "==", customerName), where("status", "==", "貸出中")));
        const tanks: string[] = [];
        tankSnap.forEach((d) => tanks.push(d.id));
        setRentedTanks(tanks.sort());

        // Fetch recent logs
        const logSnap = await getDocs(query(collection(db, "logs"), where("location", "==", customerName), orderBy("timestamp", "desc"), limit(50)));
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
    return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>読み込み中…</div>;
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 20px" }}>
      
      {/* KPI: Rented Tanks */}
      <div style={{ background: "linear-gradient(135deg, #0f172a, #1e293b)", borderRadius: 20, padding: "32px 24px", color: "#fff", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, opacity: 0.8, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Package size={16} color="#38bdf8" /> 現在の貸出中タンク
          </p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{rentedTanks.length}</span>
            <span style={{ fontSize: 16, fontWeight: 600, opacity: 0.8 }}>本</span>
          </div>
        </div>
      </div>

      {/* Rented Tanks List */}
      {rentedTanks.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#334155", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <Activity size={18} color="#0ea5e9" /> 貸出中のタンクID
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {rentedTanks.map((id) => (
              <span key={id} style={{ background: "#f0f9ff", color: "#0ea5e9", border: "1px solid #bae6fd", padding: "6px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, fontFamily: "monospace" }}>
                {id}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent History */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "#334155", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <Clock size={18} color="#6366f1" /> 最近の履歴
        </h2>
        {logs.length === 0 ? (
          <p style={{ textAlign: "center", padding: "20px 0", color: "#cbd5e1", fontSize: 14 }}>履歴がありません</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {logs.map((log, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, background: "#f8fafc", border: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 12, color: "#94a3b8", minWidth: 40 }}>{formatTime(log.timestamp)}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 6, color: log.action === "貸出" ? "#6366f1" : "red", background: log.action === "貸出" ? "#eef2ff" : "#fee2e2" }}>
                  {log.action}
                </span>
                <span style={{ flex: 1, fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{log.tankId}</span>
                <span style={{ fontSize: 11, color: "#cbd5e1" }}>担: {log.staff}</span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
