import {
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  STAFF_BY_EMAIL_COLLECTION,
  STAFF_BY_UID_COLLECTION,
  setStaffUidAuthMirrorInTransaction,
  staffEmailKey,
} from "@/lib/firebase/staff-auth";

export type LinkStaffUidByEmailAuthInput = {
  uid: string;
  email: string;
  emailVerified: boolean;
};

type NormalizedStaffUidLinkInput = {
  uid: string;
  email: string;
  emailKey: string;
};

type StaffUidLinkDocs = {
  staffByEmailSnap: DocumentSnapshot<DocumentData>;
  staffSnap: DocumentSnapshot<DocumentData> | null;
  staffByUidSnap: DocumentSnapshot<DocumentData>;
  staffRef: DocumentReference<DocumentData> | null;
};

type StaffUidLinkReady = {
  input: NormalizedStaffUidLinkInput;
  staffId: string;
  staffData: DocumentData;
  staffRef: DocumentReference<DocumentData>;
};

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStaffUidLinkInput(input: LinkStaffUidByEmailAuthInput): NormalizedStaffUidLinkInput {
  const uid = input.uid.trim();
  const email = input.email.trim();
  const emailKey = staffEmailKey(email);

  if (!uid) throw new Error("uid is required.");
  if (!email) throw new Error("email is required.");
  if (!emailKey) throw new Error("email key is required.");
  if (input.emailVerified !== true) {
    throw new Error("Firebase Auth メールアドレスの確認が必要です。");
  }

  return { uid, email, emailKey };
}

async function readStaffUidLinkDocs(
  transaction: Transaction,
  input: NormalizedStaffUidLinkInput
): Promise<StaffUidLinkDocs> {
  const staffByEmailRef = doc(db, STAFF_BY_EMAIL_COLLECTION, input.emailKey);
  const staffByUidRef = doc(db, STAFF_BY_UID_COLLECTION, input.uid);
  const staffByEmailSnap = await transaction.get(staffByEmailRef);
  const staffByUidSnap = await transaction.get(staffByUidRef);

  const staffId = staffByEmailSnap.exists()
    ? stringOrEmpty(staffByEmailSnap.data().staffId)
    : "";
  const staffRef = staffId ? doc(db, "staff", staffId) : null;
  const staffSnap = staffRef ? await transaction.get(staffRef) : null;

  return {
    staffByEmailSnap,
    staffSnap,
    staffByUidSnap,
    staffRef,
  };
}

function assertStaffUidCanBeLinked(
  input: NormalizedStaffUidLinkInput,
  docs: StaffUidLinkDocs
): StaffUidLinkReady {
  if (!docs.staffByEmailSnap.exists()) {
    throw new Error("このメールアドレスはスタッフ認証 mirror に登録されていません。");
  }

  const staffByEmailData = docs.staffByEmailSnap.data();
  const staffId = stringOrEmpty(staffByEmailData.staffId);
  if (!staffId) throw new Error("staffByEmail mirror に staffId がありません。");
  if (staffByEmailData.isActive !== true) {
    throw new Error("staffByEmail mirror が有効なスタッフを指していません。");
  }

  if (!docs.staffRef || !docs.staffSnap?.exists()) {
    throw new Error("スタッフ情報が見つかりません。");
  }

  const staffData = docs.staffSnap.data();
  if (staffData.isActive !== true) {
    throw new Error("停止中のスタッフには UID を紐付けできません。");
  }

  const staffEmail = stringOrEmpty(staffData.email);
  if (staffEmailKey(staffEmail) !== input.emailKey) {
    throw new Error("Firebase Auth メールアドレスとスタッフ email が一致しません。");
  }

  const mirrorEmail = stringOrEmpty(staffByEmailData.email);
  if (mirrorEmail && staffEmailKey(mirrorEmail) !== input.emailKey) {
    throw new Error("Firebase Auth メールアドレスと staffByEmail mirror が一致しません。");
  }

  const existingAuthUid = stringOrEmpty(staffData.authUid);
  if (existingAuthUid && existingAuthUid !== input.uid) {
    throw new Error("このスタッフには別の UID が既に紐付いています。");
  }

  if (docs.staffByUidSnap.exists()) {
    const existingStaffId = stringOrEmpty(docs.staffByUidSnap.data().staffId);
    if (existingStaffId !== staffId) {
      throw new Error("この UID は別のスタッフに既に紐付いています。");
    }
  }

  return {
    input,
    staffId,
    staffData,
    staffRef: docs.staffRef,
  };
}

function writeStaffUidLink(transaction: Transaction, ready: StaffUidLinkReady): void {
  const now = serverTimestamp();

  transaction.update(ready.staffRef, {
    authUid: ready.input.uid,
    authEmail: ready.input.email,
    uidLinkedAt: now,
    updatedAt: now,
  });

  setStaffUidAuthMirrorInTransaction(
    transaction,
    ready.input.uid,
    ready.staffId,
    ready.staffData
  );
}

export async function linkStaffUidByEmailAuth(input: LinkStaffUidByEmailAuthInput): Promise<void> {
  const normalized = normalizeStaffUidLinkInput(input);

  await runTransaction(db, async (transaction) => {
    const docs = await readStaffUidLinkDocs(transaction, normalized);
    const ready = assertStaffUidCanBeLinked(normalized, docs);
    writeStaffUidLink(transaction, ready);
  });
}
