"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { AlertCircle, CheckCircle2, Clock3, LogOut, Send, UserPlus } from "lucide-react";
import type { StaffJoinRequest } from "@/lib/firebase/staff-join-requests";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import type { LocalizedText } from "@/lib/staff-display";

interface StaffJoinRequestPanelProps {
  firebaseUser: User;
  existingRequest?: StaffJoinRequest | null;
  loading?: boolean;
  lookupFailed?: boolean;
  error?: string;
  locale?: Locale;
  onSubmit: (input: { requestedName: string; message: string }) => Promise<void>;
  onSignOut?: () => Promise<void> | void;
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: "2px solid #e2e8f0",
  fontSize: 15,
  outline: "none",
  transition: "border-color 0.2s",
  color: "#0f172a",
  background: "#fff",
  boxSizing: "border-box",
};

const noticeStyle: CSSProperties = {
  borderRadius: 14,
  padding: "14px 16px",
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
};

const JOIN_TEXT = {
  approved: { ja: "申請は承認済みです", en: "Your request has been approved" },
  approvedHelp: {
    ja: "再ログインしても利用できない場合は、管理者に確認してください。",
    en: "If access is still unavailable after signing in again, contact an administrator.",
  },
  rejected: { ja: "申請は却下されています", en: "Your request was rejected" },
  rejectedHelp: { ja: "詳細は管理者に確認してください。", en: "Contact an administrator for details." },
  pending: { ja: "承認待ちです", en: "Awaiting approval" },
  pendingHelp: {
    ja: "管理者が申請を確認するまで、スタッフ画面は利用できません。",
    en: "The staff portal is unavailable until an administrator reviews your request.",
  },
  heading: { ja: "スタッフ利用申請", en: "Request staff access" },
  introduction: {
    ja: "このアカウントはまだスタッフとして登録されていません。",
    en: "This account is not registered as a staff account yet.",
  },
  authAccount: { ja: "Firebase Auth アカウント", en: "Firebase Auth account" },
  emailUnavailable: { ja: "メールアドレスが取得できません", en: "Email address unavailable" },
  checking: { ja: "申請状況を確認中…", en: "Checking request status…" },
  lookupBlocked: { ja: "申請を送信できません", en: "The request cannot be submitted" },
  lookupBlockedHelp: {
    ja: "申請状況を確認できないため、申請を送信できません。時間をおいて再度お試しください。",
    en: "The request status could not be checked. Please try again later.",
  },
  cannotApply: { ja: "申請できません", en: "The request cannot be submitted" },
  emailRequired: {
    ja: "Firebase Auth のメールアドレスが必要です。別のログイン方法を試してください。",
    en: "A Firebase Auth email address is required. Try another sign-in method.",
  },
  applicantName: { ja: "申請者名", en: "Applicant name" },
  applicantExample: { ja: "例: 山田 太郎", en: "e.g. Taro Yamada" },
  messageOptional: { ja: "メッセージ 任意", en: "Message (optional)" },
  messagePlaceholder: {
    ja: "所属や補足があれば入力してください",
    en: "Enter your team or any additional information",
  },
  saving: { ja: "保存中…", en: "Saving…" },
  submit: { ja: "申請する", en: "Submit request" },
  anotherAccount: { ja: "別アカウントでログイン", en: "Sign in with another account" },
} satisfies Record<string, LocalizedText>;

