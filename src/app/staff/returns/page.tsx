"use client";

import { useState, useEffect } from "react";
import {
  ArrowLeft, Loader2, CheckCircle2, Users, ChevronDown,
} from "lucide-react";
import { db } from "@/lib/firebase/config";
import {
  collection, query, where, getDocs,
} from "firebase/firestore";
import { STATUS, RETURN_TAG, resolveReturnAction, type ReturnTag } from "@/lib/tank-rules";
import { applyBulkTankOperations } from "@/lib/tank-operation";

type Condition = "normal" | "unused" | "uncharged";

interface TankItem {
  id: string;
  condition: Condition;
}
interface CustomerInfo {
  id: string;
  name: string;
}

/* Toggle tags — no "通常" chip; click to toggle ON/OFF */
const TOGGLE_TAGS: { val: Condition; label: string; color: string; bg: string }[] = [
  { val: "unused",    label: "未使用", color: "#10b981", bg: "#ecfdf5" },
  { val: "uncharged", label: "未充填", color: "#ef4444", bg: "#fef2f2" },
];

export default function StaffReturnsPage() {
  const [customers, setCustomers] = useState<CustomerInfo[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerInfo | null>(null);
  const [tanks, setTanks] = useState<TankItem[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingTanks, setLoadingTanks] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [returnedCount, setReturnedCount] = useState(0);

  useEffect(() => {
    const fetchCustomers = async () => {
      setLoadingCustomers(true);
      try {
        const snap = await getDocs(query(collection(db, "tanks"), where("status", "==", STATUS.LENT)));
        const locationSet = new Set<string>();
        snap.forEach((d) => {
          const loc = d.data().location;
          if (loc && loc !== "倉庫") locationSet.add(loc);
        });
        setCustomers(Array.from(locationSet).sort().map((name) => ({ id: name, name })));
      } catch (e) { console.error(e); }
      finally { setLoadingCustomers(false); }
    };
    fetchCustomers();
  }, []);

  const selectCustomer = async (customer: CustomerInfo) => {
    setSelectedCustomer(customer);
    setLoadingTanks(true);
    setDone(false);
    try {
      const snap = await getDocs(query(
        collection(db, "tanks"),
        where("location", "==", customer.name),
        where("status", "==", STATUS.LENT),
      ));
      const items: TankItem[] = [];
      snap.forEach((d) => items.push({ id: d.id, condition: "normal" }));
      items.sort((a, b) => a.id.localeCompare(b.id));
      setTanks(items);
    } catch (e) { console.error(e); }
    finally { setLoadingTanks(false); }
  };

  /* Toggle ON/OFF: if already active → set normal, else set to val */
  const toggleCondition = (tankId: string, val: Condition) => {
    setTanks((prev) =>
      prev.map((t) =>
        t.id === tankId
          ? { ...t, condition: t.condition === val ? "normal" : val }
          : t
      )
    );
  };

  const submitReturn = async () => {
    if (!selectedCustomer || tanks.length === 0) return;
    if (!confirm(`${selectedCustomer.name} のタンク ${tanks.length}本 を返却処理しますか？`)) return;
    setSubmitting(true);
    try {
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";
      const note = `[現場受付] 顧客: ${selectedCustomer.name}`;
      await applyBulkTankOperations(
        tanks.map((tank) => {
          const tag: ReturnTag =
            tank.condition === "unused" ? RETURN_TAG.UNUSED
              : tank.condition === "uncharged" ? RETURN_TAG.DEFECT
              : RETURN_TAG.NORMAL;
          return {
            tankId: tank.id,
            transitionAction: resolveReturnAction(tag, STATUS.LENT),
            currentStatus: STATUS.LENT,
            staff: staffName,
            location: "倉庫",
            logNote: note,
            tankNote: note,
          };
        })
      );
      setReturnedCount(tanks.length);
      setDone(true);
    } catch (e: any) { alert("エラー: " + e.message); }
    finally { setSubmitting(false); }
  };

  /* ── Done screen ── */
  if (done) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px", textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20, boxShadow: "0 8px 24px rgba(16,185,129,0.2)" }}>
          <CheckCircle2 size={36} color="#10b981" />
        </div>
        <p style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>返却処理完了</p>
        <p style={{ fontSize: 14, color: "#64748b", marginBottom: 32 }}>{selectedCustomer?.name} — {returnedCount}本を倉庫に戻しました</p>
        <button onClick={() => { setSelectedCustomer(null); setTanks([]); setDone(false); }}
          style={{ padding: "14px 36px", borderRadius: 16, border: "none", background: "#10b981", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
          別の顧客を処理する
        </button>
      </div>
    );
  }

  /* ── Tank list (customer selected) ── */
  if (selectedCustomer) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f8fafc" }}>
        <div style={{ padding: "14px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <button onClick={() => { setSelectedCustomer(null); setTanks([]); }}
            style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "#f1f5f9", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowLeft size={16} />
          </button>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0 }}>{selectedCustomer.name}</p>
            <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>貸出中: {loadingTanks ? "…" : `${tanks.length}本`}</p>
          </div>
        </div>

        {loadingTanks ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
            <Loader2 size={24} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
          </div>
        ) : tanks.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <p style={{ color: "#94a3b8", fontWeight: 600 }}>貸出中のタンクがありません</p>
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", paddingBottom: 100 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", marginBottom: 10 }}>
                特殊な状態のタンクのみタグを付けてください
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tanks.map((tank) => (
                  <div key={tank.id} style={{
                    background: "#fff",
                    border: `1.5px solid ${tank.condition !== "normal" ? (tank.condition === "unused" ? "#10b981" : "#ef4444") : "#e2e8f0"}`,
                    borderRadius: 14, padding: "12px 16px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    transition: "border-color 0.15s",
                  }}>
                    <span style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.04em", color: "#0f172a" }}>{tank.id}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {TOGGLE_TAGS.map((tag) => {
                        const isActive = tank.condition === tag.val;
                        return (
                          <button
                            key={tag.val}
                            onClick={() => toggleCondition(tank.id, tag.val)}
                            style={{
                              padding: "7px 14px", borderRadius: 10,
                              fontSize: 12, fontWeight: 700, cursor: "pointer",
                              border: `2px solid ${isActive ? tag.color : "transparent"}`,
                              background: isActive ? tag.bg : "#f1f5f9",
                              color: isActive ? tag.color : "#b0b8c4",
                              transition: "all 0.12s",
                              transform: isActive ? "scale(1.05)" : "scale(1)",
                            }}
                          >
                            {tag.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: "12px 20px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", background: "#fff", borderTop: "1px solid #e2e8f0", flexShrink: 0 }}>
              <button onClick={submitReturn} disabled={submitting}
                style={{ width: "100%", padding: 16, borderRadius: 18, border: "none", background: "#10b981", color: "#fff", fontSize: 16, fontWeight: 800, cursor: submitting ? "wait" : "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, boxShadow: "0 8px 16px rgba(16,185,129,0.25)" }}>
                {submitting ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={18} />}
                {tanks.length}本の返却を処理する
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  /* ── Customer selector ── */
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20, background: "#f8fafc" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <Users size={18} color="#10b981" />
        <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0 }}>顧客を選択</h2>
      </div>

      {loadingCustomers ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 size={24} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : customers.length === 0 ? (
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 20, padding: "40px 20px", textAlign: "center" }}>
          <CheckCircle2 size={32} color="#94a3b8" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>貸出中のタンクはありません</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {customers.map((c) => (
            <button key={c.id} onClick={() => selectCustomer(c)}
              style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 16, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", width: "100%", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Users size={18} color="#10b981" />
                </div>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{c.name}</span>
              </div>
              <ChevronDown size={18} color="#94a3b8" style={{ transform: "rotate(-90deg)" }} />
            </button>
          ))}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
