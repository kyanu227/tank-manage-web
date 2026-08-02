import {
  BarChart3,
  Bell,
  Building2,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  Medal,
  Package,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  UserRoundCog,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { AdminCapability } from "@/lib/admin/adminCapabilities";
import { hasAdminCapability } from "@/lib/admin/adminCapabilities";

export type AdminPageGroup =
  | "dashboard"
  | "response"
  | "analysis"
  | "management"
  | "settings"
  | "developer";

export type AdminPageVisibility = "navigation" | "launcher" | "internal" | "confidential";
export type AdminPageActiveMatch = "exact" | "prefix";
export type AdminPageBadge = "operation-reviews";

export type AdminPageDef = {
  id: string;
  label: string;
  icon: LucideIcon;
  group: AdminPageGroup;
  order: number;
  href: string;
  activeMatch: AdminPageActiveMatch;
  capability: AdminCapability;
  /** 関連画面のcapabilityだけを持つ場合も、統合ナビを表示する。 */
  alternateCapabilities?: readonly AdminCapability[];
  /** 統合画面内の別routeを現在地として扱う。 */
  relatedPageIds?: readonly string[];
  visibility: AdminPageVisibility;
  sidebar: boolean;
  adminOnly?: boolean;
  developerOnly?: boolean;
  badge?: AdminPageBadge;
};

export const ADMIN_NAV_GROUPS: readonly {
  id: AdminPageGroup;
  label: string;
  order: number;
}[] = [
  { id: "response", label: "対応", order: 10 },
  { id: "analysis", label: "分析", order: 20 },
  { id: "management", label: "管理", order: 30 },
];

export const ADMIN_PAGES: readonly AdminPageDef[] = [
  { id: "dashboard", label: "ダッシュボード", icon: LayoutDashboard, group: "dashboard", order: 0, href: "/admin", activeMatch: "exact", capability: "dashboard.view", visibility: "navigation", sidebar: true },
  { id: "reviews", label: "レビュー", icon: ClipboardCheck, group: "response", order: 10, href: "/admin/operation-reviews", activeMatch: "prefix", capability: "reviews.view", visibility: "navigation", sidebar: true, adminOnly: true, badge: "operation-reviews" },
  { id: "billing", label: "請求", icon: FileText, group: "response", order: 20, href: "/admin/billing", activeMatch: "prefix", capability: "billing.view", visibility: "navigation", sidebar: true },
  { id: "sales", label: "売上", icon: BarChart3, group: "analysis", order: 10, href: "/admin/sales", activeMatch: "prefix", capability: "analytics.sales.view", visibility: "navigation", sidebar: true },
  { id: "staff-analytics", label: "スタッフ実績", icon: Medal, group: "analysis", order: 20, href: "/admin/staff-analytics", activeMatch: "prefix", capability: "analytics.staff.view", visibility: "navigation", sidebar: true },
  { id: "customers", label: "取引先", icon: Building2, group: "management", order: 10, href: "/admin/customers", activeMatch: "prefix", capability: "customers.view", alternateCapabilities: ["customerPortalUsers.view"], relatedPageIds: ["customer-portal-users"], visibility: "navigation", sidebar: true },
  { id: "customer-portal-users", label: "ポータル利用者", icon: Users, group: "management", order: 11, href: "/admin/customers/users", activeMatch: "prefix", capability: "customerPortalUsers.view", visibility: "internal", sidebar: false },
  { id: "staff", label: "スタッフ", icon: UserRoundCog, group: "management", order: 20, href: "/admin/staff", activeMatch: "prefix", capability: "staff.view", alternateCapabilities: ["staffPermissions.view", "staffCompensation.view"], relatedPageIds: ["staff-permissions", "staff-compensation"], visibility: "navigation", sidebar: true },
  { id: "staff-permissions", label: "権限", icon: Shield, group: "management", order: 21, href: "/admin/permissions", activeMatch: "prefix", capability: "staffPermissions.view", visibility: "confidential", sidebar: false },
  { id: "staff-compensation", label: "報酬・ランク", icon: Wallet, group: "management", order: 22, href: "/admin/money", activeMatch: "prefix", capability: "staffCompensation.view", visibility: "internal", sidebar: false },
  { id: "order-master", label: "発注品目", icon: Package, group: "management", order: 30, href: "/admin/order-master", activeMatch: "prefix", capability: "orderMaster.view", visibility: "navigation", sidebar: true },
  { id: "settings", label: "システム設定", icon: Settings, group: "settings", order: 0, href: "/admin/settings", activeMatch: "prefix", capability: "settings.businessRules.view", visibility: "launcher", sidebar: false },
  { id: "portal-settings", label: "ポータル設定", icon: Settings, group: "settings", order: 10, href: "/admin/settings/portal", activeMatch: "prefix", capability: "settings.businessRules.view", visibility: "internal", sidebar: false },
  { id: "inspection-settings", label: "耐圧検査設定", icon: ShieldCheck, group: "settings", order: 20, href: "/admin/settings/inspection", activeMatch: "prefix", capability: "settings.businessRules.view", visibility: "internal", sidebar: false },
  { id: "notification-settings", label: "通知設定", icon: Bell, group: "settings", order: 30, href: "/admin/notifications", activeMatch: "prefix", capability: "settings.notifications.view", visibility: "internal", sidebar: false },
  { id: "operation-mode", label: "状態遷移モード", icon: Workflow, group: "settings", order: 40, href: "/admin/settings/tank-operations", activeMatch: "prefix", capability: "settings.operationMode.view", visibility: "internal", sidebar: false },
  { id: "state-diagram", label: "状態遷移図", icon: Workflow, group: "developer", order: 10, href: "/admin/state-diagram", activeMatch: "prefix", capability: "developer.stateDiagram.view", visibility: "internal", sidebar: false, developerOnly: true },
  { id: "security-rules", label: "Security Rules", icon: ShieldCheck, group: "developer", order: 20, href: "/admin/security-rules", activeMatch: "prefix", capability: "developer.securityRules.view", visibility: "confidential", sidebar: false, adminOnly: true, developerOnly: true },
];

export const LEGACY_ADMIN_PATH_CAPABILITY_MAP: Readonly<Record<string, readonly AdminCapability[]>> = {
  "/admin": ["dashboard.view"],
  "/admin/operation-reviews": [],
  "/admin/billing": ["billing.view"],
  "/admin/sales": ["analytics.sales.view"],
  "/admin/staff-analytics": ["analytics.staff.view"],
  "/admin/customers": ["customers.view", "customerPortalUsers.view"],
  "/admin/customers/users": ["customerPortalUsers.view"],
  "/admin/staff": ["staff.view"],
  "/admin/permissions": [],
  "/admin/money": ["staffCompensation.view"],
  "/admin/order-master": ["orderMaster.view", "orderMaster.manage"],
  "/admin/settings": ["settings.businessRules.view"],
  "/admin/settings/portal": ["settings.businessRules.view"],
  "/admin/settings/inspection": ["settings.businessRules.view"],
  "/admin/notifications": ["settings.notifications.view"],
  "/admin/settings/tank-operations": [],
  "/admin/state-diagram": [],
  "/admin/security-rules": [],
};

export function matchesAdminPagePath(page: AdminPageDef, pathname: string): boolean {
  if (page.activeMatch === "exact") return pathname === page.href;
  return pathname === page.href || pathname.startsWith(`${page.href}/`);
}

export function findAdminPage(pathname: string): AdminPageDef | null {
  return ADMIN_PAGES
    .filter((page) => matchesAdminPagePath(page, pathname))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

export function getAdminSidebarPages(): AdminPageDef[] {
  return ADMIN_PAGES
    .filter((page) => page.sidebar)
    .sort((a, b) => a.order - b.order);
}

export function getVisibleAdminSidebarPages(
  capabilities: readonly AdminCapability[],
): AdminPageDef[] {
  return getAdminSidebarPages().filter((page) => (
    hasAdminCapability(capabilities, page.capability)
    || page.alternateCapabilities?.some((capability) => (
      hasAdminCapability(capabilities, capability)
    ))
  ));
}

export function getVisibleAdminSidebarGroups(capabilities: readonly AdminCapability[]) {
  const pages = getVisibleAdminSidebarPages(capabilities);
  return [
    { id: "dashboard" as const, label: "", items: pages.filter((page) => page.group === "dashboard") },
    ...ADMIN_NAV_GROUPS.map((group) => ({
      ...group,
      items: pages.filter((page) => page.group === group.id),
    })),
  ].filter((group) => group.items.length > 0);
}

export function getResolvedAdminPageHref(
  page: AdminPageDef,
  capabilities: readonly AdminCapability[],
): string {
  if (hasAdminCapability(capabilities, page.capability)) return page.href;

  const alternateCapability = page.alternateCapabilities?.find((capability) => (
    hasAdminCapability(capabilities, capability)
  ));
  if (!alternateCapability) return page.href;

  return ADMIN_PAGES.find((candidate) => candidate.capability === alternateCapability)?.href
    ?? page.href;
}

export function isAdminSidebarPageActive(page: AdminPageDef, pathname: string): boolean {
  if (matchesAdminPagePath(page, pathname)) return true;
  if (!page.relatedPageIds) return false;
  return page.relatedPageIds.some((pageId) => {
    const relatedPage = ADMIN_PAGES.find((candidate) => candidate.id === pageId);
    return relatedPage ? matchesAdminPagePath(relatedPage, pathname) : false;
  });
}

export function getFirstAccessibleAdminHref(
  capabilities: readonly AdminCapability[],
): string | null {
  return ADMIN_PAGES
    .filter((page) => page.visibility !== "confidential")
    .sort((a, b) => a.order - b.order)
    .find((page) => hasAdminCapability(capabilities, page.capability))?.href ?? null;
}
