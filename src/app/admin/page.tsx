"use client";

import { BarChart3, Truck, Users, AlertTriangle } from "lucide-react";

const CARDS = [
  { label: "本日の売上", value: "—", icon: BarChart3, color: "#6366f1", bg: "#eef2ff" },
  { label: "貸出中", value: "—", icon: Truck, color: "#0ea5e9", bg: "#f0f9ff" },
  { label: "稼働スタッフ", value: "—", icon: Users, color: "#10b981", bg: "#ecfdf5" },
  { label: "要対応", value: "—", icon: AlertTriangle, color: "#f59e0b", bg: "#fffbeb" },
];

export default function AdminDashboardPage() {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>
          ダッシュボード
        </h1>
        <p style={{ fontSize: 14, color: "#94a3b8", marginTop: 4 }}>
          システム全体の稼働状況
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              style={{
                background: "#fff",
                border: "1px solid #e8eaed",
                borderRadius: 16,
                padding: "24px 20px",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
              }}
            >
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {card.label}
                </p>
                <p style={{ fontSize: 32, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
                  {card.value}
                </p>
              </div>
              <div
                style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: card.bg, display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Icon size={20} color={card.color} />
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e8eaed",
          borderRadius: 16,
          padding: "32px",
          textAlign: "center",
          color: "#94a3b8",
        }}
      >
        <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
          Firebaseに接続後、リアルタイムデータが表示されます
        </p>
        <p style={{ fontSize: 13 }}>
          先に「設定変更」からマスターデータを登録してください
        </p>
      </div>
    </div>
  );
}
