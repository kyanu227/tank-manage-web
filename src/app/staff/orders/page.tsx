"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { 
  ClipboardList, ArrowLeft, Loader2, Search, CheckCircle2,
  Package, Minus, Check, X
} from "lucide-react";
import { db } from "@/lib/firebase/config";
import { 
  collection, query, where, getDocs, doc, writeBatch, serverTimestamp, orderBy 
} from "firebase/firestore";

interface PendingOrder {
  id: string;
  customerId: string;
  customerName: string;
  tankType: string;
  quantity: number;
  createdAt: any;
}

interface TankDoc {
  id: string;
  status: string;
  location: string;
}

export default function StaffOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<PendingOrder | null>(null);
  
  // Fulfillment state
  const [scannedTanks, setScannedTanks] = useState<{ id: string, valid: boolean, error?: string }[]>([]);
  const [activePrefix, setActivePrefix] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [allTanks, setAllTanks] = useState<Record<string, TankDoc>>({});
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const dialContainerRef = useRef<HTMLDivElement>(null);
  const [dialMetrics, setDialMetrics] = useState({ gap: 16, blockHeight: 64 });

  useEffect(() => {
    const updateMetrics = () => {
      if (dialContainerRef.current && prefixes.length > 0) {
        const h = dialContainerRef.current.offsetHeight;
        if (h > 0) {
          const n = prefixes.length;
          const totalItemHeight = n * 48;
          const availableSpace = h - 16 - totalItemHeight;
          const calculatedGap = n > 1 ? Math.max(16, availableSpace / (n - 1)) : 16;
          
          setDialMetrics({
            gap: calculatedGap,
            blockHeight: 48 + calculatedGap
          });
        }
      }
    };

    updateMetrics();
    window.addEventListener("resize", updateMetrics);
    return () => window.removeEventListener("resize", updateMetrics);
  }, [prefixes, loading]);

  // Fetch orders and tanks

  // Fetch orders and tanks
  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch pending orders
      const q = query(
        collection(db, "transactions"), 
        where("type", "==", "order"), 
        where("status", "==", "pending")
      );
      const snap = await getDocs(q);
      const ordersData: PendingOrder[] = [];
      snap.forEach(d => {
        ordersData.push({ id: d.id, ...d.data() } as PendingOrder);
      });
      // Sort in memory since Firestore requires composite index for query sorting
      ordersData.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
      setOrders(ordersData);

      // 2. Fetch tanks for validation
      const tankSnap = await getDocs(collection(db, "tanks"));
      const tankMap: Record<string, TankDoc> = {};
      const pSet = new Set<string>();
      tankSnap.forEach((d) => {
        const t = { id: d.id, ...d.data() } as TankDoc;
        tankMap[d.id] = t;
        const match = t.id.match(/^([A-Z]+)/i);
        if (match) pSet.add(match[1].toUpperCase());
      });
      setAllTanks(tankMap);
      setPrefixes(Array.from(pSet).sort());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openFulfillment = (order: PendingOrder) => {
    setSelectedOrder(order);
    setScannedTanks([]);
    setActivePrefix(null);
    setInputValue("");
  };

  const closeFulfillment = () => {
    setSelectedOrder(null);
    setScannedTanks([]);
    setActivePrefix(null);
    setInputValue("");
  };

  /* ─── Dial Input Logic ─── */
  const focusInput = (prefix: string) => {
    setActivePrefix(prefix);
    setInputValue("");
    if (inputRef.current) inputRef.current.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, "");
    if (val.length > 2) return;
    setInputValue(val);

    if (val.length === 2 && activePrefix) {
      const tankId = `${activePrefix}-${val}`;
      addScannedTank(tankId);
      setInputValue("");
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const handleManualOkTrigger = () => {
    if (!activePrefix) return;
    let payload = inputValue;
    if (!payload) payload = "OK";
    
    const tankId = `${activePrefix}-${payload}`;
    addScannedTank(tankId);
    setInputValue("");
    if (inputRef.current) inputRef.current.focus();
  };

  const addScannedTank = (tankId: string) => {
    if (scannedTanks.some((t) => t.id === tankId)) return; // No dupes
    if (!selectedOrder) return;
    
    // Check if we already reached quantity
    const validCount = scannedTanks.filter(t => t.valid).length;
    if (validCount >= selectedOrder.quantity) {
      alert("発注数に達しています");
      return;
    }

    const tank = allTanks[tankId];
    let valid = true;
    let error = "";

    if (!tank) {
      valid = false;
      error = "未登録タンク";
    } else if (tank.status !== "充填済み" && tank.status !== "保管中") {
      valid = false;
      error = `[${tank.status}] は貸出不可`;
    } else if (tank.location !== "倉庫") {
      valid = false;
      error = "倉庫にありません";
    }

    setScannedTanks([{ id: tankId, valid, error }, ...scannedTanks]);

    setLastAdded(tankId);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => {
      setLastAdded(null);
    }, 1500);
  };

  const removeScannedTank = (id: string) => {
    setScannedTanks(scannedTanks.filter(t => t.id !== id));
  };

  /* ─── Submission Logic ─── */
  const fulfillOrder = async () => {
    if (!selectedOrder) return;
    const validTanks = scannedTanks.filter(t => t.valid);
    if (validTanks.length !== selectedOrder.quantity) {
      alert(`数量が一致しません (${validTanks.length}/${selectedOrder.quantity})`);
      return;
    }

    setSubmitting(true);
    try {
      const batch = writeBatch(db);
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";

      // 1. Update each tank globally to "貸出中" and set location to customerName
      validTanks.forEach((tank) => {
        const tankRef = doc(db, "tanks", tank.id);
        batch.set(tankRef, {
          status: "貸出中",
          location: selectedOrder.customerName,
          staff: staffName,
          updatedAt: serverTimestamp(),
          logNote: `受注ID: ${selectedOrder.id}`,
        }, { merge: true });

        // Create log entry
        const logRef = doc(collection(db, "logs"));
        batch.set(logRef, {
          tankId: tank.id,
          action: "受注貸出",
          prevStatus: allTanks[tank.id]?.status || "不明",
          newStatus: "貸出中",
          location: selectedOrder.customerName,
          staff: staffName,
          timestamp: serverTimestamp(),
          note: `受注ID: ${selectedOrder.id}`,
          customerId: selectedOrder.customerId
        });
      });

      // 2. Mark order as completed
      const orderRef = doc(db, "transactions", selectedOrder.id);
      batch.update(orderRef, {
        status: "completed",
        fulfilledAt: serverTimestamp(),
        fulfilledBy: staffName
      });

      await batch.commit();
      alert("受注したタンクを貸し出しました");
      closeFulfillment();
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
  if (selectedOrder) {
    const validCount = scannedTanks.filter(t => t.valid).length;
    const isReady = validCount === selectedOrder.quantity;

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 56px)", background: "#f8fafc", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={closeFulfillment} style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "none", background: "#f1f5f9", cursor: "pointer", color: "#64748b" }}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.02em" }}>受注対応</h2>
            <p style={{ fontSize: 12, color: "#64748b", margin: 0, marginTop: 2 }}>{selectedOrder.customerName}</p>
          </div>
        </div>

        {/* Info Card */}
        <div style={{ padding: "16px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Package size={20} color="#3b82f6" />
              </div>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 2 }}>要求</p>
                <p style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>{selectedOrder.tankType}</p>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#64748b", marginBottom: 2 }}>スキャン状況</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: isReady ? "#10b981" : "#3b82f6" }}>{validCount}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>/ {selectedOrder.quantity}本</span>
              </div>
            </div>
          </div>
        </div>

        {/* 2-Column Split */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          
          {/* Left Column: Scanned Tanks */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
            
            {/* Top OK Button Area */}
            <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
              <button
                onClick={handleManualOkTrigger}
                disabled={!activePrefix}
                style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: lastAdded ? "#10b981" : (activePrefix ? "#3b82f6" : "#e2e8f0"),
                  color: (activePrefix || lastAdded) ? "#fff" : "#94a3b8",
                  fontSize: 20, fontWeight: 900,
                  boxShadow: (activePrefix || lastAdded) ? `0 4px 12px ${lastAdded ? '#10b981' : '#3b82f6'}40` : "none",
                  cursor: activePrefix ? "pointer" : "not-allowed",
                  transition: "background 0.2s, box-shadow 0.2s"
                }}
              >
                {lastAdded
                  ? lastAdded
                  : (!activePrefix ? "OK入力" : inputValue ? `${activePrefix} - ${inputValue}` : `${activePrefix} - OK`)}
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {scannedTanks.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#cbd5e1" }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>右側のリストからアルファベットを選び、</p>
                <p style={{ margin: "4px 0", fontSize: 14, fontWeight: 600 }}>タンクの数字(2桁)を入力してください</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {scannedTanks.map((item) => (
                  <div key={item.id} className="queue-anim" style={{ 
                    background: "#fff", padding: "12px 16px", borderRadius: 12,
                    borderLeft: `5px solid ${item.valid ? "#3b82f6" : "#ef4444"}`,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    animation: "slideInLeft 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
                  }}>
                    <div>
                      <span style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.05em", color: "#0f172a" }}>
                        {item.id}
                      </span>
                      <div style={{ fontSize: 11, color: item.valid ? "#64748b" : "#ef4444", fontWeight: 600, marginTop: 4 }}>
                        {item.valid ? "OK" : item.error}
                      </div>
                    </div>
                    <button onClick={() => removeScannedTank(item.id)} style={{ border: "none", background: "none", color: "#cbd5e1", padding: 8, cursor: "pointer", marginRight: -8 }}>
                      <X size={18} />
                    </button>
                  </div>
                ))}
                
                {/* Submit Overlay inside list at bottom */}
                {isReady && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ marginBottom: 8, textAlign: "center", fontSize: 13, fontWeight: 700, color: "#10b981" }}>
                      貸出先: {selectedOrder.customerName}
                    </div>
                    <button
                      onClick={fulfillOrder}
                      disabled={submitting}
                      style={{
                        pointerEvents: "auto",
                        width: "100%", padding: 16, borderRadius: 16, border: "none",
                        background: "#10b981", color: "#fff",
                        fontSize: 16, fontWeight: 800,
                        boxShadow: `0 8px 16px rgba(16, 185, 129, 0.25)`,
                        display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
                        cursor: submitting ? "wait" : "pointer",
                        transition: "transform 0.1s", transform: submitting ? "scale(0.98)" : "scale(1)"
                      }}
                    >
                      {submitting ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={18} />}
                      受注を完了する
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

          {/* Right Column: Prefix List */}
          <div style={{ 
            width: 70, background: "#fff", borderLeft: "1px solid #e2e8f0", 
            display: "flex", flexDirection: "column", position: "relative"
          }}>
            {prefixes.length > 0 && (
              <>
                {/* Bottom Appeal Frame (Targeting Box) */}
                <div style={{
                  position: "absolute", bottom: 16, left: 6, right: 6, height: 48,
                  border: `3px solid #3b82f6`, borderRadius: 12, pointerEvents: "none", zIndex: 10,
                  background: `#3b82f60A`
                }} />

                {/* Invisible auto-submit input overlay */}
                <input
                  ref={inputRef}
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={inputValue}
                  onChange={handleInputChange}
                  style={{ position: "absolute", opacity: 0.01, zIndex: -1 }}
                />

                {/* Native Scroll Container */}
                <div 
                  ref={dialContainerRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    
                    // Use dynamic metrics
                    const { blockHeight } = dialMetrics;
                    
                    const rawIdx = Math.round(el.scrollTop / blockHeight);
                    const wrappedIdx = rawIdx % prefixes.length;
                    
                    if (prefixes[wrappedIdx] && prefixes[wrappedIdx] !== activePrefix) {
                      setActivePrefix(prefixes[wrappedIdx]);
                    }

                    // Infinite scroll loop reset
                    const cycleHeight = blockHeight * prefixes.length;
                    const totalHeight = cycleHeight * 30; // 30 repeated sets
                    
                    // Wrap instantly when we get too close to bounds
                    if (el.scrollTop < cycleHeight * 5) {
                      el.scrollTop = el.scrollTop + (cycleHeight * 10);
                    } else if (el.scrollTop > totalHeight - (cycleHeight * 5)) {
                      el.scrollTop = el.scrollTop - (cycleHeight * 10);
                    }
                  }}
                  style={{
                    flex: 1, overflowY: "auto", overflowX: "hidden", position: "relative",
                    scrollSnapType: "y mandatory", scrollPaddingBottom: 16
                  }}
                >
                  {/* Initial Spacer to align the FIRST item directly inside the bottom appeal frame */}
                  {/* (Container Height) - (Item Height: 48) - (Bottom Margin: 16) */}
                  <div style={{ height: `calc(100% - ${dialMetrics.blockHeight}px)`, flexShrink: 0 }} />
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: dialMetrics.gap, padding: "0 6px 16px 6px" }}>
                    {/* Fill 30 repetitions of the prefixes */}
                    {Array(30).fill(prefixes).flat().map((p, index) => {
                      const isActive = activePrefix === p;
                      return (
                        <div key={`${p}-${index}`} style={{ scrollSnapAlign: "end", scrollSnapStop: "always" }}>
                          <button
                            onClick={(e) => {
                              focusInput(p);
                              e.currentTarget.scrollIntoView({ behavior: "smooth", block: "end" });
                            }}
                            style={{
                              width: "100%", height: 48, borderRadius: 10, flexShrink: 0,
                              border: "none", background: "transparent",
                              color: isActive ? "#3b82f6" : "#94a3b8",
                              fontSize: 22, fontWeight: 900, fontFamily: "monospace",
                              transition: "all 0.15s ease", cursor: "pointer",
                              transform: isActive ? "scale(1.3)" : "scale(1.0)",
                            }}
                          >
                            {p}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <style>{`
          @keyframes slideInLeft {
            from { opacity: 0; transform: translateX(-20px); }
            to { opacity: 1; transform: translateX(0); }
          }
        `}</style>
      </div>
    );
  }

  // Active View: Order List
  return (
    <div style={{ padding: 20, paddingBottom: 60 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginBottom: 24, display: "flex", alignItems: "center", gap: 10, letterSpacing: "-0.02em" }}>
        <ClipboardList size={26} color="#3b82f6" />
        受注管理
      </h1>

      {orders.length === 0 ? (
        <div style={{ 
          background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 20, 
          padding: "40px 20px", textAlign: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.02)"
        }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <CheckCircle2 size={32} color="#94a3b8" />
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>未対応の受注はありません</p>
          <p style={{ fontSize: 13, color: "#64748b" }}>顧客がアプリから発注するとここに表示されます</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {orders.map((order) => {
            const dateStr = order.createdAt ? new Date(order.createdAt.toMillis()).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "";
            
            return (
              <button
                key={order.id}
                onClick={() => openFulfillment(order)}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{order.customerName}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{dateStr}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#475569", background: "#f1f5f9", padding: "4px 8px", borderRadius: 6 }}>
                      {order.tankType}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: "#3b82f6", letterSpacing: "-0.04em" }}>{order.quantity}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>本</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  );
}
