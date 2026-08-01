import type React from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit2,
  Loader2,
  Square,
  Undo2,
} from "lucide-react";
import { DashboardSectionLabel } from "@/features/staff-dashboard/components/DashboardSectionLabel";
import {
  formatDashboardActiveLogs,
  formatDashboardSelectedCount,
  getDashboardText,
} from "@/features/staff-dashboard/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

export type DashboardHistoryEntryView = Readonly<{
  id: string;
  revisionLabel: string;
  statusLabel: string;
  statusColor: string;
  actionLabel: string;
  timeLabel: string;
  editMetadata: string | null;
  voidMetadata: string | null;
}>;

export type DashboardLogRowView = Readonly<{
  id: string;
  tankId: string;
  actionLabel: string;
  actionBackground: string;
  actionForeground: string;
  locationLabel: string;
  staffLabel: string;
  timeLabel: string;
  isTankLog: boolean;
  logKindLabel: string;
  isSelected: boolean;
  canModify: boolean;
  modifyDisabledReason: string | null;
  canCorrect: boolean;
  correctionDisabledReason: string | null;
  isExpanded: boolean;
  historyLoading: boolean;
  historyEntries: readonly DashboardHistoryEntryView[];
}>;

export type DashboardLogsSectionProps = {
  activeLogCount: number;
  rows: readonly DashboardLogRowView[];
  sortOrder: "asc" | "desc";
  isEditMode: boolean;
  selectedCount: number;
  bulkLocationDisabled: boolean;
  bulkVoidDisabled: boolean;
  bulkLocationUnavailableReason: string | null;
  onToggleSort: () => void;
  onToggleEditMode: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenBulkLocation: () => void;
  onOpenBulkVoid: () => void;
  onToggleSelection: (logId: string) => void;
  onOpenEdit: (logId: string) => void;
  onOpenVoid: (logId: string) => void;
  onToggleHistory: (logId: string) => Promise<void>;
  locale?: Locale;
};

