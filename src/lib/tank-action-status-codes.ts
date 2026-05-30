import { ACTION, STATUS, type TankAction, type TankStatus } from "./tank-rules";

export type TankActionCode =
  | "lend"
  | "order_lend"
  | "return"
  | "return_unused"
  | "return_uncharged"
  | "carry_over"
  | "fill"
  | "inhouse_use"
  | "inhouse_use_retro"
  | "inhouse_return"
  | "inhouse_return_unused"
  | "inhouse_return_uncharged"
  | "damage_report"
  | "repaired"
  | "inspection"
  | "dispose"
  | "procurement_purchase"
  | "procurement_register"
  | "supply_order";

export type TankStatusCode =
  | "filled"
  | "empty"
  | "lent"
  | "unreturned"
  | "in_house"
  | "damaged"
  | "defective"
  | "disposed";

export type LegacyTankAction =
  | TankAction
  | "受注貸出"
  | "タンク購入"
  | "タンク登録"
  | "資材発注";

export type LegacyTankStatus = TankStatus;

export const TANK_ACTION_CODE_TO_LEGACY_ACTION = {
  lend: ACTION.LEND,
  order_lend: "受注貸出",
  return: ACTION.RETURN,
  return_unused: ACTION.RETURN_UNUSED,
  return_uncharged: ACTION.RETURN_UNCHARGED,
  carry_over: ACTION.CARRY_OVER,
  fill: ACTION.FILL,
  inhouse_use: ACTION.IN_HOUSE_USE,
  inhouse_use_retro: ACTION.IN_HOUSE_USE_RETRO,
  inhouse_return: ACTION.IN_HOUSE_RETURN,
  inhouse_return_unused: ACTION.IN_HOUSE_RETURN_UNUSED,
  inhouse_return_uncharged: ACTION.IN_HOUSE_RETURN_UNCHARGED,
  damage_report: ACTION.DAMAGE_REPORT,
  repaired: ACTION.REPAIRED,
  inspection: ACTION.INSPECTION,
  dispose: ACTION.DISPOSE,
  procurement_purchase: "タンク購入",
  procurement_register: "タンク登録",
  supply_order: "資材発注",
} as const satisfies Record<TankActionCode, LegacyTankAction>;

export const TANK_STATUS_CODE_TO_LEGACY_STATUS = {
  filled: STATUS.FILLED,
  empty: STATUS.EMPTY,
  lent: STATUS.LENT,
  unreturned: STATUS.UNRETURNED,
  in_house: STATUS.IN_HOUSE,
  damaged: STATUS.DAMAGED,
  defective: STATUS.DEFECTIVE,
  disposed: STATUS.DISPOSED,
} as const satisfies Record<TankStatusCode, LegacyTankStatus>;

export const LEGACY_ACTION_TO_TANK_ACTION_CODE = {
  [ACTION.LEND]: "lend",
  "受注貸出": "order_lend",
  [ACTION.RETURN]: "return",
  [ACTION.RETURN_UNUSED]: "return_unused",
  [ACTION.RETURN_UNCHARGED]: "return_uncharged",
  [ACTION.CARRY_OVER]: "carry_over",
  [ACTION.FILL]: "fill",
  [ACTION.IN_HOUSE_USE]: "inhouse_use",
  [ACTION.IN_HOUSE_USE_RETRO]: "inhouse_use_retro",
  [ACTION.IN_HOUSE_RETURN]: "inhouse_return",
  [ACTION.IN_HOUSE_RETURN_UNUSED]: "inhouse_return_unused",
  [ACTION.IN_HOUSE_RETURN_UNCHARGED]: "inhouse_return_uncharged",
  [ACTION.DAMAGE_REPORT]: "damage_report",
  [ACTION.REPAIRED]: "repaired",
  [ACTION.INSPECTION]: "inspection",
  [ACTION.DISPOSE]: "dispose",
  "タンク購入": "procurement_purchase",
  "タンク登録": "procurement_register",
  "資材発注": "supply_order",
} as const satisfies Record<LegacyTankAction, TankActionCode>;

export const LEGACY_STATUS_TO_TANK_STATUS_CODE = {
  [STATUS.FILLED]: "filled",
  [STATUS.EMPTY]: "empty",
  [STATUS.LENT]: "lent",
  [STATUS.UNRETURNED]: "unreturned",
  [STATUS.IN_HOUSE]: "in_house",
  [STATUS.DAMAGED]: "damaged",
  [STATUS.DEFECTIVE]: "defective",
  [STATUS.DISPOSED]: "disposed",
} as const satisfies Record<LegacyTankStatus, TankStatusCode>;

const LEND_ACTION_CODES: readonly TankActionCode[] = ["lend", "order_lend"];
const RETURN_ACTION_CODES: readonly TankActionCode[] = [
  "return",
  "return_unused",
  "return_uncharged",
  "inhouse_return",
  "inhouse_return_unused",
  "inhouse_return_uncharged",
];
const FILL_ACTION_CODES: readonly TankActionCode[] = ["fill"];
const IN_HOUSE_ACTION_CODES: readonly TankActionCode[] = [
  "inhouse_use",
  "inhouse_use_retro",
  "inhouse_return",
  "inhouse_return_unused",
  "inhouse_return_uncharged",
];
const PROCUREMENT_ACTION_CODES: readonly TankActionCode[] = [
  "procurement_purchase",
  "procurement_register",
];

