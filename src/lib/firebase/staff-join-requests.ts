import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./config";

export const STAFF_JOIN_REQUESTS_COLLECTION = "staffJoinRequests";

export const STAFF_JOIN_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;

export type StaffJoinRequestStatus = typeof STAFF_JOIN_REQUEST_STATUSES[number];

export interface StaffJoinRequest {
  uid: string;
  authEmail: string;
  authEmailLower: string;
  authDisplayName: string;
  requestedName: string;
  message: string;
  status: StaffJoinRequestStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
  reviewedAt?: unknown;
  reviewedByStaffId?: string;
  reviewedByStaffName?: string;
  linkedStaffId?: string;
  rejectionReason?: string;
}

export interface CreateOrUpdateOwnStaffJoinRequestInput {
  uid: string;
  authEmail: string;
  authDisplayName?: string | null;
  requestedName: string;
  message?: string | null;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function normalizeStaffJoinRequestStatus(status: unknown): StaffJoinRequestStatus {
  return status === "approved" || status === "rejected" ? status : "pending";
}

export function isPendingStaffJoinRequest(request: StaffJoinRequest): boolean {
  return request.status === "pending";
}

export function buildStaffJoinRequest(uid: string, data: DocumentData): StaffJoinRequest {
  const authEmail = stringOrEmpty(data.authEmail);
  const request: StaffJoinRequest = {
    uid: stringOrEmpty(data.uid) || uid,
    authEmail,
    authEmailLower: stringOrEmpty(data.authEmailLower) || authEmail.trim().toLowerCase(),
    authDisplayName: stringOrEmpty(data.authDisplayName),
    requestedName: stringOrEmpty(data.requestedName),
    message: stringOrEmpty(data.message),
    status: normalizeStaffJoinRequestStatus(data.status),
  };

  if (data.createdAt !== undefined) request.createdAt = data.createdAt;
  if (data.updatedAt !== undefined) request.updatedAt = data.updatedAt;
  if (data.reviewedAt !== undefined) request.reviewedAt = data.reviewedAt;

  const reviewedByStaffId = optionalString(data.reviewedByStaffId);
  if (reviewedByStaffId) request.reviewedByStaffId = reviewedByStaffId;

  const reviewedByStaffName = optionalString(data.reviewedByStaffName);
  if (reviewedByStaffName) request.reviewedByStaffName = reviewedByStaffName;

  const linkedStaffId = optionalString(data.linkedStaffId);
  if (linkedStaffId) request.linkedStaffId = linkedStaffId;

  const rejectionReason = optionalString(data.rejectionReason);
  if (rejectionReason) request.rejectionReason = rejectionReason;

  return request;
}

function staffJoinRequestStatusOrder(status: StaffJoinRequestStatus): number {
  if (status === "pending") return 0;
  if (status === "approved") return 1;
  return 2;
}

function timestampMillis(value: unknown): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && value !== null && "toMillis" in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") return toMillis.call(value);
  }
  return 0;
}

function compareStaffJoinRequests(a: StaffJoinRequest, b: StaffJoinRequest): number {
  const statusDiff = staffJoinRequestStatusOrder(a.status) - staffJoinRequestStatusOrder(b.status);
  if (statusDiff !== 0) return statusDiff;

  const aTime = timestampMillis(a.updatedAt ?? a.createdAt);
  const bTime = timestampMillis(b.updatedAt ?? b.createdAt);
  if (aTime !== bTime) return bTime - aTime;

  return a.uid.localeCompare(b.uid);
}

export async function getStaffJoinRequestByUidReadOnly(uid: string): Promise<StaffJoinRequest | null> {
  const id = uid.trim();
  if (!id) return null;

  const snap = await getDoc(doc(db, STAFF_JOIN_REQUESTS_COLLECTION, id));
  return snap.exists() ? buildStaffJoinRequest(id, snap.data()) : null;
}

export async function listStaffJoinRequestsReadOnly(): Promise<StaffJoinRequest[]> {
  const snap = await getDocs(collection(db, STAFF_JOIN_REQUESTS_COLLECTION));
  return snap.docs
    .map((requestDoc) => buildStaffJoinRequest(requestDoc.id, requestDoc.data()))
    .sort(compareStaffJoinRequests);
}

export async function createOrUpdateOwnStaffJoinRequest(
  input: CreateOrUpdateOwnStaffJoinRequestInput
): Promise<void> {
  const uid = input.uid.trim();
  const authEmail = input.authEmail.trim();
  const requestedName = input.requestedName.trim();
  const message = input.message?.trim() ?? "";

  if (!uid) throw new Error("uid is required.");
  if (!authEmail) throw new Error("authEmail is required.");
  if (!requestedName) throw new Error("requestedName is required.");

  const authSnapshot = {
    uid,
    authEmail,
    authEmailLower: authEmail.toLowerCase(),
    authDisplayName: input.authDisplayName?.trim() ?? "",
  };

  await runTransaction(db, async (transaction) => {
    const ref = doc(db, STAFF_JOIN_REQUESTS_COLLECTION, uid);
    const snap = await transaction.get(ref);
    const now = serverTimestamp();

    if (snap.exists()) {
      const current = buildStaffJoinRequest(uid, snap.data());
      if (!isPendingStaffJoinRequest(current)) {
        throw new Error("承認または却下済みのスタッフ申請は本人から更新できません。");
      }

      transaction.set(ref, {
        ...authSnapshot,
        requestedName,
        message,
        status: "pending",
        updatedAt: now,
      }, { merge: true });
      return;
    }

    transaction.set(ref, {
      ...authSnapshot,
      requestedName,
      message,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  });
}
