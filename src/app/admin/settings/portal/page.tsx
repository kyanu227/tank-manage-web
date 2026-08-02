"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PortalSettingsPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/admin/settings"); }, [router]);
  return <p style={{ padding: 24, color: "#64748b" }}>業務ルール設定へ移動しています…</p>;
}
