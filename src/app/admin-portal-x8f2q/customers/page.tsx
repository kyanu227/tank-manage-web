"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Plus, Search, MoreVertical, Building2, KeyRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, getDocs, doc, updateDoc, serverTimestamp, query, orderBy } from "firebase/firestore";

interface Customer {
  id: string;
  name: string;
  pinCode: string; // Storing as plain text ONLY for this specific simple B2B use case, normally this entails Firebase Auth
  isActive: boolean;
  createdAt: any;
}

export default function CustomerManagementPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPin, setNewCustomerPin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "customers"), orderBy("createdAt", "desc"));
      const querySnapshot = await getDocs(q);
      const data: Customer[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as Customer);
      });
      setCustomers(data);
    } catch (error) {
      console.error("Error fetching customers: ", error);
      // Fallback for when collection doesn't exist or permissions fail initially
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  const generateRandomPin = () => {
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    setNewCustomerPin(pin);
  };

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim() || !newCustomerPin.trim()) return;
    
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, "customers"), {
        name: newCustomerName.trim(),
        pinCode: newCustomerPin.trim(),
        isActive: true,
        createdAt: serverTimestamp()
      });
      
      setIsModalOpen(false);
      setNewCustomerName("");
      setNewCustomerPin("");
      fetchCustomers(); // Refresh list
    } catch (error) {
      console.error("Error adding customer: ", error);
      alert("エラーが発生しました。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleCustomerStatus = async (id: string, currentStatus: boolean) => {
    try {
      const customerRef = doc(db, "customers", id);
      await updateDoc(customerRef, {
        isActive: !currentStatus
      });
      // Optimistic URL
      setCustomers(prev => prev.map(c => c.id === id ? { ...c, isActive: !currentStatus } : c));
    } catch (error) {
      console.error("Error updating status:", error);
      alert("ステータスの更新に失敗しました。");
    }
  };

  const filteredCustomers = customers.filter(c => 
    c.name.includes(searchTerm) || c.pinCode.includes(searchTerm)
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => router.push('/admin-portal-x8f2q')}
              className="w-10 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-full transition-colors shrink-0"
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-xl font-bold text-slate-800">貸出先管理（顧客マスター）</h1>
          </div>
          <button 
            onClick={() => {
              setIsModalOpen(true);
              if (!newCustomerPin) generateRandomPin();
            }}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
          >
            <Plus size={16} />
            新規登録
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        
        {/* Search & Filter Bar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="店舗名やPINコードで検索..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        {/* Customer List */}
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
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-bold">
                    <th className="px-6 py-4">お客様名 (店舗名)</th>
                    <th className="px-6 py-4">ログインPIN</th>
                    <th className="px-6 py-4">ステータス</th>
                    <th className="px-6 py-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCustomers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg shrink-0">
                            {customer.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-800">{customer.name}</p>
                            <p className="text-xs text-slate-400 font-mono mt-0.5">ID: {customer.id.slice(0, 8)}...</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <KeyRound size={14} className="text-slate-400" />
                          <span className="font-mono font-bold text-slate-700 tracking-widest bg-slate-100 px-2 py-1 rounded">
                            {customer.pinCode}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                          customer.isActive 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${customer.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {customer.isActive ? '有効' : '無効'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => toggleCustomerStatus(customer.id, customer.isActive)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                          >
                            {customer.isActive ? '無効化' : '有効化'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Add Customer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-800">新規顧客の登録</h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleAddCustomer} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">お客様名 (店舗名)</label>
                  <input 
                    type="text" 
                    required
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="例: 〇〇ダイビング"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 flex justify-between items-center">
                    ログイン用PINコード (4桁〜)
                    <button 
                      type="button" 
                      onClick={generateRandomPin}
                      className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                    >
                      自動生成
                    </button>
                  </label>
                  <input 
                    type="text" 
                    required
                    value={newCustomerPin}
                    onChange={(e) => setNewCustomerPin(e.target.value)}
                    placeholder="例: 1234"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-lg font-bold tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                  <p className="text-xs text-slate-500 mt-2">
                    ※ お客様はこのPINコードを入力して現場アプリ（ログイン・発注画面）にアクセスします。
                  </p>
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                >
                  キャンセル
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting || !newCustomerName || !newCustomerPin}
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
