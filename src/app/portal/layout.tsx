"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { LogOut, Building2 } from "lucide-react";

const PUBLIC_PATHS = ["/portal/login", "/portal/register", "/portal/setup"];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(true);

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  useEffect(() => {
    if (isPublic) {
      setLoading(false);
      return;
    }
    const session = localStorage.getItem("customerSession");
    if (!session) {
      router.replace("/portal/login");
      return;
    }
    try {
      const user = JSON.parse(session);
      setCustomerName(user.name);
      setLoading(false);
    } catch (e) {
      localStorage.removeItem("customerSession");
      router.replace("/portal/login");
    }
  }, [router, isPublic]);

  const handleLogout = () => {
    if (!confirm("ログアウトしますか？")) return;
    localStorage.removeItem("customerSession");
    router.replace("/portal/login");
  };

  if (loading) {
    return <div style={{ minHeight: "100vh", background: "#f8f9fb" }} />;
  }

  if (isPublic) {
    return <>{children}</>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", background: "#f8f9fb", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <header
        style={{
          height: "clamp(40px, 5dvh, 52px)", background: "#fff",
          borderBottom: "1px solid #e8eaed",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 4vw", flexShrink: 0, zIndex: 30,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "#e0f2fe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Building2 size={13} color="#0ea5e9" />
          </div>
          <span style={{ fontSize: "clamp(12px, 3.5vw, 15px)", fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "55vw" }}>
            {customerName} <span style={{ fontSize: "clamp(10px, 2.8vw, 12px)", color: "#64748b", fontWeight: 600 }}>様</span>
          </span>
        </div>

        <button
          onClick={handleLogout}
          title="ログアウト"
          style={{
            width: 28, height: 28, borderRadius: 7, border: "1px solid #e2e8f0",
            background: "#fff", color: "#94a3b8",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0,
          }}
        >
          <LogOut size={13} />
        </button>
      </header>

      <main style={{ flex: 1, height: 0, overflow: "hidden" }}>
        {children}
      </main>
    </div>
  );
}
