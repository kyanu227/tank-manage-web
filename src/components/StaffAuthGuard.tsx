"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Lock, CheckCircle2, AlertCircle, Mail, KeyRound, LogIn } from "lucide-react";
import { auth, db } from "@/lib/firebase/config";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  User,
} from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import StaffJoinRequestPanel from "@/components/StaffJoinRequestPanel";
import { DEV_STAFF_SESSION, isDevAuthBypassEnabled } from "@/lib/auth/dev-auth";
import { findActiveStaffByEmail } from "@/lib/firebase/staff-auth";
import {
  createOrUpdateOwnStaffJoinRequest,
  getStaffJoinRequestByUidReadOnly,
  type StaffJoinRequest,
} from "@/lib/firebase/staff-join-requests";
import { linkStaffUidByEmailAuth } from "@/lib/firebase/staff-uid-link-service";

type StaffRole = "一般" | "準管理者" | "管理者";

interface StaffAuthGuardProps {
  children: React.ReactNode;
  allowedRoles?: StaffRole[];
}

interface StaffUser {
  id: string;
  name: string;
  role: string;
  rank: string;
  email?: string;
}

export default function StaffAuthGuard({ children, allowedRoles }: StaffAuthGuardProps) {
  const devAuthBypassEnabled = isDevAuthBypassEnabled();
  // パスコードログインは request.auth に乗らないため通常は無効。
  // 一時復活が必要な場合のみ NEXT_PUBLIC_ENABLE_STAFF_PASSCODE_LOGIN=true を設定する。
  const passcodeLoginEnabled = process.env.NEXT_PUBLIC_ENABLE_STAFF_PASSCODE_LOGIN === "true";
  const staffJoinRequestsEnabled = process.env.NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS === "true";
  const authScreenRef = useRef<HTMLDivElement>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [joinRequestMode, setJoinRequestMode] = useState(false);
  const [joinRequest, setJoinRequest] = useState<StaffJoinRequest | null>(null);
  const [joinRequestLoading, setJoinRequestLoading] = useState(false);
  const [joinRequestError, setJoinRequestError] = useState("");
  const [joinRequestLookupFailed, setJoinRequestLookupFailed] = useState(false);

  // Login form state
  const [loginMethod, setLoginMethod] = useState<"passcode" | "email">("email");
  const [passcode, setPasscode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Firebase Auth state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [firebaseAuthChecked, setFirebaseAuthChecked] = useState(false);

  const resetViewportAfterInput = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();

    const resetScroll = () => {
      authScreenRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    resetScroll();
    requestAnimationFrame(resetScroll);
    window.setTimeout(resetScroll, 80);
    window.setTimeout(resetScroll, 250);
  }, []);

  const clearJoinRequestState = useCallback(() => {
    setJoinRequestMode(false);
    setJoinRequest(null);
    setJoinRequestError("");
    setJoinRequestLoading(false);
    setJoinRequestLookupFailed(false);
  }, []);

  const showJoinRequestPanel = useCallback(async (user: User) => {
    localStorage.removeItem("staffSession");
    setIsAuthenticated(false);
    setError("");
    setJoinRequestMode(true);
    setJoinRequest(null);
    setJoinRequestError("");
    setJoinRequestLookupFailed(false);
    setJoinRequestLoading(true);

    try {
      const request = await getStaffJoinRequestByUidReadOnly(user.uid);
      setJoinRequest(request);
      setJoinRequestLookupFailed(false);
    } catch (e) {
      console.error("Staff join request lookup failed:", e);
      setJoinRequestError("申請状況を確認できませんでした。時間をおいて再度お試しください。");
      setJoinRequestLookupFailed(true);
    } finally {
      setJoinRequestLoading(false);
    }
  }, []);

  // iOS: 入力でズレた viewport を遷移前後でリセットする。body/html はロックしない。
  useEffect(() => {
    resetViewportAfterInput();
  }, [isAuthenticated, resetViewportAfterInput]);

  useEffect(() => {
    if (!devAuthBypassEnabled) return;
    localStorage.setItem("staffSession", JSON.stringify(DEV_STAFF_SESSION));
    window.dispatchEvent(new Event("staffLogin"));
    setIsAuthenticated(true);
    setLoading(false);
  }, [devAuthBypassEnabled]);

  // Helper: look up staff by email, set session, authenticate
  const authenticateByEmail = useCallback(async (userEmail: string, user?: User) => {
    try {
      const profile = await findActiveStaffByEmail(userEmail);

      if (!profile) {
        localStorage.removeItem("staffSession");
        setIsAuthenticated(false);
        if (staffJoinRequestsEnabled && user) {
          await showJoinRequestPanel(user);
          return false;
        }
        clearJoinRequestState();
        setError("このメールアドレスはスタッフとして登録されていません。");
        return false;
      }

      if (allowedRoles && !allowedRoles.includes(profile.role as StaffRole)) {
        clearJoinRequestState();
        setError("このページにアクセスする権限がありません");
        localStorage.removeItem("staffSession");
        setIsAuthenticated(false);
        return false;
      }

      if (user?.uid && user.email) {
        await linkStaffUidByEmailAuth({
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified,
        });
      }

      const userSession: StaffUser = {
        id: profile.staffId,
        name: profile.name,
        role: profile.role,
        rank: profile.rank,
        email: profile.email,
      };

      clearJoinRequestState();
      localStorage.setItem("staffSession", JSON.stringify(userSession));
      window.dispatchEvent(new Event("staffLogin"));
      setIsAuthenticated(true);
      return true;
    } catch (e) {
      console.error("Email staff lookup failed:", e);
      clearJoinRequestState();
      setError("認証エラーが発生しました");
      localStorage.removeItem("staffSession");
      setIsAuthenticated(false);
      return false;
    }
  }, [allowedRoles, clearJoinRequestState, showJoinRequestPanel, staffJoinRequestsEnabled]);

  // 1. Check Firebase Auth (Google / Email already logged in)
  useEffect(() => {
    if (devAuthBypassEnabled) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setFirebaseAuthChecked(true);
      if (!user) {
        localStorage.removeItem("staffSession");
        setIsAuthenticated(false);
        clearJoinRequestState();
      }
    });
    return () => unsub();
  }, [clearJoinRequestState, devAuthBypassEnabled]);

  // 2. Firebase user exists → staff collection で有効スタッフか確認する。
  // localStorage staffSession だけでは認証済みにしない。
  useEffect(() => {
    if (devAuthBypassEnabled || !firebaseAuthChecked) return;

    if (firebaseUser?.email) {
      authenticateByEmail(firebaseUser.email, firebaseUser).then(() => {
        setLoading(false);
      });
      return;
    }

    if (staffJoinRequestsEnabled && firebaseUser) {
      showJoinRequestPanel(firebaseUser).then(() => {
        setLoading(false);
      });
      return;
    }

    localStorage.removeItem("staffSession");
    setIsAuthenticated(false);
    setLoading(false);
  }, [
    devAuthBypassEnabled,
    firebaseAuthChecked,
    firebaseUser,
    authenticateByEmail,
    showJoinRequestPanel,
    staffJoinRequestsEnabled,
  ]);

  // --- Passcode login handler (feature flag only) ---
  const handlePasscodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcodeLoginEnabled) {
      setError("パスコードログインは現在無効です。メールまたはGoogleでログインしてください。");
      localStorage.removeItem("staffSession");
      setIsAuthenticated(false);
      setLoading(false);
      return;
    }
    if (!passcode) return;

    resetViewportAfterInput();
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

      const doc = snap.docs[0];
      const data = doc.data();

      if (allowedRoles && !allowedRoles.includes(data.role as StaffRole)) {
        setError("このページにアクセスする権限がありません");
        setChecking(false);
        return;
      }

      const userSession: StaffUser = {
        id: doc.id,
        name: data.name,
        role: data.role,
        rank: data.rank || "レギュラー",
        email: data.email,
      };

      localStorage.setItem("staffSession", JSON.stringify(userSession));
      window.dispatchEvent(new Event("staffLogin"));
      setIsAuthenticated(true);
    } catch (e) {
      console.error("Login verify failed", e);
      setError("認証エラーが発生しました");
    } finally {
      setChecking(false);
    }
  };

  // --- Google login handler ---
  const handleGoogleLogin = async () => {
    resetViewportAfterInput();
    setChecking(true);
    setError("");
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      if (result.user.email) {
        await authenticateByEmail(result.user.email, result.user);
      } else if (staffJoinRequestsEnabled) {
        await showJoinRequestPanel(result.user);
      } else {
        setError("Googleアカウントにメールアドレスがありません。");
      }
    } catch (e: unknown) {
      console.error(e);
      setError("Googleログインに失敗しました。");
    } finally {
      setChecking(false);
    }
  };

  // --- Email/Password login handler ---
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    resetViewportAfterInput();
    setChecking(true);
    setError("");
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      if (result.user.email) {
        await authenticateByEmail(result.user.email, result.user);
      } else if (staffJoinRequestsEnabled) {
        await showJoinRequestPanel(result.user);
      }
    } catch (err: unknown) {
      console.error(err);
      setError("メールアドレスまたはパスワードが間違っています。");
    } finally {
      setChecking(false);
    }
  };

  const handleJoinRequestSubmit = async (input: { requestedName: string; message: string }) => {
    if (!firebaseUser) return;
    if (!firebaseUser.email) {
      setJoinRequestError("申請には Firebase Auth のメールアドレスが必要です。");
      return;
    }

    setJoinRequestLoading(true);
    setJoinRequestError("");
    try {
      await createOrUpdateOwnStaffJoinRequest({
        uid: firebaseUser.uid,
        authEmail: firebaseUser.email,
        authDisplayName: firebaseUser.displayName,
        requestedName: input.requestedName,
        message: input.message,
      });
      const request = await getStaffJoinRequestByUidReadOnly(firebaseUser.uid);
      setJoinRequest(request);
    } catch (e) {
      console.error("Staff join request save failed:", e);
      setJoinRequestError("申請を保存できませんでした。時間をおいて再度お試しください。");
    } finally {
      setJoinRequestLoading(false);
    }
  };

  const handleJoinRequestSignOut = async () => {
    try {
      await signOut(auth);
    } finally {
      localStorage.removeItem("staffSession");
      setIsAuthenticated(false);
      setFirebaseUser(null);
      clearJoinRequestState();
      setError("");
      setLoading(false);
    }
  };

  // --- Render: Loading ---
  if (loading) {
    return (
      <div style={{ width: "100%", height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "#f8f9fb" }}>
        <div aria-hidden="true" style={{ height: "env(safe-area-inset-top, 0px)", flexShrink: 0, background: "#f8f9fb" }} />
        <div ref={authScreenRef} style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, boxSizing: "border-box" }}>
          <div style={{ color: "#94a3b8", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, border: "3px solid #e2e8f0", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
            <p style={{ fontSize: 14, fontWeight: 600 }}>認証を確認中…</p>
          </div>
        </div>
        <div aria-hidden="true" style={{ height: "env(safe-area-inset-bottom, 0px)", flexShrink: 0, background: "#f8f9fb" }} />
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // --- Render: Authenticated ---
  if (isAuthenticated) {
    return (
      <>
        {devAuthBypassEnabled && (
          <div style={{ position: "fixed", right: 8, bottom: 8, zIndex: 9999, padding: "3px 7px", borderRadius: 999, background: "#0f172a", color: "#f8fafc", fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", opacity: 0.72, pointerEvents: "none" }}>
            DEV AUTH BYPASS
          </div>
        )}
        {children}
      </>
    );
  }

  if (staffJoinRequestsEnabled && joinRequestMode && firebaseUser) {
    return (
      <div style={{ width: "100%", height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "#f8f9fb" }}>
        <div aria-hidden="true" style={{ height: "env(safe-area-inset-top, 0px)", flexShrink: 0, background: "#f8f9fb" }} />
        <div ref={authScreenRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", display: "flex", flexDirection: "column", padding: 20, boxSizing: "border-box" }}>
          <StaffJoinRequestPanel
            firebaseUser={firebaseUser}
            existingRequest={joinRequest}
            loading={joinRequestLoading}
            lookupFailed={joinRequestLookupFailed}
            error={joinRequestError}
            onSubmit={handleJoinRequestSubmit}
            onSignOut={handleJoinRequestSignOut}
          />
        </div>
        <div aria-hidden="true" style={{ height: "env(safe-area-inset-bottom, 0px)", flexShrink: 0, background: "#f8f9fb" }} />
      </div>
    );
  }

  // --- Render: Login form ---
  return (
    <div style={{ width: "100%", height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "#f8f9fb" }}>
      <div aria-hidden="true" style={{ height: "env(safe-area-inset-top, 0px)", flexShrink: 0, background: "#f8f9fb" }} />
      <div ref={authScreenRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", display: "flex", flexDirection: "column", padding: 20, boxSizing: "border-box" }}>
        <div style={{
          background: "#fff", borderRadius: 24, padding: "32px 24px", width: "100%", maxWidth: 380,
          boxShadow: "0 20px 40px rgba(0,0,0,0.06)", margin: "auto",
        }}>
        {/* Header */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16,
          }}>
            <Lock size={28} color="#fff" />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>スタッフ用</h1>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>ログインしてください</p>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12,
            padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10,
          }}>
            <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
            <p style={{ fontSize: 13, fontWeight: 600, color: "#991b1b" }}>{error}</p>
          </div>
        )}

        {/* Google login button */}
        <button
          onClick={handleGoogleLogin}
          disabled={checking}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
            width: "100%", padding: "13px", borderRadius: 12,
            background: "#fff", color: "#334155",
            border: "2px solid #e2e8f0", fontSize: 15, fontWeight: 700,
            cursor: checking ? "not-allowed" : "pointer",
            transition: "all 0.2s", opacity: checking ? 0.7 : 1,
          }}
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={{ width: 20, height: 20 }} />
          Google でログイン
        </button>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "18px 0" }}>
          <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
          <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>または</span>
          <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
        </div>

        {/* Method toggle: Passcode / Email */}
        {passcodeLoginEnabled && (
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 10, padding: 3, marginBottom: 16 }}>
            <button
              onClick={() => { setLoginMethod("passcode"); setError(""); }}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 700,
                background: loginMethod === "passcode" ? "#fff" : "transparent",
                color: loginMethod === "passcode" ? "#6366f1" : "#94a3b8",
                boxShadow: loginMethod === "passcode" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                cursor: "pointer", transition: "all 0.2s",
              }}
            >
              パスコード
            </button>
            <button
              onClick={() => { setLoginMethod("email"); setError(""); }}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 700,
                background: loginMethod === "email" ? "#fff" : "transparent",
                color: loginMethod === "email" ? "#6366f1" : "#94a3b8",
                boxShadow: loginMethod === "email" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                cursor: "pointer", transition: "all 0.2s",
              }}
            >
              メール
            </button>
          </div>
        )}

        {passcodeLoginEnabled && loginMethod === "passcode" ? (
          /* Passcode form (existing) */
          <form onSubmit={handlePasscodeLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="••••"
              style={{
                width: "100%", padding: "14px", fontSize: 24, fontWeight: 700,
                border: "2px solid #e2e8f0", borderRadius: 12, outline: "none", color: "#0f172a",
                textAlign: "center", letterSpacing: "0.2em", transition: "border-color 0.2s",
              }}
              onFocus={(e) => e.target.style.borderColor = "#6366f1"}
              onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
            />
            <button
              type="submit"
              disabled={checking || !passcode}
              style={{
                width: "100%", padding: "14px", borderRadius: 12, border: "none",
                background: (checking || !passcode) ? "#c7d2fe" : "#6366f1",
                color: "#fff", fontSize: 15, fontWeight: 800,
                cursor: (checking || !passcode) ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                marginTop: 4, transition: "background 0.2s",
              }}
            >
              {checking ? (
                <><div style={{ width: 18, height: 18, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} /> 確認中…</>
              ) : (
                <><CheckCircle2 size={18} /> ログイン</>
              )}
            </button>
          </form>
        ) : (
          /* Email/Password form */
          <form onSubmit={handleEmailLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ position: "relative" }}>
              <Mail size={18} color="#94a3b8" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
              <input
                type="email"
                placeholder="メールアドレス"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: "100%", padding: "12px 12px 12px 42px",
                  borderRadius: 12, border: "2px solid #e2e8f0",
                  fontSize: 16, outline: "none", transition: "border-color 0.2s",
                }}
                onFocus={(e) => e.target.style.borderColor = "#6366f1"}
                onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
              />
            </div>
            <div style={{ position: "relative" }}>
              <KeyRound size={18} color="#94a3b8" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
              <input
                type="password"
                placeholder="パスワード"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: "100%", padding: "12px 12px 12px 42px",
                  borderRadius: 12, border: "2px solid #e2e8f0",
                  fontSize: 16, outline: "none", transition: "border-color 0.2s",
                }}
                onFocus={(e) => e.target.style.borderColor = "#6366f1"}
                onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
              />
            </div>
            <button
              type="submit"
              disabled={checking || !email || !password}
              style={{
                width: "100%", padding: "14px", borderRadius: 12, border: "none",
                background: (checking || !email || !password) ? "#c7d2fe" : "#6366f1",
                color: "#fff", fontSize: 15, fontWeight: 800,
                cursor: (checking || !email || !password) ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                marginTop: 4, transition: "background 0.2s",
              }}
            >
              {checking ? (
                <><div style={{ width: 18, height: 18, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} /> 確認中…</>
              ) : (
                <><LogIn size={18} /> メールでログイン</>
              )}
            </button>
          </form>
        )}
        </div>
      </div>
      <div aria-hidden="true" style={{ height: "env(safe-area-inset-bottom, 0px)", flexShrink: 0, background: "#f8f9fb" }} />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
