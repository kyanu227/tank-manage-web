"use client";

/**
 * 状態遷移図ページ（管理者画面）
 *
 * tank-rules.ts の OP_RULES を単一の情報源として、
 * 状態遷移・請求可否・報酬可否を一元ビジュアライズする。
 *
 * ルール変更 → 再デプロイで即反映（図はコードから自動生成）。
 */

import { useMemo, useState } from "react";
import {
  STATUS,
  ACTION,
  OP_RULES,
  STATUS_COLORS,
  type TankAction,
  type TankStatus,
} from "@/lib/tank-rules";
import { isRewardEligible } from "@/lib/incentive-rules";
import { isBillable } from "@/lib/billing-rules";
import {
  Workflow,
  Coins,
  Receipt,
  Check,
  Minus,
  ArrowRight,
  Info,
} from "lucide-react";

/* ══════════════════════════════════
   カテゴリ分類
   ══════════════════════════════════ */
const CATEGORIES: { name: string; color: string; actions: TankAction[] }[] = [
  {
    name: "メインサイクル",
    color: "#6366f1",
    actions: [
      ACTION.LEND,
      ACTION.RETURN,
      ACTION.RETURN_UNUSED,
      ACTION.RETURN_DEFECT,
      ACTION.CARRY_OVER,
      ACTION.FILL,
    ],
  },
  {
    name: "自社利用",
    color: "#f59e0b",
    actions: [
      ACTION.IN_HOUSE_USE,
      ACTION.IN_HOUSE_USE_RETRO,
      ACTION.IN_HOUSE_RETURN,
      ACTION.IN_HOUSE_RETURN_UNUSED,
      ACTION.IN_HOUSE_RETURN_DEFECT,
    ],
  },
  {
    name: "異常系・メンテナンス",
    color: "#ef4444",
    actions: [ACTION.DAMAGE_REPORT, ACTION.REPAIRED, ACTION.INSPECTION],
  },
  {
    name: "破棄",
    color: "#374151",
    actions: [ACTION.DISPOSE],
  },
];

/* ══════════════════════════════════
   状態ノードの配置（ビジュアル用）
   ══════════════════════════════════ */
const NODE_LAYOUT: Record<TankStatus, { col: number; row: number; label: string }> = {
  [STATUS.EMPTY]:      { col: 0, row: 1, label: "空" },
  [STATUS.FILLED]:     { col: 1, row: 1, label: "充填済み" },
  [STATUS.LENT]:       { col: 2, row: 1, label: "貸出中" },
  [STATUS.UNRETURNED]: { col: 3, row: 1, label: "未返却" },
  [STATUS.IN_HOUSE]:   { col: 2, row: 2, label: "自社利用中" },
  [STATUS.DAMAGED]:    { col: 0, row: 0, label: "破損" },
  [STATUS.DEFECTIVE]:  { col: 1, row: 0, label: "不良" },
  [STATUS.DISPOSED]:   { col: 3, row: 0, label: "破棄" },
};

/* ══════════════════════════════════
   バッジコンポーネント
   ══════════════════════════════════ */
function BillingBadge({ billable }: { billable: boolean | null }) {
  if (billable === null) {
    return (
      <span style={badgeStyle("#f1f5f9", "#94a3b8")}>
        <Minus size={11} />
        対象外
      </span>
    );
  }
  if (billable) {
    return (
      <span style={badgeStyle("#ecfdf5", "#059669")}>
        <Receipt size={11} />
        請求あり
      </span>
    );
  }
  return (
    <span style={badgeStyle("#fef2f2", "#dc2626")}>
      <Minus size={11} />
      請求なし
    </span>
  );
}

function RewardBadge({ eligible }: { eligible: boolean }) {
  if (eligible) {
    return (
      <span style={badgeStyle("#fffbeb", "#d97706")}>
        <Coins size={11} />
        報酬あり
      </span>
    );
  }
  return (
    <span style={badgeStyle("#f1f5f9", "#94a3b8")}>
      <Minus size={11} />
      報酬なし
    </span>
  );
}

