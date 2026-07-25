import { describe, expect, it } from "vitest";
import { calculateInspectionSchedule } from "@/lib/inspection-schedule";

describe("calculateInspectionSchedule", () => {
  it("settings fallback解決後の5年を従来どおり加算する", () => {
    const result = calculateInspectionSchedule({
      validityYears: 5,
      nextInspectionDateBase: new Date(2026, 6, 25, 14, 30),
      inspectionDate: new Date(2026, 6, 25, 14, 30),
    });

    expect(result).toEqual({
      maintenanceDate: "2026/07/25",
      nextMaintenanceDate: "2031/07/25",
    });
  });

  it("settingsの異なる有効年数を従来どおり加算する", () => {
    const result = calculateInspectionSchedule({
      validityYears: 3,
      nextInspectionDateBase: new Date(2026, 6, 25, 14, 30),
      inspectionDate: new Date(2026, 6, 25, 14, 30),
    });

    expect(result).toEqual({
      maintenanceDate: "2026/07/25",
      nextMaintenanceDate: "2029/07/25",
    });
  });

  it("うるう日のsetFullYearによる月繰り上がりを維持する", () => {
    const result = calculateInspectionSchedule({
      validityYears: 5,
      nextInspectionDateBase: new Date(2024, 1, 29, 12),
      inspectionDate: new Date(2024, 1, 29, 12),
    });

    expect(result).toEqual({
      maintenanceDate: "2024/02/29",
      nextMaintenanceDate: "2029/03/01",
    });
  });

  it("年末をまたいだ2回のDate生成順序を従来どおり反映する", () => {
    const result = calculateInspectionSchedule({
      validityYears: 5,
      nextInspectionDateBase: new Date(2026, 11, 31, 23, 59, 59, 999),
      inspectionDate: new Date(2027, 0, 1),
    });

    expect(result).toEqual({
      maintenanceDate: "2027/01/01",
      nextMaintenanceDate: "2031/12/31",
    });
  });

  it("同じ入力に対して同じ結果を返す", () => {
    const input = {
      validityYears: 5,
      nextInspectionDateBase: new Date(2026, 6, 25, 14, 30),
      inspectionDate: new Date(2026, 6, 25, 14, 30),
    };

    expect(calculateInspectionSchedule(input)).toEqual(
      calculateInspectionSchedule(input),
    );
  });

  it("入力Dateを変更しない", () => {
    const nextInspectionDateBase = new Date(2024, 1, 29, 12);
    const inspectionDate = new Date(2024, 1, 29, 12);
    const originalNextInspectionTime = nextInspectionDateBase.getTime();
    const originalInspectionTime = inspectionDate.getTime();

    calculateInspectionSchedule({
      validityYears: 5,
      nextInspectionDateBase,
      inspectionDate,
    });

    expect(nextInspectionDateBase.getTime()).toBe(originalNextInspectionTime);
    expect(inspectionDate.getTime()).toBe(originalInspectionTime);
  });
});
