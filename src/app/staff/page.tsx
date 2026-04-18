"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /staff への直接アクセスは /staff/lend にリダイレクトする。
 * 静的エクスポート構成のためクライアントサイドで router.replace を使う。
 */
export default function StaffIndex() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/staff/lend");
  }, [router]);
  return null;
}
