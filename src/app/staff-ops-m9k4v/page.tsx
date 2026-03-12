"use client";

import { useState, useEffect } from "react";
import { PackageOpen, ShoppingCart, Check, X, Clock, MapPin, Search } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, serverTimestamp, getDoc } from "firebase/firestore";

interface PendingTransaction {
  id: string;
  type: "order" | "return";
  status: "pending" | "pending_approval";
  destination?: string;
  tankType?: string;
  quantity?: number;
  tankId?: string;
  condition?: "normal" | "unused" | "defect";
  note?: string;
  createdAt: any;
}

export default function StaffPanel() {
  const [activeTab, setActiveTab] = useState<"returns" | "orders">("returns");
  const [transactions, setTransactions] = useState<PendingTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Subscribe to pending transactions
  useEffect(() => {
    const q = query(
      collection(db, "transactions"),
      where("status", "in", ["pending", "pending_approval"]),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: PendingTransaction[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as PendingTransaction);
      });
      setTransactions(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const returns = transactions.filter(t => t.type === "return");
  const orders = transactions.filter(t => t.type === "order");

  const handleApproveReturn = async (txId: string, tankId: string, condition: string, note?: string) => {
    try {
      // 1. Update transaction status
      await updateDoc(doc(db, "transactions", txId), {
        status: "approved",
        approvedAt: serverTimestamp(),
      });

      // 2. Logic to update actual Tank status in 'tanks' collection
      // (Simplified logic based on architecture)
      let newStatus = "空";
      if (condition === "unused") newStatus = "充填済み";
      // We would also write this to a 'logs' collection for billing/history

      alert(`${tankId} の返却を承認しました（状態: ${newStatus}）`);
    } catch (error) {
      console.error("Error approving return:", error);
      alert("エラーが発生しました");
    }
  };

  const handleDeliverOrder = async (txId: string) => {
    try {
      await updateDoc(doc(db, "transactions", txId), {
        status: "delivered",
        deliveredAt: serverTimestamp(),
      });
      alert("配達完了として記録しました");
    } catch (error) {
      console.error("Error delivering order:", error);
      alert("エラーが発生しました");
    }
  };

  return (
    <div className="container max-w-3xl mx-auto py-8 px-4 animate-fade-in">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">現場作業パネル</h1>
          <p className="text-slate-500 text-sm mt-1">顧客からの発注・返却リクエストの処理</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-200/50 p-1 rounded-lg mb-6 max-w-fit">
        <button 
          onClick={() => setActiveTab("returns")}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'returns' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800 hover:bg-slate-200'}`}
        >
          <PackageOpen size={16} />
          返送承認待ち
          {returns.length > 0 && (
            <span className="bg-red-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full ml-1">
              {returns.length}
            </span>
          )}
        </button>
        <button 
          onClick={() => setActiveTab("orders")}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'orders' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800 hover:bg-slate-200'}`}
        >
          <ShoppingCart size={16} />
          配達待ち (発注)
          {orders.length > 0 && (
            <span className="bg-amber-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full ml-1">
              {orders.length}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : activeTab === 'returns' ? (
        <div className="space-y-4">
          {returns.length === 0 ? (
            <div className="text-center py-16 bg-white border border-slate-200 rounded-xl">
              <PackageOpen size={40} className="mx-auto text-slate-300 mb-4" />
              <p className="text-slate-500 font-medium">承認待ちの返送はありません</p>
            </div>
          ) : (
            returns.map(req => (
              <div key={req.id} className="card p-5 border-l-4 border-l-blue-500 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider">返却</span>
                    <span className="text-sm text-slate-500 flex items-center gap-1">
                      <Clock size={12} />
                      {req.createdAt?.toDate().toLocaleString('ja-JP', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800 font-mono mb-1">{req.tankId}</h3>
                  
                  <div className="flex items-center gap-3">
                    <div className="text-sm flex items-center gap-1.5">
                      <span className="text-slate-500">申告状態:</span>
                      {req.condition === 'normal' && <span className="text-slate-700 font-medium">通常返却</span>}
                      {req.condition === 'unused' && <span className="text-green-600 font-medium">未使用</span>}
                      {req.condition === 'defect' && <span className="text-red-600 font-medium">トラブル ({req.note || '詳細なし'})</span>}
                    </div>
                  </div>
                </div>
                
                <div className="flex w-full sm:w-auto gap-2">
                  <button onClick={() => handleApproveReturn(req.id, req.tankId!, req.condition!, req.note)} className="flex-1 sm:flex-none btn-primary py-2 px-4 shadow-none">
                    <Check size={18} />
                    <span>この内容で承認</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {orders.length === 0 ? (
            <div className="text-center py-16 bg-white border border-slate-200 rounded-xl">
              <ShoppingCart size={40} className="mx-auto text-slate-300 mb-4" />
              <p className="text-slate-500 font-medium">配達待ちの発注はありません</p>
            </div>
          ) : (
            orders.map(req => (
              <div key={req.id} className="card p-5 border-l-4 border-l-emerald-500 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider">発注</span>
                    <span className="text-sm text-slate-500 flex items-center gap-1">
                      <Clock size={12} />
                      {req.createdAt?.toDate().toLocaleString('ja-JP', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin size={16} className="text-slate-400" />
                    <h3 className="text-lg font-bold text-slate-800">{req.destination}</h3>
                  </div>
                  
                  <p className="text-slate-600 font-medium text-lg ml-6">
                    {req.tankType} × <span className="text-2xl font-bold text-blue-600 mx-1">{req.quantity}</span> 本
                  </p>
                </div>
                
                <div className="flex w-full sm:w-auto gap-2 mt-4 sm:mt-0">
                  <button onClick={() => handleDeliverOrder(req.id)} className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-2 px-6 rounded-md font-medium transition-colors">
                    <Check size={18} />
                    <span>配達完了</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
