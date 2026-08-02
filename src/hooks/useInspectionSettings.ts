"use client";

import { useEffect, useState } from "react";
import { getInspectionSettings } from "@/lib/firebase/admin-settings";
import {
  DEFAULT_INSPECTION_SETTINGS,
  type InspectionSettings,
} from "@/lib/inspection-settings";

export { DEFAULT_INSPECTION_SETTINGS } from "@/lib/inspection-settings";
export type { InspectionSettings } from "@/lib/inspection-settings";

/**
 * 耐圧検査の設定値。
 * - validityYears: 検査有効期間（年）。完了時の次回期限 = 今日 + N年
 * - alertMonths:   告知開始（ヶ月）。次回期限が今日 + Nヶ月 以内で対象化
 */
/**
 * settings/inspection ドキュメントから閾値を読み取るフック。
 * 未設定時はデフォルト値を返す。
 */
export function useInspectionSettings() {
  const [settings, setSettings] = useState<InspectionSettings>(DEFAULT_INSPECTION_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const nextSettings = await getInspectionSettings();
        if (active) setSettings(nextSettings);
      } catch (e) {
        console.error("useInspectionSettings failed", e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  return { settings, loading };
}
