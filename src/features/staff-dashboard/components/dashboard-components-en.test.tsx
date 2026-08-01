import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DashboardCorrectionModals } from "./DashboardCorrectionModals";
import { DashboardLogsSection } from "./DashboardLogsSection";
import { DashboardOperationsSummary } from "./DashboardOperationsSummary";
import { DashboardStatusSummary } from "./DashboardStatusSummary";
import { StaffDashboardView } from "./StaffDashboardView";

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/u;

describe("staff dashboard English static render", () => {
  it("renders English chrome across the view and summaries", () => {
    const html = renderToStaticMarkup(
      <StaffDashboardView staffName="Alex" loading={false} overlays={null} locale="en">
        <DashboardStatusSummary totalTanks={1} items={[{ key: "filled", label: "Filled", count: 1, color: "#16a34a" }]} locale="en" />
        <DashboardOperationsSummary
          customerLoans={[]}
          todayTotal={0}
          todayOperations={[]}
          unfilledReportCount={0}
          recentUnfilledReports={[]}
          locale="en"
        />
      </StaffDashboardView>,
    );
    expect(html).toContain("Dashboard");
    expect(html).toContain(">tank</span>");
    expect(html).toContain("No tanks are currently lent.");
    expect(html).not.toMatch(JAPANESE_TEXT);
  });

  it("renders English log controls and empty state", () => {
    const html = renderToStaticMarkup(
      <DashboardLogsSection
        activeLogCount={0}
        rows={[]}
        sortOrder="desc"
        isEditMode={false}
        selectedCount={0}
        bulkLocationDisabled
        bulkVoidDisabled
        bulkLocationUnavailableReason={null}
        onToggleSort={vi.fn()}
        onToggleEditMode={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
        onOpenBulkLocation={vi.fn()}
        onOpenBulkVoid={vi.fn()}
        onToggleSelection={vi.fn()}
        onOpenEdit={vi.fn()}
        onOpenVoid={vi.fn()}
        onToggleHistory={async () => undefined}
        locale="en"
      />,
    );
    expect(html).toContain("Recent activity log");
    expect(html).toContain("Newest first");
    expect(html).not.toMatch(JAPANESE_TEXT);
  });

  it("renders contextual English counts and accessible log controls", () => {
    const operationsHtml = renderToStaticMarkup(
      <DashboardOperationsSummary
        customerLoans={[{ key: "customer-1", displayName: "Acme", lent: 1, unreturned: 0 }]}
        todayTotal={2}
        todayOperations={[{ key: "lend", action: "Lend", count: 2 }]}
        unfilledReportCount={1}
        recentUnfilledReports={[{
          id: "report-1",
          tankId: "A-01",
          customerName: "Acme",
          customerTitle: "Acme",
          statusLabel: "Pending",
          timeLabel: "Jul 25, 10:00",
          sourceLabel: "Customer portal",
        }]}
        locale="en"
      />,
    );
    expect(operationsHtml).toContain("1 customer");
    expect(operationsHtml).toContain("2 operations");
    expect(operationsHtml).toContain("1 report");
    expect(operationsHtml).not.toMatch(JAPANESE_TEXT);

    const logsHtml = renderToStaticMarkup(
      <DashboardLogsSection
        activeLogCount={1}
        rows={[{
          id: "log-1",
          tankId: "A-01",
          actionLabel: "Lend",
          actionBackground: "#eff6ff",
          actionForeground: "#2563eb",
          locationLabel: "Acme",
          staffLabel: "Alex",
          timeLabel: "Jul 25, 10:00",
          isTankLog: true,
          logKindLabel: "Tank operation",
          isSelected: false,
          canModify: true,
          modifyDisabledReason: null,
          canCorrect: true,
          correctionDisabledReason: null,
          isExpanded: true,
          historyLoading: false,
          historyEntries: [],
        }]}
        sortOrder="desc"
        isEditMode
        selectedCount={0}
        bulkLocationDisabled
        bulkVoidDisabled
        bulkLocationUnavailableReason={null}
        onToggleSort={vi.fn()}
        onToggleEditMode={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
        onOpenBulkLocation={vi.fn()}
        onOpenBulkVoid={vi.fn()}
        onToggleSelection={vi.fn()}
        onOpenEdit={vi.fn()}
        onOpenVoid={vi.fn()}
        onToggleHistory={async () => undefined}
        locale="en"
      />,
    );
    expect(logsHtml).toContain("1 active log");
    expect(logsHtml).toContain('aria-pressed="true"');
    expect(logsHtml).toContain('aria-controls="dashboard-log-history-log-1"');
    expect(logsHtml).not.toMatch(JAPANESE_TEXT);
  });

  it("renders English loading failures and retry without raw details", () => {
    const html = renderToStaticMarkup(
      <StaffDashboardView
        staffName="Alex"
        loading={false}
        loadFailed
        onRetry={vi.fn()}
        overlays={null}
        locale="en"
      >
        <span>stale content</span>
      </StaffDashboardView>,
    );
    expect(html).toContain("The dashboard could not be loaded.");
    expect(html).toContain("Retry");
    expect(html).not.toContain("stale content");
    expect(html).not.toMatch(JAPANESE_TEXT);
  });

  it("renders an accessible English correction dialog", () => {
    const html = renderToStaticMarkup(
      <DashboardCorrectionModals
        idCorrection={{
          tankIds: ["A-01", "A-02"],
          selectedTankId: "A-02",
          reason: "correct tank",
          saving: false,
          confirmDisabled: false,
          disabledReason: null,
          onTankIdChange: vi.fn(),
          onReasonChange: vi.fn(),
          onConfirm: async () => undefined,
          onClose: vi.fn(),
        }}
        singleVoid={null}
        bulkLocation={null}
        bulkVoid={null}
        locale="en"
      />,
    );
    expect(html).toContain("Change tank ID");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Close"');
    expect(html).not.toMatch(JAPANESE_TEXT);
  });
});
