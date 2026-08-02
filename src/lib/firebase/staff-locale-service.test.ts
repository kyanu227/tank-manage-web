import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  StaffOperationError,
  getStaffOperationErrorMessage,
} from "@/lib/staff-operation-error";
import { updateOwnStaffLocale } from "./staff-locale-service";

const mocks = vi.hoisted(() => ({
  session: null as null | { id?: string; email?: string },
  currentUser: null as null | { email?: string | null },
  doc: vi.fn(),
  getDoc: vi.fn(),
  updateStoredStaffSessionLocale: vi.fn(),
  batchUpdate: vi.fn(),
  batchCommit: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  writeBatch: mocks.writeBatch,
}));

vi.mock("@/lib/staff-session-store", () => ({
  getStaffSession: () => mocks.session,
  updateStoredStaffSessionLocale: mocks.updateStoredStaffSessionLocale,
}));

vi.mock("@/lib/firebase/config", () => ({
  auth: {
    get currentUser() {
      return mocks.currentUser;
    },
  },
  db: { kind: "mock-db" },
}));

vi.mock("@/lib/firebase/staff-auth", () => ({
  STAFF_BY_EMAIL_COLLECTION: "staffByEmail",
  staffEmailKey: (email: string) => email.trim().toLowerCase(),
}));

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe("updateOwnStaffLocale error classification", () => {
  beforeEach(() => {
    mocks.session = null;
    mocks.currentUser = null;
    mocks.doc.mockReset();
    mocks.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({
      path: segments.join("/"),
    }));
    mocks.getDoc.mockReset();
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    mocks.updateStoredStaffSessionLocale.mockReset();
    mocks.batchUpdate.mockReset();
    mocks.batchCommit.mockReset();
    mocks.batchCommit.mockResolvedValue(undefined);
    mocks.writeBatch.mockReset();
    mocks.writeBatch.mockReturnValue({
      update: mocks.batchUpdate,
      commit: mocks.batchCommit,
    });
  });

  it("types a pre-write session failure and keeps its existing Japanese reason", async () => {
    const error = await captureError(updateOwnStaffLocale("en"));

    expect(error).toBeInstanceOf(StaffOperationError);
    expect(error).toMatchObject({
      code: "staff_session_invalid",
      message: "スタッフセッションが見つかりません。再ログインしてください。",
    });
    expect(getStaffOperationErrorMessage(error, "en")).toBe(
      "Your staff session could not be verified. Sign in again.",
    );
    expect(mocks.getDoc).toHaveBeenCalledTimes(0);
    expect(mocks.writeBatch).toHaveBeenCalledTimes(0);
  });

  it("does not relabel a Firestore read failure as a session problem", async () => {
    mocks.session = { id: "staff-001", email: "staff@example.com" };
    mocks.currentUser = { email: "staff@example.com" };
    const firestoreError = new Error("permission-denied");
    mocks.getDoc.mockRejectedValueOnce(firestoreError);

    const error = await captureError(updateOwnStaffLocale("en"));

    expect(error).toBe(firestoreError);
    expect(error).not.toBeInstanceOf(StaffOperationError);
    expect(getStaffOperationErrorMessage(error, "en")).toBe(
      "The operation could not be completed. Contact an administrator if the problem persists.",
    );
    expect(mocks.writeBatch).toHaveBeenCalledTimes(0);
  });
});
