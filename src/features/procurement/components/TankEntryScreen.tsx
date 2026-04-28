"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Package,
  Plus,
  Trash2,
} from "lucide-react";
import {
  collection,
  getDocs,
} from "firebase/firestore";
import ProcurementTabs from "@/components/ProcurementTabs";
import { db } from "@/lib/firebase/config";
import { getStaffName } from "@/hooks/useStaffSession";
import { useTanks } from "@/hooks/useTanks";
import { STATUS } from "@/lib/tank-rules";
import {
  submitTankEntryBatch,
  type TankEntryMode,
} from "@/features/procurement/lib/submitTankEntryBatch";
import { useProcurementSwipe } from "@/features/procurement/hooks/useProcurementSwipe";

const DEFAULT_TANK_TYPES = ["スチール 10L", "スチール 12L", "アルミ"];
const LOCATION_OPTIONS = ["倉庫", "自社"];
const STATUS_OPTIONS = [STATUS.EMPTY, STATUS.FILLED];

interface TankEntryScreenProps {
  mode: TankEntryMode;
}

export default function TankEntryScreen({ mode }: TankEntryScreenProps) {
  useProcurementSwipe(mode === "purchase" ? "tank-purchase" : "tank-register");

  const { tanks, tankMap, prefixes, refetch } = useTanks();
  const [tankIdInput, setTankIdInput] = useState("");
  const [tankIds, setTankIds] = useState<string[]>([]);
  const [masterTankTypes, setMasterTankTypes] = useState<string[]>([]);
  const [masterLoading, setMasterLoading] = useState(true);
  const [tankType, setTankType] = useState("");
  const [initialStatus, setInitialStatus] = useState<string>(STATUS.EMPTY);
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
  const pageTitle = isPurchase ? "タンク購入" : "タンク登録";
  const pageDescription = isPurchase
    ? "新しいタンクの登録と費用計上を同時に行います"
    : "既存の実物タンクへIDを追加し、タンク情報だけ登録します";
  const submitLabel = isPurchase ? "購入登録" : "登録";

  useEffect(() => {
    let mounted = true;
    (async () => {
      setMasterLoading(true);
      try {
        const snap = await getDocs(collection(db, "orderMaster"));
        const fromMaster = new Set<string>();
        snap.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          if (String(data.category || "") !== "tank") return;
          const name = `${String(data.colA || "").trim()} ${String(data.colB || "").trim()}`.trim();
          if (name) fromMaster.add(name);
        });
        if (mounted) setMasterTankTypes(Array.from(fromMaster));
      } catch (error) {
        console.error(error);
        if (mounted) setMasterTankTypes([]);
      } finally {
        if (mounted) setMasterLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

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
    const normalized = normalizeTankId(tankIdInput);
    if (!normalized) return;

    if (!isValidTankId(normalized)) {
      setResult({ success: false, message: "タンクIDは A-01 の形式で入力してください" });
      return;
    }
    if (tankIds.includes(normalized)) {
      setResult({ success: false, message: `${normalized} は追加済みです` });
      return;
    }
    if (tankMap[normalized]) {
      setResult({ success: false, message: `${normalized} は既に登録されています` });
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

    const message = isPurchase
      ? `${tankIds.length}本を購入登録しますか？\n合計 ¥${totalCost.toLocaleString()} を計上します。`
      : `${tankIds.length}本を登録しますか？`;

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
        staff: getStaffName(),
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
        message: isPurchase
          ? `${outcome.count}本を購入登録しました（¥${outcome.totalCost.toLocaleString()}）`
          : `${outcome.count}本を登録しました`,
      });
    } catch (error) {
      setResult({ success: false, message: errorMessage(error) });
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
                <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{pageTitle}</h1>
                <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{pageDescription}</p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <MetricCard label="追加予定" value={`${tankIds.length}`} accent={accent} />
              <MetricCard label="既存プレフィックス" value={`${prefixes.length}`} accent={accent} />
              <MetricCard
                label={isPurchase ? "費用計上" : "費用計上"}
                value={isPurchase ? `¥${totalCost.toLocaleString()}` : "なし"}
                accent={accent}
              />
            </div>
          </div>

          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div>
                <h2 style={sectionTitleStyle}>タンクID</h2>
                <p style={sectionSubStyle}>1本ずつ追加してからまとめて保存します</p>
              </div>
              {tankIds.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 800, color: accent }}>{tankIds.length}本</span>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                value={tankIdInput}
                onChange={(e) => setTankIdInput(normalizeTankId(e.target.value))}
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
                追加
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
              <div style={emptyStateStyle}>追加予定のタンクIDはまだありません</div>
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
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={cardStyle}>
            <h2 style={sectionTitleStyle}>登録情報</h2>
            <p style={sectionSubStyle}>購入・登録どちらでも共通の情報です</p>

            <label style={labelStyle}>
              タンク種別
              <select value={tankType} onChange={(e) => setTankType(e.target.value)} style={inputStyle} disabled={masterLoading}>
                {tankTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <div style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>初期ステータス</span>
              <div style={chipRowStyle}>
                {STATUS_OPTIONS.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setInitialStatus(status)}
                    style={toggleButtonStyle(initialStatus === status, accent, accentBg)}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            <div style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>保管場所</span>
              <div style={chipRowStyle}>
                {LOCATION_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLocation(value)}
                    style={toggleButtonStyle(location === value, accent, accentBg)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <label style={labelStyle}>
              次回耐圧期限
              <input
                type="date"
                value={nextMaintenanceDate}
                onChange={(e) => setNextMaintenanceDate(e.target.value)}
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              メモ
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
              <h2 style={sectionTitleStyle}>費用計上</h2>
              <p style={sectionSubStyle}>タンク購入のときだけ記録します</p>

              <label style={labelStyle}>
                購入日
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  style={inputStyle}
                />
              </label>

              <label style={labelStyle}>
                購入先
                <input
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="仕入先名"
                  style={inputStyle}
                />
              </label>

              <label style={labelStyle}>
                単価
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
                <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>合計</span>
                <span style={{ fontSize: 24, fontWeight: 900, color: "#0f172a", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                  ¥{totalCost.toLocaleString()}
                </span>
              </div>
            </section>
          )}

          {result && (
            <div
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
              ? "保存中..."
              : isPurchase
              ? `${tankIds.length}本を${submitLabel}`
              : `${tankIds.length}本を${submitLabel}`}
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

function normalizeTankId(value: string): string {
  return value
    .toUpperCase()
    .replace(/[‐‑‒–—―ーｰ−]/g, "-")
    .replace(/\s+/g, "");
}

function isValidTankId(value: string): boolean {
  return /^[A-Z]+-\d{2}$/.test(value);
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
