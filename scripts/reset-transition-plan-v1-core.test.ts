import { describe, expect, it } from "vitest";
import {
  assertBackupCanBeVerified,
  assertMigrationMarkerMayStart,
  classifyLogKind,
  classifyTransactionType,
  parseResetArguments,
  tankBasicInformationSnapshot,
  validateExecuteArguments,
} from "./reset-transition-plan-v1-core";

describe("transition reset command guard", () => {
  it("requires an explicit Firebase project", () => {
    expect(() => parseResetArguments([])).toThrow("--project");
  });

  it("keeps dry-run available with an explicit project", () => {
    const args = parseResetArguments(["--project=test-project"]);
    expect(args.projectId).toBe("test-project");
    expect(args.execute).toBe(false);
    expect(() => validateExecuteArguments(args)).not.toThrow();
  });

  it("refuses execute while no verifiable backup registry exists", () => {
    const args = parseResetArguments([
      "--project=test-project",
      "--execute",
      "--confirm=RESET_TRANSITION_PLAN_V1",
      "--backup-ref=backup-001",
      "--executed-by=test-admin",
    ]);
    expect(() => validateExecuteArguments(args)).not.toThrow();
    expect(() => assertBackupCanBeVerified(args)).toThrow("機械検証する仕組みがありません");
  });

  it.each(["completed", "in_progress"])("refuses a %s migration marker", (status) => {
    expect(() => assertMigrationMarkerMayStart({ status })).toThrow(status);
  });

  it("allows a failed marker to be retried after the failure is inspected", () => {
    expect(() => assertMigrationMarkerMayStart({ status: "failed" })).not.toThrow();
  });
});

describe("transition reset record classification", () => {
  it("deletes only explicit tank logs", () => {
    expect(classifyLogKind("tank")).toBe("tank");
    expect(classifyLogKind("procurement")).toBe("preserved_non_tank");
    expect(classifyLogKind("future-kind")).toBe("unknown");
    expect(classifyLogKind(undefined)).toBe("unknown");
  });

  it("deletes only explicit development transaction types", () => {
    expect(classifyTransactionType("order")).toBe("delete");
    expect(classifyTransactionType("return")).toBe("delete");
    expect(classifyTransactionType("uncharged_report")).toBe("delete");
    expect(classifyTransactionType("future-type")).toBe("unknown");
  });

  it("separates operation projection from preserved tank information", () => {
    expect(tankBasicInformationSnapshot({
      status: "lent",
      location: "A社",
      customerId: "customer-a",
      latestLogId: "log-a",
      staffName: "担当者",
      logNote: "operation note",
      type: "steel",
      capacity: 10,
      serialNumber: "SERIAL-1",
      purchaseDate: "2026-01-01",
      nextMaintenanceDate: "2031-01-01",
    })).toEqual({
      capacity: 10,
      nextMaintenanceDate: "2031-01-01",
      purchaseDate: "2026-01-01",
      serialNumber: "SERIAL-1",
      type: "steel",
    });
  });
});
