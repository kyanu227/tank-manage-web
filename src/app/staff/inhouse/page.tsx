"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { STATUS, ACTION, resolveReturnAction, type ReturnTag, RETURN_TAG } from "@/lib/tank-rules";
import { applyTankOperation, applyBulkTankOperations } from "@/lib/tank-operation";
import { updateLogNote } from "@/lib/firebase/tank-tag-service";
import TankIdInput from "@/components/TankIdInput";
import ReturnTagSelector from "@/components/ReturnTagSelector";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { useTanks } from "@/hooks/useTanks";

type TagType = "normal" | "unused" | "uncharged";

const ACCENT = "#6366f1";

export default function InHousePage() {
  const { tanks: allTanks, tankMap, prefixes, loading, refetch } = useTanks();
  const [activePrefix, setActivePrefix] = useState<string | null>(null);
  const [numberValue, setNumberValue] = useState("");
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // タグの楽観更新を保持（refetch までの間 UI を即時反映するため）
  const [tagOverrides, setTagOverrides] = useState<Record<string, TagType>>({});
  const [reporting, setReporting] = useState(false);
  const [reportResult, setReportResult] = useState<{ success: boolean; message: string } | null>(null);
  const [returning, setReturning] = useState(false);

  // DrumRoll 操作中にページ全体へスクロールが逃げないよう、操作画面中だけロックする。
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      document.documentElement.style.overflow = "";
    };
  }, []);

  // 自社利用中タンク（tagOverrides を反映）
  const inHouseTanks = useMemo(() => {
    const list = allTanks
      .filter((t) => t.status === STATUS.IN_HOUSE)
      .map((t) => {
        const baseTag: TagType =
          t.logNote === "[TAG:unused]" ? "unused" :
          t.logNote === "[TAG:uncharged]" ? "uncharged" : "normal";
        return {
          id: t.id,
          status: t.status,
          location: t.location ?? "",
          staff: t.staff ?? "",
          updatedAt: t.updatedAt,
          logNote: t.logNote,
          tag: tagOverrides[t.id] ?? baseTag,
        };
      });
    return list;
  }, [allTanks, tagOverrides]);

  const updateTag = async (tankId: string, newTag: TagType) => {
    setTagOverrides((prev) => ({ ...prev, [tankId]: newTag }));
    try {
      let logNote = "";
      if (newTag === "unused") logNote = "[TAG:unused]";
      if (newTag === "uncharged") logNote = "[TAG:uncharged]";
      await updateLogNote(tankId, logNote);
    } catch (e) {
      console.error("Failed to update tag", e);
      // 失敗時はオーバーライドを取り消して最新状態を取り直す
      setTagOverrides((prev) => {
        const next = { ...prev };
        delete next[tankId];
        return next;
      });
      refetch();
    }
  };

  // TankIdInput からの commit: その場で事後報告実行
  const handleCommit = async (tankId: string) => {
    if (reporting) return;
    if (!/^[A-Z]+-(\d{2}|OK)$/.test(tankId)) {
      setReportResult({ success: false, message: "ID形式が正しくありません (例: A-01 / A-OK)" });
      return;
    }
    setReporting(true);
    setReportResult(null);
    try {
      const context = { actor: requireStaffIdentity() };
      const tank = tankMap[tankId];
      if (!tank) {
        setReportResult({ success: false, message: `${tankId} は登録されていません` });
        return;
      }
      if (tank.status === STATUS.IN_HOUSE) {
        setReportResult({ success: true, message: `${tankId} は既に自社利用中です` });
        return;
      }
      await applyTankOperation({
        tankId,
        transitionAction: ACTION.IN_HOUSE_USE_RETRO,
        currentStatus: tank.status,
        context,
        location: "自社",
        logNote: "事後報告",
      });
      setLastAdded(tankId);
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = setTimeout(() => setLastAdded(null), 1500);
      setReportResult({ success: true, message: `${tankId} の事後報告を完了しました` });
      setTagOverrides({});
      refetch();
    } catch (e: unknown) {
      setReportResult({ success: false, message: "エラー: " + errorMessage(e) });
    } finally {
      setReporting(false);
    }
  };

  const handleBulkReturn = async () => {
    if (inHouseTanks.length === 0) return;
    if (!confirm(`自社利用中のタンク全 ${inHouseTanks.length} 本を一括返却しますか？\n(タグ付けに応じて処理されます)`)) return;
    setReturning(true);
    try {
      const context = { actor: requireStaffIdentity() };
      await applyBulkTankOperations(
        inHouseTanks.map((tank) => {
          const tag = (tank.tag || RETURN_TAG.NORMAL) as ReturnTag;
          return {
            tankId: tank.id,
            transitionAction: resolveReturnAction(tag, STATUS.IN_HOUSE),
            currentStatus: STATUS.IN_HOUSE,
            context,
            location: "倉庫",
          };
        })
      );
      alert("一括返却が完了しました。");
      setTagOverrides({});
      refetch();
    } catch (e: unknown) {
      alert("エラー: " + errorMessage(e));
    } finally {
      setReturning(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#f8fafc", overflow: "hidden" }}>
      <TankIdInput
        prefixes={prefixes}
        activePrefix={activePrefix}
        onPrefixChange={setActivePrefix}
        numberValue={numberValue}
        onNumberChange={setNumberValue}
        onCommit={handleCommit}
        accentColor={ACCENT}
        confirmLabel={reporting ? "送信中…" : "事後報告"}
        lastAdded={lastAdded}
        beforeConfirm={
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {/* フィードバック */}
            {reportResult && (
              <div style={{
                marginBottom: 12, display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", borderRadius: 10,
                background: reportResult.success ? "#ecfdf5" : "#fef2f2",
                border: `1px solid ${reportResult.success ? "#bbf7d0" : "#fecaca"}`,
              }}>
                {reportResult.success
                  ? <CheckCircle2 size={14} color="#10b981" />
                  : <AlertCircle size={14} color="#ef4444" />}
                <span style={{ fontSize: 12, fontWeight: 600, color: reportResult.success ? "#166534" : "#991b1b" }}>
                  {reportResult.message}
                </span>
              </div>
            )}

            {/* 利用中タンク一覧 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>利用中タンク</span>
              {inHouseTanks.length > 0 && (
                <span style={{ background: ACCENT, color: "#fff", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 800 }}>
                  {inHouseTanks.length}本
                </span>
              )}
            </div>

            {loading ? (
              <div style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>
                <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
              </div>
            ) : inHouseTanks.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 12px", color: "#cbd5e1", fontSize: 13 }}>
                利用中のタンクはありません
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {inHouseTanks.map((tank) => (
                  <div key={tank.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 12px", background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0",
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 900, fontFamily: "monospace", color: "#0f172a", letterSpacing: "0.05em" }}>
                        {tank.id}
                      </div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>{tank.staff}</div>
                    </div>
                    <div style={{ width: 170, flexShrink: 0 }}>
                      <ReturnTagSelector<TagType>
                        value={tank.tag}
                        onChange={(value) => updateTag(tank.id, value)}
                        options={[
                          { value: "uncharged", label: "未充填" },
                          { value: "unused", label: "未使用" },
                        ]}
                        compact
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        }
        footerSlot={
          <div style={{
            padding: "8px 16px max(8px, env(safe-area-inset-bottom, 8px))",
            background: "#fff", borderTop: "1px solid #e2e8f0", flexShrink: 0, zIndex: 20,
          }}>
            <button
              onClick={handleBulkReturn}
              disabled={inHouseTanks.length === 0 || returning}
              style={{
                width: "100%", padding: "12px", borderRadius: 12, border: "none",
                background: inHouseTanks.length === 0 || returning ? "#e2e8f0" : "#0f172a",
                color: inHouseTanks.length === 0 || returning ? "#94a3b8" : "#fff",
                fontSize: 14, fontWeight: 900,
                display: "flex", justifyContent: "center", alignItems: "center", gap: 6,
                cursor: inHouseTanks.length === 0 || returning ? "not-allowed" : "pointer",
              }}
            >
              {returning
                ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                : <CheckCircle2 size={16} />}
              全て返却確定
            </button>
          </div>
        }
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
