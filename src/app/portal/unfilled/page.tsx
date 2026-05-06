"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Send, CheckCircle2, AlertCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import PrefixNumberPicker from "@/components/PrefixNumberPicker";
import { createPortalUnfilledReports } from "@/lib/firebase/portal-transaction-service";
import { tanksRepository } from "@/lib/firebase/repositories";
import { getPortalIdentityFromStorage, isLinkedPortalIdentity, type PortalIdentity } from "@/lib/portal";
import { STATUS } from "@/lib/tank-rules";

interface TankItem {
  id: string;
  tankId: string;
}

export default function UnfilledReportPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [tanks, setTanks] = useState<TankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<PortalIdentity | null>(null);

  const [lentTanks, setLentTanks] = useState<string[]>([]);
  const [selectedTankId, setSelectedTankId] = useState<string | null>(null);

  useEffect(() => {
    const fetchLentTanks = async () => {
      try {
        const currentIdentity = getPortalIdentityFromStorage();
        setIdentity(currentIdentity);
        if (!isLinkedPortalIdentity(currentIdentity)) {
          setLentTanks([]);
          return;
        }

        const tankDocs = await tanksRepository.getTanks({ location: currentIdentity.customerName, status: STATUS.LENT });
        const tankIds: string[] = tankDocs.map((t) => t.id);
        setLentTanks(tankIds);
      } catch (e) {
        console.error("Failed to fetch lent tanks:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchLentTanks();
  }, []);

  const reportableTankIds = lentTanks.filter(
    (tankId) => !tanks.some((tank) => tank.tankId === tankId),
  );

  const handleTankSelect = (tankId: string) => {
    if (!lentTanks.includes(tankId)) {
      alert(`${tankId}は現在貸出中ではありません。`);
      setSelectedTankId(null);
      return;
    }

    if (tanks.some((tank) => tank.tankId === tankId)) {
      alert("すでに追加されています。");
      setSelectedTankId(null);
      return;
    }

    setTanks((prev) => [...prev, { id: Date.now().toString(), tankId }]);
    setSelectedTankId(null);
  };

  const removeTank = (id: string) => {
    setTanks((prev) => prev.filter((t) => t.id !== id));
  };

  const submitReport = async () => {
    if (tanks.length === 0) return;
    if (!isLinkedPortalIdentity(identity)) {
      alert("未充填報告は顧客情報の紐付け後に利用できます。");
      return;
    }
    setIsSubmitting(true);
    try {
      await createPortalUnfilledReports({
        identity,
        tankIds: tanks.map((tank) => tank.tankId),
        source: "customer_app",
      });
      setIsSuccess(true);
    } catch (err) {
      console.error(err);
      alert("送信に失敗しました。再度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLinked = isLinkedPortalIdentity(identity);

  if (isSuccess) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#f8fafc",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 24px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "#f1f5f9",
            border: "1.5px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
          }}
        >
          <CheckCircle2 size={38} color="#0f172a" />
        </div>
        <h2
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: "#0f172a",
            letterSpacing: "-0.02em",
            marginBottom: 8,
          }}
        >
          報告完了
        </h2>
        <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 40 }}>
          ご報告ありがとうございます。内容を受け付けました。
        </p>
        <button
          onClick={() => router.push("/portal")}
          style={{
            width: "100%",
            padding: "16px 0",
            borderRadius: 16,
            background: "#0f172a",
            border: "none",
            color: "#fff",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          トップへ戻る
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "#f8fafc",
        overflow: "hidden",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          padding: "44px 20px 16px",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => router.push("/portal")}
          style={{
            width: 40,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#64748b",
            background: "none",
            border: "none",
            cursor: "pointer",
            marginRight: 4,
          }}
        >
          <ArrowLeft size={22} />
        </button>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "#0f172a",
            letterSpacing: "-0.02em",
            flex: 1,
          }}
        >
          未充填タンク報告
        </h1>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 20px",
          paddingBottom: tanks.length > 0 ? 100 : 40,
        }}
      >
        <div style={{ marginBottom: 24, textAlign: "center" }}>
           <p style={{ color: "#ef4444", fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
             ご不便をおかけして申し訳ありません。
           </p>
           <p style={{ color: "#64748b", fontSize: 13, fontWeight: 500 }}>
             お届けしたタンクが未充填だった場合、こちらからご報告ください。<br/>
             <span style={{ fontSize: 11, color: "#94a3b8" }}>※現在お客様に貸出中のタンクのみ報告可能です</span>
           </p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", paddingTop: 40 }}>
            <span
              style={{
                width: 24,
                height: 24,
                border: "2px solid #e2e8f0",
                borderTopColor: "#94a3b8",
                borderRadius: "50%",
                display: "inline-block",
                animation: "spin 0.7s linear infinite",
              }}
            />
          </div>
        ) : !isLinked ? (
          <div style={{ textAlign: "center", paddingTop: 20 }}>
            <div
              style={{
                background: "#fff",
                border: "1.5px solid #e2e8f0",
                borderRadius: 20,
                padding: "32px 24px",
                textAlign: "center",
                marginBottom: 16,
              }}
            >
              <AlertCircle size={32} color="#f59e0b" style={{ marginBottom: 12 }} />
              <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>
                会社情報の確認後に利用できます
              </p>
              <p style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: 0 }}>
                未充填報告は顧客情報の紐付け後に利用できます。
              </p>
            </div>
          </div>
        ) : lentTanks.length === 0 ? (
          <div style={{ textAlign: "center", paddingTop: 20 }}>
            <div
              style={{
                background: "#fff",
                border: "1.5px solid #e2e8f0",
                borderRadius: 20,
                padding: "32px 24px",
                textAlign: "center",
                marginBottom: 16,
              }}
            >
              <p style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>
                貸出中のタンクがありません
              </p>
              <p style={{ fontSize: 13, color: "#cbd5e1", fontWeight: 500 }}>
                報告できる未充填タンクはありません
              </p>
            </div>
          </div>
        ) : reportableTankIds.length === 0 ? (
          <div style={{
            background: "#fff",
            border: "1.5px solid #e2e8f0",
            borderRadius: 20,
            padding: "32px 20px",
            textAlign: "center",
            marginBottom: 20,
          }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>
              貸出中タンクはすべて報告リストに追加済みです
            </p>
            <p style={{ fontSize: 13, color: "#cbd5e1", fontWeight: 500 }}>
              リストから削除すると再選択できます
            </p>
          </div>
        ) : (
          <div style={{
            background: "#fff",
            border: "1.5px solid #e2e8f0",
            borderRadius: 20,
            padding: "20px",
            marginBottom: 20,
          }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>
              未充填だった貸出中タンクを選択
            </p>
            <PrefixNumberPicker
              tankIds={reportableTankIds}
              value={selectedTankId}
              onChange={setSelectedTankId}
              onSelect={handleTankSelect}
              accentColor="#0f172a"
              emptyMessage="報告できる貸出中タンクがありません"
            />
          </div>
        )}

        {/* Selected List */}
        {isLinked && tanks.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#94a3b8", marginBottom: 10, paddingLeft: 2 }}>
              報告リスト ({tanks.length}件)
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tanks.map((tank) => (
                <div
                  key={tank.id}
                  style={{
                    background: "#fef2f2",
                    border: "1.5px solid #fecaca",
                    borderRadius: 16,
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      fontFamily: "monospace",
                      letterSpacing: "0.04em",
                      color: "#991b1b",
                    }}
                  >
                    {tank.tankId}
                  </span>
                  <button
                    onClick={() => removeTank(tank.id)}
                    style={{
                      width: 28,
                      height: 28,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#f87171",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {isLinked && tanks.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "rgba(248,250,252,0.92)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderTop: "1px solid #e2e8f0",
            padding: "12px 20px",
            paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <button
            onClick={submitReport}
            disabled={isSubmitting}
            style={{
              width: "100%",
              padding: "16px 0",
              borderRadius: 16,
              border: "none",
              background: isSubmitting ? "#fca5a5" : "#ef4444",
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
              cursor: isSubmitting ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {isSubmitting ? (
              <span
                style={{
                  width: 18,
                  height: 18,
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spin 0.7s linear infinite",
                }}
              />
            ) : (
              <>
                <Send size={17} />
                報告を送信する
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
