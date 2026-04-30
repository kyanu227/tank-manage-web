"use client";

import { useEffect, useState } from "react";
import {
  findStaffProfileByEmailReadOnly,
  getStaffProfileByIdReadOnly,
  type StaffAuthProfile,
} from "@/lib/firebase/staff-auth";
import { useStaffSession, type StaffSession } from "@/hooks/useStaffSession";

export interface UseStaffProfileResult {
  profile: StaffAuthProfile | null;
  session: StaffSession | null;
  loading: boolean;
  error: string | null;
}

/**
 * staffSession を起点に、表示用スタッフプロフィールを read-only で取得する。
 */
export function useStaffProfile(): UseStaffProfileResult {
  const session = useStaffSession();
  const [profile, setProfile] = useState<StaffAuthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const staffId = session?.id?.trim() ?? "";
    const email = session?.email?.trim() ?? "";

    if (!session) {
      setProfile(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (!staffId && !email) {
      setProfile(null);
      setError("ログイン情報にスタッフIDまたはメールアドレスがありません");
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        let found: StaffAuthProfile | null = null;
        if (staffId) {
          found = await getStaffProfileByIdReadOnly(staffId);
        }
        if (!found && email) {
          found = await findStaffProfileByEmailReadOnly(email);
        }

        if (cancelled) return;
        setProfile(found);
        if (!found) {
          setError("スタッフ情報が見つかりませんでした");
        }
      } catch (e) {
        if (cancelled) return;
        console.error("useStaffProfile failed:", e);
        setProfile(null);
        setError("スタッフ情報の取得に失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  return { profile, session, loading, error };
}
