"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ClipboardList, ArrowLeft, Loader2, Search, CheckCircle2,
  Package, Minus, Check, X, ThumbsUp,
  ArrowDownToLine, ChevronDown, ChevronRight,
} from "lucide-react";
import { db } from "@/lib/firebase/config";
import {
  collection, query, where, getDocs, doc, writeBatch, serverTimestamp, orderBy,
} from "firebase/firestore";
import {
  STATUS, ACTION, RETURN_TAG,
  validateTransition, resolveReturnAction,
  type ReturnTag,
} from "@/lib/tank-rules";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import DrumRoll from "@/components/DrumRoll";
import {
  type PendingOrder,
  normalizeOrderDoc, findMatchingItem, totalOrderQuantity, summarizeOrderItems,
} from "@/lib/order-types";

/* ─── Types ─── */
type TabId = "orders" | "approvals" | "bulk";

interface TankDoc { id: string; status: string; location: string; type?: string; }
interface PendingReturn {
  id: string;
  customerId: string;
  customerName: string;
  tankId: string;
  condition: Condition;
  createdAt: any;
}
interface ReturnGroup {
  customerId: string;
  customerName: string;
  items: PendingReturn[];
}
type Condition = "normal" | "unused" | "uncharged";

const CONDITION_LABELS: { val: Condition; label: string; color: string }[] = [
  { val: "normal", label: "通常", color: "#64748b" },
  { val: "unused", label: "未使用", color: "#10b981" },
  { val: "uncharged", label: "未充填", color: "#ef4444" },
];

