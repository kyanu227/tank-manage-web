import {
  type TankActionCode,
  type TankStatusCode,
  tankActionCodeToLegacyAction,
  tankActionToCode,
  tankStatusCodeToLegacyStatus,
  tankStatusToCode,
} from "./tank-action-status-codes";
import { DEFAULT_LOCALE, type Locale } from "./locale";

export const TANK_ACTION_LABELS = {
  lend: {
    ja: tankActionCodeToLegacyAction("lend"),
    en: "Lend",
  },
  order_lend: {
    ja: tankActionCodeToLegacyAction("order_lend"),
    en: "Order lend",
  },
  return: {
    ja: tankActionCodeToLegacyAction("return"),
    en: "Return",
  },
  return_unused: {
    ja: tankActionCodeToLegacyAction("return_unused"),
    en: "Return unused",
  },
  return_uncharged: {
    ja: tankActionCodeToLegacyAction("return_uncharged"),
    en: "Return uncharged",
  },
  carry_over: {
    ja: tankActionCodeToLegacyAction("carry_over"),
    en: "Carry over",
  },
  fill: {
    ja: tankActionCodeToLegacyAction("fill"),
    en: "Fill",
  },
  inhouse_use: {
    ja: tankActionCodeToLegacyAction("inhouse_use"),
    en: "In-house use",
  },
  inhouse_use_retro: {
    ja: tankActionCodeToLegacyAction("inhouse_use_retro"),
    en: "In-house use (retroactive)",
  },
  inhouse_return: {
    ja: tankActionCodeToLegacyAction("inhouse_return"),
    en: "In-house return",
  },
  inhouse_return_unused: {
    ja: tankActionCodeToLegacyAction("inhouse_return_unused"),
    en: "In-house return unused",
  },
  inhouse_return_uncharged: {
    ja: tankActionCodeToLegacyAction("inhouse_return_uncharged"),
    en: "In-house return uncharged",
  },
  damage_report: {
    ja: tankActionCodeToLegacyAction("damage_report"),
    en: "Damage report",
  },
  repaired: {
    ja: tankActionCodeToLegacyAction("repaired"),
    en: "Repaired",
  },
  inspection: {
    ja: tankActionCodeToLegacyAction("inspection"),
    en: "Inspection",
  },
  dispose: {
    ja: tankActionCodeToLegacyAction("dispose"),
    en: "Dispose",
  },
  procurement_purchase: {
    ja: tankActionCodeToLegacyAction("procurement_purchase"),
    en: "Tank purchase",
  },
  procurement_register: {
    ja: tankActionCodeToLegacyAction("procurement_register"),
    en: "Tank registration",
  },
  supply_order: {
    ja: tankActionCodeToLegacyAction("supply_order"),
    en: "Supply order",
  },
} satisfies Record<TankActionCode, Record<Locale, string>>;

export const TANK_STATUS_LABELS = {
  filled: {
    ja: tankStatusCodeToLegacyStatus("filled"),
    en: "Filled",
  },
  empty: {
    ja: tankStatusCodeToLegacyStatus("empty"),
    en: "Empty",
  },
  lent: {
    ja: tankStatusCodeToLegacyStatus("lent"),
    en: "Lent",
  },
  unreturned: {
    ja: tankStatusCodeToLegacyStatus("unreturned"),
    en: "Unreturned",
  },
  in_house: {
    ja: tankStatusCodeToLegacyStatus("in_house"),
    en: "In-house",
  },
  damaged: {
    ja: tankStatusCodeToLegacyStatus("damaged"),
    en: "Damaged",
  },
  defective: {
    ja: tankStatusCodeToLegacyStatus("defective"),
    en: "Defective",
  },
  disposed: {
    ja: tankStatusCodeToLegacyStatus("disposed"),
    en: "Disposed",
  },
} satisfies Record<TankStatusCode, Record<Locale, string>>;

export function getTankActionLabel(
  code: TankActionCode,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return TANK_ACTION_LABELS[code][locale];
}

export function getTankStatusLabel(
  code: TankStatusCode,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return TANK_STATUS_LABELS[code][locale];
}

export function getLegacyTankActionLabel(
  action: string | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const code = tankActionToCode(action);
  return code ? getTankActionLabel(code, locale) : null;
}

export function getLegacyTankStatusLabel(
  status: string | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const code = tankStatusToCode(status);
  return code ? getTankStatusLabel(code, locale) : null;
}
