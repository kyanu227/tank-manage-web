"use client";

import { useMemo, useSyncExternalStore } from "react";
import { normalizeLocale, type Locale } from "@/lib/locale";
import type { OperationActor } from "@/lib/operation-context";
import {
  getServerStaffSessionSnapshot,
  getStaffSessionSnapshot,
  staffSessionToOperationActor,
  subscribeStaffSession,
  type StaffSession,
} from "@/lib/staff-session-store";

export {
  getStaffIdentity,
  getStaffLocale,
  getStaffName,
  getStaffSession,
  requireStaffIdentity,
  staffSessionToOperationActor,
  updateStoredStaffSessionLocale,
  type StaffSession,
} from "@/lib/staff-session-store";

/**
 * localStorage からスタッフセッションを読み取るReactフック。
 * SSRおよび初回マウント前は null、マウント後にセッション情報が入る。
 */
export function useStaffSession(): StaffSession | null {
  return useSyncExternalStore(
    subscribeStaffSession,
    getStaffSessionSnapshot,
    getServerStaffSessionSnapshot,
  );
}

export function useStaffIdentity(): OperationActor | null {
  const session = useStaffSession();
  return useMemo(() => staffSessionToOperationActor(session), [session]);
}

export function useStaffLocale(): Locale {
  const session = useStaffSession();
  return useMemo(() => normalizeLocale(session?.locale), [session?.locale]);
}
