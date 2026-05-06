import {
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  STAFF_JOIN_REQUESTS_COLLECTION,
  buildStaffJoinRequest,
  isPendingStaffJoinRequest,
} from "@/lib/firebase/staff-join-requests";
import {
  STAFF_BY_UID_COLLECTION,
  setStaffUidAuthMirrorInTransaction,
} from "@/lib/firebase/staff-auth";

export type StaffJoinRequestReviewer = {
  staffId: string;
  staffName: string;
};

export type ApproveStaffJoinRequestInput = {
  uid: string;
  staffId: string;
  reviewer: StaffJoinRequestReviewer;
};

export type RejectStaffJoinRequestInput = {
  uid: string;
  reviewer: StaffJoinRequestReviewer;
  rejectionReason?: string;
};

function normalizeReviewer(reviewer: StaffJoinRequestReviewer): StaffJoinRequestReviewer {
  const staffId = reviewer.staffId.trim();
  const staffName = reviewer.staffName.trim();
  if (!staffId) throw new Error("reviewer.staffId is required.");
  if (!staffName) throw new Error("reviewer.staffName is required.");
  return { staffId, staffName };
}

function normalizeUid(uid: string): string {
  const normalized = uid.trim();
  if (!normalized) throw new Error("uid is required.");
  return normalized;
}

function normalizeStaffId(staffId: string): string {
  const normalized = staffId.trim();
  if (!normalized) throw new Error("staffId is required.");
  return normalized;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function assertRequestUidMatchesPath(requestUid: string, pathUid: string): void {
  if (requestUid !== pathUid) {
    throw new Error("スタッフ利用申請の UID がドキュメント ID と一致しません。");
  }
}

export async function approveStaffJoinRequestForExistingStaff(
  input: ApproveStaffJoinRequestInput
): Promise<void> {
  const uid = normalizeUid(input.uid);
  const staffId = normalizeStaffId(input.staffId);
  const reviewer = normalizeReviewer(input.reviewer);

  await runTransaction(db, async (transaction) => {
    const requestRef = doc(db, STAFF_JOIN_REQUESTS_COLLECTION, uid);
    const staffRef = doc(db, "staff", staffId);
    const staffByUidRef = doc(db, STAFF_BY_UID_COLLECTION, uid);

    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists()) {
      throw new Error("スタッフ利用申請が見つかりません。");
    }

    const request = buildStaffJoinRequest(uid, requestSnap.data());
    assertRequestUidMatchesPath(request.uid, uid);
    if (!isPendingStaffJoinRequest(request)) {
      throw new Error("承認待ちではないスタッフ利用申請は承認できません。");
    }
    if (!request.authEmail) {
      throw new Error("スタッフ利用申請に Firebase Auth メールアドレスがありません。");
    }

    const staffSnap = await transaction.get(staffRef);
    if (!staffSnap.exists()) {
      throw new Error("紐付け先のスタッフが見つかりません。");
    }

    const staffData = staffSnap.data();
    if (staffData.isActive !== true) {
      throw new Error("停止中のスタッフには UID を紐付けできません。");
    }

    const existingAuthUid = stringOrEmpty(staffData.authUid);
    if (existingAuthUid && existingAuthUid !== uid) {
      throw new Error("このスタッフには別の UID が既に紐付いています。");
    }

    const staffByUidSnap = await transaction.get(staffByUidRef);
    if (staffByUidSnap.exists()) {
      const existingStaffId = stringOrEmpty(staffByUidSnap.data().staffId);
      if (existingStaffId !== staffId) {
        throw new Error("この UID は別のスタッフに既に紐付いています。");
      }
      throw new Error("この UID の staffByUid mirror は既に存在します。");
    }

    const now = serverTimestamp();
    const staffEmail = stringOrEmpty(staffData.email) || request.authEmail;

    transaction.update(staffRef, {
      authUid: uid,
      authEmail: request.authEmail,
      uidLinkedAt: now,
      updatedAt: now,
    });

    setStaffUidAuthMirrorInTransaction(transaction, uid, staffId, {
      ...staffData,
      email: staffEmail,
    });

    transaction.update(requestRef, {
      status: "approved",
      reviewedAt: now,
      reviewedByStaffId: reviewer.staffId,
      reviewedByStaffName: reviewer.staffName,
      linkedStaffId: staffId,
      updatedAt: now,
    });
  });
}

export async function rejectStaffJoinRequest(input: RejectStaffJoinRequestInput): Promise<void> {
  const uid = normalizeUid(input.uid);
  const reviewer = normalizeReviewer(input.reviewer);
  const rejectionReason = input.rejectionReason?.trim() ?? "";

  await runTransaction(db, async (transaction) => {
    const requestRef = doc(db, STAFF_JOIN_REQUESTS_COLLECTION, uid);
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists()) {
      throw new Error("スタッフ利用申請が見つかりません。");
    }

    const request = buildStaffJoinRequest(uid, requestSnap.data());
    assertRequestUidMatchesPath(request.uid, uid);
    if (!isPendingStaffJoinRequest(request)) {
      throw new Error("承認待ちではないスタッフ利用申請は却下できません。");
    }

    const now = serverTimestamp();
    transaction.update(requestRef, {
      status: "rejected",
      reviewedAt: now,
      reviewedByStaffId: reviewer.staffId,
      reviewedByStaffName: reviewer.staffName,
      rejectionReason,
      updatedAt: now,
    });
  });
}
