"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Package,
  Plus,
  Trash2,
} from "lucide-react";
import ProcurementTabs from "@/components/ProcurementTabs";
import { requireStaffIdentity, useStaffLocale } from "@/hooks/useStaffSession";
import { useTanks } from "@/hooks/useTanks";
import type { TankStatusCode } from "@/lib/tank-action-status-codes";
import { getTankStatusLabel } from "@/lib/tank-action-status-labels";
import { tryParseTankId } from "@/lib/tank-id";
import { listOrderItems } from "@/lib/firebase/order-master-settings";
import {
  submitTankEntryBatch,
  type TankEntryMode,
} from "@/features/procurement/lib/submitTankEntryBatch";
import { useProcurementSwipe } from "@/features/procurement/hooks/useProcurementSwipe";
import {
  formatRemoveTankLabel,
  formatProcurementJpy,
  formatTankEntryConfirm,
  formatTankEntryDuplicate,
  formatTankEntryRegistered,
  formatTankEntrySubmit,
  formatTankEntrySuccess,
  getProcurementText,
  getTankEntryCopy,
  getTankTypeDisplayLabel,
} from "@/features/procurement/i18n";
import {
  formatStaffTankCount,
  getStaffGenericErrorMessage,
  getStaffLocationLabel,
} from "@/lib/staff-display";

const DEFAULT_TANK_TYPES = ["スチール 10L", "スチール 12L", "アルミ"];
const LOCATION_OPTIONS = ["倉庫", "自社"];
const STATUS_OPTIONS: readonly TankStatusCode[] = ["empty", "filled"];

interface TankEntryScreenProps {
  mode: TankEntryMode;
}

