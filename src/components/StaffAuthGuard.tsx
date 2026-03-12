"use client";

import { useState, useEffect } from "react";
import { Lock, CheckCircle2, AlertCircle } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, where } from "firebase/firestore";

interface StaffAuthGuardProps {
  children: React.ReactNode;
  allowedRoles?: ("一般" | "準管理者" | "管理者")[];
}

interface StaffUser {
  id: string;
  name: string;
  role: string;
  rank: string;
}

export default function StaffAuthGuard({ children, allowedRoles }: StaffAuthGuardProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // Check localStorage first
    const session = localStorage.getItem("staffSession");
    if (session) {
      try {
        const user = JSON.parse(session) as StaffUser;
        if (!allowedRoles || allowedRoles.includes(user.role as any)) {
          setIsAuthenticated(true);
        } else {
          setError("アクセス権限がありません");
          localStorage.removeItem("staffSession");
        }
      } catch (e) {
        localStorage.removeItem("staffSession");
      }
    }
    setLoading(false);
  }, [allowedRoles]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode) return;

    setChecking(true);
    setError("");
    try {
      const q = query(
        collection(db, "staff"),
        where("passcode", "==", passcode),
        where("isActive", "==", true)
      );
      const snap = await getDocs(q);
      
      if (snap.empty) {
        setError("パスコードが一致しません");
        setChecking(false);
        return;
      }

      // If multiple users have the same passcode, we just pick the first one.
      // Ideally passcodes should be unique per active user.
      const doc = snap.docs[0];
      const data = doc.data();
      
      if (allowedRoles && !allowedRoles.includes(data.role as any)) {
        setError("このページにアクセスする権限がありません");
        setChecking(false);
        return;
      }

      const userSession: StaffUser = {
        id: doc.id,
        name: data.name,
        role: data.role,
        rank: data.rank || "レギュラー",
      };
      
      localStorage.setItem("staffSession", JSON.stringify(userSession));
      // Dispatch an event so layout can update user info
      window.dispatchEvent(new Event("staffLogin"));
      
      setIsAuthenticated(true);
    } catch (e) {
      console.error("Login verify failed", e);
      setError("認証エラーが発生しました");
    } finally {
      if (!isAuthenticated) setChecking(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f9fb" }}>
        <div style={{ color: "#94a3b8", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, border: "3px solid #e2e8f0", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <p style={{ fontSize: 14, fontWeight: 600 }}>認証を確認中…</p>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f9fb", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: "32px 24px", width: "100%", maxWidth: 360, boxShadow: "0 10px 25px -5px rgba(0,0,0,0.05), 0 8px 10px -6px rgba(0,0,0,0.01)" }}>
        
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Lock size={28} color="#fff" />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>スタッフ・ログイン</h1>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>パスコードを入力してください</p>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
            <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
            <p style={{ fontSize: 13, fontWeight: 600, color: "#991b1b" }}>{error}</p>
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="••••"
              autoFocus
              style={{
                width: "100%", padding: "14px", fontSize: 24, fontWeight: 700,
                border: "2px solid #e2e8f0", borderRadius: 12, outline: "none", color: "#0f172a",
                textAlign: "center", letterSpacing: "0.2em", transition: "border-color 0.2s"
              }}
              onFocus={(e) => e.target.style.borderColor = "#6366f1"}
              onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
            />
          </div>

          <button
            type="submit"
            disabled={checking || !passcode}
            style={{
              width: "100%", padding: "14px", borderRadius: 12, border: "none",
              background: (checking || !passcode) ? "#c7d2fe" : "#6366f1",
              color: "#fff", fontSize: 16, fontWeight: 800, cursor: (checking || !passcode) ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12,
              transition: "background 0.2s",
            }}
          >
            {checking ? (
              <><div style={{ width: 18, height: 18, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} /> 確認中…</>
            ) : (
              <><CheckCircle2 size={18} /> ログイン</>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
