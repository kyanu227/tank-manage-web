export interface AdminSystemNotificationSettings {
  emails: string[];
}

export type AdminSystemNotificationSettingsSource = "document" | "default";

export interface NormalizedAdminSystemNotificationSettings {
  settings: AdminSystemNotificationSettings;
  source: AdminSystemNotificationSettingsSource;
}

export const DEFAULT_ADMIN_SYSTEM_NOTIFICATION_SETTINGS: Readonly<AdminSystemNotificationSettings> = {
  emails: [],
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
      emails: Array.isArray(documentData.emails)
        ? documentData.emails.filter((email): email is string => typeof email === "string")
        : [],
    },
    source: "document",
  };
}

/** legacyの検査設定フィールドを含めず、merge保存で既存値にも触れない。 */
export function buildAdminSystemNotificationSettingsWriteFields(
  emails: readonly string[],
): AdminSystemNotificationSettings {
  return {
    emails: emails.map((email) => email.trim()).filter(Boolean),
  };
}
