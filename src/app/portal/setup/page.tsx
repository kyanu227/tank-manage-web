"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase/config";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { Building2, MessageSquare, ArrowRight, CheckCircle2, UserRound } from "lucide-react";
import {
  ensureCustomerUser,
  normalizeCustomerUser,
  needsCustomerUserSetup,
  saveCustomerPortalSession,
  type CustomerUserDoc,
} from "@/lib/firebase/customer-user";
import { completeCustomerUserSetup } from "@/lib/firebase/portal-profile-service";

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [customerUser, setCustomerUser] = useState<CustomerUserDoc | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [selfName, setSelfName] = useState("");
  const [lineName, setLineName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/portal/register");
        return;
      }

      try {
        setUserUid(user.uid);
        const data = await ensureCustomerUser(user);
        if (data.status === "disabled") {
          await signOut(auth);
          localStorage.removeItem("customerSession");
          router.push("/portal/login");
          return;
        }

        setCustomerUser(data);
        setCompanyName(data.selfCompanyName);
        setSelfName(data.selfName || user.displayName || "");
        setLineName(data.lineName || "");

        if (!needsCustomerUserSetup(data)) {
          saveCustomerPortalSession(data);
          router.push("/portal");
          return;
        }
      } catch (err) {
        console.error(err);
        setError("アカウント情報の読み込みに失敗しました。");
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);

  const handleSaveSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userUid) return;

    const trimmedCompanyName = companyName.trim();
    const trimmedSelfName = selfName.trim();
    if (!trimmedCompanyName || !trimmedSelfName) {
      setError("会社名・店舗名とお名前を入力してください。");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const profile = await completeCustomerUserSetup({
        uid: userUid,
        selfCompanyName: trimmedCompanyName,
        selfName: trimmedSelfName,
        lineName: lineName.trim(),
      });

      saveCustomerPortalSession(normalizeCustomerUser({
        ...(customerUser ?? {}),
        uid: userUid,
        ...profile,
      }));

      router.push("/portal");
    } catch (err) {
      console.error(err);
      setError("プロフィールの保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

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
            background: "#ecfdf5", borderRadius: "50%",
            marginBottom: 16,
          }}>
            <CheckCircle2 size={32} color="#10b981" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1e293b", margin: 0 }}>
            登録が完了しました
          </h1>
          <p style={{ color: "#64748b", margin: "8px 0 0 0", fontSize: 14 }}>
            顧客確認のため、会社名とお名前を入力してください。
          </p>
        </div>

        {error && (
          <div style={{
            background: "#fef2f2", color: "#dc2626",
            padding: "12px 16px", borderRadius: 12,
            fontSize: 14, fontWeight: 500, border: "1px solid #fecaca",
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSaveSetup} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
              会社名・店舗名 <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <div style={{ position: "relative" }}>
              <Building2 size={18} color="#94a3b8" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }} />
              <input
                type="text"
                placeholder="例: 株式会社マリン"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                style={{
                  width: "100%", padding: "14px 16px 14px 44px",
                  borderRadius: 12, border: "2px solid #e2e8f0",
                  fontSize: 16, outline: "none", transition: "border-color 0.2s",
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
              お名前 <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <div style={{ position: "relative" }}>
              <UserRound size={18} color="#94a3b8" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }} />
              <input
                type="text"
                placeholder="例: 山田 太郎"
                value={selfName}
                onChange={(e) => setSelfName(e.target.value)}
                required
                style={{
                  width: "100%", padding: "14px 16px 14px 44px",
                  borderRadius: 12, border: "2px solid #e2e8f0",
                  fontSize: 16, outline: "none", transition: "border-color 0.2s",
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
              LINE登録名 (任意)
            </label>
            <div style={{ position: "relative" }}>
              <MessageSquare size={18} color="#94a3b8" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }} />
              <input
                type="text"
                placeholder="LINEでお使いの名前"
                value={lineName}
                onChange={(e) => setLineName(e.target.value)}
                style={{
                  width: "100%", padding: "14px 16px 14px 44px",
                  borderRadius: 12, border: "2px solid #e2e8f0",
                  fontSize: 16, outline: "none", transition: "border-color 0.2s",
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving || !companyName.trim() || !selfName.trim()}
            style={{
              width: "100%", padding: "14px", borderRadius: 12,
              background: "#10b981", color: "#fff", border: "none",
              fontSize: 16, fontWeight: 700,
              cursor: (saving || !companyName.trim() || !selfName.trim()) ? "not-allowed" : "pointer",
              transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: (saving || !companyName.trim() || !selfName.trim()) ? 0.7 : 1,
              marginTop: 16,
            }}
          >
            設定を完了する
            <ArrowRight size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
