"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  MAX_OPERATION_REVIEW_BATCH_SIZE,
  listOperationReviews,
  reviewOperationLogs,
  type OperationReviewDecision,
  type OperationReviewItem,
  type OperationReviewListMode,
} from "@/lib/firebase/operation-review-service";
import {
  coerceTankActionCode,
} from "@/lib/tank-action-status-codes";
import {
  getTankActionLabel,
  getTankStatusLabel,
} from "@/lib/tank-action-status-labels";

type RecoveryEvidenceKey = NonNullable<
  OperationReviewItem["transitionPlan"]
>["requiredEvidence"][number];

const EVIDENCE_LABELS: Record<RecoveryEvidenceKey, string> = {
  physicalTankConfirmed: "現物タンクを確認",
  possessionConfirmed: "現在の保有状況を確認",
  previousCustomerConfirmed: "以前の貸出先を確認",
  fillStateConfirmed: "充填状態を確認",
  damageStateConfirmed: "破損・不良状態を確認",
};

const BUSINESS_EFFECT_LABELS = {
  state_only: "状態のみ整合",
  rental_open: "貸出サイクル開始",
  rental_close: "貸出サイクル終了",
} as const;

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  overflow: "hidden",
};

export default function OperationReviewsPage() {
  const [mode, setMode] = useState<OperationReviewListMode>("pending");
  const [items, setItems] = useState<OperationReviewItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadReviews = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await listOperationReviews(mode));
    } catch (cause) {
      console.error("例外操作レビュー取得エラー:", cause);
      setError(errorMessage(cause, "例外操作レビューを読み込めませんでした。"));
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  useEffect(() => {
    setSelectedIds(new Set());
    setReason("");
    setMessage("");
  }, [mode]);

  const selectableItems = useMemo(
    () => items.filter((item) => (
      item.transitionReviewStatus === "pending" && !item.validationError
    )),
    [items],
  );
  const selectableBatch = selectableItems.slice(0, MAX_OPERATION_REVIEW_BATCH_SIZE);
  const selectedCount = selectedIds.size;
  const allSelectableSelected = selectableBatch.length > 0
    && selectableBatch.every((item) => selectedIds.has(item.id));

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_OPERATION_REVIEW_BATCH_SIZE) next.add(id);
      return next;
    });
    setMessage("");
  };

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(
      selectableBatch.map((item) => item.id),
    ));
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitDecision = async (decision: OperationReviewDecision) => {
    setError("");
    setMessage("");
    if (selectedIds.size === 0) {
      setError("レビュー対象を選択してください。");
      return;
    }
    if (reason.trim().length < 5) {
      setError("レビュー理由を5文字以上で入力してください。");
      return;
    }

    const decisionLabel = decision === "approved"
      ? "正式集計に承認"
      : "正式集計から除外";
    if (!confirm(`${selectedIds.size}件を「${decisionLabel}」として確定しますか？\nこのrevision上では判断を変更できません。`)) {
      return;
    }

    setSubmitting(true);
    try {
      await reviewOperationLogs({
        logIds: [...selectedIds],
        decision,
        reason,
      });
      setMessage(`${selectedIds.size}件を${decisionLabel}しました。`);
      setSelectedIds(new Set());
      setReason("");
      await loadReviews();
    } catch (cause) {
      console.error("例外操作レビュー更新エラー:", cause);
      setError(errorMessage(cause, "レビュー結果を保存できませんでした。"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>
            例外操作レビュー
          </h1>
          <p style={{ fontSize: 14, color: "#94a3b8", marginTop: 4 }}>
            自動補完された操作を、請求・報酬・正式実績へ算入するか判断します
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadReviews()}
          disabled={loading || submitting}
          style={outlineButtonStyle(loading || submitting)}
        >
          <RefreshCw size={15} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />
          再読込
        </button>
      </div>

      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "14px 18px",
        marginBottom: 20,
        borderRadius: 12,
        background: "#fffbeb",
        border: "1px solid #fde68a",
      }}>
        <ShieldAlert size={20} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 13, lineHeight: 1.65, color: "#92400e", fontWeight: 500 }}>
          タンク状態は現場操作時点で確定済みです。この画面の判断は正式集計への算入だけを変更します。
          状態そのものが誤っている場合、自動補完ログは最新ログを取消して正しい操作を再実行してください。
        </p>
      </div>

      <div style={{ display: "flex", gap: 4, padding: 4, background: "#e2e8f0", borderRadius: 12, width: "fit-content", marginBottom: 20 }}>
        <TabButton active={mode === "pending"} onClick={() => setMode("pending")}>
          承認待ち
        </TabButton>
        <TabButton active={mode === "resolved"} onClick={() => setMode("resolved")}>
          処理済み履歴
        </TabButton>
      </div>

      {error && <MessageBanner tone="error">{error}</MessageBanner>}
      {message && <MessageBanner tone="success">{message}</MessageBanner>}

      {mode === "pending" && !loading && items.length > 0 && (
        <section style={{ ...cardStyle, padding: 18, marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 800, color: "#334155" }}>
                選択中 {selectedCount}件 / 最大{MAX_OPERATION_REVIEW_BATCH_SIZE}件
              </p>
              <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                検証エラーのある操作は選択できません
              </p>
            </div>
            <button
              type="button"
              onClick={toggleSelectAll}
              disabled={selectableItems.length === 0 || submitting}
              style={outlineButtonStyle(selectableItems.length === 0 || submitting)}
            >
              {allSelectableSelected
                ? "選択解除"
                : selectableItems.length > MAX_OPERATION_REVIEW_BATCH_SIZE
                  ? `先頭${MAX_OPERATION_REVIEW_BATCH_SIZE}件を選択`
                  : "全件選択"}
            </button>
          </div>

          <label style={{ display: "block", fontSize: 12, fontWeight: 800, color: "#475569", marginBottom: 6 }}>
            判断理由（5文字以上）
          </label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={submitting}
            placeholder="確認した内容と、正式集計へ算入または除外する理由"
            style={{
              width: "100%",
              minHeight: 84,
              boxSizing: "border-box",
              resize: "vertical",
              padding: "10px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              color: "#334155",
              fontSize: 13,
              lineHeight: 1.6,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void submitDecision("excluded")}
              disabled={submitting || selectedCount === 0}
              style={decisionButtonStyle("excluded", submitting || selectedCount === 0)}
            >
              <XCircle size={16} /> 正式集計から除外
            </button>
            <button
              type="button"
              onClick={() => void submitDecision("approved")}
              disabled={submitting || selectedCount === 0}
              style={decisionButtonStyle("approved", submitting || selectedCount === 0)}
            >
              {submitting
                ? <RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} />
                : <CheckCircle2 size={16} />}
              正式集計に承認
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <div style={{ ...cardStyle, padding: 60, textAlign: "center", color: "#94a3b8" }}>
          <RefreshCw size={24} style={{ animation: "spin 1s linear infinite", marginBottom: 10 }} />
          <p style={{ fontSize: 13, fontWeight: 700 }}>レビュー対象を読み込み中…</p>
        </div>
      ) : items.length === 0 ? (
        <div style={{ ...cardStyle, padding: 60, textAlign: "center", color: "#94a3b8" }}>
          <ClipboardCheck size={32} style={{ opacity: 0.55, marginBottom: 10 }} />
          <p style={{ fontSize: 14, fontWeight: 700 }}>
            {mode === "pending" ? "承認待ちの例外操作はありません" : "処理済みの例外操作はありません"}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              expanded={expandedIds.has(item.id)}
              disabled={submitting}
              onToggleSelected={() => toggleSelected(item.id)}
              onToggleExpanded={() => toggleExpanded(item.id)}
            />
          ))}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ReviewCard({
  item,
  selected,
  expanded,
  disabled,
  onToggleSelected,
  onToggleExpanded,
}: {
  item: OperationReviewItem;
  selected: boolean;
  expanded: boolean;
  disabled: boolean;
  onToggleSelected: () => void;
  onToggleExpanded: () => void;
}) {
  const pending = item.transitionReviewStatus === "pending";
  const selectable = pending && !item.validationError;
  const actionLabel = displayAction(item.action, item.transitionAction);
  const plan = item.transitionPlan;

  return (
    <article style={{
      ...cardStyle,
      borderColor: selected ? "#818cf8" : item.validationError ? "#fecaca" : "#e2e8f0",
      boxShadow: selected ? "0 0 0 2px #e0e7ff" : "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px" }}>
        {pending && (
          <input
            type="checkbox"
            checked={selected}
            disabled={!selectable || disabled}
            onChange={onToggleSelected}
            aria-label={`タンク ${item.tankId} を選択`}
            style={{ width: 18, height: 18, accentColor: "#6366f1", flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
              タンク {item.tankId || "不明"}
            </span>
            <ReviewStatusBadge status={item.transitionReviewStatus} />
            {item.isHistoryEvent && <LogStatusBadge status={item.logStatus} />}
            <span style={{ padding: "3px 8px", borderRadius: 999, background: "#eef2ff", color: "#4338ca", fontSize: 11, fontWeight: 800 }}>
              {actionLabel}
            </span>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 7, color: "#64748b", fontSize: 12 }}>
            <span>操作日時: {formatDate(item.occurredAt)}</span>
            <span>担当: {item.staffName || "不明"}</span>
            <span>影響顧客: {item.affectedCustomerIds.length}件{item.hasUnknownAffectedCustomer ? "＋不明" : ""}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleExpanded}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "7px 10px", border: "1px solid #e2e8f0", borderRadius: 8,
            background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 700,
            cursor: "pointer", flexShrink: 0,
          }}
        >
          詳細 {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {item.validationError && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 18px", background: "#fef2f2", borderTop: "1px solid #fecaca", color: "#b91c1c", fontSize: 12, fontWeight: 700 }}>
          <AlertTriangle size={15} /> {item.validationError}
        </div>
      )}

      {expanded && (
        <div style={{ padding: "18px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
          <DetailLabel>自動補完された経路</DetailLabel>
          {plan && plan.steps.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
              {plan.steps.map((step, index) => (
                <div key={`${item.id}-step-${index}`} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", gap: 10, alignItems: "start" }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, background: step.actorType === "system" ? "#fef3c7" : "#dbeafe", color: step.actorType === "system" ? "#b45309" : "#1d4ed8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>
                    {index + 1}
                  </div>
                  <div>
                    <p style={{ fontSize: 13, color: "#1e293b", fontWeight: 800 }}>
                      {getTankStatusLabel(step.fromStatus)} → {getTankActionLabel(step.action)} → {getTankStatusLabel(step.toStatus)}
                    </p>
                    <p style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                      {step.actorType === "system" ? "システム補完" : "担当者操作"}
                      {" ・ "}{BUSINESS_EFFECT_LABELS[step.businessEffect]}
                      {step.customerName ? ` ・ ${step.customerName}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#b91c1c", marginBottom: 18 }}>経路を表示できません。</p>
          )}

          <DetailLabel>実行時に必須だった確認</DetailLabel>
          {!plan ? (
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 18 }}>
              元ログが見つからないため確認証跡の詳細を表示できません。
            </p>
          ) : plan.requiredEvidence.length > 0 ? (
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 18 }}>
              {plan.requiredEvidence.map((key) => {
                const confirmed = item.recoveryEvidence[key] === true;
                return (
                  <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 9px", borderRadius: 999, background: confirmed ? "#ecfdf5" : "#fef2f2", color: confirmed ? "#047857" : "#b91c1c", fontSize: 11, fontWeight: 800 }}>
                    {confirmed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                    {EVIDENCE_LABELS[key]}
                  </span>
                );
              })}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 18 }}>必須確認項目なし</p>
          )}

          {item.hasUnknownAffectedCustomer && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 11px", borderRadius: 9, background: "#fef2f2", color: "#b91c1c", fontSize: 12, fontWeight: 700, marginBottom: 18 }}>
              <AlertTriangle size={15} /> 影響顧客を特定できないstepが含まれています
            </div>
          )}

          {!pending && (
            <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
              <DetailLabel>管理者判断</DetailLabel>
              <p style={{ fontSize: 12, color: "#475569", lineHeight: 1.7 }}>
                {formatDate(item.reviewedAt)} / {item.reviewedByStaffName || "不明"}<br />
                {item.reviewReason || "理由なし"}<br />
                UID: {item.reviewedByUid || "記録なし"} / Email: {item.reviewedByEmail || "記録なし"}<br />
                監査event: {item.eventId || "記録なし"} / 対象log: {item.logId || "記録なし"}
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function ReviewStatusBadge({ status }: { status: OperationReviewItem["transitionReviewStatus"] }) {
  const config = status === "approved"
    ? { label: "集計承認済み", color: "#047857", background: "#ecfdf5" }
    : status === "excluded"
      ? { label: "集計除外済み", color: "#b91c1c", background: "#fef2f2" }
      : status === "pending"
        ? { label: "承認待ち", color: "#b45309", background: "#fffbeb" }
        : { label: "判断不明", color: "#475569", background: "#f1f5f9" };
  return (
    <span style={{ padding: "3px 8px", borderRadius: 999, color: config.color, background: config.background, fontSize: 11, fontWeight: 800 }}>
      {config.label}
    </span>
  );
}

function LogStatusBadge({ status }: { status?: string }) {
  const config = status === "voided"
    ? { label: "取消済み", color: "#b91c1c", background: "#fef2f2" }
    : status === "superseded"
      ? { label: "訂正済み", color: "#6d28d9", background: "#f5f3ff" }
      : status === "active"
        ? { label: "有効log", color: "#0369a1", background: "#f0f9ff" }
        : { label: "元logなし", color: "#475569", background: "#f1f5f9" };
  return (
    <span style={{ padding: "3px 8px", borderRadius: 999, color: config.color, background: config.background, fontSize: 11, fontWeight: 800 }}>
      {config.label}
    </span>
  );
}

function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.04em", marginBottom: 7 }}>
      {children}
    </p>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 15px", border: "none", borderRadius: 9,
        background: active ? "#fff" : "transparent",
        color: active ? "#0f172a" : "#64748b",
        fontSize: 13, fontWeight: 800, cursor: "pointer",
        boxShadow: active ? "0 1px 3px rgba(15, 23, 42, 0.12)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function MessageBanner({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  const error = tone === "error";
  return (
    <div style={{ padding: "11px 14px", marginBottom: 16, borderRadius: 10, border: `1px solid ${error ? "#fecaca" : "#a7f3d0"}`, background: error ? "#fef2f2" : "#ecfdf5", color: error ? "#b91c1c" : "#047857", fontSize: 13, fontWeight: 700 }}>
      {children}
    </div>
  );
}

function outlineButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 13px", borderRadius: 9,
    border: "1px solid #cbd5e1", background: "#fff",
    color: "#475569", fontSize: 13, fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

function decisionButtonStyle(decision: OperationReviewDecision, disabled: boolean): React.CSSProperties {
  const approved = decision === "approved";
  return {
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: "10px 16px", borderRadius: 10,
    border: approved ? "none" : "1px solid #fecaca",
    background: approved ? "#059669" : "#fff",
    color: approved ? "#fff" : "#b91c1c",
    fontSize: 13, fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function displayAction(action?: string, transitionAction?: string): string {
  // top-level actionは利用者が実行したvisible action。transitionActionより優先する。
  const code = coerceTankActionCode(action) ?? coerceTankActionCode(transitionAction);
  return code ? getTankActionLabel(code) : "操作内容不明";
}

function formatDate(value?: { toDate(): Date }): string {
  if (!value) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value.toDate());
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
