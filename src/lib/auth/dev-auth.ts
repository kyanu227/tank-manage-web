import { ADMIN_PAGES } from "@/lib/admin/adminPagesRegistry";

export function isDevAuthBypassEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true";
}

export const DEV_STAFF_SESSION = {
  id: "dev-staff",
  name: "開発スタッフ",
  role: "管理者",
  rank: "dev",
  email: "dev@example.local",
} as const;

export const DEV_ADMIN_ALLOWED_PATHS = ADMIN_PAGES
  .filter((page) => !page.hidden)
  .map((page) => page.path);
