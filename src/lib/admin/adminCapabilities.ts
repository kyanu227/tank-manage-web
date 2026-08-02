export const ADMIN_CAPABILITY_DEFINITIONS = [
  { key: "dashboard.view", label: "ダッシュボードを表示", group: "確認", assignableToSubAdmin: true },
  { key: "reviews.view", label: "例外操作レビューを表示", group: "対応", assignableToSubAdmin: false },
  { key: "reviews.approve", label: "例外操作レビューを承認", group: "対応", assignableToSubAdmin: false },
  { key: "billing.view", label: "請求を表示", group: "対応", assignableToSubAdmin: true },
  { key: "billing.manage", label: "請求を管理", group: "対応", assignableToSubAdmin: false },
  { key: "analytics.sales.view", label: "売上を表示", group: "分析", assignableToSubAdmin: true },
  { key: "analytics.staff.view", label: "スタッフ実績を表示", group: "分析", assignableToSubAdmin: true },
  { key: "customers.view", label: "顧客を表示", group: "取引先", assignableToSubAdmin: true },
  { key: "customers.manage", label: "顧客を管理", group: "取引先", assignableToSubAdmin: false },
  { key: "customerPortalUsers.view", label: "ポータル利用者を表示", group: "取引先", assignableToSubAdmin: true },
  { key: "customerPortalUsers.manage", label: "ポータル利用者を管理", group: "取引先", assignableToSubAdmin: false },
  { key: "staff.view", label: "担当者を表示", group: "スタッフ", assignableToSubAdmin: true },
  { key: "staff.manage", label: "担当者を管理", group: "スタッフ", assignableToSubAdmin: false },
  { key: "staffPermissions.view", label: "権限設定を表示", group: "スタッフ", assignableToSubAdmin: true, confidential: true },
  { key: "staffPermissions.manage", label: "権限設定を管理", group: "スタッフ", assignableToSubAdmin: false, confidential: true },
  { key: "staffCompensation.view", label: "報酬・ランクを表示", group: "スタッフ", assignableToSubAdmin: true },
  { key: "staffCompensation.manage", label: "報酬・ランクを管理", group: "スタッフ", assignableToSubAdmin: false },
  { key: "orderMaster.view", label: "発注品目を表示", group: "マスタ", assignableToSubAdmin: true },
  { key: "orderMaster.manage", label: "発注品目を管理", group: "マスタ", assignableToSubAdmin: true },
  { key: "settings.businessRules.view", label: "業務ルールを表示", group: "設定", assignableToSubAdmin: true },
  { key: "settings.businessRules.manage", label: "業務ルールを管理", group: "設定", assignableToSubAdmin: false },
  { key: "settings.notifications.view", label: "通知設定を表示", group: "設定", assignableToSubAdmin: true },
  { key: "settings.notifications.manage", label: "通知設定を管理", group: "設定", assignableToSubAdmin: false },
  { key: "settings.operationMode.view", label: "運用制御を表示", group: "設定", assignableToSubAdmin: true },
  { key: "settings.operationMode.manage", label: "運用制御を管理", group: "設定", assignableToSubAdmin: false },
  { key: "developer.stateDiagram.view", label: "状態遷移図を表示", group: "開発者ツール", assignableToSubAdmin: true },
  { key: "developer.securityRules.view", label: "Security Rulesを表示", group: "開発者ツール", assignableToSubAdmin: false, confidential: true },
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITY_DEFINITIONS)[number]["key"];

export type AdminCapabilityDefinition = (typeof ADMIN_CAPABILITY_DEFINITIONS)[number];

export const ALL_ADMIN_CAPABILITIES: readonly AdminCapability[] =
  ADMIN_CAPABILITY_DEFINITIONS.map((definition) => definition.key);

const ADMIN_CAPABILITY_SET = new Set<string>(ALL_ADMIN_CAPABILITIES);

export function isAdminCapability(value: string): value is AdminCapability {
  return ADMIN_CAPABILITY_SET.has(value);
}

export function hasAdminCapability(
  capabilities: readonly AdminCapability[],
  capability: AdminCapability,
): boolean {
  return capabilities.includes(capability);
}

export function getAdminCapabilitiesForRole(
  role: string,
  grants: Readonly<Partial<Record<AdminCapability, readonly string[]>>>,
): AdminCapability[] {
  if (role === "管理者") return [...ALL_ADMIN_CAPABILITIES];
  if (role !== "準管理者") return [];

  return ALL_ADMIN_CAPABILITIES.filter((capability) => (
    grants[capability]?.some((candidate) => candidate === "準管理者") === true
  ));
}
