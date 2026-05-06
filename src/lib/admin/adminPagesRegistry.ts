export type AdminPageGroup =
  | "確認・分析"
  | "顧客・請求"
  | "スタッフ・権限"
  | "マスタ・料金"
  | "設定"
  | "開発・確認";

export type AdminPageDef = {
  path: string;
  label: string;
  group: AdminPageGroup;
  adminOnly?: boolean;
  devOnly?: boolean;
  hidden?: boolean;
};

export const ADMIN_PAGES: readonly AdminPageDef[] = [
  { path: "/admin", label: "ダッシュボード", group: "確認・分析" },
  { path: "/admin/settings", label: "設定変更", group: "マスタ・料金", hidden: true },
  { path: "/admin/settings/portal", label: "ポータル設定", group: "設定" },
  { path: "/admin/settings/inspection", label: "耐圧検査設定", group: "設定" },
  { path: "/admin/notifications", label: "通知設定", group: "設定" },
  { path: "/admin/sales", label: "売上統計", group: "確認・分析" },
  { path: "/admin/staff-analytics", label: "スタッフ実績", group: "確認・分析" },
  { path: "/admin/money", label: "金銭・ランク", group: "マスタ・料金" },
  { path: "/admin/order-master", label: "発注品目", group: "マスタ・料金" },
  { path: "/admin/billing", label: "請求書発行", group: "顧客・請求" },
  { path: "/admin/customers", label: "顧客管理", group: "顧客・請求" },
  { path: "/admin/customers/users", label: "ポータル利用者", group: "顧客・請求", hidden: true },
  { path: "/admin/staff", label: "担当者", group: "スタッフ・権限" },
  { path: "/admin/permissions", label: "ページ権限", group: "スタッフ・権限", adminOnly: true },
  { path: "/admin/state-diagram", label: "状態遷移図", group: "開発・確認", devOnly: true },
  { path: "/admin/security-rules", label: "Security Rules", group: "開発・確認", adminOnly: true, devOnly: true },
];
