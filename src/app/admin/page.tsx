"use client";

import { useState, useEffect } from "react";
import { BarChart3, Truck, Users, AlertTriangle } from "lucide-react";
import {
  logsRepository,
  tanksRepository,
  transactionsRepository,
} from "@/lib/firebase/repositories";
import { STATUS } from "@/lib/tank-rules";

// カード定義（アイコン・色のみ。値はstateで管理）
const CARD_DEFS = [
  { key: "todayOps", label: "本日の操作", icon: BarChart3, color: "#6366f1", bg: "#eef2ff" },
  { key: "renting", label: "貸出中", icon: Truck, color: "#0ea5e9", bg: "#f0f9ff" },
  { key: "activeStaff", label: "稼働スタッフ", icon: Users, color: "#10b981", bg: "#ecfdf5" },
  { key: "pending", label: "要対応", icon: AlertTriangle, color: "#f59e0b", bg: "#fffbeb" },
  { key: "qualityReports", label: "品質報告", icon: AlertTriangle, color: "#dc2626", bg: "#fef2f2" },
] as const;

type CardKey = (typeof CARD_DEFS)[number]["key"];

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<CardKey, number>>({
    todayOps: 0,
    renting: 0,
    activeStaff: 0,
    pending: 0,
    qualityReports: 0,
  });

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        // 今日の0時（ローカルタイム）
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

        // 3つのクエリを並列実行
        const [logs, tanks, pendingTxs, unchargedReports] = await Promise.all([
          // 本日のログ → 操作件数 + ユニークスタッフ数
          logsRepository.getActiveLogs({ from: todayStart }),
          // 貸出中タンク数
          tanksRepository.getTanks({ status: STATUS.LENT }),
          // 要対応トランザクション（受注待ち + 返却タグ処理待ち）
          transactionsRepository.getPendingTransactions(),
          // 顧客起点の未充填報告。read-only visibility 用で、要対応 status には混ぜない。
          transactionsRepository.getUnchargedReports(),
        ]);

        // ログからユニークスタッフ数を集計
        const staffSet = new Set<string>();
        logs.forEach((log) => {
          if (log.staffId) {
            staffSet.add(log.staffId);
          }
        });

        setValues({
          todayOps: logs.length,
          renting: tanks.length,
          activeStaff: staffSet.size,
          pending: pendingTxs.length,
          qualityReports: unchargedReports.length,
        });
      } catch (err) {
        console.error("ダッシュボードデータ取得エラー:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

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
        {CARD_DEFS.map((card) => {
          const Icon = card.icon;
          const displayValue = loading ? "—" : values[card.key].toLocaleString();
          return (
            <div
              key={card.key}
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
                  {displayValue}
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
    </div>
  );
}