/* ═══════════════════════════════════════════════
   Main Component — Tabs
═══════════════════════════════════════════════ */
export default function StaffOrdersPage() {
  const [tab, setTab] = useState<TabId>("orders");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 56px)", background: "#f8fafc", overflow: "hidden" }}>
      {/* Tab bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 0, padding: "0 16px" }}>
          {([
            { id: "orders" as TabId, label: "受注管理" },
            { id: "approvals" as TabId, label: "返却承認" },
            { id: "bulk" as TabId, label: "一括返却" },
          ]).map(({ id, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  flex: 1, padding: "12px 0", border: "none", background: "none",
                  fontSize: 14, fontWeight: active ? 800 : 600,
                  color: active ? "#3b82f6" : "#94a3b8",
                  borderBottom: `3px solid ${active ? "#3b82f6" : "transparent"}`,
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "orders" ? <OrdersTab /> : tab === "approvals" ? <ApprovalsTab /> : <BulkReturnTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Tab 1: 受注管理
═══════════════════════════════════════════════ */
function OrdersTab() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<PendingOrder | null>(null);

  const [scannedTanks, setScannedTanks] = useState<{ id: string; valid: boolean; error?: string }[]>([]);
  const [activePrefix, setActivePrefix] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [allTanks, setAllTanks] = useState<Record<string, TankDoc>>({});
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "transactions"), where("type", "==", "order"), where("status", "==", "pending"));
      const snap = await getDocs(q);
      const ordersData: PendingOrder[] = [];
      // normalizeOrderDoc を通して旧スキーマ(tankType/quantityスカラー)も
      // 新スキーマ(items配列)も一律 items ベースで扱えるようにする。
      snap.forEach((d) => ordersData.push(normalizeOrderDoc(d.id, d.data())));
      ordersData.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setOrders(ordersData);

      const tankSnap = await getDocs(collection(db, "tanks"));
      const tankMap: Record<string, TankDoc> = {};
      const pSet = new Set<string>();
      tankSnap.forEach((d) => {
        const raw = d.data();
        const t: TankDoc = {
          id: d.id,
          status: String(raw.status ?? ""),
          location: String(raw.location ?? ""),
          type: raw.type ? String(raw.type) : undefined,
        };
        tankMap[d.id] = t;
        const match = t.id.match(/^([A-Z]+)/i);
        if (match) pSet.add(match[1].toUpperCase());
      });
      setAllTanks(tankMap);
      setPrefixes(Array.from(pSet).sort());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

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
      addScannedTank(`${activePrefix}-${val}`);
      setInputValue("");
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const addScannedTank = (tankId: string) => {
    if (scannedTanks.some((t) => t.id === tankId)) return;
    if (!selectedOrder) return;

    const totalRequired = totalOrderQuantity(selectedOrder.items);
    const validCount = scannedTanks.filter((t) => t.valid).length;
    if (validCount >= totalRequired) { alert("発注数に達しています"); return; }

    const tank = allTanks[tankId];
    let valid = true, error = "";
    if (!tank) { valid = false; error = "未登録タンク"; }
    else {
      const v = validateTransition(tank.status, ACTION.LEND);
      if (!v.ok) { valid = false; error = v.reason || `[${tank.status}] は貸出不可`; }
      else if (tank.location !== "倉庫") { valid = false; error = "倉庫にありません"; }
      else {
        // items 配列（種別ごとの要求本数）との突合
        const matched = findMatchingItem(tank.type ?? "", selectedOrder.items);
        if (!matched) {
          valid = false;
          error = "この受注に含まれない種別です";
        } else {
          // すでに該当種別を必要数スキャン済みか？
          const scannedSameType = scannedTanks.filter((t) => {
            if (!t.valid) return false;
            const sTank = allTanks[t.id];
            return sTank && sTank.type === tank.type;
          }).length;
          if (scannedSameType >= matched.quantity) {
            valid = false;
            error = "この種別は必要数スキャン済みです";
          }
        }
      }
    }

    setScannedTanks([{ id: tankId, valid, error }, ...scannedTanks]);
    setLastAdded(tankId);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => setLastAdded(null), 1500);
  };

  const removeScannedTank = (id: string) => setScannedTanks(scannedTanks.filter((t) => t.id !== id));

  const fulfillOrder = async () => {
    if (!selectedOrder) return;
    const validTanks = scannedTanks.filter((t) => t.valid);
    const totalRequired = totalOrderQuantity(selectedOrder.items);

    // items 配列の各種別について、必要本数をスキャンしきったか確認する
    // （scannedTanks を tank.type でグループ化して、items 側の quantity と突合）
    const scannedByType = new Map<string, number>();
    validTanks.forEach((t) => {
      const tk = allTanks[t.id];
      const tType = tk?.type ?? "";
      scannedByType.set(tType, (scannedByType.get(tType) ?? 0) + 1);
    });
    const unmetItems = selectedOrder.items.filter(
      (it) => (scannedByType.get(it.tankType) ?? 0) !== it.quantity
    );
    if (validTanks.length !== totalRequired || unmetItems.length > 0) {
      alert(`数量が一致しません (${validTanks.length}/${totalRequired})`);
      return;
    }
    setSubmitting(true);
    try {
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";
      const orderNote = `受注ID: ${selectedOrder.id}`;

      await applyBulkTankOperations(
        validTanks.map((tank) => ({
          tankId: tank.id,
          transitionAction: ACTION.LEND,
          logAction: "受注貸出",
          currentStatus: allTanks[tank.id]?.status ?? "",
          staff: staffName,
          location: selectedOrder.customerName,
          tankNote: orderNote,
          logNote: orderNote,
          logExtra: { customerId: selectedOrder.customerId },
        })),
        (batch) => {
          batch.update(doc(db, "transactions", selectedOrder.id), {
            status: "completed",
            fulfilledAt: serverTimestamp(),
            fulfilledBy: staffName,
          });
        }
      );

      alert("受注したタンクを貸し出しました");
      closeFulfillment();
      fetchData();
    } catch (err: any) { alert("エラー: " + err.message); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 size={24} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} /></div>;

  if (selectedOrder) {
    const validCount = scannedTanks.filter((t) => t.valid).length;
    const totalRequired = totalOrderQuantity(selectedOrder.items);
    // 各種別ごとに必要本数をスキャンしきった場合のみ完了可能とする
    const scannedByType = new Map<string, number>();
    scannedTanks.forEach((t) => {
      if (!t.valid) return;
      const tk = allTanks[t.id];
      const tType = tk?.type ?? "";
      scannedByType.set(tType, (scannedByType.get(tType) ?? 0) + 1);
    });
    const isReady =
      validCount === totalRequired &&
      selectedOrder.items.every((it) => (scannedByType.get(it.tankType) ?? 0) === it.quantity);

    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={closeFulfillment} style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "none", background: "#f1f5f9", cursor: "pointer", color: "#64748b" }}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0 }}>受注対応</h2>
            <p style={{ fontSize: 12, color: "#64748b", margin: 0, marginTop: 2 }}>{selectedOrder.customerName}</p>
          </div>
        </div>

        <div style={{ padding: "16px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Package size={20} color="#3b82f6" />
              </div>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 2 }}>要求</p>
                <p style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>{summarizeOrderItems(selectedOrder.items)}</p>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#64748b", marginBottom: 2 }}>スキャン状況</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: isReady ? "#10b981" : "#3b82f6" }}>{validCount}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>/ {totalRequired}本</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#fff", borderRadius: 14,
                border: `2px solid ${activePrefix ? "#3b82f6" : "#e2e8f0"}`,
                padding: "8px 12px", transition: "border-color 0.2s",
              }}>
                <span style={{ fontSize: 28, fontWeight: 900, fontFamily: "monospace", color: activePrefix ? "#3b82f6" : "#cbd5e1", minWidth: 36, textAlign: "center" }}>
                  {activePrefix || "?"}
                </span>
                <span style={{ fontSize: 24, fontWeight: 300, color: "#cbd5e1" }}>-</span>
                <input ref={inputRef} type="tel" inputMode="numeric" pattern="[0-9]*" placeholder="00" value={inputValue} onChange={handleInputChange} disabled={!activePrefix} autoComplete="off"
                  style={{ flex: 1, fontSize: 28, fontWeight: 900, fontFamily: "monospace", color: "#0f172a", background: "transparent", border: "none", outline: "none", letterSpacing: "0.15em", textAlign: "center", maxWidth: 80 }}
                />
              </div>
              {lastAdded && (
                <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, background: "#ecfdf5", border: "1px solid #a7f3d0", textAlign: "center", fontSize: 14, fontWeight: 800, color: "#059669" }}>
                  ✓ {lastAdded} 追加
                </div>
              )}
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
                    <div key={item.id} style={{ background: "#fff", padding: "12px 16px", borderRadius: 12, borderLeft: `5px solid ${item.valid ? "#3b82f6" : "#ef4444"}`, boxShadow: "0 2px 6px rgba(0,0,0,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between", animation: "slideInLeft 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)" }}>
                      <div>
                        <span style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: "#0f172a" }}>{item.id}</span>
                        <div style={{ fontSize: 11, color: item.valid ? "#64748b" : "#ef4444", fontWeight: 600, marginTop: 4 }}>{item.valid ? "OK" : item.error}</div>
                      </div>
                      <button onClick={() => removeScannedTank(item.id)} style={{ border: "none", background: "none", color: "#cbd5e1", padding: 8, cursor: "pointer" }}><X size={18} /></button>
                    </div>
                  ))}
                  {isReady && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ marginBottom: 8, textAlign: "center", fontSize: 13, fontWeight: 700, color: "#10b981" }}>貸出先: {selectedOrder.customerName}</div>
                      <button onClick={fulfillOrder} disabled={submitting}
                        style={{ width: "100%", padding: 16, borderRadius: 16, border: "none", background: "#10b981", color: "#fff", fontSize: 16, fontWeight: 800, boxShadow: "0 8px 16px rgba(16,185,129,0.25)", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, cursor: submitting ? "wait" : "pointer" }}>
                        {submitting ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={18} />}
                        受注を完了する
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 循環ドラムロール（共通コンポーネント化） */}
          <DrumRoll
            items={prefixes}
            value={activePrefix}
            onChange={(p) => setActivePrefix(p)}
            onSelect={(p) => focusInput(p)}
            accentColor="#3b82f6"
          />
        </div>

        <style>{`@keyframes slideInLeft { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      {orders.length === 0 ? (
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 20, padding: "40px 20px", textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <CheckCircle2 size={32} color="#94a3b8" />
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>未対応の受注はありません</p>
          <p style={{ fontSize: 13, color: "#64748b" }}>顧客がアプリから発注するとここに表示されます</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {orders.map((order) => {
            const dateStr = order.createdAt ? new Date(order.createdAt.toMillis()).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
            const total = totalOrderQuantity(order.items);
            // 1種別: "スチール10L × 3本" / 複数種別: "3種・合計10本"
            const summary = order.items.length === 1
              ? `${order.items[0].tankType} × ${order.items[0].quantity}本`
              : `${order.items.length}種・合計${total}本`;
            return (
              <button key={order.id} onClick={() => openFulfillment(order)}
                style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 16, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", textAlign: "left", width: "100%" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{order.customerName}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{dateStr}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#475569", background: "#f1f5f9", padding: "4px 8px", borderRadius: 6 }}>{summary}</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, flexShrink: 0, marginLeft: 12 }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: "#3b82f6" }}>{total}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>本</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Tab 2: 返却承認 (portal-initiated returns)
═══════════════════════════════════════════════ */
function ApprovalsTab() {
  const [loading, setLoading] = useState(true);
  const [returnGroups, setReturnGroups] = useState<ReturnGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ReturnGroup | null>(null);
  const [approvals, setApprovals] = useState<Record<string, { approved: boolean; condition: Condition }>>({});
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "transactions"), where("type", "==", "return"), where("status", "==", "pending_approval"));
      const snap = await getDocs(q);
      const items: PendingReturn[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as PendingReturn));
      const groupMap = new Map<string, ReturnGroup>();
      items.forEach((item) => {
        if (!groupMap.has(item.customerId)) groupMap.set(item.customerId, { customerId: item.customerId, customerName: item.customerName, items: [] });
        groupMap.get(item.customerId)!.items.push(item);
      });
      const groups = Array.from(groupMap.values());
      groups.forEach((g) => g.items.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)));
      groups.sort((a, b) => (b.items[0]?.createdAt?.toMillis() || 0) - (a.items[0]?.createdAt?.toMillis() || 0));
      setReturnGroups(groups);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const openGroup = (group: ReturnGroup) => {
    setSelectedGroup(group);
    const init: Record<string, { approved: boolean; condition: Condition }> = {};
    group.items.forEach((item) => { init[item.id] = { approved: false, condition: item.condition }; });
    setApprovals(init);
  };

  const fulfillReturns = async () => {
    if (!selectedGroup) return;
    const approved = selectedGroup.items.filter((i) => approvals[i.id]?.approved);
    if (approved.length === 0) { alert("承認するタンクを選択してください"); return; }
    setSubmitting(true);
    try {
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";

      const approvedData = approved.map((item) => {
        const appData = approvals[item.id];
        const tag: ReturnTag =
          appData.condition === "unused" ? RETURN_TAG.UNUSED
            : appData.condition === "uncharged" ? RETURN_TAG.DEFECT
            : RETURN_TAG.NORMAL;
        const note = `[承認] 顧客: ${selectedGroup.customerName} (タグ:${appData.condition})`;
        return { item, tag, condition: appData.condition, note };
      });

      await applyBulkTankOperations(
        approvedData.map(({ item, tag, note }) => ({
          tankId: item.tankId,
          transitionAction: resolveReturnAction(tag, STATUS.LENT),
          currentStatus: STATUS.LENT,
          staff: staffName,
          location: "倉庫",
          tankNote: note,
          logNote: note,
          logExtra: { customerId: selectedGroup.customerId },
        })),
        (batch) => {
          approvedData.forEach(({ item, condition }) => {
            batch.update(doc(db, "transactions", item.id), {
              status: "completed",
              finalCondition: condition,
              fulfilledAt: serverTimestamp(),
              fulfilledBy: staffName,
            });
          });
        }
      );

      alert(`${approved.length}件の返却を承認しました`);
      setSelectedGroup(null);
      fetchData();
    } catch (e: any) { alert("エラー: " + e.message); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 size={24} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} /></div>;

  if (selectedGroup) {
    const approvedCount = Object.values(approvals).filter((a) => a.approved).length;
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setSelectedGroup(null)} style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "#f1f5f9", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowLeft size={16} />
          </button>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0 }}>{selectedGroup.customerName}</p>
            <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>返却承認 — {approvedCount}/{selectedGroup.items.length}</p>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", paddingBottom: 100 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {selectedGroup.items.map((item) => {
              const app = approvals[item.id] || { approved: false, condition: item.condition };
              return (
                <div key={item.id} style={{ background: "#fff", border: `2px solid ${app.approved ? "#10b981" : "#e2e8f0"}`, borderRadius: 16, padding: 16, transition: "border-color 0.15s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: "#0f172a" }}>{item.tankId}</span>
                    <button onClick={() => setApprovals((p) => ({ ...p, [item.id]: { ...p[item.id], approved: !p[item.id].approved } }))}
                      style={{ width: 44, height: 44, borderRadius: 12, border: "none", background: app.approved ? "#10b981" : "#f1f5f9", color: app.approved ? "#fff" : "#cbd5e1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}>
                      <ThumbsUp size={20} />
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {CONDITION_LABELS.map((c) => (
                      <button key={c.val} onClick={() => setApprovals((p) => ({ ...p, [item.id]: { ...p[item.id], condition: c.val } }))}
                        style={{ flex: 1, padding: "8px 0", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1.5px solid", transition: "all 0.1s", background: app.condition === c.val ? `${c.color}15` : "#f8fafc", borderColor: app.condition === c.val ? c.color : "transparent", color: app.condition === c.val ? c.color : "#94a3b8" }}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {approvedCount > 0 && (
              <button onClick={fulfillReturns} disabled={submitting}
                style={{ width: "100%", padding: 16, borderRadius: 16, border: "none", background: "#10b981", color: "#fff", fontSize: 16, fontWeight: 800, cursor: submitting ? "wait" : "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 8, boxShadow: "0 8px 16px rgba(16,185,129,0.25)" }}>
                {submitting ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={18} />}
                {approvedCount}件の返却を承認する
              </button>
            )}
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      {returnGroups.length === 0 ? (
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 20, padding: "40px 20px", textAlign: "center" }}>
          <CheckCircle2 size={32} color="#94a3b8" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>未確認の返却リクエストはありません</p>
          <p style={{ fontSize: 13, color: "#64748b" }}>顧客がアプリから返却するとここに表示されます</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {returnGroups.map((group) => (
            <button key={group.customerId} onClick={() => openGroup(group)}
              style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 16, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", textAlign: "left", width: "100%" }}>
              <div>
                <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>{group.customerName}</p>
                <p style={{ fontSize: 12, color: "#94a3b8" }}>{group.items.length}本 返却待ち</p>
              </div>
              <span style={{ fontSize: 24, fontWeight: 900, color: "#10b981" }}>{group.items.length}<span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>本</span></span>
            </button>
          ))}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Tab 3: 一括返却
═══════════════════════════════════════════════ */
type BulkTagType = "normal" | "unused" | "defect";

interface BulkTankDoc {
  id: string;
  status: string;
  location: string;
  staff: string;
  updatedAt: any;
  logNote?: string;
}

const BULK_TAGS: { id: BulkTagType; label: string; color: string; bg: string; borderColor: string }[] = [
  { id: "normal", label: "通常", color: "#64748b", bg: "#f1f5f9", borderColor: "#e2e8f0" },
  { id: "unused", label: "未使用", color: "#10b981", bg: "#ecfdf5", borderColor: "#6ee7b7" },
  { id: "defect", label: "未充填", color: "#ef4444", bg: "#fef2f2", borderColor: "#fca5a5" },
];

function BulkReturnTab() {
  const [loading, setLoading] = useState(true);
  const [groupedTanks, setGroupedTanks] = useState<Record<string, (BulkTankDoc & { tag: BulkTagType })[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [returning, setReturning] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "tanks"), where("status", "in", [STATUS.LENT, STATUS.UNRETURNED]));
      const snap = await getDocs(q);

      const groups: Record<string, (BulkTankDoc & { tag: BulkTagType })[]> = {};

      snap.forEach((d) => {
        const data = d.data();
        const loc = data.location || "不明";
        if (!groups[loc]) groups[loc] = [];

        let tag: BulkTagType = "normal";
        if (data.logNote === "[TAG:unused]") tag = "unused";
        if (data.logNote === "[TAG:defect]") tag = "defect";

        groups[loc].push({ id: d.id, ...data, tag } as any);
      });

      // グループ内のタンクをIDでソート
      Object.keys(groups).forEach(loc => {
        groups[loc].sort((a, b) => a.id.localeCompare(b.id));
      });

      setGroupedTanks(groups);

      // 全て展開
      const newExpanded: Record<string, boolean> = {};
      Object.keys(groups).forEach(loc => newExpanded[loc] = true);
      setExpanded(newExpanded);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleExpand = (loc: string) => {
    setExpanded(prev => ({ ...prev, [loc]: !prev[loc] }));
  };

  const updateTag = async (loc: string, tankId: string, newTag: BulkTagType) => {
    // 楽観的UI更新
    setGroupedTanks(prev => {
      const g = { ...prev };
      g[loc] = g[loc].map(t => (t.id === tankId ? { ...t, tag: newTag } : t));
      return g;
    });

    try {
      let logNote = "";
      if (newTag === "unused") logNote = "[TAG:unused]";
      if (newTag === "defect") logNote = "[TAG:defect]";

      const ref = doc(db, "tanks", tankId);
      await writeBatch(db).update(ref, { logNote }).commit();
    } catch (e) {
      console.error("Failed to update tag", e);
      fetchData();
    }
  };

  const handleBulkReturnForLocation = async (loc: string) => {
    const tanksToReturn = groupedTanks[loc];
    if (!tanksToReturn || tanksToReturn.length === 0) return;

    if (!confirm(`${loc} の貸出中タンク全 ${tanksToReturn.length} 本を一括返却しますか？\n(タグ付けに応じて処理されます)`)) return;

    setReturning(prev => ({ ...prev, [loc]: true }));
    try {
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";

      await applyBulkTankOperations(
        tanksToReturn.map((tank) => {
          const tag = (tank.tag || RETURN_TAG.NORMAL) as ReturnTag;
          return {
            tankId: tank.id,
            transitionAction: resolveReturnAction(tag, tank.status),
            currentStatus: tank.status,
            staff: staffName,
            location: "倉庫",
          };
        })
      );

      alert(`${loc} の一括返却が完了しました。`);
      fetchData();

    } catch (e: any) {
      alert("エラー: " + e.message);
    } finally {
      setReturning(prev => ({ ...prev, [loc]: false }));
    }
  };

  const locationKeys = Object.keys(groupedTanks).sort();

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <Loader2 size={24} style={{ animation: "spin 1s linear infinite", color: "#64748b" }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>読み込み中…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      {locationKeys.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 40, textAlign: "center" }}>
          <CheckCircle2 size={40} color="#10b981" style={{ marginBottom: 16, opacity: 0.8 }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: "#334155" }}>貸出中のタンクはありません</p>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>すべて返却済みです</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {locationKeys.map(loc => {
            const tanks = groupedTanks[loc];
            const isExpanded = expanded[loc];
            const isReturning = returning[loc];

            return (
              <div key={loc} style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, overflow: "hidden" }}>

                {/* アコーディオンヘッダー */}
                <div
                  onClick={() => toggleExpand(loc)}
                  style={{
                    padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
                    cursor: "pointer", userSelect: "none", background: isExpanded ? "#f8fafc" : "#fff",
                    borderBottom: isExpanded ? "1px solid #e8eaed" : "none", transition: "background 0.2s"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ padding: 4, background: "#e0f2fe", borderRadius: 8, color: "#0284c7" }}>
                      {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0 }}>{loc}</h3>
                      <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0 0", fontWeight: 600 }}>
                        {tanks.length}本 貸出中
                      </p>
                    </div>
                  </div>

                  {/* 一括返却ボタン */}
                  <div onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handleBulkReturnForLocation(loc)}
                      disabled={isReturning}
                      style={{
                        padding: "8px 16px", borderRadius: 10, border: "none",
                        background: isReturning ? "#e2e8f0" : "#0f172a",
                        color: isReturning ? "#94a3b8" : "#fff",
                        fontSize: 13, fontWeight: 700, cursor: isReturning ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
                        boxShadow: isReturning ? "none" : "0 2px 4px rgba(0,0,0,0.1)"
                      }}
                    >
                      {isReturning ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <ArrowDownToLine size={16} />}
                      {loc}分を一括返却
                    </button>
                  </div>
                </div>

                {/* アコーディオンボディ */}
                {isExpanded && (
                  <div style={{ padding: "16px 20px", background: "#fff" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                      {tanks.map(tank => (
                        <div key={tank.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", border: "1px solid #f1f5f9", borderRadius: 12, background: "#f8fafc" }}>

                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: "#1e293b", letterSpacing: "0.05em" }}>
                              {tank.id}
                            </span>
                            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginTop: 2 }}>
                              {tank.staff}
                            </span>
                          </div>

                          {/* タグセレクター */}
                          <div style={{ display: "flex", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 2, flexShrink: 0 }}>
                            {BULK_TAGS.map((tag) => {
                              const active = tank.tag === tag.id;
                              return (
                                <button
                                  key={tag.id}
                                  onClick={() => updateTag(loc, tank.id, tag.id)}
                                  style={{
                                    padding: "6px 10px", border: "none", borderRadius: 6,
                                    background: active ? tag.bg : "transparent",
                                    color: active ? tag.color : "#94a3b8",
                                    fontSize: 11, fontWeight: active ? 800 : 600,
                                    cursor: "pointer", transition: "all 0.15s",
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
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
