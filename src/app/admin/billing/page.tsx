"use client";

import { useState, useEffect } from "react";
import { FileText, Printer, Calendar } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, orderBy } from "firebase/firestore";

interface BillItem { customer: string; count: number; total10: number; total12: number; totalPrice: number; }

export default function BillingPage() {
  const [bills, setBills] = useState<BillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  useEffect(() => {
    (async () => {
      try {
        // Get log data to aggregate by customer
        const logSnap = await getDocs(query(collection(db, "logs"), orderBy("timestamp", "desc")));
        // Get customer pricing
        const custSnap = await getDocs(collection(db, "customers"));
        const priceMap: Record<string, { price10: number; price12: number }> = {};
        custSnap.forEach((d) => {
          const data = d.data();
          priceMap[data.name] = { price10: Number(data.price10) || 0, price12: Number(data.price12) || 0 };
        });

        const [y, m] = period.split("-").map(Number);
        const custMap: Record<string, { count: number }> = {};
        logSnap.forEach((d) => {
          const data = d.data();
          if (data.action !== "貸出" || !data.timestamp?.toDate) return;
          const dt = data.timestamp.toDate();
          if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m) return;
          const loc = data.location || "不明";
          if (!custMap[loc]) custMap[loc] = { count: 0 };
          custMap[loc].count++;
        });

        const items: BillItem[] = Object.entries(custMap).map(([customer, v]) => {
          const p = priceMap[customer] || { price10: 0, price12: 0 };
          return {
            customer, count: v.count,
            total10: v.count, total12: 0,
            totalPrice: v.count * p.price10,
          };
        }).sort((a, b) => b.count - a.count);
        setBills(items);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [period]);

  const grandTotal = bills.reduce((s, b) => s + b.totalPrice, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 4 }}>請求書発行</h1>
          <p style={{ fontSize: 14, color: "#94a3b8" }}>月次の貸出先別請求データ</p>
        </div>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)}
          style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 14, fontWeight: 600, color: "#334155", outline: "none" }} />
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>読み込み中…</div>
      ) : bills.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
          {period} の貸出データがありません
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {bills.map((b) => (
            <div key={b.customer} style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "20px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{b.customer}</h3>
                <button onClick={() => window.print()}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <Printer size={14} /> 印刷
                </button>
              </div>
              <div style={{ display: "flex", gap: 20 }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>貸出件数</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "#6366f1" }}>{b.count}<span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}> 本</span></p>
                </div>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>請求額</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", fontFamily: "monospace" }}>¥{b.totalPrice.toLocaleString()}</p>
                </div>
              </div>
            </div>
          ))}

          {/* Grand total */}
          <div style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 14, padding: "20px 20px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>合計請求額</span>
            <span style={{ fontSize: 26, fontWeight: 800, fontFamily: "monospace" }}>¥{grandTotal.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
