"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  Lock, AlertCircle, LogIn, Mail, KeyRound,
} from "lucide-react";
import { auth, db } from "@/lib/firebase/config";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  User,
} from "firebase/auth";
import {
  collection, getDocs, query, where, doc, getDoc,
} from "firebase/firestore";
import { DEV_ADMIN_ALLOWED_PATHS, DEV_STAFF_SESSION, isDevAuthBypassEnabled } from "@/lib/auth/dev-auth";

interface StaffUser {
  id: string;
  name: string;
  role: string;
  rank: string;
  email: string;
}

interface AdminAuthGuardProps {
  children: React.ReactNode;
  /** Callback to pass staff info up to the layout */
  onStaffLoaded?: (staff: StaffUser) => void;
  /** Callback to pass allowed paths for the current user's role */
  onPermissionsLoaded?: (allowedPaths: string[]) => void;
}

export default function AdminAuthGuard({
  children,
  onStaffLoaded,
  onPermissionsLoaded,
}: AdminAuthGuardProps) {
  const pathname = usePathname();
  const devAuthBypassEnabled = isDevAuthBypassEnabled();

  // Auth state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Staff lookup
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [staffChecked, setStaffChecked] = useState(false);

  // Permission check
  const [hasAccess, setHasAccess] = useState(false);
  const [permChecked, setPermChecked] = useState(false);

  // Login form
  const [loginMethod, setLoginMethod] = useState<"google" | "email">("google");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!devAuthBypassEnabled) return;
    const devStaff: StaffUser = { ...DEV_STAFF_SESSION };
    localStorage.setItem("staffSession", JSON.stringify(devStaff));
    window.dispatchEvent(new Event("staffLogin"));
    setFirebaseUser(null);
    setAuthChecked(true);
    setStaffUser(devStaff);
    setStaffChecked(true);
    onStaffLoaded?.(devStaff);
    onPermissionsLoaded?.(DEV_ADMIN_ALLOWED_PATHS);
    setHasAccess(true);
    setPermChecked(true);
  }, [devAuthBypassEnabled, onPermissionsLoaded, onStaffLoaded]);

  // 1. Listen to Firebase Auth
  useEffect(() => {
    if (devAuthBypassEnabled) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthChecked(true);
      if (!user) {
        setStaffUser(null);
        setStaffChecked(true);
        setPermChecked(true);
      }
    });
    return () => unsub();
  }, [devAuthBypassEnabled]);

  // 2. When user is logged in, find matching staff document
  useEffect(() => {
    if (devAuthBypassEnabled) return;
    if (!firebaseUser) return;

    const lookupStaff = async () => {
      try {
        const userEmail = firebaseUser.email;
        if (!userEmail) {
          setStaffUser(null);
          setStaffChecked(true);
          return;
        }

        const q = query(
          collection(db, "staff"),
          where("email", "==", userEmail),
          where("isActive", "==", true)
        );
        const snap = await getDocs(q);

        if (snap.empty) {
          setStaffUser(null);
          setStaffChecked(true);
          return;
        }

        const d = snap.docs[0];
        const data = d.data();
        const staff: StaffUser = {
          id: d.id,
          name: data.name,
          role: data.role,
          rank: data.rank || "レギュラー",
          email: data.email,
        };
        setStaffUser(staff);
        onStaffLoaded?.(staff);
      } catch (e) {
        console.error("Staff lookup failed:", e);
        setStaffUser(null);
      } finally {
        setStaffChecked(true);
      }
    };

    lookupStaff();
  }, [devAuthBypassEnabled, firebaseUser, onStaffLoaded]);

  // 3. Check permissions for current path
  useEffect(() => {
    if (devAuthBypassEnabled) return;
    if (!staffChecked || !staffUser) {
      if (staffChecked) setPermChecked(true);
      return;
    }

    const checkPermissions = async () => {
      try {
        // 管理者 always has full access
        if (staffUser.role === "管理者") {
          setHasAccess(true);
          // Report all admin paths as allowed
          const allPaths = [
            "/admin", "/admin/settings", "/admin/notifications",
            "/admin/sales", "/admin/staff-analytics", "/admin/money",
            "/admin/billing", "/admin/permissions",
          ];
          onPermissionsLoaded?.(allPaths);
          setPermChecked(true);
          return;
        }

        // 準管理者 → check Firestore permissions
        if (staffUser.role === "準管理者") {
          const permDoc = await getDoc(doc(db, "settings", "adminPermissions"));
          if (permDoc.exists()) {
            const pages = permDoc.data().pages as Record<string, string[]>;
            const allowedPaths = Object.entries(pages)
              .filter(([, roles]) => roles.includes("準管理者"))
              .map(([path]) => path);

            onPermissionsLoaded?.(allowedPaths);

            // Check if current pathname is allowed
            const isAllowed = allowedPaths.some(
              (p) => pathname === p || (p !== "/admin" && pathname.startsWith(p + "/"))
            );
            setHasAccess(isAllowed);
          } else {
            // No permissions doc → deny all by default
            onPermissionsLoaded?.([]);
            setHasAccess(false);
          }
          setPermChecked(true);
          return;
        }

        // 一般 → no admin access
        setHasAccess(false);
        onPermissionsLoaded?.([]);
        setPermChecked(true);
      } catch (e) {
        console.error("Permission check failed:", e);
        setHasAccess(false);
        setPermChecked(true);
      }
    };

    checkPermissions();
  }, [devAuthBypassEnabled, staffChecked, staffUser, pathname, onPermissionsLoaded]);

  // --- Login handlers ---
  const handleGoogleLogin = async () => {
    setLoading(true);
    setError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e: unknown) {
      console.error(e);
      setError("Googleログインに失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: unknown) {
      console.error(err);
      setError("メールアドレスまたはパスワードが間違っています。");
    } finally {
      setLoading(false);
    }
  };

  // --- Render: Loading ---
  if (!authChecked || (firebaseUser && !staffChecked) || (staffUser && !permChecked)) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f9fb", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", boxSizing: "border-box" }}>
        <div style={{ color: "#94a3b8", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, border: "3px solid #e2e8f0", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <p style={{ fontSize: 14, fontWeight: 600 }}>認証を確認中…</p>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // --- Render: Not logged in → Login screen ---
  if (!firebaseUser && !devAuthBypassEnabled) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f9fb", padding: 20, paddingTop: "max(20px, env(safe-area-inset-top))", paddingBottom: "max(20px, env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
        <div style={{
          background: "#fff", borderRadius: 24, padding: "40px 28px", width: "100%", maxWidth: 400,
          boxShadow: "0 20px 40px rgba(0,0,0,0.06)",
        }}>
          {/* Header */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16,
            }}>
              <Lock size={28} color="#fff" />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>管理画面</h1>
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

          {/* Google login */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
              width: "100%", padding: "14px", borderRadius: 12,
              background: "#fff", color: "#334155",
              border: "2px solid #e2e8f0", fontSize: 15, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.2s", opacity: loading ? 0.7 : 1,
            }}
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={{ width: 20, height: 20 }} />
            Google でログイン
          </button>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "20px 0" }}>
            <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
            <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600 }}>または</span>
            <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
          </div>

          {/* Email login */}
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
                  fontSize: 15, outline: "none", transition: "border-color 0.2s",
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
                  fontSize: 15, outline: "none", transition: "border-color 0.2s",
                }}
                onFocus={(e) => e.target.style.borderColor = "#6366f1"}
                onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email || !password}
              style={{
                width: "100%", padding: "14px", borderRadius: 12, border: "none",
                background: (loading || !email || !password) ? "#c7d2fe" : "#6366f1",
                color: "#fff", fontSize: 15, fontWeight: 800,
                cursor: (loading || !email || !password) ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                marginTop: 4, transition: "background 0.2s",
              }}
            >
              {loading ? (
                <><div style={{ width: 18, height: 18, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} /> 確認中…</>
              ) : (
                <><LogIn size={18} /> メールでログイン</>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- Render: Logged in but no staff record / wrong role ---
  if (!staffUser || !["管理者", "準管理者"].includes(staffUser.role)) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f9fb", padding: 20, paddingTop: "max(20px, env(safe-area-inset-top))", paddingBottom: "max(20px, env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
        <div style={{
          background: "#fff", borderRadius: 24, padding: "40px 28px", width: "100%", maxWidth: 400,
          boxShadow: "0 20px 40px rgba(0,0,0,0.06)", textAlign: "center",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: "#fef2f2",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
          }}>
            <AlertCircle size={28} color="#ef4444" />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>アクセス権限がありません</h2>
          <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, marginBottom: 24 }}>
            {!staffUser
              ? "このメールアドレスはスタッフとして登録されていません。"
              : "管理画面へのアクセスには「管理者」または「準管理者」権限が必要です。"}
          </p>
          <button
            onClick={() => auth.signOut()}
            style={{
              padding: "12px 24px", borderRadius: 12, border: "1px solid #e2e8f0",
              background: "#fff", color: "#64748b", fontSize: 14, fontWeight: 700,
              cursor: "pointer",
            }}
          >
            別のアカウントでログイン
          </button>
        </div>
      </div>
    );
  }

  // --- Render: Logged in but no permission for this page ---
  if (!hasAccess) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f9fb", padding: 20, paddingTop: "max(20px, env(safe-area-inset-top))", paddingBottom: "max(20px, env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
        <div style={{
          background: "#fff", borderRadius: 24, padding: "40px 28px", width: "100%", maxWidth: 400,
          boxShadow: "0 20px 40px rgba(0,0,0,0.06)", textAlign: "center",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: "#fffbeb",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
          }}>
            <Lock size={28} color="#f59e0b" />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>このページへのアクセス権がありません</h2>
          <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, marginBottom: 24 }}>
            このページには「準管理者」のアクセスが許可されていません。<br />
            管理者にお問い合わせください。
          </p>
          <button
            onClick={() => window.history.back()}
            style={{
              padding: "12px 24px", borderRadius: 12, border: "none",
              background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 700,
              cursor: "pointer",
            }}
          >
            戻る
          </button>
        </div>
      </div>
    );
  }

  // --- Render: Authorized ---
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
