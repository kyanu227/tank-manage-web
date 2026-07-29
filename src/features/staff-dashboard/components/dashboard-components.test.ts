import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  DashboardCorrectionModals,
  type DashboardBulkLocationModalProps,
  type DashboardBulkVoidModalProps,
  type DashboardIdCorrectionModalProps,
  type DashboardSingleVoidModalProps,
} from "./DashboardCorrectionModals";
import {
  DashboardLogsSection,
  type DashboardLogRowView,
} from "./DashboardLogsSection";
import { DashboardOperationsSummary } from "./DashboardOperationsSummary";
import { DashboardSectionLabel } from "./DashboardSectionLabel";
import { DashboardStatusSummary } from "./DashboardStatusSummary";
import {
  StaffDashboardView,
  type StaffDashboardViewProps,
} from "./StaffDashboardView";

const PAGE_PATH = "src/app/staff/dashboard/page.tsx";
const COMPONENT_DIRECTORY =
  "src/features/staff-dashboard/components";

function noop(): void {}

async function noopAsync(): Promise<void> {}

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("StaffDashboardView static render", () => {
  it("header・staff・children・overlays・styleを現行DOM順で表示する", () => {
    const props = {
      staffName: "担当者A",
      loading: false,
      children: React.createElement("main", null, "CONTENT"),
      overlays: React.createElement("aside", null, "OVERLAY"),
    } satisfies StaffDashboardViewProps;
    const html = render(
      React.createElement(StaffDashboardView, props),
    );

    expect(html).toContain("ダッシュボード");
    expect(html).toContain("ステータス別内訳 / 業務状況 / 操作ログ");
    expect(html).toContain("担当者A さん");
    expect(html).toContain("CONTENT");
    expect(html).toContain("OVERLAY");
    expect(html).toContain("@keyframes spin");
    expect(html).toContain("@media (max-width: 720px)");
    expect(html.indexOf("ダッシュボード")).toBeLessThan(
      html.indexOf("CONTENT"),
    );
    expect(html.indexOf("CONTENT")).toBeLessThan(
      html.indexOf("OVERLAY"),
    );
    expect(html.indexOf("OVERLAY")).toBeLessThan(
      html.indexOf("<style>"),
    );
  });

  it("staffなしとloading分岐でもoverlay・styleを維持する", () => {
    const props = {
      staffName: null,
      loading: true,
      children: React.createElement("main", null, "HIDDEN"),
      overlays: React.createElement("aside", null, "OVERLAY"),
    } satisfies StaffDashboardViewProps;
    const html = render(
      React.createElement(StaffDashboardView, props),
    );

    expect(html).toContain("読み込み中...");
    expect(html).not.toContain("HIDDEN");
    expect(html).not.toContain(" さん");
    expect(html).toContain("OVERLAY");
    expect(html).toContain("dashboard-log-row");
  });
});

