"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/portal");
  }, [router]);

  return <div style={{ minHeight: "100vh", background: "#f8f9fb" }} />;
}
