import type { AdminCapability } from "@/lib/admin/adminCapabilities";

export type AdminSectionTab = {
  id: string;
  label: string;
  href: string;
  capability: AdminCapability;
};

export const ADMIN_CUSTOMER_TABS = [
  { id: "customers", label: "顧客", href: "/admin/customers", capability: "customers.view" },
  { id: "portalUsers", label: "ポータル利用者", href: "/admin/customers/users", capability: "customerPortalUsers.view" },
] as const satisfies readonly AdminSectionTab[];

export const ADMIN_STAFF_TABS = [
  { id: "members", label: "担当者", href: "/admin/staff", capability: "staff.view" },
  { id: "permissions", label: "権限", href: "/admin/permissions", capability: "staffPermissions.view" },
  { id: "compensation", label: "報酬・ランク", href: "/admin/money", capability: "staffCompensation.view" },
] as const satisfies readonly AdminSectionTab[];

export const ADMIN_SETTINGS_TABS = [
  { id: "businessRules", label: "業務ルール", href: "/admin/settings", capability: "settings.businessRules.view" },
  { id: "notifications", label: "通知", href: "/admin/notifications", capability: "settings.notifications.view" },
  { id: "operationMode", label: "運用制御", href: "/admin/settings/tank-operations", capability: "settings.operationMode.view" },
] as const satisfies readonly AdminSectionTab[];

export const ADMIN_DEVELOPER_TABS = [
  { id: "stateDiagram", label: "状態遷移図", href: "/admin/state-diagram", capability: "developer.stateDiagram.view" },
  { id: "securityRules", label: "Security Rules", href: "/admin/security-rules", capability: "developer.securityRules.view" },
] as const satisfies readonly AdminSectionTab[];

export function getVisibleAdminSectionTabs<T extends AdminSectionTab>(
  tabs: readonly T[],
  capabilities: readonly AdminCapability[],
): T[] {
  const allowed = new Set(capabilities);
  return tabs.filter((tab) => allowed.has(tab.capability));
}