describe("summary components static render", () => {
  it("SectionLabelの通常toneとalert toneを維持する", () => {
    const normal = render(
      React.createElement(DashboardSectionLabel, {
        icon: React.createElement("i", null, "I"),
        title: "通常",
      }),
    );
    const alert = render(
      React.createElement(DashboardSectionLabel, {
        icon: React.createElement("i", null, "I"),
        title: "警告",
        tone: "alert",
      }),
    );

    expect(normal).toContain("通常");
    expect(normal).toContain("#475569");
    expect(alert).toContain("警告");
    expect(alert).toContain("#dc2626");
  });

  it("status total・複数item・label・colorを表示する", () => {
    const html = render(
      React.createElement(DashboardStatusSummary, {
        totalTanks: 3,
        items: [
          {
            key: "filled",
            label: "充填済",
            count: 2,
            color: "#16a34a",
          },
          {
            key: "lent",
            label: "貸出中",
            count: 1,
            color: "#3b82f6",
          },
        ],
      }),
    );

    expect(html).toContain("ステータス別内訳");
    expect(html).toContain("総本数");
    expect(html).toContain(">3<");
    expect(html).toContain("充填済");
    expect(html).toContain("貸出中");
    expect(html).toContain("#16a34a");
    expect(html).toContain("#3b82f6");
  });

  it("total 0で現行empty textを表示する", () => {
    const html = render(
      React.createElement(DashboardStatusSummary, {
        totalTanks: 0,
        items: [],
      }),
    );

    expect(html).toContain("タンクが未登録です");
  });

  it("業務3panelをpopulated順で表示する", () => {
    const html = render(
      React.createElement(DashboardOperationsSummary, {
        customerLoans: [
          {
            key: "customer-1",
            displayName: "貸出先A",
            lent: 2,
            unreturned: 1,
          },
        ],
        todayTotal: 4,
        todayOperations: [
          {
            action: "貸出",
            count: 4,
          },
        ],
        unfilledReportCount: 2,
        recentUnfilledReports: [
          {
            id: "report-configured",
            tankId: "A-01",
            customerName: "顧客A",
            customerTitle: "顧客A",
            statusLabel: "記録済み",
            timeLabel: "7/27 10:00",
            sourceLabel: "顧客ポータル",
          },
          {
            id: "report-missing",
            tankId: "-",
            customerName: "顧客未設定",
            customerTitle: "",
            statusLabel: "status未設定",
            timeLabel: "-",
            sourceLabel: "source未設定",
          },
        ],
      }),
    );

    expect(html).toContain("業務状況");
    expect(html).toContain("貸出先A");
    expect(html).toContain("貸出 2");
    expect(html).toContain("未返却 1");
    expect(html).toContain("今日の操作");
    expect(html).toContain("4件");
    expect(html).toContain("顧客未充填報告");
    expect(html).toContain("顧客未設定");
    expect(html).toContain("status未設定");
    expect(html).toContain("source未設定");
    expect(html).toContain("read-only");
    expect(html).toMatch(
      /title="顧客A"[^>]*>顧客A<\/span>/,
    );
    expect(html).toMatch(
      /title=""[^>]*>顧客未設定<\/span>/,
    );
    expect(html).not.toContain(
      'title="顧客未設定"',
    );
    expect(html.indexOf("貸出先別")).toBeLessThan(
      html.indexOf("今日の操作"),
    );
    expect(html.indexOf("今日の操作")).toBeLessThan(
      html.indexOf("顧客未充填報告"),
    );
  });

  it("業務3panelのempty textを維持する", () => {
    const html = render(
      React.createElement(DashboardOperationsSummary, {
        customerLoans: [],
        todayTotal: 0,
        todayOperations: [],
        unfilledReportCount: 0,
        recentUnfilledReports: [],
      }),
    );

    expect(html).toContain("貸出中のタンクはありません");
    expect(html).toContain("本日の操作はまだありません");
    expect(html).toContain("顧客未充填報告はありません");
  });
});

