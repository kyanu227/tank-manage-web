"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users, Building2, Package, Plus, Save, RefreshCw, Trash2,
  ToggleLeft, ToggleRight, Eye, EyeOff, ChevronDown, Clock,
} from "lucide-react";
import { db } from "@/lib/firebase/config";
import {
  collection, getDocs, doc, setDoc, getDoc, deleteDoc,
  serverTimestamp, writeBatch,
} from "firebase/firestore";

/* ─── Types ─── */
interface StaffMember {
  id: string;
  name: string;
  email: string;
  passcode: string;
  role: "一般" | "準管理者" | "管理者";
  rank: string;
  isActive: boolean;
}

interface Destination {
  id: string;
  name: string;
  formalName: string;
  price10: number;
  price12: number;
  loginId: string;
  passcode: string;
  isActive: boolean;
}

interface OrderItem {
  id: string;
  category: "tank" | "supply";
  colA: string;
  colB: string;
  price: number;
}

interface Customer {
  id: string; // matches auth UID
  email: string;
  passcode: string;
  role: string;
  setupCompleted: boolean;
  companyName?: string;
  lineName?: string;
  linkedLocation?: string; // Links to a destination ID
}

type TabId = "staff" | "dest" | "customer" | "order" | "portal";

const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: "staff",   label: "担当者",       icon: Users },
  { id: "dest",    label: "貸出先",       icon: Building2 },
  { id: "customer",label: "ポータル利用者", icon: Users },
  { id: "order",   label: "発注品目",     icon: Package },
  { id: "portal",  label: "ポータル設定", icon: Clock },
];

const ROLES = ["一般", "準管理者", "管理者"] as const;
const RANKS = ["レギュラー", "ブロンズ", "シルバー", "ゴールド", "プラチナ"] as const;

/* ─── Shared styles ─── */
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 500,
  border: "1px solid #e2e8f0", borderRadius: 8, outline: "none",
  background: "#fff", color: "#1e293b", transition: "border-color 0.15s",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle, appearance: "none" as const, paddingRight: 28,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "10px 20px", borderRadius: 10, border: "none",
  background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 700,
  cursor: "pointer", transition: "all 0.15s",
};

const btnOutline: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 14px", borderRadius: 8,
  border: "1px solid #e2e8f0", background: "#fff",
  color: "#64748b", fontSize: 13, fontWeight: 600,
  cursor: "pointer", transition: "all 0.15s",
};

