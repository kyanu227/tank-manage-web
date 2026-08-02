import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  assertValidInspectionSettings,
  DEFAULT_INSPECTION_SETTINGS,
  normalizeInspectionSettings,
  type InspectionSettings,
} from "@/lib/inspection-settings";

export type { InspectionSettings } from "@/lib/inspection-settings";

export type PortalSettings = {
  autoReturnHour: number;
  autoReturnMinute: number;
};

export type PortalAutoReturnSchedule = {
  autoReturnHour: number;
  autoReturnMinute: number;
};

const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
  autoReturnHour: 17,
  autoReturnMinute: 0,
};

export async function getPortalSettings(): Promise<PortalSettings> {
  const snap = await getDoc(doc(db, "settings", "portal"));
  if (!snap.exists()) return DEFAULT_PORTAL_SETTINGS;

  const data = snap.data();
  return {
    autoReturnHour: typeof data.autoReturnHour === "number"
      ? data.autoReturnHour
      : DEFAULT_PORTAL_SETTINGS.autoReturnHour,
    autoReturnMinute: typeof data.autoReturnMinute === "number"
      ? data.autoReturnMinute
      : DEFAULT_PORTAL_SETTINGS.autoReturnMinute,
  };
}

export async function getPortalAutoReturnSchedule(): Promise<PortalAutoReturnSchedule | null> {
  const snap = await getDoc(doc(db, "settings", "portal"));
  if (!snap.exists()) return null;

  const data = snap.data();
  if (data.autoReturnHour == null || data.autoReturnMinute == null) {
    return null;
  }

  return {
    autoReturnHour: Number(data.autoReturnHour),
    autoReturnMinute: Number(data.autoReturnMinute),
  };
}

export async function savePortalSettings({
  autoReturnHour,
  autoReturnMinute,
}: PortalSettings): Promise<void> {
  await setDoc(doc(db, "settings", "portal"), {
    autoReturnHour,
    autoReturnMinute,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function getInspectionSettings(): Promise<InspectionSettings> {
  const snap = await getDoc(doc(db, "settings", "inspection"));
  if (!snap.exists()) return { ...DEFAULT_INSPECTION_SETTINGS };
  return normalizeInspectionSettings(snap.data());
}

export async function saveInspectionSettings({
  validityYears,
  alertMonths,
}: InspectionSettings): Promise<void> {
  assertValidInspectionSettings({ validityYears, alertMonths });
  await setDoc(doc(db, "settings", "inspection"), {
    validityYears,
    alertMonths,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
