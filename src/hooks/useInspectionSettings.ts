"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

/**
 * 耐圧検査の設定値。
 * - validityYears: 検査有効期間（年）。完了時の次回期限 = 今日 + N年
 * - alertMonths:   告知開始（ヶ月）。次回期限が今日 + Nヶ月 以内で対象化
 */
export interface InspectionSettings {
  validityYears: number;
  alertMonths: number;
}

export const DEFAULT_INSPECTION_SETTINGS: InspectionSettings = {
  validityYears: 5,
  alertMonths: 6,
};

/**
 * settings/inspection ドキュメントから閾値を読み取るフック。
 * 未設定時はデフォルト値を返す。
 */
export function useInspectionSettings() {
  const [settings, setSettings] = useState<InspectionSettings>(DEFAULT_INSPECTION_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "inspection"));
        if (snap.exists()) {
          const d = snap.data();
          setSettings({
            validityYears: typeof d.validityYears === "number" && d.validityYears > 0
              ? d.validityYears
              : DEFAULT_INSPECTION_SETTINGS.validityYears,
            alertMonths: typeof d.alertMonths === "number" && d.alertMonths > 0
              ? d.alertMonths
              : DEFAULT_INSPECTION_SETTINGS.alertMonths,
          });
        }
      } catch (e) {
        console.error("useInspectionSettings failed", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { settings, loading };
}
