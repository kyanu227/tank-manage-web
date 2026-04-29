"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase/config";
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, type User } from "firebase/auth";
import { Mail, Lock, UserCheck, ArrowRight } from "lucide-react";
import {
  ensureCustomerUser,
  needsCustomerUserSetup,
  saveCustomerPortalSession,
} from "@/lib/firebase/customer-user";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // すでにログイン済みならポータルへ
  useEffect(() => {
    try {
      const raw = localStorage.getItem("customerSession");
      const session = raw ? JSON.parse(raw) as { customerUserUid?: string } : null;
      if (session?.customerUserUid) {
        router.replace("/portal");
        return;
      }
      if (raw) localStorage.removeItem("customerSession");
    } catch {
      localStorage.removeItem("customerSession");
    }
  }, [router]);

  const handleFirebaseUserRedirect = async (user: User) => {
    const customerUser = await ensureCustomerUser(user);
    if (customerUser.status === "disabled") {
      setError("このアカウントは利用停止中です。");
      return;
    }
    if (needsCustomerUserSetup(customerUser)) {
      router.push("/portal/setup");
      return;
    }
    saveCustomerPortalSession(customerUser);
    router.push("/portal");
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    setLoading(true);
    setError("");

    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      if (typeof window !== 'undefined') {
         localStorage.removeItem("customerSessionUid"); // Clear any stale simple session
      }
      await handleFirebaseUserRedirect(result.user);
    } catch (err) {
      console.error(err);
      setError("メールアドレスまたはパスワードが間違っています。");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setLoading(true);
    setError("");
    const provider = new GoogleAuthProvider();

    try {
      const result = await signInWithPopup(auth, provider);
      if (typeof window !== 'undefined') {
         localStorage.removeItem("customerSessionUid");
      }
      
      await handleFirebaseUserRedirect(result.user);
    } catch (err) {
      console.error(err);
      setError("Googleログインに失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      width: "100%",
      height: "100dvh",
      overflow: "hidden",
      display: "flex", flexDirection: "column",
      background: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)",
    }}>
      <div aria-hidden="true" style={{ height: "env(safe-area-inset-top, 0px)", flexShrink: 0 }} />
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        display: "flex",
        flexDirection: "column",
        padding: 20,
        boxSizing: "border-box",
      }}>
      <div style={{
        background: "#fff", 
        padding: "40px 32px", 
        borderRadius: 24, 
        boxShadow: "0 20px 40px rgba(0,0,0,0.08)",
        width: "100%", maxWidth: 400,
        display: "flex", flexDirection: "column", gap: 24,
        margin: "auto",
      }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ 
            display: "inline-flex", padding: 16, 
            background: "#eff6ff", borderRadius: "50%", 
            marginBottom: 16 
          }}>
            <UserCheck size={32} color="#3b82f6" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1e293b", margin: 0 }}>
            ログイン
          </h1>
          <p style={{ color: "#64748b", margin: "8px 0 0 0", fontSize: 14 }}>
            顧客用ポータルサイト
          </p>
        </div>

        {error && (
          <div style={{ 
            background: "#fef2f2", color: "#dc2626", 
            padding: "12px 16px", borderRadius: 12, 
            fontSize: 14, fontWeight: 500, border: "1px solid #fecaca"
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
                width: "100%", padding: "14px", borderRadius: 12,
                background: "#fff", color: "#334155",
                border: "2px solid #e2e8f0", fontSize: 16, fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "all 0.2s", opacity: loading ? 0.7 : 1
              }}
            >
              <span aria-hidden="true" style={{ width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#4285f4", fontWeight: 900 }}>
                G
              </span>
              Google でログイン
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "4px 0" }}>
              <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
              <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600 }}>または</span>
              <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
            </div>

            <form onSubmit={handleEmailLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ position: "relative" }}>
                <Mail size={18} color="#94a3b8" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }} />
                <input
                  type="email"
                  placeholder="メールアドレス"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  style={{
                    width: "100%", padding: "14px 16px 14px 44px",
                    borderRadius: 12, border: "2px solid #e2e8f0",
                    fontSize: 16, outline: "none", transition: "border-color 0.2s",
                  }}
                />
              </div>
              
              <div style={{ position: "relative" }}>
                <Lock size={18} color="#94a3b8" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }} />
                <input
                  type="password"
                  placeholder="パスワード"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{
                    width: "100%", padding: "14px 16px 14px 44px",
                    borderRadius: 12, border: "2px solid #e2e8f0",
                    fontSize: 16, outline: "none", transition: "border-color 0.2s",
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email || !password}
                style={{
                  width: "100%", padding: "14px", borderRadius: 12,
                  background: "#334155", color: "#fff", border: "none",
                  fontSize: 16, fontWeight: 700, cursor: (loading || !email || !password) ? "not-allowed" : "pointer",
                  transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  opacity: (loading || !email || !password) ? 0.7 : 1,
                  marginTop: 8
                }}
              >
                メールアドレスでログイン
                <ArrowRight size={18} />
              </button>
            </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button 
            onClick={() => router.push("/portal/register")}
            style={{ 
              background: "none", border: "none", color: "#64748b", 
              fontSize: 14, cursor: "pointer", textDecoration: "underline" 
            }}
          >
            新規登録はこちら
          </button>
        </div>
      </div>
      </div>
      <div aria-hidden="true" style={{ height: "env(safe-area-inset-bottom, 0px)", flexShrink: 0 }} />
    </div>
  );
}
