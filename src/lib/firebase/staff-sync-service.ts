import { collection, doc, getDocs, serverTimestamp, writeBatch, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { assertNotChangedSinceLoad, createDocId, hasFieldChanges, isNewDocId } from "@/lib/firebase/diff-write";
import {
  deleteStaffAuthMirrorInBatch,
  setStaffAuthMirrorInBatch,
  staffEmailKey,
} from "@/lib/firebase/staff-auth";

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  passcode: string;
  role: "一般" | "準管理者" | "管理者";
  rank: string;
  isActive: boolean;
  updatedAt?: unknown;
}

export async function listStaffMembers(): Promise<StaffMember[]> {
  const snap = await getDocs(collection(db, "staff"));
  const staff: StaffMember[] = [];
  snap.forEach((d) => staff.push({ id: d.id, ...d.data() } as StaffMember));
  return staff;
}

export async function saveStaffMembers({
  staffList,
  dirtyStaffIds,
}: {
  staffList: StaffMember[];
  dirtyStaffIds: string[];
}): Promise<void> {
  const batch = writeBatch(db);
  const staffSnap = await getDocs(collection(db, "staff"));
  const currentStaff = new Map(staffSnap.docs.map((d) => [d.id, d.data()]));
  const emails = staffList.map((s) => staffEmailKey(s.email || "")).filter(Boolean);
  if (new Set(emails).size !== emails.length) {
    throw new Error("同じメールアドレスの担当者が重複しています。");
  }

  staffList.forEach((s) => {
    const docId = isNewDocId(s.id) ? createDocId("staff") : s.id;
    const ref = doc(db, "staff", docId);
    const payload = {
      name: s.name.trim(),
      email: s.email.trim(),
      passcode: s.passcode.trim(),
      role: s.role,
      rank: s.rank,
      isActive: s.isActive,
    };

    if (isNewDocId(s.id)) {
      batch.set(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setStaffAuthMirrorInBatch(batch, docId, payload);
      return;
    }

    const current = currentStaff.get(docId);
    const isDirty = dirtyStaffIds.includes(s.id);
    if (!isDirty) {
      if (current) setStaffAuthMirrorInBatch(batch, docId, current);
      return;
    }

    if (!current) {
      throw new Error(`担当者「${s.name || docId}」は他の操作で削除されています。再読込してください。`);
    }
    assertNotChangedSinceLoad(s as unknown as DocumentData, current, `担当者「${s.name || docId}」`);

    const oldEmail = staffEmailKey(String(current.email || ""));
    const newEmail = staffEmailKey(payload.email);
    if (oldEmail && oldEmail !== newEmail) {
      deleteStaffAuthMirrorInBatch(batch, oldEmail);
    }

    if (hasFieldChanges(current, payload)) {
      batch.update(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    }
    setStaffAuthMirrorInBatch(batch, docId, payload);
  });

  await batch.commit();
}