export function tankActionToCode(action: string | null | undefined): TankActionCode | null {
  const normalized = normalizeLegacyValue(action);
  if (!normalized) return null;
  return LEGACY_ACTION_TO_TANK_ACTION_CODE[normalized as LegacyTankAction] ?? null;
}

export function tankActionCodeToLegacyAction(code: TankActionCode): LegacyTankAction {
  return TANK_ACTION_CODE_TO_LEGACY_ACTION[code];
}

export function tankActionCodeToJapaneseLabel(code: TankActionCode): LegacyTankAction {
  return tankActionCodeToLegacyAction(code);
}

export function tankStatusToCode(status: string | null | undefined): TankStatusCode | null {
  const normalized = normalizeLegacyValue(status);
  if (!normalized) return null;
  return LEGACY_STATUS_TO_TANK_STATUS_CODE[normalized as LegacyTankStatus] ?? null;
}

export function tankStatusCodeToLegacyStatus(code: TankStatusCode): LegacyTankStatus {
  return TANK_STATUS_CODE_TO_LEGACY_STATUS[code];
}

export function tankStatusCodeToJapaneseLabel(code: TankStatusCode): LegacyTankStatus {
  return tankStatusCodeToLegacyStatus(code);
}

export function isLendActionCode(code: TankActionCode | null | undefined): boolean {
  return isActionCodeIn(code, LEND_ACTION_CODES);
}

export function isReturnActionCode(code: TankActionCode | null | undefined): boolean {
  return isActionCodeIn(code, RETURN_ACTION_CODES);
}

export function isCarryOverActionCode(code: TankActionCode | null | undefined): boolean {
  return code === "carry_over";
}

export function isFillActionCode(code: TankActionCode | null | undefined): boolean {
  return isActionCodeIn(code, FILL_ACTION_CODES);
}

export function isInHouseActionCode(code: TankActionCode | null | undefined): boolean {
  return isActionCodeIn(code, IN_HOUSE_ACTION_CODES);
}

export function isProcurementActionCode(code: TankActionCode | null | undefined): boolean {
  return isActionCodeIn(code, PROCUREMENT_ACTION_CODES);
}

export function isSupplyOrderActionCode(code: TankActionCode | null | undefined): boolean {
  return code === "supply_order";
}

export function isLendLegacyAction(action: string | null | undefined): boolean {
  return isLendActionCode(tankActionToCode(action));
}

export function isReturnLegacyAction(action: string | null | undefined): boolean {
  return isReturnActionCode(tankActionToCode(action));
}

export function isCarryOverLegacyAction(action: string | null | undefined): boolean {
  return isCarryOverActionCode(tankActionToCode(action));
}

export function isFillLegacyAction(action: string | null | undefined): boolean {
  return isFillActionCode(tankActionToCode(action));
}

export function isInHouseLegacyAction(action: string | null | undefined): boolean {
  return isInHouseActionCode(tankActionToCode(action));
}

export function isProcurementLegacyAction(action: string | null | undefined): boolean {
  return isProcurementActionCode(tankActionToCode(action));
}

export function isSupplyOrderLegacyAction(action: string | null | undefined): boolean {
  return isSupplyOrderActionCode(tankActionToCode(action));
}

export function isActiveRentalStatusCode(code: TankStatusCode | null | undefined): boolean {
  return code === "lent" || code === "unreturned";
}

export function isLentStatusCode(code: TankStatusCode | null | undefined): boolean {
  return code === "lent";
}

export function isUnreturnedStatusCode(code: TankStatusCode | null | undefined): boolean {
  return code === "unreturned";
}

export function isInHouseStatusCode(code: TankStatusCode | null | undefined): boolean {
  return code === "in_house";
}

export function isDisposedStatusCode(code: TankStatusCode | null | undefined): boolean {
  return code === "disposed";
}

export function isActiveRentalLegacyStatus(status: string | null | undefined): boolean {
  return isActiveRentalStatusCode(tankStatusToCode(status));
}

export function isLentLegacyStatus(status: string | null | undefined): boolean {
  return isLentStatusCode(tankStatusToCode(status));
}

export function isUnreturnedLegacyStatus(status: string | null | undefined): boolean {
  return isUnreturnedStatusCode(tankStatusToCode(status));
}

export function isInHouseLegacyStatus(status: string | null | undefined): boolean {
  return isInHouseStatusCode(tankStatusToCode(status));
}

export function isDisposedLegacyStatus(status: string | null | undefined): boolean {
  return isDisposedStatusCode(tankStatusToCode(status));
}

function normalizeLegacyValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isActionCodeIn(
  code: TankActionCode | null | undefined,
  values: readonly TankActionCode[],
): boolean {
  return code != null && values.includes(code);
}
