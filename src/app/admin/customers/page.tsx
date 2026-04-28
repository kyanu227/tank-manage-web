"use client";

import { useEffect, useState } from "react";
import { Building2, Plus, Save, Search, X, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";

interface Customer {
  id: string;
  name: string;
  companyName: string;
  formalName: string;
  price10: number;
  price12: number;
  priceAluminum: number;
  isActive: boolean;
  createdAt?: unknown;
}

interface CustomerForm {
  name: string;
  companyName: string;
  formalName: string;
  price10: string;
  price12: string;
  priceAluminum: string;
  isActive: boolean;
}

type CustomerField = keyof Pick<
  Customer,
  "name" | "companyName" | "formalName" | "price10" | "price12" | "priceAluminum" | "isActive"
>;

const emptyCustomerForm: CustomerForm = {
  name: "",
  companyName: "",
  formalName: "",
  price10: "0",
  price12: "0",
  priceAluminum: "0",
  isActive: true,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 500,
  border: "1px solid #e2e8f0", borderRadius: 8, outline: "none",
  background: "#fff", color: "#1e293b", transition: "border-color 0.15s",
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

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const toText = (value: unknown) => (typeof value === "string" ? value : "");

const createdAtMillis = (value: unknown) => {
  if (value && typeof value === "object" && "toMillis" in value) {
    const toMillis = (value as { toMillis?: () => number }).toMillis;
    if (typeof toMillis === "function") return toMillis();
  }
  return 0;
};

const normalizeCustomer = (id: string, data: Record<string, unknown>): Customer => {
  const name = toText(data.name).trim() || toText(data.companyName).trim();
  const companyName = toText(data.companyName).trim() || name;

  return {
    id,
    name,
    companyName,
    formalName: toText(data.formalName).trim(),
    price10: toNumber(data.price10),
    price12: toNumber(data.price12),
    priceAluminum: toNumber(data.priceAluminum),
    isActive: data.isActive !== false,
    createdAt: data.createdAt,
  };
};

const buildCustomerPayload = (customer: Customer) => {
  const name = customer.name.trim();
  if (!name) {
    throw new Error("貸出先名は必須です。");
  }

  return {
    name,
    companyName: customer.companyName.trim() || name,
    formalName: customer.formalName.trim(),
    price10: toNumber(customer.price10),
    price12: toNumber(customer.price12),
    priceAluminum: toNumber(customer.priceAluminum),
    isActive: customer.isActive,
  };
};

export default function CustomerManagementPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dirtyCustomerIds, setDirtyCustomerIds] = useState<string[]>([]);
  const [savingCustomerIds, setSavingCustomerIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState<CustomerForm>(emptyCustomerForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, "customers"));
      const data: Customer[] = [];
      querySnapshot.forEach((customerDoc) => {
        data.push(normalizeCustomer(customerDoc.id, customerDoc.data()));
      });
      data.sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));
      setCustomers(data);
      setDirtyCustomerIds([]);
    } catch (error) {
      console.error("Error fetching customers: ", error);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  const resetNewCustomer = () => {
    setNewCustomer(emptyCustomerForm);
  };

  const openNewCustomerModal = () => {
    resetNewCustomer();
    setIsModalOpen(true);
  };

  const closeNewCustomerModal = () => {
    if (isSubmitting) return;
    setIsModalOpen(false);
    resetNewCustomer();
  };

  const updateCustomer = (id: string, field: CustomerField, value: string | number | boolean) => {
    setCustomers((prev) => prev.map((customer) => (
      customer.id === id ? { ...customer, [field]: value } : customer
    )));
    setDirtyCustomerIds((prev) => prev.includes(id) ? prev : [...prev, id]);
  };

  const updateNewCustomer = (field: keyof CustomerForm, value: string | boolean) => {
    setNewCustomer((prev) => ({ ...prev, [field]: value }));
  };

  const findDuplicateCustomerName = (name: string, currentCustomerId?: string) => {
    const normalizedName = name.trim();
    if (!normalizedName) return null;
    return customers.find((customer) => (
      customer.id !== currentCustomerId && customer.name.trim() === normalizedName
    )) ?? null;
  };

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCustomer.name.trim();
    if (!name) {
      alert("貸出先名を入力してください。");
      return;
    }
    if (findDuplicateCustomerName(name)) {
      alert(`貸出先名「${name}」は既に登録されています。別の名前を入力してください。`);
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, "customers"), {
        name,
        companyName: newCustomer.companyName.trim() || name,
        formalName: newCustomer.formalName.trim(),
        price10: toNumber(newCustomer.price10),
        price12: toNumber(newCustomer.price12),
        priceAluminum: toNumber(newCustomer.priceAluminum),
        isActive: newCustomer.isActive,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setIsModalOpen(false);
      resetNewCustomer();
      await fetchCustomers();
    } catch (error) {
      console.error("Error adding customer: ", error);
      alert("エラーが発生しました。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveCustomer = async (customer: Customer) => {
    let payload: ReturnType<typeof buildCustomerPayload>;
    try {
      payload = buildCustomerPayload(customer);
    } catch (error: any) {
      alert(error?.message || "保存に失敗しました。");
      return;
    }

    if (findDuplicateCustomerName(payload.name, customer.id)) {
      alert(`貸出先名「${payload.name}」は既に登録されています。別の名前を入力してください。`);
      return;
    }

    setSavingCustomerIds((prev) => prev.includes(customer.id) ? prev : [...prev, customer.id]);
    try {
      const customerRef = doc(db, "customers", customer.id);
      await updateDoc(customerRef, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
      setCustomers((prev) => prev.map((item) => (
        item.id === customer.id ? { ...item, ...payload } : item
      )));
      setDirtyCustomerIds((prev) => prev.filter((id) => id !== customer.id));
    } catch (error: any) {
      console.error("Error saving customer:", error);
      alert(error?.message || "保存に失敗しました。");
    } finally {
      setSavingCustomerIds((prev) => prev.filter((id) => id !== customer.id));
    }
  };

  const toggleCustomerStatus = async (customer: Customer) => {
    const nextCustomer = { ...customer, isActive: !customer.isActive };
    let payload: ReturnType<typeof buildCustomerPayload>;
    try {
      payload = buildCustomerPayload(nextCustomer);
    } catch (error: any) {
      alert(error?.message || "ステータスの更新に失敗しました。");
      return;
    }

    try {
      const customerRef = doc(db, "customers", customer.id);
      await updateDoc(customerRef, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
      setCustomers((prev) => prev.map((item) => (
        item.id === customer.id ? { ...item, ...payload } : item
      )));
      setDirtyCustomerIds((prev) => prev.filter((id) => id !== customer.id));
    } catch (error: any) {
      console.error("Error updating status:", error);
      alert(error?.message || "ステータスの更新に失敗しました。");
    }
  };

  const filteredCustomers = customers.filter((customer) => {
    const q = searchTerm.trim();
    if (!q) return true;
    return [
      customer.name,
      customer.companyName,
      customer.formalName,
      customer.id,
    ].some((value) => value.includes(q));
  });

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", display: "inline-flex", alignItems: "center", gap: 10 }}>
            <Building2 size={22} /> 貸出先管理
          </h1>
          <p style={{ fontSize: 14, color: "#94a3b8", marginTop: 4 }}>
            貸出先（顧客マスター）の登録・単価・有効/無効を管理します
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={fetchCustomers} disabled={loading} style={btnOutline}>
            <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />
            再読込
          </button>
          <button onClick={openNewCustomerModal} style={btnPrimary}>
            <Plus size={16} /> 新規登録
          </button>
        </div>
      </div>

      {/* Search */}
      <div
        style={{
          background: "#fff", border: "1px solid #e8eaed",
          borderRadius: 12, padding: 12, marginBottom: 16,
          display: "flex", alignItems: "center", gap: 8,
        }}
      >
        <Search size={16} color="#94a3b8" style={{ marginLeft: 4 }} />
        <input
          type="text"
          placeholder="貸出先名・会社名・正式名称で検索..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: 1, padding: "6px 8px", fontSize: 13, fontWeight: 500,
            border: "none", outline: "none", background: "transparent",
            color: "#1e293b",
          }}
        />
      </div>

      {/* Table card */}
      <div
        style={{
          background: "#fff", border: "1px solid #e8eaed",
          borderRadius: 16, padding: 24, minHeight: 300,
        }}
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
            <RefreshCw size={24} style={{ animation: "spin 1s linear infinite", marginBottom: 12 }} />
            <p style={{ fontSize: 14, fontWeight: 600 }}>データを読み込み中…</p>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>
                ※「停止」にすると選択肢から消えます。各行の「保存」ボタンで個別に保存します。
              </p>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                    {["貸出先名", "会社名", "正式名称", "単価 (10L / 12L / アルミ)", "状態", "操作"].map((h) => (
                      <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
                        {customers.length === 0
                          ? "データがありません。「新規登録」ボタンで追加してください。"
                          : "該当する貸出先がありません。"}
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map((customer) => {
                      const dirty = dirtyCustomerIds.includes(customer.id);
                      const saving = savingCustomerIds.includes(customer.id);
                      return (
                        <tr
                          key={customer.id}
                          style={{
                            borderBottom: "1px solid #f1f5f9",
                            opacity: customer.isActive ? 1 : 0.5,
                            background: customer.isActive ? undefined : "#fafafa",
                            transition: "opacity 0.15s",
                          }}
                        >
                          <td style={{ padding: "10px 12px" }}>
                            <input
                              style={{ ...inputStyle, fontWeight: 700 }}
                              value={customer.name}
                              placeholder="例: 〇〇ダイビング"
                              onChange={(e) => updateCustomer(customer.id, "name", e.target.value)}
                            />
                            <p style={{ fontSize: 10, color: "#cbd5e1", fontFamily: "monospace", marginTop: 4 }}>
                              ID: {customer.id.slice(0, 8)}...
                            </p>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <input
                              style={inputStyle}
                              value={customer.companyName}
                              placeholder="会社名"
                              onChange={(e) => updateCustomer(customer.id, "companyName", e.target.value)}
                            />
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <input
                              style={inputStyle}
                              value={customer.formalName}
                              placeholder="請求書用の正式名称"
                              onChange={(e) => updateCustomer(customer.id, "formalName", e.target.value)}
                            />
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ display: "flex", gap: 6 }}>
                              <input
                                type="number"
                                style={{ ...inputStyle, textAlign: "right" as const, fontFamily: "monospace", width: 80 }}
                                value={customer.price10}
                                placeholder="10L"
                                onChange={(e) => updateCustomer(customer.id, "price10", toNumber(e.target.value))}
                              />
                              <input
                                type="number"
                                style={{ ...inputStyle, textAlign: "right" as const, fontFamily: "monospace", width: 80 }}
                                value={customer.price12}
                                placeholder="12L"
                                onChange={(e) => updateCustomer(customer.id, "price12", toNumber(e.target.value))}
                              />
                              <input
                                type="number"
                                style={{ ...inputStyle, textAlign: "right" as const, fontFamily: "monospace", width: 80 }}
                                value={customer.priceAluminum}
                                placeholder="アルミ"
                                onChange={(e) => updateCustomer(customer.id, "priceAluminum", toNumber(e.target.value))}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <button
                              onClick={() => toggleCustomerStatus(customer)}
                              style={{
                                border: "none", background: "none",
                                cursor: "pointer", padding: 4,
                                color: customer.isActive ? "#10b981" : "#cbd5e1",
                                transition: "color 0.15s",
                              }}
                              title={customer.isActive ? "停止する" : "有効化する"}
                            >
                              {customer.isActive ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                            </button>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>
                            <button
                              onClick={() => saveCustomer(customer)}
                              disabled={!dirty || saving || !customer.name.trim()}
                              style={{
                                ...btnOutline,
                                color: dirty ? "#6366f1" : "#cbd5e1",
                                borderColor: dirty ? "#c7d2fe" : "#e2e8f0",
                                cursor: (!dirty || saving || !customer.name.trim()) ? "not-allowed" : "pointer",
                              }}
                            >
                              <Save size={13} />
                              {saving ? "保存中" : dirty ? "保存" : "保存済"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* New customer modal */}
      {isModalOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(15, 23, 42, 0.4)",
            backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#fff", borderRadius: 20, width: "100%", maxWidth: 640,
              boxShadow: "0 20px 40px rgba(0,0,0,0.18)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 24px", borderBottom: "1px solid #f1f5f9",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>貸出先の登録</h2>
              <button
                onClick={closeNewCustomerModal}
                style={{
                  width: 32, height: 32, borderRadius: 8, border: "none",
                  background: "#f1f5f9", color: "#64748b",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddCustomer} style={{ padding: 24 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
                    貸出先名 *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCustomer.name}
                    onChange={(e) => updateNewCustomer("name", e.target.value)}
                    placeholder="例: 〇〇ダイビング"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
                    会社名
                  </label>
                  <input
                    type="text"
                    value={newCustomer.companyName}
                    onChange={(e) => updateNewCustomer("companyName", e.target.value)}
                    placeholder="未入力なら貸出先名と同じ"
                    style={inputStyle}
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
                    正式名称
                  </label>
                  <input
                    type="text"
                    value={newCustomer.formalName}
                    onChange={(e) => updateNewCustomer("formalName", e.target.value)}
                    placeholder="請求書・正式表示用"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
                    10L 単価
                  </label>
                  <input
                    type="number"
                    value={newCustomer.price10}
                    onChange={(e) => updateNewCustomer("price10", e.target.value)}
                    style={{ ...inputStyle, textAlign: "right", fontFamily: "monospace" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
                    12L 単価
                  </label>
                  <input
                    type="number"
                    value={newCustomer.price12}
                    onChange={(e) => updateNewCustomer("price12", e.target.value)}
                    style={{ ...inputStyle, textAlign: "right", fontFamily: "monospace" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
                    アルミ 単価
                  </label>
                  <input
                    type="number"
                    value={newCustomer.priceAluminum}
                    onChange={(e) => updateNewCustomer("priceAluminum", e.target.value)}
                    style={{ ...inputStyle, textAlign: "right", fontFamily: "monospace" }}
                  />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#475569", paddingTop: 22 }}>
                  <input
                    type="checkbox"
                    checked={newCustomer.isActive}
                    onChange={(e) => updateNewCustomer("isActive", e.target.checked)}
                    style={{ width: 16, height: 16 }}
                  />
                  有効にする
                </label>
              </div>

              <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                <button
                  type="button"
                  onClick={closeNewCustomerModal}
                  style={{ ...btnOutline, flex: 1, justifyContent: "center", padding: "10px 16px" }}
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newCustomer.name.trim()}
                  style={{
                    ...btnPrimary, flex: 1, justifyContent: "center",
                    background: (isSubmitting || !newCustomer.name.trim()) ? "#c7d2fe" : "#6366f1",
                    cursor: (isSubmitting || !newCustomer.name.trim()) ? "not-allowed" : "pointer",
                  }}
                >
                  {isSubmitting ? (
                    <RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} />
                  ) : (
                    <Save size={16} />
                  )}
                  {isSubmitting ? "登録中…" : "登録する"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
