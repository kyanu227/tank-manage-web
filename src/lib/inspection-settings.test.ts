import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSPECTION_SETTINGS,
  normalizeInspectionSettings,
  validateInspectionSettings,
} from "@/lib/inspection-settings";

describe("inspection settings", () => {
  it("uses the documented defaults when the document or fields are absent", () => {
    expect(normalizeInspectionSettings(undefined)).toEqual({ validityYears: 5, alertMonths: 6 });
    expect(normalizeInspectionSettings({ validityYears: 10 })).toEqual({
      validityYears: 10,
      alertMonths: DEFAULT_INSPECTION_SETTINGS.alertMonths,
    });
  });

  it("accepts the inclusive integer boundaries", () => {
    expect(validateInspectionSettings({ validityYears: 1, alertMonths: 24 })).toEqual([]);
    expect(validateInspectionSettings({ validityYears: 20, alertMonths: 1 })).toEqual([]);
  });

  it("rejects non-integers and out-of-range values", () => {
    expect(validateInspectionSettings({ validityYears: 0, alertMonths: 25 })).toHaveLength(2);
    expect(validateInspectionSettings({ validityYears: 5.5, alertMonths: Number.NaN })).toHaveLength(2);
  });

  it("falls back field-by-field for invalid stored data", () => {
    expect(normalizeInspectionSettings({ validityYears: 21, alertMonths: 12 })).toEqual({
      validityYears: 5,
      alertMonths: 12,
    });
  });
});