describe("DashboardLogsSection static render", () => {
  const historyRow: DashboardLogRowView = {
    id: "log-1",
    tankId: "A-01",
    actionLabel: "貸出",
    actionBackground: "#eff6ff",
    actionForeground: "#2563eb",
    locationLabel: "顧客A",
    staffLabel: "担当者A",
    timeLabel: "7/27 10:00",
    isTankLog: true,
    logKindLabel: "tank",
    isSelected: true,
    canModify: true,
    modifyDisabledReason: null,
    canCorrect: true,
    correctionDisabledReason: null,
    isExpanded: true,
    historyLoading: false,
    historyEntries: [
      {
        id: "revision-1",
        revisionLabel: "v1",
        statusLabel: "置換済",
        statusColor: "#64748b",
        actionLabel: "貸出",
        timeLabel: "7/27 10:05",
        editMetadata: "担当者A / 修正理由",
        voidMetadata: null,
      },
      {
        id: "revision-2",
        revisionLabel: "v2",
        statusLabel: "取消済",
        statusColor: "#dc2626",
        actionLabel: "取消",
        timeLabel: "7/27 10:10",
        editMetadata: null,
        voidMetadata: "担当者B / 取消理由",
      },
    ],
  };

  const baseProps = {
    activeLogCount: 2,
    rows: [historyRow],
    sortOrder: "desc" as const,
    isEditMode: true,
    selectedCount: 1,
    bulkLocationDisabled: false,
    bulkVoidDisabled: false,
    bulkLocationUnavailableReason: null,
    onToggleSort: noop,
    onToggleEditMode: noop,
    onSelectAll: noop,
    onClearSelection: noop,
    onOpenBulkLocation: noop,
    onOpenBulkVoid: noop,
    onToggleSelection: noop,
    onOpenEdit: noop,
    onOpenVoid: noop,
    onToggleHistory: noopAsync,
  };

  it("count・desc・edit/bulk toolbar・tank row・historyを表示する", () => {
    const html = render(
      React.createElement(DashboardLogsSection, baseProps),
    );

    expect(html).toContain("最近の操作ログ");
    expect(html).toContain("直近 2 件（active）");
    expect(html).toContain("新しい順");
    expect(html).toContain("新しい順 → 古い順に切替");
    expect(html).toContain("選択 1 件");
    expect(html).toContain("全選択");
    expect(html).toContain("選択解除");
    expect(html).toContain("貸出先変更");
    expect(html).toContain("一括取消");
    expect(html).toContain("dashboard-log-row--editing");
    expect(html).toContain("dashboard-log-checkbox");
    expect(html).toContain("A-01");
    expect(html).toContain("顧客A");
    expect(html).toContain("担当者A");
    expect(html).toContain("title=\"選択\"");
    expect(html).toContain("ID変更");
    expect(html).toContain("取消");
    expect(html).toContain("履歴");
    expect(html).toContain("v1");
    expect(html).toContain("担当者A / 修正理由");
    expect(html).toContain("担当者B / 取消理由");
  });

  it("asc・edit off・non-tank・unselectedを表示する", () => {
    const html = render(
      React.createElement(DashboardLogsSection, {
        ...baseProps,
        sortOrder: "asc",
        isEditMode: false,
        selectedCount: 0,
        rows: [
          {
            ...historyRow,
            id: "non-tank",
            tankId: "PROC-1",
            isTankLog: false,
            logKindLabel: "procurement",
            isSelected: false,
            isExpanded: false,
            historyEntries: [],
          },
        ],
      }),
    );

    expect(html).toContain("古い順");
    expect(html).toContain("古い順 → 新しい順に切替");
    expect(html).toContain(">編集<");
    expect(html).toContain("procurement");
    expect(html).not.toContain("dashboard-log-row--editing");
    expect(html).not.toContain("選択 0 件");
  });

  it("disabled reason・checkbox title・history loading/emptyを維持する", () => {
    const disabledRow: DashboardLogRowView = {
      ...historyRow,
      canModify: false,
      modifyDisabledReason: "期限超過",
      canCorrect: false,
      correctionDisabledReason: "訂正不可",
      isSelected: false,
      historyLoading: true,
      historyEntries: [],
    };
    const loadingHtml = render(
      React.createElement(DashboardLogsSection, {
        ...baseProps,
        rows: [disabledRow],
        bulkLocationDisabled: true,
        bulkVoidDisabled: true,
        bulkLocationUnavailableReason: "貸出先変更不可",
      }),
    );

    expect(loadingHtml).toContain("title=\"期限超過\"");
    expect(loadingHtml).toContain("disabled");
    expect(loadingHtml).toContain("訂正不可");
    expect(loadingHtml).toContain("貸出先変更不可");
    expect(loadingHtml).toContain("履歴を読み込み中...");

    const emptyHtml = render(
      React.createElement(DashboardLogsSection, {
        ...baseProps,
        rows: [{
          ...disabledRow,
          historyLoading: false,
        }],
      }),
    );
    expect(emptyHtml).toContain("履歴がありません");
  });

  it("rows emptyで現行empty textを表示する", () => {
    const html = render(
      React.createElement(DashboardLogsSection, {
        ...baseProps,
        rows: [],
      }),
    );

    expect(html).toContain("ログがありません");
  });
});

