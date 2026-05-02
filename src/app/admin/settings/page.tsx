"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users, Package, Plus, Save, RefreshCw, Trash2,
  ToggleLeft, ToggleRight, Eye, EyeOff, ChevronDown, Clock, ShieldCheck,
} from "lucide-react";
import { auth, db } from "@/lib/firebase/config";
import {
  collection, getDocs, doc, setDoc, getDoc,
  serverTimestamp, writeBatch,
} from "firebase/firestore";
import { transactionsRepository } from "@/lib/firebase/repositories";
import {
  deleteStaffAuthMirrorInBatch,
  findStaffProfileByEmailReadOnly,
  setStaffAuthMirrorInBatch,
  staffEmailKey,
} from "@/lib/firebase/staff-auth";
import { assertNotChangedSinceLoad, createDocId, hasFieldChanges, isNewDocId } from "@/lib/firebase/diff-write";
import { getStaffIdentity } from "@/hooks/useStaffSession";
import type { OperationActor } from "@/lib/operation-context";

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

interface OrderItem {
  id: string;
  category: "tank" | "supply";
  colA: string;
  colB: string;
  price: number;
}

interface Customer {
  id: string; // matches auth UID
  name?: string;
  email?: string;
  role?: string;
  setupCompleted?: boolean;
  companyName?: string;
  lineName?: string;
  isActive?: boolean;
}

interface CustomerUser {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  selfCompanyName: string;
  selfName: string;
  lineName?: string;
  customerId?: string | null;
  customerName?: string;
  status: "pending_setup" | "pending" | "active" | "disabled";
  setupCompleted: boolean;
}

type TabId = "staff" | "customer" | "order" | "portal" | "inspection";