export function DashboardLogsSection({
  activeLogCount,
  rows,
  sortOrder,
  isEditMode,
  selectedCount,
  bulkLocationDisabled,
  bulkVoidDisabled,
  bulkLocationUnavailableReason,
  onToggleSort,
  onToggleEditMode,
  onSelectAll,
  onClearSelection,
  onOpenBulkLocation,
  onOpenBulkVoid,
  onToggleSelection,
  onOpenEdit,
  onOpenVoid,
  onToggleHistory,
  locale = DEFAULT_LOCALE,
}: DashboardLogsSectionProps) {
  return (
    <>
      <DashboardSectionLabel icon={<Clock size={14} />} title={getDashboardText("recentLogs", locale)} />
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.04em", flex: 1 }}>
            {formatDashboardActiveLogs(activeLogCount, locale)}
          </span>
          <button
            type="button"
            onClick={onToggleSort}
            title={getDashboardText(sortOrder === "desc" ? "newestToOldest" : "oldestToNewest", locale)}
            style={{
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#475569",
              borderRadius: 8,
              padding: "7px 11px",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              whiteSpace: "nowrap",
            }}
          >
            {sortOrder === "desc" ? <ArrowDownWideNarrow size={13} /> : <ArrowUpNarrowWide size={13} />}
            {getDashboardText(sortOrder === "desc" ? "newestFirst" : "oldestFirst", locale)}
          </button>
          <button
            type="button"
            onClick={onToggleEditMode}
            aria-pressed={isEditMode}
            style={{
              border: "1px solid #dbeafe",
              background: isEditMode ? "#eff6ff" : "#fff",
              color: "#2563eb",
              borderRadius: 8,
              padding: "7px 11px",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              whiteSpace: "nowrap",
            }}
          >
            {isEditMode ? <CheckSquare size={13} /> : <Edit2 size={13} />}
            {getDashboardText(isEditMode ? "done" : "edit", locale)}
          </button>
        </div>

        {isEditMode && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 10,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 800, color: "#334155", marginRight: 4 }}>
              {formatDashboardSelectedCount(selectedCount, locale)}
            </span>
            <button type="button" onClick={onSelectAll} style={miniActionButtonStyle()}>
              {getDashboardText("selectAll", locale)}
            </button>
            <button type="button" onClick={onClearSelection} style={miniActionButtonStyle()}>
              {getDashboardText("clearSelection", locale)}
            </button>
            <button
              type="button"
              onClick={onOpenBulkLocation}
              disabled={bulkLocationDisabled}
              style={miniActionButtonStyle(bulkLocationDisabled)}
            >
              {getDashboardText("changeCustomer", locale)}
            </button>
            <button
              type="button"
              onClick={onOpenBulkVoid}
              disabled={bulkVoidDisabled}
              style={dangerMiniButtonStyle(bulkVoidDisabled)}
            >
              {getDashboardText("bulkVoid", locale)}
            </button>
            {bulkLocationUnavailableReason && (
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                {bulkLocationUnavailableReason}
              </span>
            )}
          </div>
        )}

        {rows.length === 0 ? (
          <p style={{ fontSize: 13, color: "#cbd5e1", textAlign: "center", padding: 20 }}>
            {getDashboardText("noLogs", locale)}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((row) => (
              <div key={row.id} style={{ border: "1px solid #eef2f7", borderRadius: 10, background: "#f8fafc", overflow: "hidden" }}>
                <div className={`dashboard-log-row${isEditMode ? " dashboard-log-row--editing" : ""}`}>
                  {isEditMode ? (
                    <button
                      type="button"
                      onClick={() => onToggleSelection(row.id)}
                      disabled={!row.canModify}
                      title={row.canModify ? getDashboardText("select", locale) : row.modifyDisabledReason ?? getDashboardText("unavailable", locale)}
                      aria-label={`${getDashboardText("select", locale)} ${row.tankId}`}
                      aria-pressed={row.isSelected}
                      className="dashboard-log-checkbox"
                      style={{
                        border: "none",
                        background: "transparent",
                        color: row.canModify
                          ? (row.isSelected ? "#2563eb" : "#94a3b8")
                          : "#cbd5e1",
                        padding: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: row.canModify ? "pointer" : "not-allowed",
                      }}
                    >
                      {row.isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                  ) : null}
                  <span
                    className="dashboard-log-id"
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, monospace",
                      fontSize: 13,
                      fontWeight: 800,
                      color: "#0f172a",
                      minWidth: 54,
                    }}
                  >
                    {row.tankId}
                  </span>
                  <span
                    className="dashboard-log-action"
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: row.actionBackground,
                      color: row.actionForeground,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.actionLabel}
                  </span>
                  <div className="dashboard-log-body" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                    <span
                      style={{
                        fontSize: 12,
                        color: "#334155",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.locationLabel}
                    </span>
                    <span style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.staffLabel}
                    </span>
                  </div>
                  <span
                    className="dashboard-log-time"
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      fontFamily: "ui-monospace, SFMono-Regular, monospace",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.timeLabel}
                  </span>
                  {row.isTankLog && isEditMode ? (
                    <div className="dashboard-log-actions" style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <IconTextButton
                        label={getDashboardText("changeId", locale)}
                        icon={<Edit2 size={13} />}
                        disabled={!row.canCorrect}
                        disabledReason={row.correctionDisabledReason ?? undefined}
                        unavailableLabel={getDashboardText("unavailable", locale)}
                        onClick={() => onOpenEdit(row.id)}
                      />
                      <IconTextButton
                        label={getDashboardText("void", locale)}
                        icon={<Undo2 size={13} />}
                        disabled={!row.canModify}
                        disabledReason={row.modifyDisabledReason ?? undefined}
                        unavailableLabel={getDashboardText("unavailable", locale)}
                        onClick={() => onOpenVoid(row.id)}
                      />
                      <IconTextButton
                        label={getDashboardText("history", locale)}
                        icon={row.isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        onClick={() => onToggleHistory(row.id)}
                        unavailableLabel={getDashboardText("unavailable", locale)}
                        expanded={row.isExpanded}
                        controls={`dashboard-log-history-${row.id}`}
                      />
                      {row.modifyDisabledReason && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", alignSelf: "center" }}>
                          {row.modifyDisabledReason}
                        </span>
                      )}
                      {!row.modifyDisabledReason && row.correctionDisabledReason && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#b45309", alignSelf: "center" }}>
                          {row.correctionDisabledReason}
                        </span>
                      )}
                    </div>
                  ) : !row.isTankLog ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", padding: "2px 6px", borderRadius: 4, background: "#fff", border: "1px solid #e2e8f0" }}>
                      {row.logKindLabel}
                    </span>
                  ) : null}
                </div>

                {isEditMode && row.isExpanded && (
                  <div
                    id={`dashboard-log-history-${row.id}`}
                    style={{ borderTop: "1px solid #e2e8f0", background: "#fff", padding: 12 }}
                  >
                    {row.historyLoading ? (
                      <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 12 }}>
                        <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> {getDashboardText("historyLoading", locale)}
                      </div>
                    ) : row.historyEntries.length === 0 ? (
                      <p style={{ color: "#cbd5e1", fontSize: 12, margin: 0 }}>{getDashboardText("noHistory", locale)}</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {row.historyEntries.map((revision) => (
                          <div
                            key={revision.id}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "52px 1fr",
                              gap: 10,
                              alignItems: "center",
                              padding: 10,
                              borderRadius: 8,
                              border: "1px solid #f1f5f9",
                              background: "#fafafa",
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>{revision.revisionLabel}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                <span style={{ fontSize: 12, fontWeight: 800, color: revision.statusColor }}>{revision.statusLabel}</span>
                                <span style={{ fontSize: 12, color: "#64748b" }}>{revision.actionLabel}</span>
                                <span style={{ fontSize: 12, color: "#94a3b8" }}>{revision.timeLabel}</span>
                              </div>
                              {revision.editMetadata && (
                                <div style={{ marginTop: 4, fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {revision.editMetadata}
                                </div>
                              )}
                              {revision.voidMetadata && (
                                <div style={{ marginTop: 4, fontSize: 11, color: "#dc2626", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {revision.voidMetadata}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function IconTextButton({
  label,
  icon,
  disabled,
  disabledReason,
  unavailableLabel,
  expanded,
  controls,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  unavailableLabel: string;
  expanded?: boolean;
  controls?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason ?? unavailableLabel : label}
      aria-expanded={expanded}
      aria-controls={controls}
      style={{
        border: "1px solid #e2e8f0",
        background: disabled ? "#f8fafc" : "#fff",
        color: disabled ? "#cbd5e1" : "#475569",
        borderRadius: 8,
        padding: "6px 8px",
        fontSize: 11,
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        gap: 4,
        minHeight: 30,
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function miniActionButtonStyle(disabled = false): React.CSSProperties {
  return {
    border: "1px solid #dbeafe",
    background: disabled ? "#f8fafc" : "#fff",
    color: disabled ? "#cbd5e1" : "#2563eb",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
  };
}

function dangerMiniButtonStyle(disabled = false): React.CSSProperties {
  return {
    ...miniActionButtonStyle(disabled),
    border: `1px solid ${disabled ? "#e2e8f0" : "#fecaca"}`,
    color: disabled ? "#cbd5e1" : "#dc2626",
  };
}