describe("DashboardCorrectionModals static render", () => {
  const idCorrection = {
    tankIds: ["A-01", "A-02"],
    selectedTankId: "A-01",
    reason: "編集理由",
    saving: false,
    confirmDisabled: true,
    disabledReason: "変更前と同じタンクIDです",
    onTankIdChange: noop,
    onReasonChange: noop,
    onConfirm: noopAsync,
    onClose: noop,
  } satisfies DashboardIdCorrectionModalProps;

  const singleVoid = {
    targetTankId: "A-01",
    actionLabel: "貸出",
    reason: "取消理由",
    saving: true,
    confirmDisabled: true,
    disabledReason: "保存中です",
    onReasonChange: noop,
    onConfirm: noopAsync,
    onClose: noop,
  } satisfies DashboardSingleVoidModalProps;

  const bulkLocation = {
    selectedCount: 2,
    options: [
      {
        value: "customer-1",
        label: "顧客A",
      },
      {
        value: "customer-2",
        label: "顧客B",
      },
    ],
    selectedValue: "customer-2",
    reason: "変更理由",
    saving: true,
    confirmDisabled: true,
    onValueChange: noop,
    onReasonChange: noop,
    onConfirm: noopAsync,
    onClose: noop,
  } satisfies DashboardBulkLocationModalProps;

  const bulkVoid = {
    selectedCount: 3,
    reason: "一括取消理由",
    saving: true,
    confirmDisabled: true,
    onReasonChange: noop,
    onConfirm: noopAsync,
    onClose: noop,
  } satisfies DashboardBulkVoidModalProps;

  it("all nullでmodalを表示しない", () => {
    const html = render(
      React.createElement(DashboardCorrectionModals, {
        idCorrection: null,
        singleVoid: null,
        bulkLocation: null,
        bulkVoid: null,
      }),
    );

    expect(html).toBe("");
  });

  it("ID modalのpicker・reason・disabled reasonを表示する", () => {
    const html = render(
      React.createElement(DashboardCorrectionModals, {
        idCorrection,
        singleVoid: null,
        bulkLocation: null,
        bulkVoid: null,
      }),
    );

    expect(html).toContain("タンクID変更");
    expect(html).toContain("アルファベット");
    expect(html).toContain("番号");
    expect(html).toContain("編集理由");
    expect(html).toContain("変更前と同じタンクIDです");
    expect(html).toContain("disabled");
    expect(html).toContain("aria-label=\"close\"");
  });

  it("single void modalのtarget・saving copy・disabledを表示する", () => {
    const html = render(
      React.createElement(DashboardCorrectionModals, {
        idCorrection: null,
        singleVoid,
        bulkLocation: null,
        bulkVoid: null,
      }),
    );

    expect(html).toContain("ログ取消");
    expect(html).toContain("A-01");
    expect(html).toContain("貸出");
    expect(html).toContain("取消中...");
    expect(html).toContain("保存中です");
    expect(html).toContain("disabled");
  });

  it("bulk location modalのcount・options・reason・savingを表示する", () => {
    const html = render(
      React.createElement(DashboardCorrectionModals, {
        idCorrection: null,
        singleVoid: null,
        bulkLocation,
        bulkVoid: null,
      }),
    );

    expect(html).toContain("選択中 2 件");
    expect(html).toContain("顧客A");
    expect(html).toContain("顧客B");
    expect(html).toContain("変更理由");
    expect(html).toContain("更新中...");
    expect(html).toContain("disabled");
  });

  it("bulk void modalのcount・reason・savingを表示する", () => {
    const html = render(
      React.createElement(DashboardCorrectionModals, {
        idCorrection: null,
        singleVoid: null,
        bulkLocation: null,
        bulkVoid,
      }),
    );

    expect(html).toContain("選択中 3 件");
    expect(html).toContain("一括取消理由");
    expect(html).toContain("取消中...");
    expect(html).toContain("disabled");
  });
});

