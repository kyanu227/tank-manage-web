"use client";

import type { LucideIcon } from "lucide-react";
import type { TankAction } from "@/lib/tank-rules";
import type { TankDoc } from "@/lib/tank-types";

export type OpMode = "lend" | "return" | "fill";
export type TagType = "normal" | "unused" | "uncharged";
export type BulkTagType = "normal" | "unused" | "uncharged";
export type OpStyle = "manual" | "order";

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

export type Condition = "normal" | "unused" | "uncharged" | "keep";

export interface PendingReturn {
  id: string;
  customerId: string;
  customerName: string;
  tankId: string;
  condition: Condition;
  createdAt: any;
}

export interface ReturnGroup {
  customerId: string;
  customerName: string;
  items: PendingReturn[];
}

export interface BulkTankDoc {
  id: string;
  status: string;
  location: string;
  staff: string;
  updatedAt: any;
  logNote?: string;
}

export interface ConditionLabel {
  val: Condition;
  label: string;
  color: string;
}

export interface BulkTagConfig {
  id: BulkTagType;
  label: string;
  color: string;
  bg: string;
  borderColor: string;
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
export type ApprovalMap = Record<string, { approved: boolean; condition: Condition }>;