/* ─── Component ─── */
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("staff");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Staff
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [showPasscodes, setShowPasscodes] = useState<Set<string>>(new Set());

  // Destinations
  const [destList, setDestList] = useState<Destination[]>([]);

  // Customers (Portal Users)
  const [customerList, setCustomerList] = useState<Customer[]>([]);

  // Order Master
  const [orderList, setOrderList] = useState<OrderItem[]>([]);

  // Portal settings
  const [autoReturnHour, setAutoReturnHour] = useState<number>(17);
  const [autoReturnMinute, setAutoReturnMinute] = useState<number>(0);
  const [portalSaving, setPortalSaving] = useState(false);

  /* ─── Fetch All ─── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // Staff
      const staffSnap = await getDocs(collection(db, "staff"));
      const staff: StaffMember[] = [];
      staffSnap.forEach((d) => staff.push({ id: d.id, ...d.data() } as StaffMember));
      setStaffList(staff.length > 0 ? staff : []);

      // Destinations
      const destSnap = await getDocs(collection(db, "destinations"));
      const dests: Destination[] = [];
      destSnap.forEach((d) => dests.push({ id: d.id, ...d.data() } as Destination));
      setDestList(dests.length > 0 ? dests : []);

      // Customers
      const custSnap = await getDocs(collection(db, "customers"));
      const custs: Customer[] = [];
      custSnap.forEach((c) => custs.push({ id: c.id, ...c.data() } as Customer));
      setCustomerList(custs.length > 0 ? custs : []);

      // Orders
      const orderSnap = await getDocs(collection(db, "orderMaster"));
      const orders: OrderItem[] = [];
      orderSnap.forEach((d) => orders.push({ id: d.id, ...d.data() } as OrderItem));
      setOrderList(orders.length > 0 ? orders : []);

      // Portal settings
      const portalSnap = await getDoc(doc(db, "settings", "portal"));
      if (portalSnap.exists()) {
        const p = portalSnap.data();
        if (p.autoReturnHour != null) setAutoReturnHour(p.autoReturnHour);
        if (p.autoReturnMinute != null) setAutoReturnMinute(p.autoReturnMinute);
      }
    } catch (e) {
      console.error("Fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ─── Staff CRUD ─── */
  const addStaff = () => {
    setStaffList((prev) => [
      ...prev,
      {
        id: `new_${Date.now()}`,
        name: "", email: "", passcode: "",
        role: "一般", rank: "レギュラー", isActive: true,
      },
    ]);
  };

  const updateStaff = (id: string, field: keyof StaffMember, value: any) => {
    setStaffList((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const togglePasscode = (id: string) => {
    setShowPasscodes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const saveStaff = async () => {
    if (!confirm("担当者リストを保存しますか？")) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      
      // Delete old documents
      const oldSnap = await getDocs(collection(db, "staff"));
      oldSnap.forEach((d) => batch.delete(d.ref));

      // Write new ones
      staffList.forEach((s) => {
        const docId = s.id.startsWith("new_") ? `staff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` : s.id;
        const ref = doc(db, "staff", docId);
        batch.set(ref, {
          name: s.name, email: s.email, passcode: s.passcode,
          role: s.role, rank: s.rank, isActive: s.isActive,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      await fetchAll();
      alert("担当者リストを保存しました。");
    } catch (e: any) {
      alert("保存エラー: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ─── Dest CRUD ─── */
  const addDest = () => {
    setDestList((prev) => [
      ...prev,
      {
        id: `new_${Date.now()}`,
        name: "", formalName: "",
        price10: 0, price12: 0,
        loginId: "", passcode: "",
        isActive: true,
      },
    ]);
  };

  const updateDest = (id: string, field: keyof Destination, value: any) => {
    setDestList((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  };

  const saveDest = async () => {
    if (!confirm("貸出先リストを保存しますか？")) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const oldSnap = await getDocs(collection(db, "destinations"));
      oldSnap.forEach((d) => batch.delete(d.ref));

      destList.forEach((d) => {
        const docId = d.id.startsWith("new_") ? `dest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` : d.id;
        const ref = doc(db, "destinations", docId);
        batch.set(ref, {
          name: d.name, formalName: d.formalName,
          price10: Number(d.price10), price12: Number(d.price12),
          loginId: d.loginId || "", passcode: d.passcode || "",
          isActive: d.isActive, updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      await fetchAll();
      alert("貸出先リストを保存しました。");
    } catch (e: any) {
      alert("保存エラー: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ─── Order CRUD ─── */
  const addOrder = (category: "tank" | "supply") => {
    setOrderList((prev) => [
      ...prev,
      { id: `new_${Date.now()}`, category, colA: "", colB: "", price: 0 },
    ]);
  };

  const updateOrder = (id: string, field: keyof OrderItem, value: any) => {
    setOrderList((prev) => prev.map((o) => (o.id === id ? { ...o, [field]: value } : o)));
  };

  const removeOrder = (id: string) => {
    setOrderList((prev) => prev.filter((o) => o.id !== id));
  };

  const saveOrder = async () => {
    if (!confirm("発注品目マスタを保存しますか？")) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const oldSnap = await getDocs(collection(db, "orderMaster"));
      oldSnap.forEach((d) => batch.delete(d.ref));

      orderList.forEach((o) => {
        const docId = o.id.startsWith("new_") ? `order_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` : o.id;
        const ref = doc(db, "orderMaster", docId);
        batch.set(ref, {
          category: o.category, colA: o.colA,
          colB: o.colB, price: Number(o.price),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      await fetchAll();
      alert("発注品目マスタを保存しました。");
    } catch (e: any) {
      alert("保存エラー: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ─── Customer CRUD ─── */
  const updateCustomer = (id: string, field: keyof Customer, value: any) => {
    setCustomerList((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const saveCustomer = async () => {
    if (!confirm("ポータル利用者リストを保存しますか？")) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      
      customerList.forEach((c) => {
        const ref = doc(db, "customers", c.id);
        batch.update(ref, {
          linkedLocation: c.linkedLocation || "",
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      await fetchAll();
      alert("ポータル利用者リストを保存しました。");
    } catch (e: any) {
      alert("保存エラー: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ─── Render ─── */
  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>
            設定変更
          </h1>
          <p style={{ fontSize: 14, color: "#94a3b8", marginTop: 4 }}>
            担当者・貸出先・発注品目のマスターデータを管理
          </p>
        </div>
        <button onClick={fetchAll} disabled={loading} style={btnOutline}>
          <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />
          再読込
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex", gap: 4, marginBottom: 0,
          background: "#f1f5f9", borderRadius: "12px 12px 0 0", padding: "6px 6px 0",
        }}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8, padding: "12px 16px", border: "none",
                borderRadius: "10px 10px 0 0",
                background: active ? "#fff" : "transparent",
                color: active ? "#6366f1" : "#94a3b8",
                fontWeight: active ? 700 : 500, fontSize: 14,
                cursor: "pointer", transition: "all 0.15s",
                borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
              }}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content container */}
      <div
        style={{
          background: "#fff", border: "1px solid #e8eaed",
          borderTop: "none", borderRadius: "0 0 16px 16px",
          padding: 24, minHeight: 300,
        }}
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
            <RefreshCw size={24} style={{ animation: "spin 1s linear infinite", marginBottom: 12 }} />
            <p style={{ fontSize: 14, fontWeight: 600 }}>データを読み込み中…</p>
          </div>
        ) : (
          <>
            {/* ─── Tab: Staff ─── */}
            {activeTab === "staff" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>
                    ※「停止」にするとログイン不可になります
                  </p>
                  <button onClick={addStaff} style={btnOutline}>
                    <Plus size={14} /> 追加
                  </button>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                        {["名前", "Email", "パスコード", "権限", "ランク", "状態"].map((h) => (
                          <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {staffList.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
                            データがありません。「追加」ボタンで登録してください。
                          </td>
                        </tr>
                      ) : (
                        staffList.map((s) => (
                          <tr
                            key={s.id}
                            style={{
                              borderBottom: "1px solid #f1f5f9",
                              opacity: s.isActive ? 1 : 0.5,
                              background: s.isActive ? undefined : "#fafafa",
                              transition: "opacity 0.15s",
                            }}
                          >
                            <td style={{ padding: "10px 12px" }}>
                              <input
                                style={{ ...inputStyle, fontWeight: 700 }}
                                value={s.name}
                                placeholder="名前"
                                disabled={!s.isActive}
                                onChange={(e) => updateStaff(s.id, "name", e.target.value)}
                              />
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <input
                                style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }}
                                value={s.email}
                                placeholder="email@example.com"
                                disabled={!s.isActive}
                                onChange={(e) => updateStaff(s.id, "email", e.target.value)}
                              />
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ display: "flex", gap: 4 }}>
                                <input
                                  type={showPasscodes.has(s.id) ? "text" : "password"}
                                  style={{ ...inputStyle, fontFamily: "monospace", flex: 1 }}
                                  value={s.passcode}
                                  placeholder="Pass"
                                  maxLength={6}
                                  disabled={!s.isActive}
                                  onChange={(e) => updateStaff(s.id, "passcode", e.target.value)}
                                />
                                <button
                                  onClick={() => togglePasscode(s.id)}
                                  style={{
                                    border: "1px solid #e2e8f0", borderRadius: 8,
                                    background: "#fff", padding: "0 8px",
                                    cursor: "pointer", color: "#94a3b8",
                                    display: "flex", alignItems: "center",
                                  }}
                                >
                                  {showPasscodes.has(s.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <select
                                style={selectStyle}
                                value={s.role}
                                disabled={!s.isActive}
                                onChange={(e) => updateStaff(s.id, "role", e.target.value)}
                              >
                                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <select
                                style={selectStyle}
                                value={s.rank}
                                disabled={!s.isActive}
                                onChange={(e) => updateStaff(s.id, "rank", e.target.value)}
                              >
                                {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "center" }}>
                              <button
                                onClick={() => updateStaff(s.id, "isActive", !s.isActive)}
                                style={{
                                  border: "none", background: "none",
                                  cursor: "pointer", padding: 4,
                                  color: s.isActive ? "#10b981" : "#cbd5e1",
                                  transition: "color 0.15s",
                                }}
                              >
                                {s.isActive ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 20 }}>
                  <button onClick={saveStaff} disabled={saving} style={btnPrimary}>
                    <Save size={16} />
                    {saving ? "保存中…" : "担当者リストを保存"}
                  </button>
                </div>
              </div>
            )}

            {/* ─── Tab: Destinations ─── */}
            {activeTab === "dest" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>
                    ※「停止」にすると選択肢から消えます
                  </p>
                  <button onClick={addDest} style={btnOutline}>
                    <Plus size={14} /> 追加
                  </button>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                        {["表示名", "10L/12L 単価", "ログインID", "パスワード", "状態"].map((h) => (
                          <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {destList.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
                            データがありません。「追加」ボタンで登録してください。
                          </td>
                        </tr>
                      ) : (
                        destList.map((d) => (
                          <tr
                            key={d.id}
                            style={{
                              borderBottom: "1px solid #f1f5f9",
                              opacity: d.isActive ? 1 : 0.5,
                              background: d.isActive ? undefined : "#fafafa",
                            }}
                          >
                            <td style={{ padding: "10px 12px" }}>
                              <input
                                style={{ ...inputStyle, fontWeight: 700 }}
                                value={d.name}
                                placeholder="例: 〇〇ダイビング"
                                disabled={!d.isActive}
                                onChange={(e) => updateDest(d.id, "name", e.target.value)}
                              />
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ display: "flex", gap: 6 }}>
                                <input
                                  type="number"
                                  style={{ ...inputStyle, textAlign: "right" as const, fontFamily: "monospace", width: 70 }}
                                  value={d.price10}
                                  placeholder="10L"
                                  disabled={!d.isActive}
                                  onChange={(e) => updateDest(d.id, "price10", e.target.value)}
                                />
                                <input
                                  type="number"
                                  style={{ ...inputStyle, textAlign: "right" as const, fontFamily: "monospace", width: 70 }}
                                  value={d.price12}
                                  placeholder="12L"
                                  disabled={!d.isActive}
                                  onChange={(e) => updateDest(d.id, "price12", e.target.value)}
                                />
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <input
                                style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }}
                                value={d.loginId || ""}
                                placeholder="customer_id"
                                disabled={!d.isActive}
                                onChange={(e) => updateDest(d.id, "loginId", e.target.value)}
                              />
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ display: "flex", gap: 4 }}>
                                <input
                                  type={showPasscodes.has(d.id) ? "text" : "password"}
                                  style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, flex: 1 }}
                                  value={d.passcode || ""}
                                  placeholder="password"
                                  disabled={!d.isActive}
                                  onChange={(e) => updateDest(d.id, "passcode", e.target.value)}
                                />
                                <button
                                  onClick={() => togglePasscode(d.id)}
                                  style={{
                                    border: "1px solid #e2e8f0", borderRadius: 8,
                                    background: "#fff", padding: "0 8px",
                                    cursor: "pointer", color: "#94a3b8",
                                    display: "flex", alignItems: "center",
                                  }}
                                >
                                  {showPasscodes.has(d.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "center" }}>
                              <button
                                onClick={() => updateDest(d.id, "isActive", !d.isActive)}
                                style={{
                                  border: "none", background: "none",
                                  cursor: "pointer", padding: 4,
                                  color: d.isActive ? "#10b981" : "#cbd5e1",
                                }}
                              >
                                {d.isActive ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 20 }}>
                  <button onClick={saveDest} disabled={saving} style={btnPrimary}>
                    <Save size={16} />
                    {saving ? "保存中…" : "貸出先リストを保存"}
                  </button>
                </div>
              </div>
            )}

            {/* ─── Tab: Customers (Portal Users) ─── */}
            {activeTab === "customer" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>
                    ※ 顧客アカウントと「貸出先」を紐付けることでデータが連動します。
                  </p>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                        {["登録日", "会社名/名前", "Email", "パスコード", "紐付け先 (貸出先)"].map((h) => (
                          <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {customerList.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
                            登録されているポータル利用者がいません。
                          </td>
                        </tr>
                      ) : (
                        customerList.map((c) => (
                          <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>
                              {c.setupCompleted ? "設定済" : "未設定"}
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 13 }}>
                                {c.companyName || "未入力"}
                              </div>
                              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                                {c.lineName && `LINE: ${c.lineName}`}
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: "monospace", color: c.email ? "#1e293b" : "#94a3b8" }}>
                              {c.email || "メール未登録"}
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ display: "flex", gap: 4 }}>
                                <input
                                  type={showPasscodes.has(c.id) ? "text" : "password"}
                                  style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, width: 80 }}
                                  value={c.passcode || ""}
                                  disabled
                                />
                                <button
                                  onClick={() => togglePasscode(c.id)}
                                  style={{
                                    border: "1px solid #e2e8f0", borderRadius: 8,
                                    background: "#fff", padding: "0 8px",
                                    cursor: "pointer", color: "#94a3b8",
                                    display: "flex", alignItems: "center",
                                  }}
                                >
                                  {showPasscodes.has(c.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <select
                                style={{ ...selectStyle, paddingRight: 32 }}
                                value={c.linkedLocation || ""}
                                onChange={(e) => updateCustomer(c.id, "linkedLocation", e.target.value)}
                              >
                                <option value="">-- 未設定 --</option>
                                {destList.filter(d => d.isActive).map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 20 }}>
                  <button onClick={saveCustomer} disabled={saving} style={btnPrimary}>
                    <Save size={16} />
                    {saving ? "保存中…" : "ポータル利用者リストを保存"}
                  </button>
                </div>
              </div>
            )}

            {/* ─── Tab: Order Master ─── */}
            {activeTab === "order" && (
              <div>
                <div
                  style={{
                    background: "#f8f9fb", border: "1px solid #e8eaed",
                    borderRadius: 10, padding: "12px 16px", marginBottom: 16,
                    fontSize: 12, color: "#64748b", lineHeight: 1.6,
                  }}
                >
                  <strong>💡 ヒント:</strong> タンク → 種類(A列) ＋ 容量(B列)。 備品 → 表示順(A列) ＋ 品名(B列)。
                </div>

                {/* Tank section */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#6366f1", display: "flex", alignItems: "center", gap: 6 }}>
                      <Package size={14} /> タンク
                    </span>
                    <button onClick={() => addOrder("tank")} style={btnOutline}>
                      <Plus size={14} /> タンク追加
                    </button>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                          {["種類", "容量", "単価", ""].map((h) => (
                            <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {orderList.filter((o) => o.category === "tank").length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "#cbd5e1", fontSize: 13 }}>
                              タンクが未登録です
                            </td>
                          </tr>
                        ) : (
                          orderList.filter((o) => o.category === "tank").map((o) => (
                            <tr key={o.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "8px 12px" }}>
                                <input style={{ ...inputStyle, textAlign: "center" as const }} value={o.colA} placeholder="種類" onChange={(e) => updateOrder(o.id, "colA", e.target.value)} />
                              </td>
                              <td style={{ padding: "8px 12px" }}>
                                <input style={{ ...inputStyle, fontWeight: 700 }} value={o.colB} placeholder="容量" onChange={(e) => updateOrder(o.id, "colB", e.target.value)} />
                              </td>
                              <td style={{ padding: "8px 12px" }}>
                                <input type="number" style={{ ...inputStyle, textAlign: "right" as const, fontFamily: "monospace" }} value={o.price} onChange={(e) => updateOrder(o.id, "price", e.target.value)} />
                              </td>
                              <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                <button onClick={() => removeOrder(o.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444", padding: 4 }}>
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Supply section */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981", display: "flex", alignItems: "center", gap: 6 }}>
                      <Package size={14} /> 備品
                    </span>
                    <button onClick={() => addOrder("supply")} style={btnOutline}>
                      <Plus size={14} /> 備品追加
                    </button>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                          {["表示順", "品名", "単価", ""].map((h) => (
                            <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {orderList.filter((o) => o.category === "supply").length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "#cbd5e1", fontSize: 13 }}>
                              備品が未登録です
                            </td>
                          </tr>
                        ) : (
                          orderList.filter((o) => o.category === "supply").map((o) => (
                            <tr key={o.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "8px 12px" }}>
                                <input type="number" style={{ ...inputStyle, textAlign: "center" as const }} value={o.colA} placeholder="順" onChange={(e) => updateOrder(o.id, "colA", e.target.value)} />
                              </td>
                              <td style={{ padding: "8px 12px" }}>
                                <input style={{ ...inputStyle, fontWeight: 700 }} value={o.colB} placeholder="品名" onChange={(e) => updateOrder(o.id, "colB", e.target.value)} />
                              </td>
                              <td style={{ padding: "8px 12px" }}>
                                <input type="number" style={{ ...inputStyle, textAlign: "right" as const, fontFamily: "monospace" }} value={o.price} onChange={(e) => updateOrder(o.id, "price", e.target.value)} />
                              </td>
                              <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                <button onClick={() => removeOrder(o.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444", padding: 4 }}>
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <button onClick={saveOrder} disabled={saving} style={btnPrimary}>
                  <Save size={16} />
                  {saving ? "保存中…" : "発注品目マスタを保存"}
                </button>
              </div>
            )}

            {/* ── Portal Settings Tab ── */}
            {activeTab === "portal" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>ポータル設定</h2>
                  <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>顧客ポータルの自動返却時刻などを管理します。</p>
                </div>

                {/* Auto return time */}
                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <Clock size={16} color="#6366f1" />
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: 0 }}>自動返却実行時刻</h3>
                  </div>
                  <p style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
                    毎日この時刻以降に顧客がポータルの返却画面を開くと、自動的に返却申請が送信されます。
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em" }}>時</label>
                      <input
                        type="number"
                        min={0} max={23}
                        value={autoReturnHour}
                        onChange={(e) => setAutoReturnHour(Math.min(23, Math.max(0, Number(e.target.value))))}
                        style={{ ...inputStyle, width: 80, textAlign: "center", fontSize: 24, fontWeight: 800, fontFamily: "monospace", padding: "10px 8px" }}
                      />
                    </div>
                    <span style={{ fontSize: 28, fontWeight: 900, color: "#334155", paddingTop: 20 }}>:</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em" }}>分</label>
                      <input
                        type="number"
                        min={0} max={59} step={5}
                        value={autoReturnMinute}
                        onChange={(e) => setAutoReturnMinute(Math.min(59, Math.max(0, Number(e.target.value))))}
                        style={{ ...inputStyle, width: 80, textAlign: "center", fontSize: 24, fontWeight: 800, fontFamily: "monospace", padding: "10px 8px" }}
                      />
                    </div>
                    <div style={{ paddingTop: 22, color: "#64748b", fontSize: 14, fontWeight: 600 }}>
                      現在: {String(autoReturnHour).padStart(2, "0")}:{String(autoReturnMinute).padStart(2, "0")}
                    </div>
                  </div>
                </div>

                <button
                  disabled={portalSaving}
                  onClick={async () => {
                    if (!confirm(`自動返却時刻を ${String(autoReturnHour).padStart(2,"0")}:${String(autoReturnMinute).padStart(2,"0")} に設定しますか？`)) return;
                    setPortalSaving(true);
                    try {
                      await setDoc(doc(db, "settings", "portal"), {
                        autoReturnHour,
                        autoReturnMinute,
                        updatedAt: serverTimestamp(),
                      }, { merge: true });
                      alert("保存しました");
                    } catch (e) {
                      console.error(e);
                      alert("保存に失敗しました");
                    } finally {
                      setPortalSaving(false);
                    }
                  }}
                  style={btnPrimary}
                >
                  <Save size={16} />
                  {portalSaving ? "保存中…" : "ポータル設定を保存"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
