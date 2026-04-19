"use client";

import { ArrowDownToLine, ArrowUpFromLine, Droplets } from "lucide-react";
import { ACTION } from "@/lib/tank-rules";
import type {
  BulkTagConfig,
  ConditionLabel,
  ModeConfig,
  OpMode,
  OpStyle,
} from "./types";

export const DEFAULT_OP_STYLE: OpStyle = "manual";

export const MODES: OpMode[] = ["lend", "return", "fill"];

export const CONDITION_LABELS: ConditionLabel[] = [
  { val: "normal", label: "通常", color: "#64748b" },
  { val: "unused", label: "未使用", color: "#10b981" },
  { val: "uncharged", label: "未充填", color: "#ef4444" },
];

export const BULK_TAGS: BulkTagConfig[] = [
  { id: "normal", label: "通常", color: "#64748b", bg: "#f1f5f9", borderColor: "#e2e8f0" },
  { id: "unused", label: "未使用", color: "#10b981", bg: "#ecfdf5", borderColor: "#6ee7b7" },
  { id: "defect", label: "未充填", color: "#ef4444", bg: "#fef2f2", borderColor: "#fca5a5" },
];

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
