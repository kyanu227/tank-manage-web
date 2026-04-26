"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Building2, Plus, Save, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
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

const inputClass = "w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:bg-slate-100";

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
  const router = useRouter();
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
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/admin")}
              className="w-10 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-full transition-colors shrink-0"
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-xl font-bold text-slate-800">貸出先管理（顧客マスター）</h1>
          </div>
          <button
            onClick={openNewCustomerModal}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
          >
            <Plus size={16} />
            新規登録
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="貸出先名・会社名・正式名称で検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center">
              <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-500 rounded-full animate-spin mb-4" />
              <p className="text-sm font-medium">データを読み込み中...</p>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Building2 size={48} className="mx-auto text-slate-300 mb-4" />
              <p className="text-lg font-bold text-slate-700 mb-1">顧客データがありません</p>
              <p className="text-sm">右上の「新規登録」ボタンから店舗を追加してください。</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1120px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-bold">
                    <th className="px-4 py-3 w-[190px]">貸出先名 *</th>
                    <th className="px-4 py-3 w-[190px]">会社名</th>
                    <th className="px-4 py-3 w-[210px]">正式名称</th>
                    <th className="px-4 py-3 w-[220px]">単価</th>
                    <th className="px-4 py-3 w-[110px]">状態</th>
                    <th className="px-4 py-3 w-[150px] text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCustomers.map((customer) => {
                    const dirty = dirtyCustomerIds.includes(customer.id);
                    const saving = savingCustomerIds.includes(customer.id);
                    return (
                      <tr key={customer.id} className="hover:bg-slate-50/50 transition-colors align-top">
                        <td className="px-4 py-3">
                          <input
                            value={customer.name}
                            required
                            placeholder="例: 〇〇ダイビング"
                            onChange={(e) => updateCustomer(customer.id, "name", e.target.value)}
                            className={inputClass}
                          />
                          <p className="text-[11px] text-slate-400 font-mono mt-1">ID: {customer.id.slice(0, 8)}...</p>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={customer.companyName}
                            placeholder="会社名"
                            onChange={(e) => updateCustomer(customer.id, "companyName", e.target.value)}
                            className={inputClass}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={customer.formalName}
                            placeholder="請求書用の正式名称"
                            onChange={(e) => updateCustomer(customer.id, "formalName", e.target.value)}
                            className={inputClass}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="grid grid-cols-3 gap-2">
                            <label className="block">
                              <span className="block text-[11px] font-bold text-slate-400 mb-1">10L</span>
                              <input
                                type="number"
                                value={customer.price10}
                                onChange={(e) => updateCustomer(customer.id, "price10", toNumber(e.target.value))}
                                className={`${inputClass} text-right font-mono`}
                              />
                            </label>
                            <label className="block">
                              <span className="block text-[11px] font-bold text-slate-400 mb-1">12L</span>
                              <input
                                type="number"
                                value={customer.price12}
                                onChange={(e) => updateCustomer(customer.id, "price12", toNumber(e.target.value))}
                                className={`${inputClass} text-right font-mono`}
                              />
                            </label>
                            <label className="block">
                              <span className="block text-[11px] font-bold text-slate-400 mb-1">アルミ</span>
                              <input
                                type="number"
                                value={customer.priceAluminum}
                                onChange={(e) => updateCustomer(customer.id, "priceAluminum", toNumber(e.target.value))}
                                className={`${inputClass} text-right font-mono`}
                              />
                            </label>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                            customer.isActive
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-slate-100 text-slate-500 border border-slate-200"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${customer.isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                            {customer.isActive ? "有効" : "無効"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => toggleCustomerStatus(customer)}
                              className="text-xs font-semibold px-3 py-2 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                            >
                              {customer.isActive ? "無効化" : "有効化"}
                            </button>
                            <button
                              onClick={() => saveCustomer(customer)}
                              disabled={!dirty || saving || !customer.name.trim()}
                              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white transition-colors disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                            >
                              <Save size={13} />
                              {saving ? "保存中" : dirty ? "保存" : "保存済"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-fade-in-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-800">貸出先の登録</h2>
              <button
                onClick={closeNewCustomerModal}
                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddCustomer} className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">貸出先名 *</label>
                  <input
                    type="text"
                    required
                    value={newCustomer.name}
                    onChange={(e) => updateNewCustomer("name", e.target.value)}
                    placeholder="例: 〇〇ダイビング"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">会社名</label>
                  <input
                    type="text"
                    value={newCustomer.companyName}
                    onChange={(e) => updateNewCustomer("companyName", e.target.value)}
                    placeholder="未入力なら貸出先名と同じ"
                    className={inputClass}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">正式名称</label>
                  <input
                    type="text"
                    value={newCustomer.formalName}
                    onChange={(e) => updateNewCustomer("formalName", e.target.value)}
                    placeholder="請求書・正式表示用"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">10L 単価</label>
                  <input
                    type="number"
                    value={newCustomer.price10}
                    onChange={(e) => updateNewCustomer("price10", e.target.value)}
                    className={`${inputClass} text-right font-mono`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">12L 単価</label>
                  <input
                    type="number"
                    value={newCustomer.price12}
                    onChange={(e) => updateNewCustomer("price12", e.target.value)}
                    className={`${inputClass} text-right font-mono`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">アルミ 単価</label>
                  <input
                    type="number"
                    value={newCustomer.priceAluminum}
                    onChange={(e) => updateNewCustomer("priceAluminum", e.target.value)}
                    className={`${inputClass} text-right font-mono`}
                  />
                </div>
                <label className="flex items-center gap-2 pt-7 text-sm font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={newCustomer.isActive}
                    onChange={(e) => updateNewCustomer("isActive", e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  有効にする
                </label>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={closeNewCustomerModal}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newCustomer.name.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    "登録する"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