function badgeStyle(bg: string, color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 8px",
    borderRadius: 6,
    background: bg,
    color,
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: "nowrap",
  };
}

function StatusChip({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "#94a3b8";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: `${color}18`,
        color,
        fontSize: 12,
        fontWeight: 700,
        border: `1px solid ${color}40`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
        }}
      />
      {status}
    </span>
  );
}

/* ══════════════════════════════════
   状態ノードマップ
   ══════════════════════════════════ */
function StateNodeMap({ hoveredStatus, setHoveredStatus }: {
  hoveredStatus: string | null;
  setHoveredStatus: (s: string | null) => void;
}) {
  // 各ステータスについて、流入・流出する操作を集計
  const statusFlows = useMemo(() => {
    const flows: Record<string, { incoming: TankAction[]; outgoing: TankAction[] }> = {};
    (Object.values(STATUS) as TankStatus[]).forEach((s) => {
      flows[s] = { incoming: [], outgoing: [] };
    });
    (Object.entries(OP_RULES) as [TankAction, typeof OP_RULES[TankAction]][]).forEach(
      ([action, rule]) => {
        flows[rule.nextStatus].incoming.push(action);
        rule.allowedPrev.forEach((prev) => {
          flows[prev].outgoing.push(action);
        });
      }
    );
    return flows;
  }, []);

  const maxCol = Math.max(...Object.values(NODE_LAYOUT).map((v) => v.col));
  const maxRow = Math.max(...Object.values(NODE_LAYOUT).map((v) => v.row));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${maxCol + 1}, 1fr)`,
        gridTemplateRows: `repeat(${maxRow + 1}, auto)`,
        gap: 16,
        padding: 20,
        background: "#fff",
        border: "1px solid #e8eaed",
        borderRadius: 16,
      }}
    >
      {(Object.entries(NODE_LAYOUT) as [TankStatus, typeof NODE_LAYOUT[TankStatus]][]).map(
        ([status, pos]) => {
          const color = STATUS_COLORS[status] ?? "#94a3b8";
          const flows = statusFlows[status];
          const isHovered = hoveredStatus === status;

          return (
            <div
              key={status}
              onMouseEnter={() => setHoveredStatus(status)}
              onMouseLeave={() => setHoveredStatus(null)}
              style={{
                gridColumnStart: pos.col + 1,
                gridRowStart: pos.row + 1,
                background: isHovered ? `${color}10` : "#fafbfc",
                border: `2px solid ${isHovered ? color : `${color}60`}`,
                borderRadius: 14,
                padding: "14px 16px",
                cursor: "pointer",
                transition: "all 0.15s",
                transform: isHovered ? "translateY(-2px)" : "none",
                boxShadow: isHovered ? `0 8px 20px ${color}30` : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: color,
                  }}
                />
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: "#0f172a",
                  }}
                >
                  {status}
                </span>
              </div>

              <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.6 }}>
                <div>
                  <span style={{ color: "#94a3b8", fontWeight: 600 }}>流入:</span>{" "}
                  {flows.incoming.length > 0 ? (
                    flows.incoming.map((a) => (
                      <span
                        key={a}
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          margin: "2px 2px 2px 0",
                          background: "#eef2ff",
                          color: "#4f46e5",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {a}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: "#cbd5e1" }}>—</span>
                  )}
                </div>
                <div style={{ marginTop: 4 }}>
                  <span style={{ color: "#94a3b8", fontWeight: 600 }}>流出:</span>{" "}
                  {flows.outgoing.length > 0 ? (
                    flows.outgoing.map((a) => (
                      <span
                        key={a}
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          margin: "2px 2px 2px 0",
                          background: "#fef3c7",
                          color: "#b45309",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {a}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: "#cbd5e1" }}>—</span>
                  )}
                </div>
              </div>
            </div>
          );
        }
      )}
    </div>
  );
}

/* ══════════════════════════════════
   遷移ルール表（カテゴリ別）
   ══════════════════════════════════ */
function TransitionTable({
  categoryColor,
  actions,
  hoveredStatus,
}: {
  categoryColor: string;
  actions: TankAction[];
  hoveredStatus: string | null;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e8eaed",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e8eaed" }}>
            <th style={thStyle}>操作</th>
            <th style={thStyle}>遷移元</th>
            <th style={thStyle}>遷移先</th>
            <th style={thStyle}>請求</th>
            <th style={thStyle}>報酬</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((action) => {
            const rule = OP_RULES[action];
            const billable = isBillable(action);
            const rewarded = isRewardEligible(action);
            const allowedPrev =
              rule.allowedPrev.length === 0
                ? null // 制限なし
                : rule.allowedPrev;

            const highlighted =
              hoveredStatus &&
              (allowedPrev?.includes(hoveredStatus as TankStatus) ||
                rule.nextStatus === hoveredStatus);

            return (
              <tr
                key={action}
                style={{
                  borderBottom: "1px solid #f1f5f9",
                  background: highlighted ? "#fffbeb" : "transparent",
                  transition: "background 0.12s",
                }}
              >
                <td style={tdStyle}>
                  <span
                    style={{
                      fontWeight: 700,
                      color: "#0f172a",
                      borderLeft: `3px solid ${categoryColor}`,
                      paddingLeft: 10,
                    }}
                  >
                    {action}
                  </span>
                </td>
                <td style={tdStyle}>
                  {allowedPrev === null ? (
                    <span
                      style={{
                        fontSize: 11,
                        color: "#64748b",
                        fontStyle: "italic",
                        background: "#f1f5f9",
                        padding: "3px 8px",
                        borderRadius: 6,
                        fontWeight: 600,
                      }}
                    >
                      どの状態からでも可
                    </span>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {allowedPrev.map((s) => (
                        <StatusChip key={s} status={s} />
                      ))}
                    </div>
                  )}
                </td>
                <td style={tdStyle}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <ArrowRight size={14} color="#cbd5e1" />
                    <StatusChip status={rule.nextStatus} />
                  </div>
                </td>
                <td style={tdStyle}>
                  <BillingBadge billable={billable} />
                </td>
                <td style={tdStyle}>
                  <RewardBadge eligible={rewarded} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: "#64748b",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "middle",
};

/* ══════════════════════════════════
   集計サマリー
   ══════════════════════════════════ */
function SummaryCards() {
  const stats = useMemo(() => {
    const actions = Object.values(ACTION) as TankAction[];
    const billable = actions.filter((a) => isBillable(a) === true).length;
    const nonBillable = actions.filter((a) => isBillable(a) === false).length;
    const rewarded = actions.filter((a) => isRewardEligible(a)).length;
    const notRewarded = actions.length - rewarded;
    return {
      totalStatuses: Object.values(STATUS).length,
      totalActions: actions.length,
      billable,
      nonBillable,
      rewarded,
      notRewarded,
    };
  }, []);

  const cards = [
    {
      label: "ステータス数",
      value: stats.totalStatuses,
      color: "#6366f1",
      bg: "#eef2ff",
    },
    {
      label: "操作数",
      value: stats.totalActions,
      color: "#0ea5e9",
      bg: "#e0f2fe",
    },
    {
      label: "請求発生操作",
      value: stats.billable,
      sub: `非請求 ${stats.nonBillable}`,
      color: "#059669",
      bg: "#ecfdf5",
    },
    {
      label: "報酬発生操作",
      value: stats.rewarded,
      sub: `報酬なし ${stats.notRewarded}`,
      color: "#d97706",
      bg: "#fffbeb",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
        marginBottom: 20,
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: "#fff",
            border: "1px solid #e8eaed",
            borderRadius: 14,
            padding: "14px 18px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 900,
              color: c.color,
              marginTop: 4,
              lineHeight: 1,
            }}
          >
            {c.value}
          </div>
          {c.sub && (
            <div
              style={{
                fontSize: 11,
                color: "#94a3b8",
                marginTop: 4,
                fontWeight: 600,
              }}
            >
              {c.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════
   メインページ
   ══════════════════════════════════ */
export default function StateDiagramPage() {
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null);

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      {/* ── ヘッダー ── */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "#0f172a",
            marginBottom: 4,
            letterSpacing: "-0.02em",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Workflow size={26} color="#6366f1" />
          タンク状態遷移図
        </h1>
        <p style={{ fontSize: 13, color: "#64748b" }}>
          <code
            style={{
              background: "#f1f5f9",
              padding: "1px 6px",
              borderRadius: 4,
              fontSize: 12,
              color: "#334155",
            }}
          >
            tank-rules.ts
          </code>{" "}
          ・{" "}
          <code
            style={{
              background: "#f1f5f9",
              padding: "1px 6px",
              borderRadius: 4,
              fontSize: 12,
              color: "#334155",
            }}
          >
            incentive-rules.ts
          </code>{" "}
          ・{" "}
          <code
            style={{
              background: "#f1f5f9",
              padding: "1px 6px",
              borderRadius: 4,
              fontSize: 12,
              color: "#334155",
            }}
          >
            billing-rules.ts
          </code>{" "}
          から自動生成。ルール変更は即座に反映されます。
        </p>
      </div>

      {/* ── サマリー ── */}
      <SummaryCards />

      {/* ── 操作説明 ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
          borderRadius: 10,
          marginBottom: 16,
          fontSize: 12,
          color: "#0c4a6e",
          fontWeight: 600,
        }}
      >
        <Info size={14} color="#0284c7" />
        ステータスノードにカーソルを合わせると、下の表で関連する遷移がハイライトされます
      </div>

      {/* ── 状態ノードマップ ── */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={sectionTitleStyle}>状態ノードマップ</h2>
        <StateNodeMap
          hoveredStatus={hoveredStatus}
          setHoveredStatus={setHoveredStatus}
        />
      </div>

      {/* ── カテゴリ別遷移表 ── */}
      <div>
        <h2 style={sectionTitleStyle}>遷移ルール詳細</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {CATEGORIES.map((cat) => (
            <div key={cat.name}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                  paddingLeft: 4,
                }}
              >
                <span
                  style={{
                    width: 4,
                    height: 16,
                    background: cat.color,
                    borderRadius: 2,
                  }}
                />
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#334155",
                    margin: 0,
                  }}
                >
                  {cat.name}
                </h3>
                <span
                  style={{
                    fontSize: 11,
                    color: "#94a3b8",
                    fontWeight: 600,
                  }}
                >
                  {cat.actions.length} 操作
                </span>
              </div>
              <TransitionTable
                categoryColor={cat.color}
                actions={cat.actions}
                hoveredStatus={hoveredStatus}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── 注釈 ── */}
      <div
        style={{
          marginTop: 32,
          padding: 20,
          background: "#fafbfc",
          border: "1px solid #e8eaed",
          borderRadius: 14,
          fontSize: 12,
          color: "#64748b",
          lineHeight: 1.7,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            color: "#334155",
            marginBottom: 8,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          補足ルール
        </div>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <b>請求</b>: 通常返却のみ請求対象。未使用返却・未充填返却・自社系は請求対象外。
          </li>
          <li>
            <b>報酬</b>: 自社系・破棄は報酬対象外。未充填返却（回収作業）は報酬あり。
          </li>
          <li>
            <b>未充填返却時の自動取消</b>: 未充填返却が発生すると、直前の充填者の報酬が自動的に取消される。
          </li>
          <li>
            <b>共同作業</b>: 複数人で作業した場合、報酬・スコアは人数で均等割り（端数切捨て）。
          </li>
          <li>
            <b>持ち越し</b>: 顧客が未使用タンクを翌日以降も保持する場合に、貸出中から未返却へ移す操作。
          </li>
          <li>
            <b>遷移元「どの状態からでも可」</b>: 現時点では耐圧検査完了など、画面側で対象を絞る前提の例外操作。自社利用(事後)・破損報告・破棄は現在は状態制限あり。
          </li>
        </ul>
      </div>
    </div>
  );
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  color: "#334155",
  marginBottom: 10,
  letterSpacing: "-0.01em",
};