export default function TankEntryScreen({ mode }: TankEntryScreenProps) {
  useProcurementSwipe(mode === "purchase" ? "tank-purchase" : "tank-register");

  const staffLocale = useStaffLocale();
  const { tanks, tankMap, prefixes, loading: tanksLoading, loadFailed: tanksLoadFailed, refetch } = useTanks();
  const [tankIdInput, setTankIdInput] = useState("");
  const [tankIds, setTankIds] = useState<string[]>([]);
  const [masterTankTypes, setMasterTankTypes] = useState<string[]>([]);
  const [masterLoading, setMasterLoading] = useState(true);
  const [masterLoadFailed, setMasterLoadFailed] = useState(false);
  const [masterLoadVersion, setMasterLoadVersion] = useState(0);
  const [tankType, setTankType] = useState("");
  const [initialStatus, setInitialStatus] = useState<TankStatusCode>("empty");
  const [location, setLocation] = useState<string>("倉庫");
  const [nextMaintenanceDate, setNextMaintenanceDate] = useState("");
  const [note, setNote] = useState("");
  const [vendor, setVendor] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayInputValue());
  const [unitCostInput, setUnitCostInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const isPurchase = mode === "purchase";
  const accent = isPurchase ? "#0ea5e9" : "#10b981";
  const accentBg = isPurchase ? "#e0f2fe" : "#dcfce7";
  const pageCopy = getTankEntryCopy(mode, staffLocale);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setMasterLoading(true);
      setMasterLoadFailed(false);
      try {
        const fromMaster = new Set<string>();
        const items = await listOrderItems();
        items.forEach((item) => {
          if (item.category !== "tank") return;
          const name = `${String(item.colA || "").trim()} ${String(item.colB || "").trim()}`.trim();
          if (name) fromMaster.add(name);
        });
        if (mounted) setMasterTankTypes(Array.from(fromMaster));
      } catch (error) {
        console.error("listOrderItems failed", error);
        if (mounted) setMasterTankTypes([]);
        if (mounted) setMasterLoadFailed(true);
      } finally {
        if (mounted) setMasterLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [masterLoadVersion]);

  const tankTypeOptions = useMemo(() => {
    const fromTanks = tanks
      .map((tank) => String(tank.type || "").trim())
      .filter(Boolean);

    return Array.from(new Set([...masterTankTypes, ...fromTanks, ...DEFAULT_TANK_TYPES]));
  }, [masterTankTypes, tanks]);

  useEffect(() => {
    setTankType((prev) => (prev && tankTypeOptions.includes(prev) ? prev : tankTypeOptions[0] || ""));
  }, [tankTypeOptions]);

  const totalCost = useMemo(() => {
    const unitCost = Number(unitCostInput) || 0;
    return unitCost * tankIds.length;
  }, [tankIds.length, unitCostInput]);

  const canSubmit = tankIds.length > 0
    && !!tankType
    && !!location
    && (!isPurchase || (Number(unitCostInput) > 0 && !!purchaseDate));

  const addTankId = () => {
    if (!tankIdInput.trim()) return;

    const parsed = tryParseTankId(tankIdInput);

    if (!parsed.ok) {
      setResult({
        success: false,
        message: staffLocale === "ja" ? parsed.reason : getProcurementText("invalidTankId", staffLocale),
      });
      return;
    }

    const normalized = parsed.canonicalTankId;

    if (tankIds.includes(normalized)) {
      setResult({ success: false, message: formatTankEntryDuplicate(normalized, staffLocale) });
      return;
    }
    if (tankMap[normalized]) {
      setResult({ success: false, message: formatTankEntryRegistered(normalized, staffLocale) });
      return;
    }

    setTankIds((prev) => [...prev, normalized]);
    setTankIdInput("");
    setResult(null);
  };

  const removeTankId = (tankId: string) => {
    setTankIds((prev) => prev.filter((value) => value !== tankId));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    const message = formatTankEntryConfirm(mode, tankIds.length, totalCost, staffLocale);

    if (!confirm(message)) return;

    setSubmitting(true);
    setResult(null);
    try {
      const outcome = await submitTankEntryBatch({
        mode,
        tankIds,
        tankType,
        initialStatus,
        location,
        note,
        nextMaintenanceDate,
        purchaseDate,
        vendor,
        unitCost: Number(unitCostInput) || 0,
        actor: requireStaffIdentity(),
      });

      await refetch();
      setTankIds([]);
      setTankIdInput("");
      setNote("");
      setNextMaintenanceDate("");
      if (isPurchase) {
        setVendor("");
        setUnitCostInput("");
        setPurchaseDate(todayInputValue());
      }
      setResult({
        success: true,
        message: formatTankEntrySuccess(mode, outcome.count, outcome.totalCost, staffLocale),
      });
    } catch (error) {
      console.error("submitTankEntryBatch failed", error);
      setResult({
        success: false,
        message: staffLocale === "ja" ? errorMessage(error) : getStaffGenericErrorMessage(staffLocale),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#f8fafc", overflow: "hidden" }}>
      <ProcurementTabs />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 16px 28px" }}>
          <div
            style={{
              marginBottom: 18,
              padding: "18px 20px",
              borderRadius: 20,
              background: "#fff",
              border: "1px solid #e8eaed",
              boxShadow: "0 8px 20px rgba(15, 23, 42, 0.04)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  background: accent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isPurchase ? <Package size={22} color="#fff" /> : <Plus size={22} color="#fff" />}
              </div>
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{pageCopy.title}</h1>
                <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{pageCopy.description}</p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <MetricCard label={getProcurementText("toAdd", staffLocale)} value={`${tankIds.length}`} accent={accent} />
              <MetricCard label={getProcurementText("prefixes", staffLocale)} value={`${prefixes.length}`} accent={accent} />
              <MetricCard
                label={getProcurementText("cost", staffLocale)}
                value={isPurchase ? formatProcurementJpy(totalCost, staffLocale) : getProcurementText("none", staffLocale)}
                accent={accent}
              />
            </div>
          </div>

          {(tanksLoading || masterLoading) && (
            <div role="status" aria-live="polite" style={{ ...emptyStateStyle, marginBottom: 16 }}>
              {getProcurementText("loading", staffLocale)}
            </div>
          )}

          {(tanksLoadFailed || masterLoadFailed) && (
            <div role="alert" style={{ ...emptyStateStyle, marginBottom: 16, color: "#9a3412", borderColor: "#fed7aa", background: "#fff7ed" }}>
              <p>
                {tanksLoadFailed
                  ? getProcurementText("tankDataLoadFailure", staffLocale)
                  : getProcurementText("orderItemsLoadFailure", staffLocale)}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (tanksLoadFailed) void refetch();
                  if (masterLoadFailed) setMasterLoadVersion((value) => value + 1);
                }}
              >
                {getProcurementText("retry", staffLocale)}
              </button>
            </div>
          )}

          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div>
                <h2 style={sectionTitleStyle}>{getProcurementText("tankId", staffLocale)}</h2>
                <p style={sectionSubStyle}>{getProcurementText("tankIdHelp", staffLocale)}</p>
              </div>
              {tankIds.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 800, color: accent }}>
                  {formatStaffTankCount(tankIds.length, staffLocale)}
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                aria-label={getProcurementText("tankId", staffLocale)}
                value={tankIdInput}
                onChange={(e) => setTankIdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTankId();
                  }
                }}
                placeholder="A-01"
                style={{ ...inputStyle, flex: 1, textTransform: "uppercase" }}
              />
              <button type="button" onClick={addTankId} style={smallButtonStyle(accent)}>
                {getProcurementText("add", staffLocale)}
              </button>
            </div>

            {prefixes.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {prefixes.slice(0, 10).map((prefix) => (
                  <button
                    key={prefix}
                    type="button"
                    onClick={() => setTankIdInput(`${prefix}-`)}
                    style={{
                      border: "1px solid #dbeafe",
                      background: "#fff",
                      color: "#475569",
                      borderRadius: 999,
                      padding: "5px 10px",
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {prefix}-
                  </button>
                ))}
              </div>
            )}

            {tankIds.length === 0 ? (
              <div style={emptyStateStyle}>{getProcurementText("noTankIds", staffLocale)}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tankIds.map((tankId) => (
                  <div
                    key={tankId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <span style={{ fontSize: 16, fontWeight: 900, fontFamily: "ui-monospace, SFMono-Regular, monospace", color: "#0f172a" }}>
                      {tankId}
                    </span>
                    <button
                      type="button"
                      aria-label={formatRemoveTankLabel(tankId, staffLocale)}
                      onClick={() => removeTankId(tankId)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#94a3b8",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={cardStyle}>
            <h2 style={sectionTitleStyle}>{getProcurementText("registrationInfo", staffLocale)}</h2>
            <p style={sectionSubStyle}>{getProcurementText("registrationInfoHelp", staffLocale)}</p>

            <label style={labelStyle}>
              {getProcurementText("tankType", staffLocale)}
              <select value={tankType} onChange={(e) => setTankType(e.target.value)} style={inputStyle} disabled={masterLoading}>
                {tankTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {getTankTypeDisplayLabel(option, staffLocale)}
                  </option>
                ))}
              </select>
            </label>

            <div style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>{getProcurementText("initialStatus", staffLocale)}</span>
              <div style={chipRowStyle}>
                {STATUS_OPTIONS.map((status) => (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={initialStatus === status}
                    onClick={() => setInitialStatus(status)}
                    style={toggleButtonStyle(initialStatus === status, accent, accentBg)}
                  >
                    {getTankStatusLabel(status, staffLocale)}
                  </button>
                ))}
              </div>
            </div>

            <div style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>{getProcurementText("storageLocation", staffLocale)}</span>
              <div style={chipRowStyle}>
                {LOCATION_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={location === value}
                    onClick={() => setLocation(value)}
                    style={toggleButtonStyle(location === value, accent, accentBg)}
                  >
                    {getStaffLocationLabel(value, staffLocale)}
                  </button>
                ))}
              </div>
            </div>

            <label style={labelStyle}>
              {getProcurementText("nextInspectionDue", staffLocale)}
              <input
                type="date"
                value={nextMaintenanceDate}
                onChange={(e) => setNextMaintenanceDate(e.target.value)}
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              {getProcurementText("note", staffLocale)}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", minHeight: 88 }}
              />
            </label>
          </section>

          {isPurchase && (
            <section style={cardStyle}>
              <h2 style={sectionTitleStyle}>{getProcurementText("costDetails", staffLocale)}</h2>
              <p style={sectionSubStyle}>{getProcurementText("costDetailsHelp", staffLocale)}</p>

              <label style={labelStyle}>
                {getProcurementText("purchaseDate", staffLocale)}
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  style={inputStyle}
                />
              </label>

              <label style={labelStyle}>
                {getProcurementText("vendor", staffLocale)}
                <input
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder={getProcurementText("vendorPlaceholder", staffLocale)}
                  style={inputStyle}
                />
              </label>

              <label style={labelStyle}>
                {getProcurementText("unitCost", staffLocale)}
                <input
                  inputMode="numeric"
                  value={unitCostInput}
                  onChange={(e) => setUnitCostInput(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="0"
                  style={inputStyle}
                />
              </label>

              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>{getProcurementText("total", staffLocale)}</span>
                <span style={{ fontSize: 24, fontWeight: 900, color: "#0f172a", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                  {formatProcurementJpy(totalCost, staffLocale)}
                </span>
              </div>
            </section>
          )}

          {result && (
            <div
              role={result.success ? "status" : "alert"}
              aria-live="polite"
              style={{
                marginBottom: 16,
                padding: "14px 16px",
                borderRadius: 14,
                background: result.success ? "#ecfdf5" : "#fef2f2",
                border: `1px solid ${result.success ? "#bbf7d0" : "#fecaca"}`,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <CheckCircle2 size={18} color={result.success ? "#10b981" : "#ef4444"} />
              <span style={{ fontSize: 13, fontWeight: 700, color: result.success ? "#166534" : "#991b1b" }}>
                {result.message}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            aria-busy={submitting}
            style={{
              width: "100%",
              padding: "14px 0",
              borderRadius: 14,
              border: "none",
              background: canSubmit ? accent : "#e2e8f0",
              color: canSubmit ? "#fff" : "#94a3b8",
              fontSize: 15,
              fontWeight: 900,
              cursor: !canSubmit || submitting ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            {submitting ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : isPurchase ? <Package size={18} /> : <Plus size={18} />}
            {submitting
              ? getProcurementText("saving", staffLocale)
              : formatTankEntrySubmit(mode, tankIds.length, staffLocale)}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

function todayInputValue(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e8eaed",
  borderRadius: 18,
  padding: 18,
  marginBottom: 16,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  color: "#0f172a",
};

const sectionSubStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  marginTop: 2,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 12,
  fontWeight: 800,
  color: "#64748b",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid #dbe3ef",
  fontSize: 16,
  color: "#0f172a",
  fontWeight: 600,
  outline: "none",
  fontFamily: "inherit",
  background: "#fff",
};

const fieldGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#64748b",
};

const chipRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const emptyStateStyle: React.CSSProperties = {
  padding: "18px 12px",
  borderRadius: 12,
  background: "#f8fafc",
  border: "1px dashed #dbe3ef",
  color: "#94a3b8",
  fontSize: 13,
  textAlign: "center",
};

function smallButtonStyle(accent: string): React.CSSProperties {
  return {
    border: "none",
    background: accent,
    color: "#fff",
    borderRadius: 10,
    padding: "0 14px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    minWidth: 72,
  };
}

function toggleButtonStyle(active: boolean, accent: string, accentBg: string): React.CSSProperties {
  return {
    border: `1px solid ${active ? accent : "#e2e8f0"}`,
    background: active ? accentBg : "#fff",
    color: active ? accent : "#64748b",
    borderRadius: 999,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  };
}
