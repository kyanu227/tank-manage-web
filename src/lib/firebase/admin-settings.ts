import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export type PortalSettings = {
  autoReturnHour: number;
  autoReturnMinute: number;
};

export type InspectionSettings = {
  validityYears: number;
  alertMonths: number;
};

const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
  autoReturnHour: 17,
  autoReturnMinute: 0,
};

const DEFAULT_INSPECTION_SETTINGS: InspectionSettings = {
  validityYears: 5,
  alertMonths: 6,
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
  if (!snap.exists()) return DEFAULT_INSPECTION_SETTINGS;

  const data = snap.data();
  return {
    validityYears: typeof data.validityYears === "number" && data.validityYears > 0
      ? data.validityYears
      : DEFAULT_INSPECTION_SETTINGS.validityYears,
    alertMonths: typeof data.alertMonths === "number" && data.alertMonths > 0
      ? data.alertMonths
      : DEFAULT_INSPECTION_SETTINGS.alertMonths,
  };
}

export async function saveInspectionSettings({
  validityYears,
  alertMonths,
}: InspectionSettings): Promise<void> {
  await setDoc(doc(db, "settings", "inspection"), {
    validityYears,
    alertMonths,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
