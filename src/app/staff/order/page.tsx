"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function StaffOrderRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/staff/supply-order");
  }, [router]);

  return <div style={{ minHeight: "100vh", background: "#f8fafc" }} />;
}
