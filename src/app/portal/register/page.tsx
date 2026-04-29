"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase/config";
import { createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { ArrowRight, Lock, Mail, UserPlus } from "lucide-react";
import {
  ensureCustomerUser,
  needsCustomerUserSetup,
  saveCustomerPortalSession,
} from "@/lib/firebase/customer-user";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleRegister = async () => {
    setLoading(true);
    setError("");
    const provider = new GoogleAuthProvider();

    try {
      const result = await signInWithPopup(auth, provider);
      const customerUser = await ensureCustomerUser(result.user);
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
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Googleでの登録に失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError("パスワードは6文字以上で入力してください。");
      return;
    }
    if (password !== passwordConfirm) {
      setError("確認用パスワードが一致しません。");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const customerUser = await ensureCustomerUser(result.user);
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
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "メールアドレスでの登録に失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100dvh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)",
      padding: 20,
    }}>
      <div style={{
        background: "#fff",
        padding: "40px 32px",
        borderRadius: 24,
        boxShadow: "0 20px 40px rgba(0,0,0,0.08)",
        width: "100%", maxWidth: 400,
        display: "flex", flexDirection: "column", gap: 24,
      }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{
            display: "inline-flex", padding: 16,
            background: "#eff6ff", borderRadius: "50%",
            marginBottom: 16,
          }}>
            <UserPlus size={32} color="#3b82f6" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1e293b", margin: 0 }}>
            新規利用登録
          </h1>
          <p style={{ color: "#64748b", margin: "8px 0 0 0", fontSize: 14 }}>
            Googleまたはメールアドレスで登録します。
          </p>
        </div>

        {error && (
          <div style={{
            background: "#fef2f2", color: "#dc2626",
            padding: "12px 16px", borderRadius: 12,
            fontSize: 14, fontWeight: 500,
            border: "1px solid #fecaca",
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleRegister}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
            width: "100%", padding: "14px", borderRadius: 12,
            background: "#fff", color: "#334155",
            border: "2px solid #e2e8f0", fontSize: 16, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            transition: "all 0.2s",
            opacity: loading ? 0.7 : 1,
          }}
        >
          <span aria-hidden="true" style={{ width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#4285f4", fontWeight: 900 }}>
            G
          </span>
          Google アカウントで登録
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "4px 0" }}>
          <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
          <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600 }}>または</span>
          <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
        </div>

        <form onSubmit={handleEmailRegister} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
              placeholder="パスワード（6文字以上）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
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
              placeholder="パスワード確認"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              required
              minLength={6}
              style={{
                width: "100%", padding: "14px 16px 14px 44px",
                borderRadius: 12, border: "2px solid #e2e8f0",
                fontSize: 16, outline: "none", transition: "border-color 0.2s",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password || !passwordConfirm}
            style={{
              width: "100%", padding: "14px", borderRadius: 12,
              background: "#334155", color: "#fff", border: "none",
              fontSize: 16, fontWeight: 700,
              cursor: (loading || !email || !password || !passwordConfirm) ? "not-allowed" : "pointer",
              transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: (loading || !email || !password || !passwordConfirm) ? 0.7 : 1,
            }}
          >
            メールアドレスで登録
            <ArrowRight size={18} />
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button
            onClick={() => router.push("/portal/login")}
            style={{
              background: "none", border: "none", color: "#64748b",
              fontSize: 14, cursor: "pointer", textDecoration: "underline",
            }}
          >
            既にアカウントをお持ちの方はこちら
          </button>
        </div>
      </div>
    </div>
  );
}
