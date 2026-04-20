"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase/config";
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { collection, query, where, getDocs, doc, getDoc, setDoc } from "firebase/firestore";
import { KeyRound, Mail, Lock, UserCheck, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [loginMethod, setLoginMethod] = useState<"passcode" | "email">("passcode");
  const [passcode, setPasscode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // すでにログイン済みならポータルへ
  useEffect(() => {
    const session = localStorage.getItem("customerSession");
    if (session) {
      router.replace("/portal");
    }
  }, [router]);

  const setSessionAndRedirect = (data: any, uid: string) => {
    // Setup the local storage session data that portal layout expects
    if (typeof window !== 'undefined') {
      localStorage.setItem("customerSession", JSON.stringify({
        uid: uid,
        name: data.companyName || "お客様"
      }));
    }

    // setupCompleted フラグ、または companyName が設定済みであればポータルへ
    // (adminが手動作成した顧客は setupCompleted 未設定でも companyName が入っている)
    if (data.setupCompleted || data.companyName) {
      router.push("/portal");
    } else {
      router.push("/portal/setup");
    }
  };

  const checkUserSetupAndRedirect = async (uid: string) => {
    const userRef = doc(db, "customers", uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      setSessionAndRedirect(snap.data(), uid);
    } else {
      // Very edge case: user somehow exists in auth but not customers collection
      router.push("/portal/setup");
    }
  };

  const handlePasscodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode || passcode.length !== 4) {
      setError("4桁のパスコードを入力してください。");
      return;
    }

    // iOS: キーボードを閉じてから遷移しないとビューポートがズレたまま固定される
    (document.activeElement as HTMLElement | null)?.blur?.();

    setLoading(true);
    setError("");

    try {
      // Find the customer doc by passcode
      const q = query(collection(db, "customers"), where("passcode", "==", passcode));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        throw new Error("正しいパスコードが見つかりません。");
      }

      const userData = querySnapshot.docs[0].data();
      const userUid = userData.uid || querySnapshot.docs[0].id;

      // パスコードユーザーはadmin管理なのでsetup不要、直接ポータルへ
      if (typeof window !== 'undefined') {
        localStorage.setItem("customerSession", JSON.stringify({
          uid: userUid,
          name: userData.companyName || userData.name || "お客様",
        }));
      }
      router.push("/portal");

    } catch (err: any) {
      console.error(err);
      setError(err.message || "ログインに失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    setLoading(true);
    setError("");

    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      // We rely on Firebase Auth state for email/google users
      if (typeof window !== 'undefined') {
         localStorage.removeItem("customerSessionUid"); // Clear any stale simple session
      }
      await checkUserSetupAndRedirect(result.user.uid);
    } catch (err: any) {
      console.error(err);
      setError("メールアドレスまたはパスワードが間違っています。");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError("");
    const provider = new GoogleAuthProvider();

    try {
      const result = await signInWithPopup(auth, provider);
      if (typeof window !== 'undefined') {
         localStorage.removeItem("customerSessionUid");
      }
      
      // 1. Check if UID exists in customers collection
      const userRef = doc(db, "customers", result.user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        await checkUserSetupAndRedirect(result.user.uid);
        return;
      }

      // 2. Check if email exists in customers collection — silently log them in if so
      const userEmail = result.user.email;
      if (userEmail) {
        const emailQ = query(
          collection(db, "customers"),
          where("email", "==", userEmail)
        );
        const emailSnap = await getDocs(emailQ);
        if (!emailSnap.empty) {
          const existingDoc = emailSnap.docs[0];
          setSessionAndRedirect(existingDoc.data(), existingDoc.id);
          return;
        }
      }

      // 3. No existing customer → go to register
      router.push("/portal/register");
    } catch (err: any) {
      console.error(err);
      setError("Googleログインに失敗しました。");
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
      paddingTop: "max(20px, env(safe-area-inset-top))",
      paddingBottom: "max(20px, env(safe-area-inset-bottom))",
      boxSizing: "border-box",
    }}>
      <div style={{
        background: "#fff", 
        padding: "40px 32px", 
        borderRadius: 24, 
        boxShadow: "0 20px 40px rgba(0,0,0,0.08)",
        width: "100%", maxWidth: 400,
        display: "flex", flexDirection: "column", gap: 24
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

        {/* Method Toggle */}
        <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 12, padding: 4 }}>
          <button
            onClick={() => { setLoginMethod("passcode"); setError(""); }}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 8, border: "none", fontSize: 14, fontWeight: 700,
              background: loginMethod === "passcode" ? "#fff" : "transparent",
              color: loginMethod === "passcode" ? "#3b82f6" : "#64748b",
              boxShadow: loginMethod === "passcode" ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
              cursor: "pointer", transition: "all 0.2s"
            }}
          >
            パスコード
          </button>
          <button
            onClick={() => { setLoginMethod("email"); setError(""); }}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 8, border: "none", fontSize: 14, fontWeight: 700,
              background: loginMethod === "email" ? "#fff" : "transparent",
              color: loginMethod === "email" ? "#3b82f6" : "#64748b",
              boxShadow: loginMethod === "email" ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
              cursor: "pointer", transition: "all 0.2s"
            }}
          >
            メール/Google
          </button>
        </div>

        {loginMethod === "passcode" ? (
          <form onSubmit={handlePasscodeLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ position: "relative" }}>
              <KeyRound size={18} color="#94a3b8" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }} />
              <input
                type="text"
                pattern="[0-9]*"
                inputMode="numeric"
                maxLength={4}
                placeholder="4桁のパスコードを入力"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value.replace(/[^0-9]/g, ""))}
                required
                style={{
                  width: "100%", padding: "14px 16px 14px 44px",
                  borderRadius: 12, border: "2px solid #e2e8f0",
                  fontSize: 16, outline: "none", transition: "border-color 0.2s",
                  letterSpacing: passcode ? "8px" : "normal",
                  fontWeight: 600
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading || passcode.length !== 4}
              style={{
                width: "100%", padding: "14px", borderRadius: 12,
                background: "#3b82f6", color: "#fff", border: "none",
                fontSize: 16, fontWeight: 700, cursor: (loading || passcode.length !== 4) ? "not-allowed" : "pointer",
                transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: (loading || passcode.length !== 4) ? 0.7 : 1,
                marginTop: 8
              }}
            >
              ログイン
              <ArrowRight size={18} />
            </button>
          </form>
        ) : (
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
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={{ width: 20, height: 20 }} />
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
        )}

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
  );
}
