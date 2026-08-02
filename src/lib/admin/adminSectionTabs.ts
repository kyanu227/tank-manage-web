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

export function getVisibleAdminSectionTabs<T extends AdminSectionTab>(
  tabs: readonly T[],
  capabilities: readonly AdminCapability[],
): T[] {
  const allowed = new Set(capabilities);
  return tabs.filter((tab) => allowed.has(tab.capability));
}
