"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { type ReturnTag, RETURN_TAG } from "@/lib/tank-rules";
import { coerceTankStatusCode } from "@/lib/tank-action-status-codes";
import { storedMarkerToReturnTag } from "@/lib/return-tag-rules";
import { tryParseTankId } from "@/lib/tank-id";
import TankIdInput from "@/components/TankIdInput";
import ReturnTagSelector from "@/components/ReturnTagSelector";
import {
  submitInHouseBulkReturn,
  updateInHouseReturnTagMarker,
} from "@/features/inhouse/services/inhouse-return-workflow";
import { submitInHouseUseReport } from "@/features/inhouse/services/inhouse-use-workflow";
import {
  formatInHouseAlreadyActive,
  formatInHouseBulkConfirm,
  formatInHouseError,
  formatInHouseReportSuccess,
  formatInHouseUnregistered,
  formatReturnTagAriaLabel,
  getInHouseText,
} from "@/features/inhouse/i18n";
import { requireStaffIdentity, useStaffLocale } from "@/hooks/useStaffSession";
import { useTanks } from "@/hooks/useTanks";
import { formatStaffTankCount } from "@/lib/staff-display";
import { logStaffOperationError } from "@/lib/staff-operation-error";
import { getStaffOperationText } from "@/features/staff-operations/i18n";

type TagType = Exclude<ReturnTag, typeof RETURN_TAG.KEEP>;

const ACCENT = "#6366f1";

export default function InHousePage() {
  const staffLocale = useStaffLocale();
  const { tanks: allTanks, tankMap, prefixes, loading, loadFailed, refetch } = useTanks();
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
      .filter((t) => coerceTankStatusCode(t.status) === "in_house")
      .map((t) => {
        const baseReturnTag = storedMarkerToReturnTag(t.logNote);
        const baseTag: TagType = baseReturnTag === RETURN_TAG.KEEP
          ? RETURN_TAG.NORMAL
          : baseReturnTag;
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
      await updateInHouseReturnTagMarker(tankId, newTag);
    } catch (e) {
      logStaffOperationError("Failed to update tag", e);
      setReportResult({
        success: false,
        message: formatInHouseError(e, staffLocale),
      });
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
  const handleCommit = async (rawTankId: string) => {
    if (reporting) return;
    const tankIdResult = tryParseTankId(rawTankId);
    if (!tankIdResult.ok) {
      setReportResult({
        success: false,
        message: staffLocale === "ja"
          ? tankIdResult.reason
          : getStaffOperationText("invalidTankId", staffLocale),
      });
      return;
    }
    const tankId = tankIdResult.canonicalTankId;
    setReporting(true);
    setReportResult(null);
    try {
      const actor = requireStaffIdentity();
      const tank = tankMap[tankId];
      if (!tank) {
        setReportResult({
          success: false,
          message: loadFailed
            ? getInHouseText("loadFailure", staffLocale)
            : formatInHouseUnregistered(tankId, staffLocale),
        });
        return;
      }
      if (coerceTankStatusCode(tank.status) === "in_house") {
        setReportResult({ success: true, message: formatInHouseAlreadyActive(tankId, staffLocale) });
        return;
      }
      await submitInHouseUseReport({
        tankId,
        currentStatus: tank.status,
        actor,
      });
      setLastAdded(tankId);
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = setTimeout(() => setLastAdded(null), 1500);
      setReportResult({ success: true, message: formatInHouseReportSuccess(tankId, staffLocale) });
      setTagOverrides({});
      refetch();
    } catch (e: unknown) {
      logStaffOperationError("submitInHouseUseReport failed", e);
      setReportResult({
        success: false,
        message: formatInHouseError(e, staffLocale),
      });
    } finally {
      setReporting(false);
    }
  };

  const handleBulkReturn = async () => {
    if (inHouseTanks.length === 0) return;
    if (!confirm(formatInHouseBulkConfirm(inHouseTanks.length, staffLocale))) return;
    setReturning(true);
    try {
      const actor = requireStaffIdentity();
      await submitInHouseBulkReturn({
        tanks: inHouseTanks.map((tank) => ({
          tankId: tank.id,
          tag: tank.tag,
        })),
        actor,
      });
      alert(getInHouseText("bulkReturnSuccess", staffLocale));
      setTagOverrides({});
      refetch();
    } catch (e: unknown) {
      logStaffOperationError("submitInHouseBulkReturn failed", e);
      alert(formatInHouseError(e, staffLocale));
    } finally {
      setReturning(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#f8fafc", overflow: "hidden" }}>
      <TankIdInput
        locale={staffLocale}
        prefixes={prefixes}
        activePrefix={activePrefix}
        onPrefixChange={setActivePrefix}
        numberValue={numberValue}
        onNumberChange={setNumberValue}
        onCommit={handleCommit}
        accentColor={ACCENT}
        confirmLabel={getInHouseText(reporting ? "sending" : "retroactiveReport", staffLocale)}
        lastAdded={lastAdded}
        beforeConfirm={
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {/* フィードバック */}
            {reportResult && (
              <div role={reportResult.success ? "status" : "alert"} aria-live="polite" style={{
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

            {loadFailed && inHouseTanks.length > 0 && (
              <div role="alert" style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 10, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", fontSize: 12 }}>
                {getInHouseText("loadFailure", staffLocale)}
                <button type="button" onClick={() => void refetch()} style={{ marginLeft: 8 }}>
                  {getInHouseText("retry", staffLocale)}
                </button>
              </div>
            )}

            {/* 利用中タンク一覧 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>
                {getInHouseText("activeTanks", staffLocale)}
              </span>
              {inHouseTanks.length > 0 && (
                <span style={{ background: ACCENT, color: "#fff", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 800 }}>
                  {formatStaffTankCount(inHouseTanks.length, staffLocale)}
                </span>
              )}
            </div>

            {loading ? (
              <div role="status" aria-live="polite" style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>
                <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
                <span>{getInHouseText("loading", staffLocale)}</span>
              </div>
            ) : loadFailed && inHouseTanks.length === 0 ? (
              <div role="alert" style={{ textAlign: "center", padding: "24px 12px", color: "#991b1b", fontSize: 13 }}>
                <p>{getInHouseText("loadFailure", staffLocale)}</p>
                <button type="button" onClick={() => void refetch()}>
                  {getInHouseText("retry", staffLocale)}
                </button>
              </div>
            ) : inHouseTanks.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 12px", color: "#cbd5e1", fontSize: 13 }}>
                {getInHouseText("noActiveTanks", staffLocale)}
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
                    <div style={{ width: "clamp(132px, 42vw, 170px)", flexShrink: 0 }}>
                      <ReturnTagSelector<TagType>
                        value={tank.tag}
                        onChange={(value) => updateTag(tank.id, value)}
                        options={[
                          { value: "uncharged", label: getInHouseText("uncharged", staffLocale) },
                          { value: "unused", label: getInHouseText("unused", staffLocale) },
                        ]}
                        locale={staffLocale}
                        ariaLabel={formatReturnTagAriaLabel(tank.id, staffLocale)}
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
              {getInHouseText("returnAll", staffLocale)}
            </button>
          </div>
        }
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
