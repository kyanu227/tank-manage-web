import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "./config";

export const STAFF_BY_EMAIL_COLLECTION = "staffByEmail";

export interface StaffAuthProfile {
  staffId: string;
  name: string;
  email: string;
  role: string;
  rank: string;
  isActive: boolean;
}

export function staffEmailKey(email: string): string {
  return email.trim();
}

export function buildStaffAuthProfile(staffId: string, data: DocumentData): StaffAuthProfile {
  return {
    staffId,
    name: String(data.name || "スタッフ"),
    email: String(data.email || ""),
    role: String(data.role || "一般"),
    rank: String(data.rank || "レギュラー"),
    isActive: data.isActive === true,
  };
}

export function setStaffAuthMirrorInBatch(
  batch: WriteBatch,
  staffId: string,
  data: DocumentData
) {
  const email = staffEmailKey(String(data.email || ""));
  if (!email) return;

  const profile = buildStaffAuthProfile(staffId, { ...data, email });
  batch.set(doc(db, STAFF_BY_EMAIL_COLLECTION, email), {
    ...profile,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export function deleteStaffAuthMirrorInBatch(batch: WriteBatch, email: string) {
  const key = staffEmailKey(email);
  if (!key) return;
  batch.delete(doc(db, STAFF_BY_EMAIL_COLLECTION, key));
}

export async function findActiveStaffByEmail(email: string): Promise<StaffAuthProfile | null> {
  const key = staffEmailKey(email);
  if (!key) return null;

  try {
    const mirrorSnap = await getDoc(doc(db, STAFF_BY_EMAIL_COLLECTION, key));
    if (mirrorSnap.exists()) {
      const profile = buildStaffAuthProfile(
        String(mirrorSnap.data().staffId || ""),
        mirrorSnap.data()
      );
      return profile.staffId && profile.isActive ? profile : null;
    }
  } catch (e) {
    console.warn("Staff auth mirror lookup failed, falling back to staff query:", e);
  }

  const staffSnap = await getDocs(query(
    collection(db, "staff"),
    where("email", "==", key),
    where("isActive", "==", true)
  ));
  if (staffSnap.empty) return null;

  const staffDoc = staffSnap.docs[0];
  const profile = buildStaffAuthProfile(staffDoc.id, staffDoc.data());
  try {
    await setDoc(doc(db, STAFF_BY_EMAIL_COLLECTION, key), {
      ...profile,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.warn("Staff auth mirror write failed:", e);
  }
  return profile;
}
