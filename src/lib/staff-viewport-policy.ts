/**
 * staff 画面の viewport policy（単一正本）。
 *
 * route ごとに scroll lock / 100dvh / overflow / bottom padding を個別判断しない。
 * 宣言はこの 1 値だけで、shell が全てをここから導出する。
 * 詳細は docs/design/staff-top-menu-and-viewport-policy.md §5。
 *
 *   locked  … 画面内で完結させる。shell が下端 safe-area を所有する
 *   allowed … 通常の document scroll。shell は下端を予約しない（既定）
 */
export type StaffViewportMode = "allowed" | "locked";

export const DEFAULT_STAFF_VIEWPORT_MODE: StaffViewportMode = "allowed";

/**
 * ID 入力端末系の画面だけが locked を要求する。
 * DrumRoll / TankIdInput と画面内固定の送信バーが、Safari のバーや
 * ホームインジケーターの下へ隠れないようにするため。
 */
export const STAFF_LOCKED_VIEWPORT_PATHS: readonly string[] = [
  "/staff/lend",
  "/staff/return",
  "/staff/fill",
  "/staff/inhouse",
  "/staff/damage",
  "/staff/repair",
  "/staff/inspection",
];

export function resolveStaffViewportMode(
  pathname: string | null | undefined,
): StaffViewportMode {
  if (!pathname) return DEFAULT_STAFF_VIEWPORT_MODE;
  return STAFF_LOCKED_VIEWPORT_PATHS.includes(pathname)
    ? "locked"
    : DEFAULT_STAFF_VIEWPORT_MODE;
}
