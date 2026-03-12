"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Building2 } from "lucide-react";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = localStorage.getItem("customerSession");
    if (!session) {
      router.replace("/login");
      return;
    }
    try {
      const user = JSON.parse(session);
      setCustomerName(user.name);
      setLoading(false);
    } catch (e) {
      localStorage.removeItem("customerSession");
      router.replace("/login");
    }
  }, [router]);

  const handleLogout = () => {
    if (!confirm("ログアウトしますか？")) return;
    localStorage.removeItem("customerSession");
    router.replace("/login");
  };

  if (loading) {
    return <div style={{ minHeight: "100vh", background: "#f8f9fb" }} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", background: "#f8f9fb" }}>
      <header
        style={{
          height: 60, background: "#fff",
          borderBottom: "1px solid #e8eaed",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px", position: "sticky", top: 0, zIndex: 30,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "#e0f2fe", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Building2 size={16} color="#0ea5e9" />
          </div>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
            {customerName} <span style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>様</span>
          </span>
        </div>
        
        <button
          onClick={handleLogout}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0",
            background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <LogOut size={14} /> ログアウト
        </button>
      </header>

      <main style={{ flex: 1 }}>
        {children}
      </main>
    </div>
  );
}
