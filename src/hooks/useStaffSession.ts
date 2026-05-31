"use client";

import { useMemo, useSyncExternalStore } from "react";
import { normalizeLocale, type Locale } from "@/lib/locale";
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
  locale: Locale;
}

const STORAGE_KEY = "staffSession";
const FALLBACK_NAME = "スタッフ";
let cachedRawSession: string | null | undefined;
let cachedSession: StaffSession | null = null;

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

export function useStaffLocale(): Locale {
  const session = useStaffSession();
  return useMemo(() => normalizeLocale(session?.locale), [session?.locale]);
}

export function getStaffIdentity(): OperationActor | null {
  return staffSessionToOperationActor(getStaffSessionSnapshot());
}

export function getStaffLocale(): Locale {
  return normalizeLocale(getStaffSessionSnapshot()?.locale);
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
  return getStaffSessionSnapshot()?.name ?? FALLBACK_NAME;
}

function subscribeStaffSession(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handleChange = () => {
    cachedRawSession = undefined;
    onStoreChange();
  };

  window.addEventListener("staffLogin", handleChange);
  window.addEventListener("storage", handleChange);
  return () => {
    window.removeEventListener("staffLogin", handleChange);
    window.removeEventListener("storage", handleChange);
  };
}

function getServerStaffSessionSnapshot(): StaffSession | null {
  return null;
}

function getStaffSessionSnapshot(): StaffSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRawSession) return cachedSession;
  cachedRawSession = raw;
  cachedSession = parseStaffSession(raw);
  return cachedSession;
}

function parseStaffSession(raw: string | null): StaffSession | null {
  if (!raw) return null;
  try {
    return normalizeStaffSession(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function normalizeStaffSession(value: unknown): StaffSession | null {
  const record = objectRecord(value);
  if (!record) return null;

  const name = nonEmptyString(record.name);
  if (!name) return null;

  const id = nonEmptyString(record.id);
  const email = nonEmptyString(record.email);
  const role = nonEmptyString(record.role);
  const rank = nonEmptyString(record.rank);

  return {
    name,
    ...(id ? { id } : {}),
    ...(email ? { email } : {}),
    ...(role ? { role } : {}),
    ...(rank ? { rank } : {}),
    locale: normalizeLocale(record.locale),
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
