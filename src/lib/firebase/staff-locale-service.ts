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

export type UpdateOwnStaffLocaleResult = {
  locale: Locale;
};

export async function updateOwnStaffLocale(
  locale: Locale,
): Promise<UpdateOwnStaffLocaleResult> {
  const normalizedLocale = normalizeLocale(locale);
  const session = getStaffSession();

  if (!session) {
    throw new Error("スタッフセッションが見つかりません。再ログインしてください。");
  }

  const staffId = session.id?.trim() ?? "";
  if (!staffId) {
    throw new Error("スタッフIDが見つかりません。再ログインしてください。");
  }

  const sessionEmail = session.email?.trim() ?? "";
  if (!sessionEmail) {
    throw new Error("スタッフメールが見つかりません。Firebase認証でログインしてください。");
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Firebase認証ユーザーが見つかりません。再ログインしてください。");
  }

  const authEmail = currentUser.email?.trim() ?? "";
  if (!authEmail) {
    throw new Error("Firebase認証メールが見つかりません。再ログインしてください。");
  }

  const sessionEmailKey = staffEmailKey(sessionEmail);
  const authEmailKey = staffEmailKey(authEmail);
  if (!sessionEmailKey || !authEmailKey || sessionEmailKey !== authEmailKey) {
    throw new Error("ログイン中のFirebaseユーザーとスタッフセッションが一致しません。");
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
