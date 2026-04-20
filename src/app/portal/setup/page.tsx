"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase/config";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { Building2, MessageSquare, ArrowRight, CheckCircle2 } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [passcode, setPasscode] = useState("");
  
  const [companyName, setCompanyName] = useState("");
  const [lineName, setLineName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setUserUid(user.uid);
        // Fetch generated passcode to display it
        const docRef = doc(db, "customers", user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.setupCompleted) {
            router.push("/portal"); // Already setup
            return;
          }
          if (data.passcode) {
            setPasscode(data.passcode);
          }
        }
      } else {
        router.push("/portal/register"); // Not logged in
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);

  const handleSaveSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userUid) return;
    
    setSaving(true);
    setError("");

    try {
      const userRef = doc(db, "customers", userUid);
      await updateDoc(userRef, {
        companyName,
        lineName,
        setupCompleted: true
      });
      
      if (typeof window !== 'undefined') {
        localStorage.setItem("customerSession", JSON.stringify({
          uid: userUid,
          name: companyName
        }));
      }
      
      router.push("/portal");
    } catch (err: any) {
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
      padding: 20
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
            background: "#ecfdf5", borderRadius: "50%", 
            marginBottom: 16 
          }}>
            <CheckCircle2 size={32} color="#10b981" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1e293b", margin: 0 }}>
            登録が完了しました！
          </h1>
          <p style={{ color: "#64748b", margin: "8px 0 0 0", fontSize: 14 }}>
            最後に、ご利用のための初期設定をお願いします。
          </p>
        </div>

        {passcode && (
          <div style={{ 
            background: "#eff6ff", border: "2px dashed #93c5fd", 
            borderRadius: 16, padding: "20px", textAlign: "center" 
          }}>
            <p style={{ color: "#3b82f6", fontSize: 13, fontWeight: 700, margin: "0 0 8px 0" }}>
              あなたの簡単ログイン用パスコード
            </p>
            <div style={{ fontSize: 36, letterSpacing: 8, fontWeight: 900, color: "#1e3a8a", fontFamily: "monospace" }}>
              {passcode}
            </div>
            <p style={{ color: "#64748b", fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              ※ 次回から、この4桁の数字でもログイン可能です。メモしておいてください。
            </p>
          </div>
        )}

        {error && (
          <div style={{ 
            background: "#fef2f2", color: "#dc2626", 
            padding: "12px 16px", borderRadius: 12, 
            fontSize: 14, fontWeight: 500, border: "1px solid #fecaca"
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSaveSetup} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          
          <div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
              会社名・店舗名 (請求先) <span style={{ color: "#ef4444" }}>*</span>
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
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 6, marginBottom: 0 }}>
              ※ LINEからお問い合わせいただく際、照合しやすくなります。
            </p>
          </div>

          <button
            type="submit"
            disabled={saving || !companyName}
            style={{
              width: "100%", padding: "14px", borderRadius: 12,
              background: "#10b981", color: "#fff", border: "none",
              fontSize: 16, fontWeight: 700, cursor: (saving || !companyName) ? "not-allowed" : "pointer",
              transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: (saving || !companyName) ? 0.7 : 1,
              marginTop: 16
            }}
          >
            設定を完了して初める
            <ArrowRight size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
