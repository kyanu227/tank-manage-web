/** 耐圧検査設定。Firestore上の正本は settings/inspection。 */
export type InspectionSettings = {
  validityYears: number;
  alertMonths: number;
};

export const INSPECTION_SETTINGS_LIMITS = {
  validityYears: { min: 1, max: 20 },
  alertMonths: { min: 1, max: 24 },
} as const;

export const DEFAULT_INSPECTION_SETTINGS: Readonly<InspectionSettings> = Object.freeze({
  validityYears: 5,
  alertMonths: 6,
});

export function validateInspectionSettings(settings: InspectionSettings): string[] {
  const errors: string[] = [];
  if (!isIntegerInRange(settings.validityYears, INSPECTION_SETTINGS_LIMITS.validityYears)) {
    errors.push("検査有効期間は1〜20年の整数で指定してください。");
  }
  if (!isIntegerInRange(settings.alertMonths, INSPECTION_SETTINGS_LIMITS.alertMonths)) {
    errors.push("告知開始は1〜24ヶ月前の整数で指定してください。");
  }
  return errors;
}

export function assertValidInspectionSettings(settings: InspectionSettings): void {
  const errors = validateInspectionSettings(settings);
  if (errors.length > 0) throw new Error(errors.join("\n"));
}

export function normalizeInspectionSettings(value: unknown): InspectionSettings {
  const record = objectRecord(value);
  return {
    validityYears: isIntegerInRange(
      record?.validityYears,
      INSPECTION_SETTINGS_LIMITS.validityYears,
    ) ? record.validityYears : DEFAULT_INSPECTION_SETTINGS.validityYears,
    alertMonths: isIntegerInRange(
      record?.alertMonths,
      INSPECTION_SETTINGS_LIMITS.alertMonths,
    ) ? record.alertMonths : DEFAULT_INSPECTION_SETTINGS.alertMonths,
  };
}

function isIntegerInRange(
  value: unknown,
  range: Readonly<{ min: number; max: number }>,
): value is number {
  return Number.isInteger(value) && Number.isFinite(value)
    && (value as number) >= range.min && (value as number) <= range.max;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
