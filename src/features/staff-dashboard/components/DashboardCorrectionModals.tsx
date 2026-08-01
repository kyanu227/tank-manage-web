import type React from "react";
import { useEffect, useRef } from "react";
import {
  Building2,
  CheckCircle2,
  Loader2,
  Undo2,
  X,
} from "lucide-react";
import PrefixNumberPicker from "@/components/PrefixNumberPicker";
import {
  formatBulkLocationDescription,
  formatBulkVoidDescription,
  getDashboardText,
} from "@/features/staff-dashboard/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

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
  locale?: Locale;
};

export function DashboardCorrectionModals({
  idCorrection,
  singleVoid,
  bulkLocation,
  bulkVoid,
  locale = DEFAULT_LOCALE,
}: DashboardCorrectionModalsProps) {
  return (
    <>
      {idCorrection && (
        <Modal onClose={idCorrection.onClose} titleId="dashboard-id-correction-title" closeLabel={getDashboardText("close", locale)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 id="dashboard-id-correction-title" style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{getDashboardText("tankIdChange", locale)}</h2>
            <button type="button" aria-label={getDashboardText("close", locale)} onClick={idCorrection.onClose} style={iconButtonStyle} disabled={idCorrection.saving}>
              <X size={20} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FieldLabel label={getDashboardText("tankId", locale)} />
            <PrefixNumberPicker
              tankIds={idCorrection.tankIds}
              value={idCorrection.selectedTankId}
              onChange={idCorrection.onTankIdChange}
              accentColor="#2563eb"
              locale={locale}
            />
            <div style={{ padding: "9px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
              {getDashboardText("tankIdChangeHelp", locale)}
            </div>

            <label style={labelStyle}>
              {getDashboardText("editReason", locale)}
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
              {idCorrection.saving ? getDashboardText("saving", locale) : getDashboardText("changeId", locale)}
            </button>
            <DisabledReasonText reason={idCorrection.disabledReason} />
          </div>
        </Modal>
      )}

      {singleVoid && (
        <Modal onClose={singleVoid.onClose} titleId="dashboard-single-void-title" closeLabel={getDashboardText("close", locale)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 id="dashboard-single-void-title" style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{getDashboardText("logVoid", locale)}</h2>
            <button type="button" aria-label={getDashboardText("close", locale)} onClick={singleVoid.onClose} style={iconButtonStyle} disabled={singleVoid.saving}>
              <X size={20} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: 12, borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 900, color: "#0f172a" }}>{singleVoid.targetTankId}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#334155" }}>{singleVoid.actionLabel}</span>
            </div>
            <label style={labelStyle}>
              {getDashboardText("voidReason", locale)}
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
              {singleVoid.saving ? getDashboardText("voiding", locale) : getDashboardText("void", locale)}
            </button>
            <DisabledReasonText reason={singleVoid.disabledReason} />
          </div>
        </Modal>
      )}

      {bulkLocation && (
        <Modal onClose={bulkLocation.onClose} titleId="dashboard-bulk-location-title" closeLabel={getDashboardText("close", locale)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 id="dashboard-bulk-location-title" style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{getDashboardText("changeCustomer", locale)}</h2>
            <button type="button" aria-label={getDashboardText("close", locale)} onClick={bulkLocation.onClose} style={iconButtonStyle} disabled={bulkLocation.saving}>
              <X size={20} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
              {formatBulkLocationDescription(bulkLocation.selectedCount, locale)}
            </div>
            <label style={labelStyle}>
              {getDashboardText("customer", locale)}
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
              {getDashboardText("changeReason", locale)}
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
              {bulkLocation.saving ? getDashboardText("updating", locale) : getDashboardText("changeCustomer", locale)}
            </button>
          </div>
        </Modal>
      )}

      {bulkVoid && (
        <Modal onClose={bulkVoid.onClose} titleId="dashboard-bulk-void-title" closeLabel={getDashboardText("close", locale)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 id="dashboard-bulk-void-title" style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{getDashboardText("bulkVoid", locale)}</h2>
            <button type="button" aria-label={getDashboardText("close", locale)} onClick={bulkVoid.onClose} style={iconButtonStyle} disabled={bulkVoid.saving}>
              <X size={20} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12, color: "#991b1b", lineHeight: 1.6 }}>
              {formatBulkVoidDescription(bulkVoid.selectedCount, locale)}
            </div>
            <label style={labelStyle}>
              {getDashboardText("voidReason", locale)}
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
              {bulkVoid.saving ? getDashboardText("voiding", locale) : getDashboardText("bulkVoid", locale)}
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
  titleId,
  closeLabel,
}: {
  children: React.ReactNode;
  onClose: () => void;
  titleId: string;
  closeLabel: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = getFocusableElements(dialog);
    (focusable[0] ?? dialog).focus();

    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [titleId]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleFocusCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.contains(event.target)) return;
    const focusable = getFocusableElements(dialog);
    (focusable[0] ?? dialog).focus();
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      onFocusCapture={handleFocusCapture}
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
        aria-label={closeLabel}
        onClick={onClose}
        tabIndex={-1}
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
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

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
  )).filter((element) => !element.hasAttribute("hidden"));
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
