"use client";

import { useState, useEffect } from "react";
import { 
  CheckSquare, ArrowLeft, Loader2, CheckCircle2,
  AlertCircle, Droplets, Package, ThumbsUp, X
} from "lucide-react";
import { db } from "@/lib/firebase/config";
import { 
  collection, query, where, getDocs, doc, writeBatch, serverTimestamp 
} from "firebase/firestore";

interface PendingReturn {
  id: string; // transaction id
  customerId: string;
  customerName: string;
  tankId: string;
  condition: "normal" | "unused" | "uncharged";
  createdAt: any;
}

interface ReturnGroup {
  customerId: string;
  customerName: string;
  items: PendingReturn[];
}

export default function StaffReturnsPage() {
  const [loading, setLoading] = useState(true);
  const [returnGroups, setReturnGroups] = useState<ReturnGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ReturnGroup | null>(null);
  
  // Fulfillment state
  const [approvals, setApprovals] = useState<Record<string, { approved: boolean, condition: "normal" | "unused" | "uncharged" }>>({});
  const [submitting, setSubmitting] = useState(false);

  // Fetch pending return requests
  const fetchData = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, "transactions"), 
        where("type", "==", "return"), 
        where("status", "==", "pending_approval")
      );
      const snap = await getDocs(q);
      const items: PendingReturn[] = [];
      snap.forEach(d => {
        items.push({ id: d.id, ...d.data() } as PendingReturn);
      });
      
      // Group by customer
      const groupMap = new Map<string, ReturnGroup>();
      items.forEach(item => {
        if (!groupMap.has(item.customerId)) {
          groupMap.set(item.customerId, {
            customerId: item.customerId,
            customerName: item.customerName,
            items: []
          });
        }
        groupMap.get(item.customerId)!.items.push(item);
      });
      
      const groups = Array.from(groupMap.values());
      // Sort groups by earliest request
      groups.forEach(g => g.items.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)));
      groups.sort((a, b) => (b.items[0]?.createdAt?.toMillis() || 0) - (a.items[0]?.createdAt?.toMillis() || 0));
      
      setReturnGroups(groups);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openGroup = (group: ReturnGroup) => {
    setSelectedGroup(group);
    
    // Initialize approvals state
    const initialApprovals: Record<string, any> = {};
    group.items.forEach(item => {
      initialApprovals[item.id] = { approved: false, condition: item.condition };
    });
    setApprovals(initialApprovals);
  };

  const closeGroup = () => {
    setSelectedGroup(null);
    setApprovals({});
  };

  const toggleApproval = (id: string) => {
    setApprovals(prev => ({
      ...prev,
      [id]: { ...prev[id], approved: !prev[id].approved }
    }));
  };

  const changeCondition = (id: string, newCondition: "normal" | "unused" | "uncharged") => {
    setApprovals(prev => ({
      ...prev,
      [id]: { ...prev[id], condition: newCondition }
    }));
  };

  /* ─── Submission Logic ─── */
  const fulfillReturns = async () => {
    if (!selectedGroup) return;
    
    // Get all items that were explicitly marked as approved
    const approvedItems = selectedGroup.items.filter(item => approvals[item.id]?.approved);
    
    if (approvedItems.length === 0) {
      alert("承認するタンクを選択してください");
      return;
    }

    setSubmitting(true);
    try {
      const batch = writeBatch(db);
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";

      // 1. Update each tank globally
      for (const item of approvedItems) {
        const approvalData = approvals[item.id];
        let finalStatus = "空";
        let finalAction = "返却";
        let finalNote = `[承認] 顧客: ${selectedGroup.customerName}`;
        
        if (approvalData.condition === "unused") {
          finalStatus = "充填済み";
          finalAction = "未使用返却";
          finalNote += " (タグ:未使用)";
        } else if (approvalData.condition === "uncharged") {
          finalAction = "返却(未充填)";
          finalNote += " (タグ:未充填/破損)";
        }

        const tankRef = doc(db, "tanks", item.tankId);
        batch.set(tankRef, {
          status: finalStatus,
          location: "倉庫",
          staff: staffName,
          updatedAt: serverTimestamp(),
          logNote: finalNote,
        }, { merge: true });

        // Retrieve prevStatus for logging purposes
        // Note: For absolute accuracy we could query it here, but saving an extra read by using "貸出中"
        // as the assumed previous state (since it's coming from a customer return).
        
        const logRef = doc(collection(db, "logs"));
        batch.set(logRef, {
          tankId: item.tankId,
          action: finalAction,
          prevStatus: "貸出中", // Approximation for batch efficiency
          newStatus: finalStatus,
          location: "倉庫",
          staff: staffName,
          timestamp: serverTimestamp(),
          note: finalNote,
          customerId: selectedGroup.customerId
        });

        // 2. Mark order as completed
        const orderRef = doc(db, "transactions", item.id);
        batch.update(orderRef, {
          status: "completed",
          finalCondition: approvalData.condition,
          fulfilledAt: serverTimestamp(),
          fulfilledBy: staffName
        });
      }

      await batch.commit();
      alert(`${approvedItems.length}件の返却を承認し、倉庫に回収しました`);
      closeGroup();
      fetchData(); // Refresh UI

    } catch (err: any) {
      alert("エラー: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60, color: "#94a3b8" }}>
        <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  // Active View: Fulfillment Dashboard
  if (selectedGroup) {
    const approvedCount = Object.values(approvals).filter(a => a.approved).length;
    
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)", background: "#f8fafc" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={closeGroup} style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "none", background: "#f1f5f9", cursor: "pointer", color: "#64748b" }}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.02em" }}>返却確認と承認</h2>
            <p style={{ fontSize: 12, color: "#64748b", margin: 0, marginTop: 2 }}>{selectedGroup.customerName}</p>
          </div>
        </div>

        {/* Info Card */}
        <div style={{ padding: "16px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>顧客からの返却リクエスト</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>
                実物と顧客の申告が合っているか確認し、承認してください
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#64748b", marginBottom: 2 }}>承認済み</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: approvedCount > 0 ? "#10b981" : "#94a3b8" }}>{approvedCount}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>/ {selectedGroup.items.length}本</span>
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Tanks List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px", paddingBottom: 100 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {selectedGroup.items.map(item => {
              const appState = approvals[item.id] || { approved: false, condition: item.condition };
              const isApproved = appState.approved;
              
              return (
                <div key={item.id} style={{
                  background: "#fff",
                  border: `2px solid ${isApproved ? "#10b981" : "#e2e8f0"}`,
                  borderRadius: 16,
                  padding: "16px",
                  transition: "all 0.15s"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div>
                      <span style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.04em", color: "#0f172a" }}>
                        {item.tankId}
                      </span>
                      <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginTop: 4 }}>
                        顧客申告: {
                          item.condition === "normal" ? "通常利用" : 
                          item.condition === "unused" ? "未使用" : "未充填"
                        }
                      </p>
                    </div>
                    
                    {/* Approve Toggle */}
                    <button
                      onClick={() => toggleApproval(item.id)}
                      style={{
                        width: 48, height: 48, borderRadius: 14, border: "none",
                        background: isApproved ? "#10b981" : "#f1f5f9",
                        color: isApproved ? "#fff" : "#cbd5e1",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer", transition: "all 0.15s"
                      }}
                    >
                      <ThumbsUp size={24} />
                    </button>
                  </div>
                  
                  {/* Condition editor (in case customer was wrong) */}
                  <div style={{ display: "flex", gap: 6 }}>
                    {([
                      { val: "normal", label: "通常", c: "#64748b" },
                      { val: "unused", label: "未使用", c: "#10b981" },
                      { val: "uncharged", label: "未充填", c: "#ef4444" }
                    ] as const).map(cTag => {
                      const isActive = appState.condition === cTag.val;
                      return (
                        <button
                          key={cTag.val}
                          onClick={() => changeCondition(item.id, cTag.val)}
                          style={{
                            flex: 1, padding: "8px 0", borderRadius: 10,
                            background: isActive ? `${cTag.c}15` : "#f8fafc",
                            border: `1.5px solid ${isActive ? cTag.c : "transparent"}`,
                            color: isActive ? cTag.c : "#94a3b8",
                            fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.1s"
                          }}
                        >
                          {cTag.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              );
            })}

            {/* Submit Overlay inside list at bottom */}
            {approvedCount > 0 && (
              <div style={{ marginTop: 16 }}>
                <button
                  onClick={fulfillReturns}
                  disabled={submitting}
                  style={{
                    pointerEvents: "auto",
                    width: "100%", padding: 16, borderRadius: 16, border: "none",
                    background: "#10b981", color: "#fff",
                    fontSize: 16, fontWeight: 800,
                    boxShadow: `0 8px 16px rgba(16, 185, 129, 0.25)`,
                    display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
                    cursor: submitting ? "wait" : "pointer"
                  }}
                >
                  {submitting ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={18} />}
                  {approvedCount} 件の返却を承認する
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active View: Order List
  return (
    <div style={{ padding: 20, paddingBottom: 60 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginBottom: 24, display: "flex", alignItems: "center", gap: 10, letterSpacing: "-0.02em" }}>
        <CheckSquare size={26} color="#10b981" />
        返却承認
      </h1>

      {returnGroups.length === 0 ? (
        <div style={{ 
          background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 20, 
          padding: "40px 20px", textAlign: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.02)"
        }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <CheckCircle2 size={32} color="#94a3b8" />
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>未確認の返却リクエストはありません</p>
          <p style={{ fontSize: 13, color: "#64748b" }}>顧客がアプリから返却するとここに表示されます</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {returnGroups.map((group) => {
            const dateStr = group.items[0]?.createdAt ? new Date(group.items[0].createdAt.toMillis()).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "";
            
            return (
              <button
                key={group.customerId}
                onClick={() => openGroup(group)}
                style={{ 
                  background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 16, 
                  padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.03)", transition: "transform 0.15s, border-color 0.15s",
                  cursor: "pointer", textAlign: "left", width: "100%"
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = "#cbd5e1"}
                onMouseOut={(e) => e.currentTarget.style.borderColor = "#e2e8f0"}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{group.customerName}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#a8a29e", background: "#f5f5f4", padding: "2px 6px", borderRadius: 4 }}>
                      {dateStr}〜
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {group.items.slice(0, 3).map((item, i) => (
                      <span key={i} style={{ fontSize: 12, fontWeight: 600, color: "#64748b", fontFamily: "monospace", letterSpacing: "0.02em" }}>
                        {item.tankId}
                      </span>
                    ))}
                    {group.items.length > 3 && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>+{group.items.length - 3}件</span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ fontSize: 24, fontWeight: 900, color: "#10b981", letterSpacing: "-0.04em" }}>{group.items.length}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>台</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  );
}
