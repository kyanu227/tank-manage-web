import { describe, expect, it } from "vitest";
import {
  buildAdminSystemNotificationSettingsWriteFields,
  normalizeAdminSystemNotificationSettings,
} from "@/lib/firebase/admin-notification-settings-load-state";

describe("admin notification settings", () => {
  it("normalizes only notification destinations", () => {
    expect(normalizeAdminSystemNotificationSettings({
      emails: ["ops@example.com", 42],
      alertMonths: 18,
      validityYears: 9,
    }).settings).toEqual({ emails: ["ops@example.com"] });
  });

  it("never puts inspection fields in the notification write payload", () => {
    const fields = buildAdminSystemNotificationSettingsWriteFields([
      " ops@example.com ",
      "",
    ]);
    expect(fields).toEqual({ emails: ["ops@example.com"] });
    expect(Object.keys(fields)).toEqual(["emails"]);
    expect(fields).not.toHaveProperty("alertMonths");
    expect(fields).not.toHaveProperty("validityYears");
  });
});
