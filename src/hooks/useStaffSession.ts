"use client";

import { useEffect, useMemo, useState } from "react";
import type { OperationActor } from "@/lib/operation-context";

/**
 * localStorage "staffSession" に保存されているスタッフセッション情報。
 * StaffAuthGuard でログイン成功時に保存される。
 */
export interface StaffSession {
  id?: string;
  name: string;
  email?: string;
  role?: string;
  rank?: string;
  [key: string]: any;
}

const STORAGE_KEY = "staffSession";
const FALLBACK_NAME = "スタッフ";

/**
 * localStorage からスタッフセッションを読み取るReactフック。
 * SSRおよび初回マウント前は null、マウント後にセッション情報が入る。
 */
export function useStaffSession(): StaffSession | null {
  const [session, setSession] = useState<StaffSession | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSession(JSON.parse(raw) as StaffSession);
    } catch {
      setSession(null);
    }
  }, []);

  return session;
}

export function staffSessionToOperationActor(
  session: StaffSession | null | undefined
): OperationActor | null {
  const staffId = nonEmptyString(session?.id);
  const staffName = nonEmptyString(session?.name);
  if (!staffId || !staffName) return null;

  const staffEmail = nonEmptyString(session?.email);
  const role = nonEmptyString(session?.role);
  const rank = nonEmptyString(session?.rank);

  return {
    staffId,
    staffName,
    ...(staffEmail ? { staffEmail } : {}),
    ...(role ? { role } : {}),
    ...(rank ? { rank } : {}),
  };
}

export function useStaffIdentity(): OperationActor | null {
  const session = useStaffSession();
  return useMemo(() => staffSessionToOperationActor(session), [session]);
}

export function getStaffIdentity(): OperationActor | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return staffSessionToOperationActor(JSON.parse(raw) as StaffSession);
  } catch {
    return null;
  }
}

export function requireStaffIdentity(): OperationActor {
  const identity = getStaffIdentity();
  if (!identity) {
    throw new Error("スタッフIDを取得できませんでした。再ログインしてください。");
  }
  return identity;
}

/**
 * スタッフ名を同期的に取得する。
 * 送信処理（onClick/onSubmit）内で「今の操作者名」をログに残したい用途向け。
 * セッション未取得/破損時はフォールバック名 "スタッフ" を返す。
 */
export function getStaffName(): string {
  if (typeof window === "undefined") return FALLBACK_NAME;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return FALLBACK_NAME;
    const session = JSON.parse(raw) as StaffSession;
    return session.name || FALLBACK_NAME;
  } catch {
    return FALLBACK_NAME;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
