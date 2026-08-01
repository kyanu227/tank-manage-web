"use client";

import { doc, getDoc, writeBatch } from "firebase/firestore";
import {
  getStaffSession,
  updateStoredStaffSessionLocale,
} from "@/hooks/useStaffSession";
import { normalizeLocale, type Locale } from "@/lib/locale";
import {
  STAFF_BY_EMAIL_COLLECTION,
  staffEmailKey,
} from "@/lib/firebase/staff-auth";
import { auth, db } from "@/lib/firebase/config";
import {
  STAFF_OPERATION_ERROR_TEXT,
  StaffOperationError,
} from "@/lib/staff-operation-error";

const STAFF_LOCALE_SESSION_ERROR_TEXT = {
  sessionMissing: {
    ja: "スタッフセッションが見つかりません。再ログインしてください。",
    en: STAFF_OPERATION_ERROR_TEXT.staff_session_invalid.en,
  },
  staffIdMissing: {
    ja: "スタッフIDが見つかりません。再ログインしてください。",
    en: STAFF_OPERATION_ERROR_TEXT.staff_session_invalid.en,
  },
  staffEmailMissing: {
    ja: "スタッフメールが見つかりません。Firebase認証でログインしてください。",
    en: STAFF_OPERATION_ERROR_TEXT.staff_session_invalid.en,
  },
  authUserMissing: {
    ja: "Firebase認証ユーザーが見つかりません。再ログインしてください。",
    en: STAFF_OPERATION_ERROR_TEXT.staff_session_invalid.en,
  },
  authEmailMissing: {
    ja: "Firebase認証メールが見つかりません。再ログインしてください。",
    en: STAFF_OPERATION_ERROR_TEXT.staff_session_invalid.en,
  },
  identityMismatch: {
    ja: "ログイン中のFirebaseユーザーとスタッフセッションが一致しません。",
    en: STAFF_OPERATION_ERROR_TEXT.staff_session_invalid.en,
  },
} as const;

export type UpdateOwnStaffLocaleResult = {
  locale: Locale;
};

export async function updateOwnStaffLocale(
  locale: Locale,
): Promise<UpdateOwnStaffLocaleResult> {
  const normalizedLocale = normalizeLocale(locale);
  const session = getStaffSession();

  if (!session) {
    throw new StaffOperationError("staff_session_invalid", {
      message: STAFF_LOCALE_SESSION_ERROR_TEXT.sessionMissing.ja,
    });
  }

  const staffId = session.id?.trim() ?? "";
  if (!staffId) {
    throw new StaffOperationError("staff_session_invalid", {
      message: STAFF_LOCALE_SESSION_ERROR_TEXT.staffIdMissing.ja,
    });
  }

  const sessionEmail = session.email?.trim() ?? "";
  if (!sessionEmail) {
    throw new StaffOperationError("staff_session_invalid", {
      message: STAFF_LOCALE_SESSION_ERROR_TEXT.staffEmailMissing.ja,
    });
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new StaffOperationError("staff_session_invalid", {
      message: STAFF_LOCALE_SESSION_ERROR_TEXT.authUserMissing.ja,
    });
  }

  const authEmail = currentUser.email?.trim() ?? "";
  if (!authEmail) {
    throw new StaffOperationError("staff_session_invalid", {
      message: STAFF_LOCALE_SESSION_ERROR_TEXT.authEmailMissing.ja,
    });
  }

  const sessionEmailKey = staffEmailKey(sessionEmail);
  const authEmailKey = staffEmailKey(authEmail);
  if (!sessionEmailKey || !authEmailKey || sessionEmailKey !== authEmailKey) {
    throw new StaffOperationError("staff_session_invalid", {
      message: STAFF_LOCALE_SESSION_ERROR_TEXT.identityMismatch.ja,
    });
  }

  const staffByEmailRef = doc(db, STAFF_BY_EMAIL_COLLECTION, sessionEmailKey);
  const staffByEmailSnap = await getDoc(staffByEmailRef);

  const batch = writeBatch(db);
  batch.update(doc(db, "staff", staffId), { locale: normalizedLocale });
  if (staffByEmailSnap.exists()) {
    batch.update(staffByEmailRef, { locale: normalizedLocale });
  }

  await batch.commit();
  updateStoredStaffSessionLocale(normalizedLocale);

  return { locale: normalizedLocale };
}
