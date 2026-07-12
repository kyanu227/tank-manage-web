export interface AdminSystemNotificationSettings {
  emails: string[];
  alertMonths: number;
  validityYears: number;
}

export type AdminSystemNotificationSettingsSource = "document" | "default";

export interface NormalizedAdminSystemNotificationSettings {
  settings: AdminSystemNotificationSettings;
  source: AdminSystemNotificationSettingsSource;
}

export const DEFAULT_ADMIN_SYSTEM_NOTIFICATION_SETTINGS: Readonly<AdminSystemNotificationSettings> = {
  emails: [],
  alertMonths: 6,
  validityYears: 3,
};

/** document不存在は正常default、read errorは呼出元のload resultで別管理する。 */
export function normalizeAdminSystemNotificationSettings(
  documentData: Record<string, unknown> | undefined,
): NormalizedAdminSystemNotificationSettings {
  if (!documentData) {
    return {
      settings: { ...DEFAULT_ADMIN_SYSTEM_NOTIFICATION_SETTINGS },
      source: "default",
    };
  }

  return {
    settings: {
      emails: (documentData.emails || []) as string[],
      alertMonths: (documentData.alertMonths
        || DEFAULT_ADMIN_SYSTEM_NOTIFICATION_SETTINGS.alertMonths) as number,
      validityYears: (documentData.validityYears
        || DEFAULT_ADMIN_SYSTEM_NOTIFICATION_SETTINGS.validityYears) as number,
    },
    source: "document",
  };
}
