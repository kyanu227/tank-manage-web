"use client";

import type { LucideIcon } from "lucide-react";
import type { ReturnTag } from "@/lib/return-tag-rules";
import type { TankAction } from "@/lib/tank-rules";
import type { TankDoc } from "@/lib/tank-types";

export type OpMode = "lend" | "return" | "fill";
export type TagType = ReturnTag;
export type BulkTagType = ReturnTag;
export type BulkReturnDatePool = "today_lent" | "past_lent" | "unknown_lent" | "long_term";
export type OpStyle = "manual" | "order";
export type TimestampLike = { toMillis: () => number };

export interface QueueItem {
  uid: string;
  tankId: string;
  status?: string;
  valid: boolean;
  error?: string;
  tag: TagType;
}

export interface ScannedTank {
  id: string;
  valid: boolean;
  error?: string;
}

export type Condition = ReturnTag;

export interface PendingReturn {
  id: string;
  customerId: string;
  customerName: string;
  tankId: string;
  condition: Condition;
  createdAt?: TimestampLike;
}

export interface ReturnGroup {
  customerId: string;
  customerName: string;
  items: PendingReturn[];
}

export interface BulkTankDoc {
  id: string;
  status: string;
  customerId?: string | null;
  customerName?: string | null;
  location: string;
  staff: string;
  updatedAt: unknown;
  logNote?: string;
}

export interface BulkReturnGroupMeta {
  key: string;
  location: string;
  customerId?: string;
  isLegacyCustomerIdentity?: boolean;
  pool: BulkReturnDatePool;
  poolLabel: string;
  dateLabel: string;
  sortMillis: number | null;
}

export interface ModeConfigItem {
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  action: TankAction;
}

export type ModeConfig = Record<OpMode, ModeConfigItem>;
export type TankMap = Record<string, TankDoc>;
export type ReturnConfirmationSelectionMap = Record<string, { selected: boolean; condition: Condition }>;
