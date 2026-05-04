import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
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
  return email.trim().toLowerCase();
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

/**
 * staff/{staffId} を直接読む表示用途の read-only helper。
 * mirror 同期などの Firestore write は行わない。
 */
export async function getStaffProfileByIdReadOnly(staffId: string): Promise<StaffAuthProfile | null> {
  const id = staffId.trim();
  if (!id) return null;

  const snap = await getDoc(doc(db, "staff", id));
  if (!snap.exists()) return null;

  return buildStaffAuthProfile(id, snap.data());
}

/**
 * email から staff profile を読む表示用途の read-only helper。
 * staffByEmail mirror を優先し、見つからなければ staff を query する。
 * fallback 経路でも mirror は更新しない。
 */
export async function findStaffProfileByEmailReadOnly(email: string): Promise<StaffAuthProfile | null> {
  const key = staffEmailKey(email);
  const trimmedEmail = email.trim();
  if (!key) return null;

  const mirrorSnap = await getDoc(doc(db, STAFF_BY_EMAIL_COLLECTION, key));
  if (mirrorSnap.exists()) {
    const profile = buildStaffAuthProfile(
      String(mirrorSnap.data().staffId || ""),
      mirrorSnap.data()
    );
    if (profile.staffId) return profile;
  }

  const emailCandidates = Array.from(new Set([key, trimmedEmail].filter(Boolean)));
  for (const candidate of emailCandidates) {
    const staffSnap = await getDocs(query(
      collection(db, "staff"),
      where("email", "==", candidate)
    ));
    if (!staffSnap.empty) {
      const staffDoc = staffSnap.docs[0];
      return buildStaffAuthProfile(staffDoc.id, staffDoc.data());
    }
  }

  return null;
}

export async function findActiveStaffByEmail(email: string): Promise<StaffAuthProfile | null> {
  const key = staffEmailKey(email);
  const trimmedEmail = email.trim();
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

  const emailCandidates = Array.from(new Set([key, trimmedEmail].filter(Boolean)));
  let staffDoc = null;

  for (const candidate of emailCandidates) {
    const staffSnap = await getDocs(query(
      collection(db, "staff"),
      where("email", "==", candidate),
      where("isActive", "==", true)
    ));
    if (!staffSnap.empty) {
      staffDoc = staffSnap.docs[0];
      break;
    }
  }

  if (!staffDoc) return null;

  return buildStaffAuthProfile(staffDoc.id, { ...staffDoc.data(), email: key });
}