describe("dashboard projection and component boundary contract", () => {

  it("未充填報告projectionの本文・title fallbackをASTで固定する", () => {
    const page = readTypeScriptSource(PAGE_PATH);
    const reportRows = findVariableDeclaration(page, "reportRows");

    expect(reportRows?.initializer).toBeDefined();
    if (!reportRows?.initializer) return;

    const properties = new Map<string, ts.Expression>();
    visit(reportRows.initializer, (node) => {
      if (!ts.isPropertyAssignment(node)) return;
      const name = node.name.getText(page);
      if (!properties.has(name)) {
        properties.set(name, node.initializer);
      }
    });

    const customerName = properties.get("customerName");
    const customerTitle = properties.get("customerTitle");

    expect(customerName).toBeDefined();
    expect(customerTitle).toBeDefined();
    if (!customerName || !customerTitle) return;

    expectLogicalOrExpression(
      page,
      customerName,
      "report.customerName",
      "\"顧客未設定\"",
    );
    expectLogicalOrExpression(
      page,
      customerTitle,
      "report.customerName",
      "\"\"",
    );

    const projectionSource =
      reportRows.initializer.getText(page);
    expect(projectionSource).not.toContain("??");
    expect(projectionSource).not.toContain(".trim(");
  });

  it("未充填報告componentの本文・title分離をASTで固定する", () => {
    const componentPath =
      `${COMPONENT_DIRECTORY}/DashboardOperationsSummary.tsx`;
    const sourceFile = readTypeScriptSource(componentPath);
    let reportCustomerSpan: ts.JsxElement | undefined;
    let hasForbiddenTitle = false;

    visit(sourceFile, (node) => {
      if (
        !ts.isJsxAttribute(node)
        || !ts.isIdentifier(node.name)
        || node.name.text !== "title"
      ) {
        return;
      }
      if (
        !node.initializer
        || !ts.isJsxExpression(node.initializer)
        || !node.initializer.expression
      ) {
        return;
      }
      const expression = compact(
        node.initializer.expression.getText(sourceFile),
      );
      if (expression === "report.customerName") {
        hasForbiddenTitle = true;
      }
      if (expression !== "report.customerTitle") return;

      const attributes = node.parent;
      const openingElement = attributes.parent;
      const jsxElement = openingElement.parent;
      if (ts.isJsxElement(jsxElement)) {
        reportCustomerSpan = jsxElement;
      }
    });

    expect(reportCustomerSpan).toBeDefined();
    expect(hasForbiddenTitle).toBe(false);
    const bodyExpressions = reportCustomerSpan?.children
      .filter(ts.isJsxExpression)
      .map((child) =>
        child.expression
          ? compact(child.expression.getText(sourceFile))
          : ""
      );
    expect(bodyExpressions).toContain("report.customerName");

    const source = compact(sourceFile.getFullText());
    expect(source).not.toContain(
      compact("report.customerName === \"顧客未設定\""),
    );
    expect(source).not.toContain(
      compact("report.customerName ||"),
    );
    expect(source).not.toContain(
      compact("report.customerName ??"),
    );
  });

  it("component props contractとforbidden import/callをASTで固定する", () => {
    const componentPaths = readdirSync(
      resolve(process.cwd(), COMPONENT_DIRECTORY),
    )
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => !file.endsWith(".test.ts"))
      .map((file) => `${COMPONENT_DIRECTORY}/${file}`);
    const forbiddenModules = [
      "firebase",
      "repositories",
      "dashboard-query",
      "dashboard-read-model",
      "log-correction-workflow",
      "useStaffSession",
      "useStaffLocale",
      "useTanks",
    ];
    const forbiddenCalls = new Set([
      "alert",
      "useStaffSession",
      "useStaffLocale",
      "useTanks",
    ]);

    componentPaths.forEach((path) => {
      const sourceFile = readTypeScriptSource(path);
      sourceFile.statements.forEach((statement) => {
        if (!ts.isImportDeclaration(statement)) return;
        const moduleName = (
          statement.moduleSpecifier as ts.StringLiteral
        ).text;
        forbiddenModules.forEach((forbidden) => {
          expect(moduleName, `${path}: ${moduleName}`)
            .not.toContain(forbidden);
        });
        if (
          moduleName.startsWith(
            "@/features/staff-dashboard/components/",
          )
        ) {
          expect(moduleName).toBe(
            "@/features/staff-dashboard/components/DashboardSectionLabel",
          );
        }
      });

      visit(sourceFile, (node) => {
        if (ts.isCallExpression(node)) {
          if (ts.isIdentifier(node.expression)) {
            expect(
              forbiddenCalls.has(node.expression.text),
              `${path}: ${node.expression.text}`,
            ).toBe(false);
          }
          if (
            ts.isPropertyAccessExpression(node.expression)
            && ts.isIdentifier(node.expression.expression)
            && node.expression.expression.text === "Date"
            && node.expression.name.text === "now"
          ) {
            throw new Error(`${path}: Date.now is forbidden`);
          }
        }
      });
    });

    expectExportedTypeMembers(
      `${COMPONENT_DIRECTORY}/StaffDashboardView.tsx`,
      "StaffDashboardViewProps",
      ["staffName", "loading", "children", "overlays"],
    );
    expectExportedTypeMembers(
      `${COMPONENT_DIRECTORY}/DashboardSectionLabel.tsx`,
      "DashboardSectionLabelProps",
      ["icon", "title", "tone"],
      ["tone"],
    );
    expectExportedTypeMembers(
      `${COMPONENT_DIRECTORY}/DashboardStatusSummary.tsx`,
      "DashboardStatusSummaryProps",
      ["totalTanks", "items"],
    );
    expectExportedTypeMembers(
      `${COMPONENT_DIRECTORY}/DashboardOperationsSummary.tsx`,
      "DashboardOperationsSummaryProps",
      [
        "customerLoans",
        "todayTotal",
        "todayOperations",
        "unfilledReportCount",
        "recentUnfilledReports",
      ],
    );
    expectReadonlyStringTypeMembers(
      `${COMPONENT_DIRECTORY}/DashboardOperationsSummary.tsx`,
      "DashboardUnfilledReportRowView",
      [
        "id",
        "tankId",
        "customerName",
        "customerTitle",
        "statusLabel",
        "timeLabel",
        "sourceLabel",
      ],
    );
    expectExportedTypeMembers(
      `${COMPONENT_DIRECTORY}/DashboardLogsSection.tsx`,
      "DashboardLogsSectionProps",
      [
        "activeLogCount",
        "rows",
        "sortOrder",
        "isEditMode",
        "selectedCount",
        "bulkLocationDisabled",
        "bulkVoidDisabled",
        "bulkLocationUnavailableReason",
        "onToggleSort",
        "onToggleEditMode",
        "onSelectAll",
        "onClearSelection",
        "onOpenBulkLocation",
        "onOpenBulkVoid",
        "onToggleSelection",
        "onOpenEdit",
        "onOpenVoid",
        "onToggleHistory",
      ],
    );
    expectExportedTypeMembers(
      `${COMPONENT_DIRECTORY}/DashboardCorrectionModals.tsx`,
      "DashboardCorrectionModalsProps",
      ["idCorrection", "singleVoid", "bulkLocation", "bulkVoid"],
    );
  });
});

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function readTypeScriptSource(relativePath: string): ts.SourceFile {
  const source = readSource(relativePath);
  return ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
}

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function expectLogicalOrExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  expectedLeft: string,
  expectedRight: string,
): void {
  expect(ts.isBinaryExpression(expression)).toBe(true);
  if (!ts.isBinaryExpression(expression)) return;
  expect(expression.operatorToken.kind).toBe(
    ts.SyntaxKind.BarBarToken,
  );
  expect(compact(expression.left.getText(sourceFile))).toBe(
    compact(expectedLeft),
  );
  expect(compact(expression.right.getText(sourceFile))).toBe(
    compact(expectedRight),
  );
}

