"use client";

import { ArrowDownToLine, ArrowUpFromLine, Droplets } from "lucide-react";
import { ACTION } from "@/lib/tank-rules";
import type {
  ModeConfig,
  OpMode,
  OpStyle,
} from "./types";

export const DEFAULT_OP_STYLE: OpStyle = "manual";

export const MODES: OpMode[] = ["lend", "return", "fill"];

export const MODE_CONFIG: ModeConfig = {
  lend: {
    label: "貸出",
    icon: ArrowUpFromLine,
    color: "#3b82f6",
    bg: "#eff6ff",
    action: ACTION.LEND,
  },
  return: {
    label: "返却",
    icon: ArrowDownToLine,
    color: "#10b981",
    bg: "#ecfdf5",
    action: ACTION.RETURN,
  },
  fill: {
    label: "充填",
    icon: Droplets,
    color: "#f59e0b",
    bg: "#fffbeb",
    action: ACTION.FILL,
  },
};
