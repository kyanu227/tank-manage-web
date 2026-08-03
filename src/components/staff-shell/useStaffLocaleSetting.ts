"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { updateOwnStaffLocale } from "@/lib/firebase/staff-locale-service";
import type { Locale } from "@/lib/locale";
import {
  getStaffOperationErrorMessage,
  logStaffOperationError,
} from "@/lib/staff-operation-error";
import type { StaffLocaleStatus } from "./staff-shell-types";

const SAVED_MESSAGE_DURATION_MS = 2500;

export interface StaffLocaleSetting {
  readonly status: StaffLocaleStatus;
  readonly errorMessage: string;
  readonly save: (locale: Locale) => void;
}

/**
 * 表示言語の保存。
 *
 * 保存経路は既存の updateOwnStaffLocale ただ1つで、ここでは state だけを持つ。
 * 成功時は service 側が staffSession を更新するため、画面表示は自動的に追随する。
 */
export function useStaffLocaleSetting(currentLocale: Locale): StaffLocaleSetting {
  const [status, setStatus] = useState<StaffLocaleStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const savingRef = useRef(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  const save = useCallback((locale: Locale) => {
    // 二重送信を防ぐ。select 側も disabled になるが、state 側でも閉じる
    if (savingRef.current) return;
    savingRef.current = true;
    setStatus("saving");
    setErrorMessage("");

    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }

    void (async () => {
      try {
        await updateOwnStaffLocale(locale);
        setStatus("saved");
        savedTimerRef.current = setTimeout(() => setStatus("idle"), SAVED_MESSAGE_DURATION_MS);
      } catch (error) {
        logStaffOperationError("updateOwnStaffLocale failed", error);
        setErrorMessage(getStaffOperationErrorMessage(error, currentLocale));
        setStatus("error");
      } finally {
        savingRef.current = false;
      }
    })();
  }, [currentLocale]);

  return { status, errorMessage, save };
}