export default function StaffJoinRequestPanel({
  firebaseUser,
  existingRequest,
  loading = false,
  lookupFailed = false,
  error = "",
  locale = DEFAULT_LOCALE,
  onSubmit,
  onSignOut,
}: StaffJoinRequestPanelProps) {
  const [requestedName, setRequestedName] = useState(firebaseUser.displayName || "");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const authEmail = firebaseUser.email || "";
  const canSubmit = Boolean(authEmail) && requestedName.trim().length > 0 && !loading && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      await onSubmit({
        requestedName,
        message,
      });
      setMessage("");
    } finally {
      setSubmitting(false);
    }
  };

  const renderRequestStatus = () => {
    if (!existingRequest) return null;

    if (existingRequest.status === "approved") {
      return (
        <div role="status" style={{ ...noticeStyle, background: "#ecfdf5", border: "1px solid #bbf7d0" }}>
          <CheckCircle2 size={20} color="#16a34a" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#166534" }}>
              {JOIN_TEXT.approved[locale]}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.6, color: "#15803d" }}>
              {JOIN_TEXT.approvedHelp[locale]}
            </p>
          </div>
        </div>
      );
    }

    if (existingRequest.status === "rejected") {
      return (
        <div role="status" style={{ ...noticeStyle, background: "#fef2f2", border: "1px solid #fecaca" }}>
          <AlertCircle size={20} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#991b1b" }}>
              {JOIN_TEXT.rejected[locale]}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.6, color: "#b91c1c" }}>
              {JOIN_TEXT.rejectedHelp[locale]}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div role="status" style={{ ...noticeStyle, background: "#fffbeb", border: "1px solid #fde68a" }}>
        <Clock3 size={20} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#92400e" }}>
            {JOIN_TEXT.pending[locale]}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.6, color: "#a16207" }}>
            {JOIN_TEXT.pendingHelp[locale]}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      background: "#fff",
      borderRadius: 24,
      padding: "32px 24px",
      width: "100%",
      maxWidth: 420,
      boxShadow: "0 20px 40px rgba(0,0,0,0.06)",
      margin: "auto",
    }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}>
          <UserPlus size={28} color="#fff" />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", letterSpacing: 0, margin: 0 }}>
          {JOIN_TEXT.heading[locale]}
        </h1>
        <p style={{ fontSize: 13, color: "#94a3b8", margin: "6px 0 0", textAlign: "center", lineHeight: 1.6 }}>
          {JOIN_TEXT.introduction[locale]}
        </p>
      </div>

      <div style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", margin: "0 0 6px" }}>
          {JOIN_TEXT.authAccount[locale]}
        </p>
        <div style={{
          padding: "11px 12px",
          borderRadius: 12,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          color: authEmail ? "#334155" : "#dc2626",
          fontSize: 13,
          fontWeight: 700,
          wordBreak: "break-all",
        }}>
          {authEmail || JOIN_TEXT.emailUnavailable[locale]}
        </div>
      </div>

      {error && (
        <div role="alert" style={{ ...noticeStyle, background: "#fef2f2", border: "1px solid #fecaca", marginBottom: 16 }}>
          <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#991b1b", lineHeight: 1.6 }}>
            {error}
          </p>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#94a3b8", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "22px 0" }}>
          <div style={{ width: 26, height: 26, border: "3px solid #e2e8f0", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <p role="status" style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{JOIN_TEXT.checking[locale]}</p>
        </div>
      ) : lookupFailed ? (
        <div role="alert" style={{ ...noticeStyle, background: "#fef2f2", border: "1px solid #fecaca" }}>
          <AlertCircle size={20} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#991b1b" }}>
              {JOIN_TEXT.lookupBlocked[locale]}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.6, color: "#b91c1c" }}>
              {JOIN_TEXT.lookupBlockedHelp[locale]}
            </p>
          </div>
        </div>
      ) : existingRequest ? (
        renderRequestStatus()
      ) : !authEmail ? (
        <div role="alert" style={{ ...noticeStyle, background: "#fef2f2", border: "1px solid #fecaca" }}>
          <AlertCircle size={20} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#991b1b" }}>
              {JOIN_TEXT.cannotApply[locale]}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.6, color: "#b91c1c" }}>
              {JOIN_TEXT.emailRequired[locale]}
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>{JOIN_TEXT.applicantName[locale]}</span>
            <input
              value={requestedName}
              onChange={(e) => setRequestedName(e.target.value)}
              placeholder={JOIN_TEXT.applicantExample[locale]}
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = "#6366f1"}
              onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>{JOIN_TEXT.messageOptional[locale]}</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={JOIN_TEXT.messagePlaceholder[locale]}
              rows={4}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
              onFocus={(e) => e.target.style.borderColor = "#6366f1"}
              onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
            />
          </label>
          <button
            type="submit"
            disabled={!canSubmit}
            aria-busy={submitting}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: 12,
              border: "none",
              background: canSubmit ? "#6366f1" : "#c7d2fe",
              color: "#fff",
              fontSize: 15,
              fontWeight: 800,
              cursor: canSubmit ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 4,
              transition: "background 0.2s",
            }}
          >
            {submitting ? (
              <><div style={{ width: 18, height: 18, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} /> {JOIN_TEXT.saving[locale]}</>
            ) : (
              <><Send size={18} /> {JOIN_TEXT.submit[locale]}</>
            )}
          </button>
        </form>
      )}

      {onSignOut && (
        <button
          type="button"
          onClick={() => onSignOut()}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "12px",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            background: "#fff",
            color: "#64748b",
            fontSize: 13,
            fontWeight: 800,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <LogOut size={16} /> {JOIN_TEXT.anotherAccount[locale]}
        </button>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
