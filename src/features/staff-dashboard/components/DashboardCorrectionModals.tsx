import type React from "react";
import {
  Building2,
  CheckCircle2,
  Loader2,
  Undo2,
  X,
} from "lucide-react";
import PrefixNumberPicker from "@/components/PrefixNumberPicker";

export type DashboardIdCorrectionModalProps = {
  tankIds: string[];
  selectedTankId: string | null;
  reason: string;
  saving: boolean;
  confirmDisabled: boolean;
  disabledReason: string | null;
  onTankIdChange: (id: string | null) => void;
  onReasonChange: (reason: string) => void;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export type DashboardSingleVoidModalProps = {
  targetTankId: string;
  actionLabel: string;
  reason: string;
  saving: boolean;
  confirmDisabled: boolean;
  disabledReason: string | null;
  onReasonChange: (reason: string) => void;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export type DashboardBulkLocationOptionView =
  Readonly<{
    value: string;
    label: string;
  }>;

export type DashboardBulkLocationModalProps = {
  selectedCount: number;
  options:
    readonly DashboardBulkLocationOptionView[];
  selectedValue: string;
  reason: string;
  saving: boolean;
  confirmDisabled: boolean;
  onValueChange: (value: string) => void;
  onReasonChange: (reason: string) => void;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export type DashboardBulkVoidModalProps = {
  selectedCount: number;
  reason: string;
  saving: boolean;
  confirmDisabled: boolean;
  onReasonChange: (reason: string) => void;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export type DashboardCorrectionModalsProps = {
  idCorrection:
    DashboardIdCorrectionModalProps | null;
  singleVoid:
    DashboardSingleVoidModalProps | null;
  bulkLocation:
    DashboardBulkLocationModalProps | null;
  bulkVoid:
    DashboardBulkVoidModalProps | null;
};

export function DashboardCorrectionModals({
  idCorrection,
  singleVoid,
  bulkLocation,
  bulkVoid,
}: DashboardCorrectionModalsProps) {
  return (
    <>
      {idCorrection && (
        <Modal onClose={idCorrection.onClose}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>タンクID変更</h2>
            <button type="button" onClick={idCorrection.onClose} style={iconButtonStyle} disabled={idCorrection.saving}>
              <X size={20} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FieldLabel label="タンクID" />
            <PrefixNumberPicker
              tankIds={idCorrection.tankIds}
              value={idCorrection.selectedTankId}
              onChange={idCorrection.onTankIdChange}
              accentColor="#2563eb"
            />
            <div style={{ padding: "9px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
              タンクIDだけを変更します。操作種別・貸出先・メモなどは変更しません。
            </div>

            <label style={labelStyle}>
              編集理由
              <textarea
                value={idCorrection.reason}
                onChange={(event) => idCorrection.onReasonChange(event.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", minHeight: 78 }}
              />
            </label>

            <button
              type="button"
              onClick={idCorrection.onConfirm}
              disabled={idCorrection.confirmDisabled}
              style={primaryButtonStyle(idCorrection.confirmDisabled)}
            >
              {idCorrection.saving ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={18} />}
              {idCorrection.saving ? "保存中..." : "ID変更"}
            </button>
            <DisabledReasonText reason={idCorrection.disabledReason} />
          </div>
        </Modal>
      )}

      {singleVoid && (
        <Modal onClose={singleVoid.onClose}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>ログ取消</h2>
            <button type="button" onClick={singleVoid.onClose} style={iconButtonStyle} disabled={singleVoid.saving}>
              <X size={20} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: 12, borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 900, color: "#0f172a" }}>{singleVoid.targetTankId}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#334155" }}>{singleVoid.actionLabel}</span>
            </div>
            <label style={labelStyle}>
              取消理由
              <textarea
                value={singleVoid.reason}
                onChange={(event) => singleVoid.onReasonChange(event.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
              />
            </label>
            <button
              type="button"
              onClick={singleVoid.onConfirm}
              disabled={singleVoid.confirmDisabled}
              style={dangerButtonStyle(singleVoid.confirmDisabled)}
            >
              {singleVoid.saving ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Undo2 size={18} />}
              {singleVoid.saving ? "取消中..." : "取消"}
            </button>
            <DisabledReasonText reason={singleVoid.disabledReason} />
          </div>
        </Modal>
      )}

      {bulkLocation && (
        <Modal onClose={bulkLocation.onClose}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>貸出先変更</h2>
            <button type="button" onClick={bulkLocation.onClose} style={iconButtonStyle} disabled={bulkLocation.saving}>
              <X size={20} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
              選択中 {bulkLocation.selectedCount} 件の貸出先をまとめて変更します。
            </div>
            <label style={labelStyle}>
              貸出先
              <select
                value={bulkLocation.selectedValue}
                onChange={(event) => bulkLocation.onValueChange(event.target.value)}
                style={inputStyle}
              >
                {bulkLocation.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              変更理由
              <textarea
                value={bulkLocation.reason}
                onChange={(event) => bulkLocation.onReasonChange(event.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
              />
            </label>
            <button
              type="button"
              onClick={bulkLocation.onConfirm}
              disabled={bulkLocation.confirmDisabled}
              style={primaryButtonStyle(bulkLocation.confirmDisabled)}
            >
              {bulkLocation.saving ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Building2 size={18} />}
              {bulkLocation.saving ? "更新中..." : "貸出先変更"}
            </button>
          </div>
        </Modal>
      )}

      {bulkVoid && (
        <Modal onClose={bulkVoid.onClose}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>一括取消</h2>
            <button type="button" onClick={bulkVoid.onClose} style={iconButtonStyle} disabled={bulkVoid.saving}>
              <X size={20} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12, color: "#991b1b", lineHeight: 1.6 }}>
              選択中 {bulkVoid.selectedCount} 件のログを取り消します。
            </div>
            <label style={labelStyle}>
              取消理由
              <textarea
                value={bulkVoid.reason}
                onChange={(event) => bulkVoid.onReasonChange(event.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
              />
            </label>
            <button
              type="button"
              onClick={bulkVoid.onConfirm}
              disabled={bulkVoid.confirmDisabled}
              style={dangerButtonStyle(bulkVoid.confirmDisabled)}
            >
              {bulkVoid.saving ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Undo2 size={18} />}
              {bulkVoid.saving ? "取消中..." : "一括取消"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "rgba(15, 23, 42, 0.42)",
          backdropFilter: "blur(4px)",
          cursor: "pointer",
        }}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 440,
          maxHeight: "88vh",
          overflowY: "auto",
          background: "#fff",
          borderRadius: 16,
          padding: 22,
          boxShadow: "0 20px 45px rgba(15, 23, 42, 0.18)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", marginBottom: -6 }}>{label}</div>;
}

function DisabledReasonText({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <p style={{ margin: "-4px 2px 0", fontSize: 12, lineHeight: 1.5, color: "#64748b", fontWeight: 700 }}>
      {reason}
    </p>
  );
}

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
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #dbe3ef",
  fontSize: 16,
  color: "#0f172a",
  fontWeight: 600,
  outline: "none",
  fontFamily: "inherit",
};

const iconButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#64748b",
  cursor: "pointer",
  padding: 4,
  display: "flex",
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: 14,
    borderRadius: 10,
    border: "none",
    background: disabled ? "#e2e8f0" : "#2563eb",
    color: disabled ? "#94a3b8" : "#fff",
    fontSize: 15,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  };
}

function dangerButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    ...primaryButtonStyle(disabled),
    background: disabled ? "#e2e8f0" : "#dc2626",
  };
}
