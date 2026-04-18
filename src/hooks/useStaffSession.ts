"use client";

import { useEffect, useState } from "react";

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