const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: "staff",      label: "担当者",       icon: Users },
  { id: "customer",   label: "ポータル利用者", icon: Users },
  { id: "order",      label: "発注品目",     icon: Package },
  { id: "portal",     label: "ポータル設定", icon: Clock },
  { id: "inspection", label: "耐圧検査",     icon: ShieldCheck },
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
  const [dirtyStaffIds, setDirtyStaffIds] = useState<string[]>([]);
  const [showPasscodes, setShowPasscodes] = useState<Set<string>>(new Set());

  // Customers (Portal Users)
  const [customerList, setCustomerList] = useState<Customer[]>([]);
  const [customerUserList, setCustomerUserList] = useState<CustomerUser[]>([]);
  const [dirtyCustomerUserIds, setDirtyCustomerUserIds] = useState<string[]>([]);

  // Order Master
  const [orderList, setOrderList] = useState<OrderItem[]>([]);
  const [dirtyOrderIds, setDirtyOrderIds] = useState<string[]>([]);
  const [deletedOrderIds, setDeletedOrderIds] = useState<string[]>([]);

  // Portal settings
  const [autoReturnHour, setAutoReturnHour] = useState<number>(17);
  const [autoReturnMinute, setAutoReturnMinute] = useState<number>(0);
  const [portalSaving, setPortalSaving] = useState(false);

  // Inspection settings（耐圧検査）
  const [inspValidityYears, setInspValidityYears] = useState<number>(5);
  const [inspAlertMonths, setInspAlertMonths] = useState<number>(6);
  const [inspectionSaving, setInspectionSaving] = useState(false);

  /* ─── Fetch All ─── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // Staff
      const staffSnap = await getDocs(collection(db, "staff"));
      const staff: StaffMember[] = [];
      staffSnap.forEach((d) => staff.push({ id: d.id, ...d.data() } as StaffMember));
      setStaffList(staff.length > 0 ? staff : []);
      setDirtyStaffIds([]);

      // Customers
      const custSnap = await getDocs(collection(db, "customers"));
      const custs: Customer[] = [];
      custSnap.forEach((c) => custs.push({ id: c.id, ...c.data() } as Customer));
      setCustomerList(custs.length > 0 ? custs : []);

      // Customer users
      const customerUserSnap = await getDocs(collection(db, "customerUsers"));
      const customerUsers: CustomerUser[] = [];
      customerUserSnap.forEach((u) => {
        const data = u.data() as Partial<CustomerUser>;
        customerUsers.push({
          id: u.id,
          uid: data.uid || u.id,
          email: data.email || "",
          displayName: data.displayName || "",
          selfCompanyName: data.selfCompanyName || "",
          selfName: data.selfName || "",
          lineName: data.lineName || "",
          customerId: data.customerId || "",
          customerName: data.customerName || "",
          status: data.status || "pending_setup",
          setupCompleted: Boolean(data.setupCompleted),
        });
      });
      setCustomerUserList(customerUsers);
      setDirtyCustomerUserIds([]);

      // Orders
      const orderSnap = await getDocs(collection(db, "orderMaster"));
      const orders: OrderItem[] = [];
      orderSnap.forEach((d) => orders.push({ id: d.id, ...d.data() } as OrderItem));
      setOrderList(orders.length > 0 ? orders : []);
      setDirtyOrderIds([]);
      setDeletedOrderIds([]);

      // Portal settings
      const portalSnap = await getDoc(doc(db, "settings", "portal"));
      if (portalSnap.exists()) {
        const p = portalSnap.data();
        if (p.autoReturnHour != null) setAutoReturnHour(p.autoReturnHour);
        if (p.autoReturnMinute != null) setAutoReturnMinute(p.autoReturnMinute);
      }

      // Inspection settings
      const inspSnap = await getDoc(doc(db, "settings", "inspection"));
      if (inspSnap.exists()) {
        const i = inspSnap.data();
        if (typeof i.validityYears === "number" && i.validityYears > 0) setInspValidityYears(i.validityYears);
        if (typeof i.alertMonths === "number" && i.alertMonths > 0) setInspAlertMonths(i.alertMonths);
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
    setDirtyStaffIds((prev) => prev.includes(id) ? prev : [...prev, id]);
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

      const staffSnap = await getDocs(collection(db, "staff"));
      const currentStaff = new Map(staffSnap.docs.map((d) => [d.id, d.data()]));
      const emails = staffList.map((s) => staffEmailKey(s.email || "")).filter(Boolean);
      if (new Set(emails).size !== emails.length) {
        throw new Error("同じメールアドレスの担当者が重複しています。");
      }

      staffList.forEach((s) => {
        const docId = isNewDocId(s.id) ? createDocId("staff") : s.id;
        const ref = doc(db, "staff", docId);
        const payload = {
          name: s.name.trim(),
          email: s.email.trim(),
          passcode: s.passcode.trim(),
          role: s.role,
          rank: s.rank,
          isActive: s.isActive,
        };

        if (isNewDocId(s.id)) {
          batch.set(ref, {
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setStaffAuthMirrorInBatch(batch, docId, payload);
          return;
        }

        const current = currentStaff.get(docId);
        const isDirty = dirtyStaffIds.includes(s.id);
        if (!isDirty) {
          if (current) setStaffAuthMirrorInBatch(batch, docId, current);
          return;
        }
        if (!current) {
          throw new Error(`担当者「${s.name || docId}」は他の操作で削除されています。再読込してください。`);
        }
        assertNotChangedSinceLoad(s as any, current, `担当者「${s.name || docId}」`);

        const oldEmail = staffEmailKey(String(current.email || ""));
        const newEmail = staffEmailKey(payload.email);
        if (oldEmail && oldEmail !== newEmail) {
          deleteStaffAuthMirrorInBatch(batch, oldEmail);
        }

        if (hasFieldChanges(current, payload)) {
          batch.update(ref, {
            ...payload,
            updatedAt: serverTimestamp(),
          });
        }
        setStaffAuthMirrorInBatch(batch, docId, payload);
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

  /* ─── Order CRUD ─── */
  const addOrder = (category: "tank" | "supply") => {
    setOrderList((prev) => [
      ...prev,
      { id: `new_${Date.now()}`, category, colA: "", colB: "", price: 0 },
    ]);
  };

  const updateOrder = (id: string, field: keyof OrderItem, value: any) => {
    setDirtyOrderIds((prev) => prev.includes(id) ? prev : [...prev, id]);
    setOrderList((prev) => prev.map((o) => (o.id === id ? { ...o, [field]: value } : o)));
  };

  const removeOrder = (id: string) => {
    if (!isNewDocId(id)) {
      setDeletedOrderIds((prev) => prev.includes(id) ? prev : [...prev, id]);
    }
    setDirtyOrderIds((prev) => prev.filter((dirtyId) => dirtyId !== id));
    setOrderList((prev) => prev.filter((o) => o.id !== id));
  };

  const saveOrder = async () => {
    if (!confirm("発注品目マスタを保存しますか？")) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const orderSnap = await getDocs(collection(db, "orderMaster"));
      const currentOrders = new Map(orderSnap.docs.map((d) => [d.id, d.data()]));

      deletedOrderIds.forEach((id) => {
        batch.delete(doc(db, "orderMaster", id));
      });

      orderList.forEach((o) => {
        const docId = isNewDocId(o.id) ? createDocId("order") : o.id;
        const ref = doc(db, "orderMaster", docId);
        const payload = {
          category: o.category,
          colA: String(o.colA).trim(),
          colB: o.colB.trim(),
          price: Number(o.price),
        };

        if (isNewDocId(o.id)) {
          batch.set(ref, {
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          return;
        }

        if (!dirtyOrderIds.includes(o.id)) return;

        const current = currentOrders.get(docId);
        if (!current) {
          throw new Error(`発注品目「${o.colB || o.id}」は他の操作で削除されています。再読込してください。`);
        }
        assertNotChangedSinceLoad(o as any, current, `発注品目「${o.colB || o.id}」`);
        if (hasFieldChanges(current, payload)) {
          batch.update(ref, {
            ...payload,
            updatedAt: serverTimestamp(),
          });
        }
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

  /* ─── Customer user linking ─── */
  const getCustomerDisplayName = (customer?: Customer) => (
    customer?.name || customer?.companyName || customer?.email || customer?.id || ""
  );

  const updateCustomerUser = (id: string, field: keyof CustomerUser, value: any) => {
    setDirtyCustomerUserIds((prev) => prev.includes(id) ? prev : [...prev, id]);
    setCustomerUserList((prev) => prev.map((u) => (u.id === id ? { ...u, [field]: value } : u)));
  };

  const saveCustomerUsers = async () => {
    if (!confirm("ポータル利用者の紐付けを保存しますか？")) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const customerUserSnap = await getDocs(collection(db, "customerUsers"));
      const currentCustomerUsers = new Map(customerUserSnap.docs.map((d) => [d.id, d.data()]));
      let linkActor: OperationActor | null = null;

      for (const u of customerUserList) {
        if (!dirtyCustomerUserIds.includes(u.id)) continue;

        const customerId = u.customerId || "";
        const linkedCustomer = customerList.find((c) => c.id === customerId);
        const customerName = customerId ? getCustomerDisplayName(linkedCustomer) : "";
        const status = u.status === "disabled"
          ? "disabled"
          : customerId
            ? "active"
            : u.setupCompleted
              ? "pending"
              : "pending_setup";
        const current = currentCustomerUsers.get(u.id);
        if (!current) {
          throw new Error(`ポータル利用者「${u.email || u.id}」は他の操作で削除されています。再読込してください。`);
        }
        assertNotChangedSinceLoad(u as any, current, `ポータル利用者「${u.email || u.id}」`);
        const payload = {
          customerId: customerId || null,
          customerName,
          status,
        };

        if (hasFieldChanges(current, payload)) {
          batch.set(doc(db, "customerUsers", u.id), {
            ...payload,
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }

        const previousCustomerId = current.customerId || "";
        if (!customerId || previousCustomerId === customerId) continue;

        const pendingItems = await transactionsRepository.findPendingLinksByUid(u.uid);
        if (pendingItems.length > 0 && !linkActor) {
          linkActor = await resolveAdminOperationActor();
        }
        pendingItems.forEach((item) => {
          batch.update(doc(db, "transactions", item.id), {
            customerId,
            customerName,
            status: "pending_approval",
            linkedAt: serverTimestamp(),
            ...(linkActor ? linkedByStaffFields(linkActor) : {}),
            updatedAt: serverTimestamp(),
          });
        });
      }

      await batch.commit();
      await fetchAll();
      alert("ポータル利用者の紐付けを保存しました。");
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
            担当者・ポータル利用者・発注品目のマスターデータを管理
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

            {/* ─── Tab: Customers (Portal Users) ─── */}
            {activeTab === "customer" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>
                    ※ Google登録した利用者を既存の顧客マスタに紐付けます。紐付けると未紐付けの発注も承認待ちに移動します。
                  </p>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                        {["状態", "登録会社/氏名", "Google Email", "Google名", "紐付け先"].map((h) => (
                          <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {customerUserList.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
                            Google登録済みのポータル利用者がいません。
                          </td>
                        </tr>
                      ) : (
                        customerUserList.map((u) => {
                          const statusLabel =
                            u.status === "active" ? "紐付け済"
                              : u.status === "disabled" ? "停止中"
                                : u.status === "pending" ? "未紐付け"
                                  : "初期設定中";
                          const statusColor =
                            u.status === "active" ? "#10b981"
                              : u.status === "disabled" ? "#ef4444"
                                : u.status === "pending" ? "#f59e0b"
                                  : "#94a3b8";
                          return (
                          <tr key={u.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>
                              <span style={{
                                display: "inline-flex", alignItems: "center",
                                padding: "4px 8px", borderRadius: 999,
                                background: `${statusColor}14`, color: statusColor,
                                fontSize: 11, fontWeight: 800,
                              }}>
                                {statusLabel}
                              </span>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 13 }}>
                                {u.selfCompanyName || "会社名未入力"}
                              </div>
                              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                                {u.selfName || "氏名未入力"}{u.lineName ? ` / LINE: ${u.lineName}` : ""}
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: "monospace", color: u.email ? "#1e293b" : "#94a3b8" }}>
                              {u.email || "メール未取得"}
                            </td>
                            <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>
                              {u.displayName || "未取得"}
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <select
                                style={{ ...selectStyle, paddingRight: 32 }}
                                value={u.customerId || ""}
                                onChange={(e) => updateCustomerUser(u.id, "customerId", e.target.value)}
                              >
                                <option value="">-- 未紐付け --</option>
                                {customerList.filter(c => c.isActive !== false).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {getCustomerDisplayName(c)}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 20 }}>
                  <button onClick={saveCustomerUsers} disabled={saving} style={btnPrimary}>
                    <Save size={16} />
                    {saving ? "保存中…" : "ポータル利用者の紐付けを保存"}
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

            {/* ── Inspection Settings Tab ── */}
            {activeTab === "inspection" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>耐圧検査設定</h2>
                  <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
                    耐圧検査の有効期間と告知開始タイミングを設定します。
                  </p>
                </div>

                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <ShieldCheck size={16} color="#8b5cf6" />
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: 0 }}>検査有効期間</h3>
                  </div>
                  <p style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
                    検査完了時、次回期限を「今日＋この年数」で更新します。（標準: 5年）
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <input
                      type="number"
                      min={1} max={20}
                      value={inspValidityYears}
                      onChange={(e) => setInspValidityYears(Math.min(20, Math.max(1, Number(e.target.value))))}
                      style={{ ...inputStyle, width: 100, textAlign: "center", fontSize: 24, fontWeight: 800, fontFamily: "monospace", padding: "10px 8px" }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>年</span>
                  </div>
                </div>

                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <Clock size={16} color="#f59e0b" />
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: 0 }}>告知開始タイミング</h3>
                  </div>
                  <p style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
                    次回期限がこのヶ月数以内に迫ったタンクをスタッフ画面に表示します。（標準: 6ヶ月）
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <input
                      type="number"
                      min={1} max={24}
                      value={inspAlertMonths}
                      onChange={(e) => setInspAlertMonths(Math.min(24, Math.max(1, Number(e.target.value))))}
                      style={{ ...inputStyle, width: 100, textAlign: "center", fontSize: 24, fontWeight: 800, fontFamily: "monospace", padding: "10px 8px" }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>ヶ月前から</span>
                  </div>
                </div>

                <button
                  disabled={inspectionSaving}
                  onClick={async () => {
                    if (!confirm(`耐圧検査設定を「有効期間 ${inspValidityYears}年 / 告知 ${inspAlertMonths}ヶ月前〜」に保存しますか？`)) return;
                    setInspectionSaving(true);
                    try {
                      await setDoc(doc(db, "settings", "inspection"), {
                        validityYears: inspValidityYears,
                        alertMonths: inspAlertMonths,
                        updatedAt: serverTimestamp(),
                      }, { merge: true });
                      alert("保存しました");
                    } catch (e) {
                      console.error(e);
                      alert("保存に失敗しました");
                    } finally {
                      setInspectionSaving(false);
                    }
                  }}
                  style={btnPrimary}
                >
                  <Save size={16} />
                  {inspectionSaving ? "保存中…" : "耐圧検査設定を保存"}
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

async function resolveAdminOperationActor(): Promise<OperationActor> {
  const cached = getStaffIdentity();
  if (cached) return cached;

  const email = auth.currentUser?.email?.trim();
  if (!email) {
    throw new Error("操作者を取得できませんでした。再ログインしてください。");
  }

  const profile = await findStaffProfileByEmailReadOnly(email);
  if (!profile || !profile.isActive) {
    throw new Error("操作者を取得できませんでした。再ログインしてください。");
  }

  return {
    staffId: profile.staffId,
    staffName: profile.name,
    ...(profile.email ? { staffEmail: profile.email } : {}),
    ...(profile.role ? { role: profile.role } : {}),
    ...(profile.rank ? { rank: profile.rank } : {}),
  };
}

function linkedByStaffFields(actor: OperationActor) {
  return {
    linkedByStaffId: actor.staffId,
    linkedByStaffName: actor.staffName,
    ...(actor.staffEmail ? { linkedByStaffEmail: actor.staffEmail } : {}),
  };
}
