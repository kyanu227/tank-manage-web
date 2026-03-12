"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, User, Lock, AlertCircle } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, where } from "firebase/firestore";

export default function LoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [passcode, setPasscode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId || !passcode) return;

    setLoading(true);
    setError("");

    try {
      const q = query(collection(db, "customers"), where("loginId", "==", loginId), where("passcode", "==", passcode), where("isActive", "==", true));
      const snap = await getDocs(q);

      if (snap.empty) {
        setError("ログインIDまたはパスワードが正しくありません");
        setLoading(false);
        return;
      }

      const doc = snap.docs[0];
      const data = doc.data();

      localStorage.setItem("customerSession", JSON.stringify({
        id: doc.id,
        name: data.name,
        loginId: data.loginId,
      }));

      // Force a hard navigation so the portal layout boots cleanly
      window.location.href = "/portal";
      
    } catch (e) {
      console.error("Login Error:", e);
      setError("通信エラーが発生しました");
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "#f8f9fb" }}>
      <header style={{ height: 60, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: "1px solid #e8eaed" }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: "#1a1a2e", letterSpacing: "-0.02em" }}>
          タンク管理<span style={{ color: "#6366f1", marginLeft: 4 }}>お客様専用ポータル</span>
        </span>
      </header>

      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ background: "#fff", borderRadius: 24, padding: "40px 24px", width: "100%", maxWidth: 360, boxShadow: "0 10px 25px -5px rgba(0,0,0,0.05)" }}>
          
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: "linear-gradient(135deg, #0ea5e9, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <LogIn size={32} color="#fff" />
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>ログイン</h1>
            <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>管理者から発行されたIDでログインしてください</p>
          </div>

          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
              <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: "#991b1b" }}>{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 6 }}>ログインID</label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="IDを入力"
                  style={{
                    width: "100%", padding: "12px 14px 12px 40px", fontSize: 15, fontWeight: 600,
                    border: "1px solid #e2e8f0", borderRadius: 12, outline: "none", color: "#0f172a",
                  }}
                />
                <User size={18} color="#94a3b8" style={{ position: "absolute", left: 14, top: 14 }} />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 6 }}>パスワード</label>
              <div style={{ position: "relative" }}>
                <input
                  type="password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="••••••••"
                  style={{
                    width: "100%", padding: "12px 14px 12px 40px", fontSize: 15, fontWeight: 600,
                    border: "1px solid #e2e8f0", borderRadius: 12, outline: "none", color: "#0f172a",
                  }}
                />
                <Lock size={18} color="#94a3b8" style={{ position: "absolute", left: 14, top: 14 }} />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !loginId || !passcode}
              style={{
                width: "100%", padding: "14px", borderRadius: 12, border: "none",
                background: (loading || !loginId || !passcode) ? "#bae6fd" : "#0ea5e9",
                color: "#fff", fontSize: 15, fontWeight: 700, cursor: (loading || !loginId || !passcode) ? "not-allowed" : "pointer",
                marginTop: 8, transition: "background 0.2s",
              }}
            >
              {loading ? "ログイン中…" : "ログイン"}
            </button>
          </form>

        </div>
      </main>
    </div>
  );
}