function visit(
  node: ts.Node,
  callback: (node: ts.Node) => void,
): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function findVariableDeclaration(
  node: ts.Node,
  variableName: string,
): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  visit(node, (candidate) => {
    if (
      !found
      && ts.isVariableDeclaration(candidate)
      && ts.isIdentifier(candidate.name)
      && candidate.name.text === variableName
    ) {
      found = candidate;
    }
  });
  return found;
}

function expectExportedTypeMembers(
  relativePath: string,
  typeName: string,
  requiredNames: readonly string[],
  optionalNames: readonly string[] = [],
): void {
  const sourceFile = readTypeScriptSource(relativePath);
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement)
      && statement.name.text === typeName,
  );

  expect(declaration, `${relativePath}: ${typeName}`).toBeDefined();
  expect(
    declaration?.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ),
  ).toBe(true);
  expect(
    declaration && ts.isTypeLiteralNode(declaration.type),
  ).toBe(true);
  if (!declaration || !ts.isTypeLiteralNode(declaration.type)) return;

  const members = declaration.type.members
    .filter(ts.isPropertySignature);
  const names = members.map((member) =>
    member.name?.getText(sourceFile)
  );
  expect(names).toStrictEqual(requiredNames);
  members.forEach((member) => {
    const name = member.name?.getText(sourceFile) ?? "";
    expect(Boolean(member.questionToken), name).toBe(
      optionalNames.includes(name),
    );
  });
}

function expectReadonlyStringTypeMembers(
  relativePath: string,
  typeName: string,
  requiredNames: readonly string[],
): void {
  const sourceFile = readTypeScriptSource(relativePath);
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement)
      && statement.name.text === typeName,
  );

  expect(declaration, `${relativePath}: ${typeName}`).toBeDefined();
  expect(
    declaration?.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ),
  ).toBe(true);
  expect(
    declaration && ts.isTypeReferenceNode(declaration.type),
  ).toBe(true);
  if (!declaration || !ts.isTypeReferenceNode(declaration.type)) {
    return;
  }

  expect(declaration.type.typeName.getText(sourceFile)).toBe(
    "Readonly",
  );
  expect(declaration.type.typeArguments?.length).toBe(1);
  const typeArgument = declaration.type.typeArguments?.[0];
  expect(typeArgument && ts.isTypeLiteralNode(typeArgument)).toBe(
    true,
  );
  if (!typeArgument || !ts.isTypeLiteralNode(typeArgument)) return;

  const members = typeArgument.members.filter(
    ts.isPropertySignature,
  );
  const names = members.map((member) =>
    member.name?.getText(sourceFile)
  );
  expect(names).toStrictEqual(requiredNames);
  members.forEach((member) => {
    const name = member.name?.getText(sourceFile) ?? "";
    expect(Boolean(member.questionToken), name).toBe(false);
    expect(member.type?.getText(sourceFile), name).toBe("string");
  });
}
