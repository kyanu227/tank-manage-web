"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowUpFromLine, ArrowDownToLine, Droplets,
  Plus, X, Send, CheckCircle2, AlertCircle, Loader2,
  Building, CheckSquare, Square, ChevronDown, MapPin,
  ArrowLeft, Package, ThumbsUp, ChevronRight,
} from "lucide-react";
import QuickSelect from "@/components/QuickSelect";
import DrumRoll from "@/components/DrumRoll";
import { db } from "@/lib/firebase/config";
import {
  collection, getDocs, doc, writeBatch,
  serverTimestamp, query, where, orderBy,
} from "firebase/firestore";
import {
  STATUS, ACTION, RETURN_TAG,
  validateTransition, resolveReturnAction,
  type TankAction, type ReturnTag,
} from "@/lib/tank-rules";
import { applyBulkTankOperations } from "@/lib/tank-operation";

/* ─── Types ─── */
type OpMode = "lend" | "return" | "fill";
type TagType = "normal" | "unused" | "defect";
type OpStyle = "manual" | "order";

// Future: configurable via admin settings
const DEFAULT_OP_STYLE: OpStyle = "manual";

interface QueueItem {
  uid: string;
  tankId: string;
  status?: string;
  valid: boolean;
  error?: string;
  tag: TagType;
}

interface TankDoc {
  id: string;
  status: string;
  location: string;
  staff: string;
}

/* ─── 受注管理 Types ─── */
interface PendingOrder {
  id: string;
  customerId: string;
  customerName: string;
  tankType: string;
  quantity: number;
  createdAt: any;
}

/* ─── 返却承認 Types ─── */
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

/* ─── 一括返却 Types ─── */
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

const MODE_CONFIG = {
  lend: {
    label: "貸出",
    icon: ArrowUpFromLine,
    color: "#3b82f6",
    bg: "#eff6ff",
    action: ACTION.LEND,
  },
  return: {
    label: "返却",
    icon: ArrowDownToLine,
    color: "#10b981",
    bg: "#ecfdf5",
    action: ACTION.RETURN,
  },
  fill: {
    label: "充填",
    icon: Droplets,
    color: "#f59e0b",
    bg: "#fffbeb",
    action: ACTION.FILL,
  },
} as const;

export default function OperationsPage() {
  const searchParams = useSearchParams();
  const modeParam = searchParams.get("mode") as OpMode | null;
  const [mode, setMode] = useState<OpMode>(modeParam || "lend");
  const [opStyle, setOpStyle] = useState<OpStyle>(DEFAULT_OP_STYLE);

  // ヘッダーのチップ切替を受信
  useEffect(() => {
    const handler = (e: Event) => {
      setOpStyle((e as CustomEvent).detail as OpStyle);
    };
    window.addEventListener("opStyleChange", handler);
    return () => window.removeEventListener("opStyleChange", handler);
  }, []);

  useEffect(() => {
    if (modeParam && MODE_CONFIG[modeParam]) setMode(modeParam);
  }, [modeParam]);

  const config = MODE_CONFIG[mode];

  // ページ自体の縦スクロールをロック
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      document.documentElement.style.overflow = "";
    };
  }, []);

  // 横スワイプでモード循環切替（documentレベルで登録）
  const MODES: OpMode[] = ["lend", "return", "fill"];
  const swipeRef = useRef<{ startX: number; startY: number } | null>(null);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      swipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY };
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!swipeRef.current) return;
      const dx = e.changedTouches[0].clientX - swipeRef.current.startX;
      const dy = e.changedTouches[0].clientY - swipeRef.current.startY;
      const startX = swipeRef.current.startX;
      swipeRef.current = null;
      // ドラムロール列（右端80px）から開始したスワイプは無視
      const screenW = window.innerWidth;
      if (startX > screenW - 80) return;
      // 横40px以上 & 横移動が縦より大きい
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      setMode(prev => {
        const idx = MODES.indexOf(prev);
        if (dx < 0) return MODES[(idx + 1) % MODES.length];
        return MODES[(idx - 1 + MODES.length) % MODES.length];
      });
    };
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // Master Data
  const [allTanks, setAllTanks] = useState<Record<string, TankDoc>>({});
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Operation State (手動貸出 / 充填)
  const [selectedDest, setSelectedDest] = useState<string>("");
  const [returnTag, setReturnTag] = useState<TagType>("normal");
  const [opQueue, setOpQueue] = useState<QueueItem[]>([]);

  // Dial / Input State
  const [activePrefix, setActivePrefix] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Submit State
  const [submitting, setSubmitting] = useState(false);

  /* ─── 受注管理 State ─── */
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<PendingOrder | null>(null);
  const [scannedTanks, setScannedTanks] = useState<{ id: string; valid: boolean; error?: string }[]>([]);
  const [orderActivePrefix, setOrderActivePrefix] = useState<string | null>(null);
  const [orderInputValue, setOrderInputValue] = useState("");
  const orderInputRef = useRef<HTMLInputElement>(null);
  const [orderLastAdded, setOrderLastAdded] = useState<string | null>(null);
  const orderSuccessTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);

  // 手動返却モード表示
  const [showManualReturn, setShowManualReturn] = useState(false);

  /* ─── 返却承認 State ─── */
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [returnGroups, setReturnGroups] = useState<ReturnGroup[]>([]);
  const [selectedReturnGroup, setSelectedReturnGroup] = useState<ReturnGroup | null>(null);
  const [approvals, setApprovals] = useState<Record<string, { approved: boolean; condition: Condition }>>({});
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);

  /* ─── 一括返却 State ─── */
  const [bulkLoading, setBulkLoading] = useState(true);
  const [groupedTanks, setGroupedTanks] = useState<Record<string, (BulkTankDoc & { tag: BulkTagType })[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [returning, setReturning] = useState<Record<string, boolean>>({});

  /* ═══════════════════════════════════════════════
     Data Fetching
  ═══════════════════════════════════════════════ */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
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

      const custSnap = await getDocs(collection(db, "customers"));
      const dests: string[] = [];
      custSnap.forEach((d) => {
        const data = d.data();
        if (data.isActive !== false) dests.push(data.name);
      });
      setDestinations(dests);
      if (dests.length > 0) setSelectedDest(dests[0]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const q = query(collection(db, "transactions"), where("type", "==", "order"), where("status", "==", "pending"));
      const snap = await getDocs(q);
      const ordersData: PendingOrder[] = [];
      snap.forEach((d) => ordersData.push({ id: d.id, ...d.data() } as PendingOrder));
      ordersData.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setPendingOrders(ordersData);
    } catch (err) { console.error(err); }
    finally { setOrdersLoading(false); }
  }, []);

  const fetchApprovals = useCallback(async () => {
    setApprovalsLoading(true);
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
    finally { setApprovalsLoading(false); }
  }, []);

  const fetchBulkTanks = useCallback(async () => {
    setBulkLoading(true);
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
      Object.keys(groups).forEach(loc => {
        groups[loc].sort((a, b) => a.id.localeCompare(b.id));
      });
      setGroupedTanks(groups);
      const newExpanded: Record<string, boolean> = {};
      Object.keys(groups).forEach(loc => newExpanded[loc] = true);
      setExpanded(newExpanded);
    } catch (e) { console.error(e); }
    finally { setBulkLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // モード変更時にデータ取得 + 状態リセット
  useEffect(() => {
    setOpQueue([]);
    setReturnTag("normal");
    setInputValue("");
    setActivePrefix(null);

    if (mode === "lend") {
      // opStyle is now global, no reset needed;
      fetchOrders();
    }
    if (mode === "return") {
      fetchApprovals();
      fetchBulkTanks();
      setSelectedReturnGroup(null);
      setShowManualReturn(false);
    }
  }, [mode, fetchOrders, fetchApprovals, fetchBulkTanks]);

  /* ═══════════════════════════════════════════════
     手動貸出 / 充填 — Input Handling
  ═══════════════════════════════════════════════ */
  const focusInput = (prefix: string) => {
    setActivePrefix(prefix);
    setInputValue("");
    // prefix変更時にアニメ即キャンセル
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    setLastAdded(null);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, "");
    if (val.length > 2) return;
    // 入力開始時にアニメ即キャンセル
    if (val.length > 0 && lastAdded) {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
      setLastAdded(null);
    }
    setInputValue(val);

    if (val.length === 2 && activePrefix) {
      const tankId = `${activePrefix}-${val}`;
      addToQueue(tankId);
      setInputValue("");
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const handleManualOkTrigger = () => {
    if (!activePrefix) return;
    let payload = inputValue;
    if (!payload) payload = "OK";
    const tankId = `${activePrefix}-${payload}`;
    addToQueue(tankId);
    setInputValue("");
    if (inputRef.current) inputRef.current.focus();
  };

  const addToQueue = (tankId: string) => {
    if (opQueue.some((q) => q.tankId === tankId)) return;

    const tank = allTanks[tankId];
    const currentStatus = tank?.status || "";
    let valid = true;
    let error = "";

    if (!tank) {
      valid = false;
      error = "未登録タンク";
    } else {
      const v = validateTransition(currentStatus, config.action);
      if (!v.ok) {
        valid = false;
        error = v.reason || `[${currentStatus}] は不可`;
      }
    }

    setOpQueue((prev) => [
      { uid: `${Date.now()}_${Math.random()}`, tankId, status: currentStatus, valid, error, tag: returnTag },
      ...prev,
    ]);

    setLastAdded(tankId);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => {
      setLastAdded(null);
    }, 1500);
  };

  const removeFromQueue = (uid: string) => {
    setOpQueue((prev) => prev.filter((q) => q.uid !== uid));
  };

  /* ─── Submit (手動貸出 / 充填) ─── */
  const handleSubmit = async (skipConfirm = false) => {
    const validItems = opQueue.filter((q) => q.valid);
    if (validItems.length === 0) return;

    if (mode === "lend" && !selectedDest) {
      alert("貸出先を選択してください。");
      return;
    }

    if (!skipConfirm && !confirm(`${config.label}：${validItems.length}本を処理しますか？`)) return;

    setSubmitting(true);
    try {
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";

      await applyBulkTankOperations(
        validItems.map((item) => {
          const tag = (item.tag || RETURN_TAG.NORMAL) as ReturnTag;
          const resolvedAction: TankAction = mode === "return"
            ? resolveReturnAction(tag, item.status || "")
            : config.action;

          let finalLocation = "倉庫";
          let finalNote = "";

          if (mode === "lend") {
            finalLocation = selectedDest;
          } else if (mode === "return") {
            if (tag === RETURN_TAG.UNUSED) finalNote = "[TAG:unused]";
            else if (tag === RETURN_TAG.DEFECT) finalNote = "[TAG:defect]";
          }

          return {
            tankId: item.tankId,
            transitionAction: resolvedAction,
            currentStatus: item.status || "",
            staff: staffName,
            location: finalLocation,
            tankNote: finalNote,
            logNote: finalNote,
          };
        })
      );

      alert(`${validItems.length}本の処理が完了しました`);
      setOpQueue([]);
      fetchData();
    } catch (e: any) {
      alert("エラー: " + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  /* ═══════════════════════════════════════════════
     受注管理 — Handlers
  ═══════════════════════════════════════════════ */
  const openFulfillment = (order: PendingOrder) => {
    setSelectedOrder(order);
    setScannedTanks([]);
    setOrderActivePrefix(null);
    setOrderInputValue("");
  };
  const closeFulfillment = () => {
    setSelectedOrder(null);
    setScannedTanks([]);
    setOrderActivePrefix(null);
    setOrderInputValue("");
  };

  const orderFocusInput = (prefix: string) => {
    setOrderActivePrefix(prefix);
    setOrderInputValue("");
    // prefix変更時にアニメ即キャンセル
    if (orderSuccessTimeoutRef.current) clearTimeout(orderSuccessTimeoutRef.current);
    setOrderLastAdded(null);
    if (orderInputRef.current) orderInputRef.current.focus();
  };

  const handleOrderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, "");
    if (val.length > 2) return;
    // 入力開始時にアニメ即キャンセル
    if (val.length > 0 && orderLastAdded) {
      if (orderSuccessTimeoutRef.current) clearTimeout(orderSuccessTimeoutRef.current);
      setOrderLastAdded(null);
    }
    setOrderInputValue(val);
    if (val.length === 2 && orderActivePrefix) {
      addScannedTank(`${orderActivePrefix}-${val}`);
      setOrderInputValue("");
      if (orderInputRef.current) orderInputRef.current.focus();
    }
  };

  const handleOrderOkTrigger = () => {
    if (!orderActivePrefix) return;
    let payload = orderInputValue;
    if (!payload) payload = "OK";
    const tankId = `${orderActivePrefix}-${payload}`;
    addScannedTank(tankId);
    setOrderInputValue("");
    if (orderInputRef.current) orderInputRef.current.focus();
  };

  const addScannedTank = (tankId: string) => {
    if (scannedTanks.some((t) => t.id === tankId)) return;
    if (!selectedOrder) return;
    const validCount = scannedTanks.filter((t) => t.valid).length;
    if (validCount >= selectedOrder.quantity) { alert("発注数に達しています"); return; }

    const tank = allTanks[tankId];
    let valid = true, error = "";
    if (!tank) { valid = false; error = "未登録タンク"; }
    else {
      const v = validateTransition(tank.status, ACTION.LEND);
      if (!v.ok) { valid = false; error = v.reason || `[${tank.status}] は貸出不可`; }
      else if (tank.location !== "倉庫") { valid = false; error = "倉庫にありません"; }
    }

    setScannedTanks(prev => [{ id: tankId, valid, error }, ...prev]);
    setOrderLastAdded(tankId);
    if (orderSuccessTimeoutRef.current) clearTimeout(orderSuccessTimeoutRef.current);
    orderSuccessTimeoutRef.current = setTimeout(() => setOrderLastAdded(null), 1500);
  };

  const removeScannedTank = (id: string) => setScannedTanks(prev => prev.filter((t) => t.id !== id));

  const fulfillOrder = async () => {
    if (!selectedOrder) return;
    const validTanks = scannedTanks.filter((t) => t.valid);
    if (validTanks.length !== selectedOrder.quantity) {
      alert(`数量が一致しません (${validTanks.length}/${selectedOrder.quantity})`);
      return;
    }
    setOrderSubmitting(true);
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
      fetchOrders();
      fetchData();
    } catch (err: any) { alert("エラー: " + err.message); }
    finally { setOrderSubmitting(false); }
  };

  /* ═══════════════════════════════════════════════
     返却承認 — Handlers
  ═══════════════════════════════════════════════ */
  const openReturnGroup = (group: ReturnGroup) => {
    setSelectedReturnGroup(group);
    const init: Record<string, { approved: boolean; condition: Condition }> = {};
    group.items.forEach((item) => { init[item.id] = { approved: false, condition: item.condition }; });
    setApprovals(init);
  };

  const fulfillReturns = async () => {
    if (!selectedReturnGroup) return;
    const approved = selectedReturnGroup.items.filter((i) => approvals[i.id]?.approved);
    if (approved.length === 0) { alert("承認するタンクを選択してください"); return; }
    setApprovalSubmitting(true);
    try {
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";

      const approvedData = approved.map((item) => {
        const appData = approvals[item.id];
        const tag: ReturnTag =
          appData.condition === "unused" ? RETURN_TAG.UNUSED
            : appData.condition === "uncharged" ? RETURN_TAG.DEFECT
            : RETURN_TAG.NORMAL;
        const note = `[承認] 顧客: ${selectedReturnGroup.customerName} (タグ:${appData.condition})`;
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
          logExtra: { customerId: selectedReturnGroup.customerId },
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
      setSelectedReturnGroup(null);
      fetchApprovals();
      fetchBulkTanks();
    } catch (e: any) { alert("エラー: " + e.message); }
    finally { setApprovalSubmitting(false); }
  };

  /* ═══════════════════════════════════════════════
     一括返却 — Handlers
  ═══════════════════════════════════════════════ */
  const toggleExpand = (loc: string) => {
    setExpanded(prev => ({ ...prev, [loc]: !prev[loc] }));
  };

  const updateTag = async (loc: string, tankId: string, newTag: BulkTagType) => {
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
      fetchBulkTanks();
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
      fetchBulkTanks();
    } catch (e: any) { alert("エラー: " + e.message); }
    finally { setReturning(prev => ({ ...prev, [loc]: false })); }
  };

  /* ═══════════════════════════════════════════════
     Render
  ═══════════════════════════════════════════════ */

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60, color: "#94a3b8" }}>
        <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  const validCount = opQueue.filter(q => q.valid).length;
  const locationKeys = Object.keys(groupedTanks).sort();

  /* ─── 受注対応 (fulfillment) 全画面表示 ─── */
  if (mode === "lend" && opStyle === "order" && selectedOrder) {
    const orderValidCount = scannedTanks.filter((t) => t.valid).length;
    // 型防衛: Firestore 由来のデータが文字列の可能性もあるため Number() で正規化
    const requiredQty = Number(selectedOrder.quantity) || 0;
    const isReady = orderValidCount === requiredQty;
    const remaining = Math.max(0, requiredQty - orderValidCount);

    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", background: "#f8fafc" }}>
        {/* 統合ヘッダー（1行） */}
        <div style={{ padding: "10px 16px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button onClick={closeFulfillment} style={{ width: 32, height: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "none", background: "#f1f5f9", cursor: "pointer", color: "#64748b" }}>
            <ArrowLeft size={16} />
          </button>
          {/* 顧客名 */}
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedOrder.customerName}
            </p>
          </div>
          {/* タンク種別 × 本数 */}
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", background: "#eff6ff", borderRadius: 8, maxWidth: "45%", overflow: "hidden" }}>
            <Package size={14} color="#3b82f6" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: "#1e40af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedOrder.tankType} × {requiredQty}本
            </span>
          </div>
          {/* スキャン状況 X/Y */}
          <div style={{ flexShrink: 0, display: "flex", alignItems: "baseline", gap: 2 }}>
            <span style={{ fontSize: 24, fontWeight: 900, color: isReady ? "#10b981" : "#3b82f6", lineHeight: 1 }}>{orderValidCount}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>/ {requiredQty}</span>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
            {/* 隠し数字入力（フォーカス用）: position:absolute の祖先になるよう左カラムに配置 */}
            <input
              ref={orderInputRef}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              value={orderInputValue}
              onChange={handleOrderInputChange}
              style={{ position: "absolute", opacity: 0, width: 1, height: 1, overflow: "hidden", pointerEvents: "none", caretColor: "transparent" }}
            />
            {/* OKボタン */}
            <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
              <button
                onClick={handleOrderOkTrigger}
                disabled={!orderActivePrefix}
                style={{
                  width: "100%", padding: "8px", borderRadius: 12, border: "none",
                  background: orderLastAdded ? "#10b981" : (orderActivePrefix ? "#3b82f6" : "#e2e8f0"),
                  color: (orderActivePrefix || orderLastAdded) ? "#fff" : "#94a3b8",
                  fontSize: 20, fontWeight: 900,
                  boxShadow: (orderActivePrefix || orderLastAdded) ? `0 4px 12px ${orderLastAdded ? '#10b981' : '#3b82f6'}40` : "none",
                  cursor: orderActivePrefix ? "pointer" : "not-allowed",
                  transition: "background 0.2s, box-shadow 0.2s"
                }}
              >
                {orderLastAdded
                  ? orderLastAdded
                  : (!orderActivePrefix ? "OK入力" : orderInputValue ? `${orderActivePrefix} - ${orderInputValue}` : `${orderActivePrefix} - OK`)}
              </button>
            </div>

            {/* スキャン済みリスト（下部にフローティングボタン分の余白を確保） */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16, paddingBottom: 96 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>スキャンリスト</span>
                {scannedTanks.length > 0 && (
                  <span style={{ background: "#3b82f6", color: "#fff", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 800 }}>
                    {scannedTanks.length}
                  </span>
                )}
              </div>
              {scannedTanks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#cbd5e1" }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>右側のリストからアルファベットを選び、</p>
                  <p style={{ margin: "4px 0", fontSize: 14, fontWeight: 600 }}>タンクの数字を入力してください</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {scannedTanks.map((item) => (
                    <div key={item.id} style={{ background: "#fff", padding: "12px 16px", borderRadius: 12, borderLeft: `5px solid ${item.valid ? "#3b82f6" : "#ef4444"}`, boxShadow: "0 2px 6px rgba(0,0,0,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <span style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: "#0f172a" }}>{item.id}</span>
                        <div style={{ fontSize: 11, color: item.valid ? "#64748b" : "#ef4444", fontWeight: 600, marginTop: 4 }}>{item.valid ? "OK" : item.error}</div>
                      </div>
                      <button onClick={() => removeScannedTank(item.id)} style={{ border: "none", background: "none", color: "#cbd5e1", padding: 8, cursor: "pointer" }}><X size={18} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Floating 受注完了ボタン（常時表示／isReady でないときは disabled） */}
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              padding: "12px 16px max(12px, env(safe-area-inset-bottom, 12px))",
              background: "linear-gradient(transparent, rgba(248,250,252,0.95) 20%)",
              zIndex: 20, pointerEvents: "none",
            }}>
              <button onClick={fulfillOrder} disabled={!isReady || orderSubmitting}
                style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: isReady ? "#10b981" : "#cbd5e1",
                  color: "#fff", fontSize: 16, fontWeight: 900,
                  boxShadow: isReady ? "0 4px 16px rgba(16,185,129,0.25)" : "none",
                  display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
                  cursor: !isReady ? "not-allowed" : (orderSubmitting ? "wait" : "pointer"),
                  pointerEvents: "auto",
                  transition: "background 0.15s, box-shadow 0.15s",
                }}>
                {orderSubmitting ? (
                  <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <CheckCircle2 size={18} />
                )}
                {isReady
                  ? `受注を完了する（${selectedOrder.customerName}）`
                  : `あと ${remaining} 本スキャンしてください`}
              </button>
            </div>
          </div>

          {/* 循環ドラムロール（共通コンポーネント化） */}
          <DrumRoll
            items={prefixes}
            value={orderActivePrefix}
            onChange={(p) => setOrderActivePrefix(p)}
            onSelect={(p) => orderFocusInput(p)}
            accentColor="#3b82f6"
          />
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  /* ─── 返却承認 詳細表示 (selectedReturnGroup) ─── */
  if (mode === "return" && selectedReturnGroup) {
    const approvedCount = Object.values(approvals).filter((a) => a.approved).length;
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", background: "#f8fafc" }}>
        {/* ヘッダー */}
        <div style={{ padding: "14px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <button onClick={() => setSelectedReturnGroup(null)} style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "#f1f5f9", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowLeft size={16} />
          </button>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0 }}>{selectedReturnGroup.customerName}</p>
            <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>返却承認 — {approvedCount}/{selectedReturnGroup.items.length}</p>
          </div>
        </div>
        {/* タンクリスト */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", paddingBottom: 100 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {selectedReturnGroup.items.map((item) => {
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
              <button onClick={fulfillReturns} disabled={approvalSubmitting}
                style={{ width: "100%", padding: 16, borderRadius: 16, border: "none", background: "#10b981", color: "#fff", fontSize: 16, fontWeight: 800, cursor: approvalSubmitting ? "wait" : "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 8, boxShadow: "0 8px 16px rgba(16,185,129,0.25)" }}>
                {approvalSubmitting ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={18} />}
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
    <div
      style={{
        display: "flex", flexDirection: "column", flex: 1,
        background: "#f8fafc", overflow: "hidden",
        overscrollBehavior: "contain",
      }}
    >

      {/* Top Bar: Mode Selector */}
      <div style={{
        padding: "12px 16px", background: "rgba(255,255,255,0.8)",
        backdropFilter: "blur(12px)", borderBottom: "1px solid #e2e8f0", zIndex: 10,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", flex: 1, gap: 6, background: "#f1f5f9", borderRadius: 12, padding: 4 }}>
            {(["lend", "return", "fill"] as OpMode[]).map((m) => {
              const mc = MODE_CONFIG[m];
              const active = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    padding: "8px 0", borderRadius: 10, border: "none",
                    background: active ? "#fff" : "transparent",
                    color: active ? mc.color : "#94a3b8",
                    fontWeight: active ? 800 : 600, fontSize: 13,
                    cursor: "pointer", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    boxShadow: active ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
                  }}
                >
                  <mc.icon size={16} />
                  {mc.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════
         貸出モード: 手動
      ═══════════════════════════════════════════════ */}
      {mode === "lend" && opStyle === "manual" && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
            {/* 隠し数字入力（フォーカス用）: position:absolute の祖先になるよう左カラムに配置 */}
            <input
              ref={inputRef}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              value={inputValue}
              onChange={handleInputChange}
              style={{ position: "absolute", opacity: 0, width: 1, height: 1, overflow: "hidden", pointerEvents: "none", caretColor: "transparent" }}
            />
            {/* Top OK Button Area */}
            <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
              <button
                onClick={handleManualOkTrigger}
                disabled={!activePrefix}
                style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: lastAdded ? "#10b981" : (activePrefix ? config.color : "#e2e8f0"),
                  color: (activePrefix || lastAdded) ? "#fff" : "#94a3b8",
                  fontSize: 20, fontWeight: 900,
                  boxShadow: (activePrefix || lastAdded) ? `0 4px 12px ${lastAdded ? '#10b981' : config.color}40` : "none",
                  cursor: activePrefix ? "pointer" : "not-allowed",
                  transition: "background 0.2s, box-shadow 0.2s"
                }}
              >
                {lastAdded
                  ? lastAdded
                  : (!activePrefix ? "OK入力" : inputValue ? `${activePrefix} - ${inputValue}` : `${activePrefix} - OK`)}
              </button>
            </div>

            {/* Queue List */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>送信リスト</span>
                {opQueue.length > 0 && (
                  <span style={{ background: config.color, color: "#fff", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 800 }}>
                    {opQueue.length}
                  </span>
                )}
              </div>

              {opQueue.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#cbd5e1", marginTop: 20 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>右側のリストからアルファベットを選び、</p>
                  <p style={{ margin: "4px 0", fontSize: 14, fontWeight: 600 }}>タンクの数字を入力してください</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {opQueue.map((item) => (
                    <div key={item.uid} className="queue-anim" style={{
                      background: "#fff", padding: "12px 16px", borderRadius: 12,
                      borderLeft: `5px solid ${item.valid ? config.color : "#ef4444"}`,
                      boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      animation: "slideInLeft 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
                    }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.05em", color: "#0f172a" }}>
                            {item.tankId}
                          </span>
                          {item.tag !== "normal" && (
                            <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: item.tag === "unused" ? "#d1fae5" : "#fee2e2", color: item.tag === "unused" ? "#047857" : "#b91c1c" }}>
                              {item.tag === "unused" ? "未使用" : "未充填"}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: item.valid ? "#64748b" : "#ef4444", fontWeight: 600, marginTop: 4 }}>
                          {item.valid ? `現在: ${item.status || "不明"} ` : item.error}
                        </div>
                      </div>
                      <button onClick={() => removeFromQueue(item.uid)} style={{ border: "none", background: "none", color: "#cbd5e1", padding: 8, cursor: "pointer", marginRight: -8 }}>
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 貸出先セレクタ（常時表示） */}
            <div style={{
              padding: "8px 16px", background: "#fff", borderTop: "1px solid #e2e8f0",
              flexShrink: 0, zIndex: 20,
            }}>
              <QuickSelect
                options={destinations}
                value={selectedDest}
                onChange={setSelectedDest}
                onConfirm={() => handleSubmit(true)}
                color={config.color}
                placeholder="貸出先を選択して実行..."
              />
            </div>

            {/* Floating 送信ボタン */}
            {opQueue.length > 0 && (
              <div style={{
                position: "absolute", bottom: 56, left: 0, right: 0,
                padding: "0 16px 8px", zIndex: 21, pointerEvents: "none",
              }}>
                <button
                  onClick={() => handleSubmit(true)}
                  disabled={submitting}
                  style={{
                    width: "100%", padding: "12px", borderRadius: 12, border: "none",
                    background: config.color, color: "#fff",
                    fontSize: 15, fontWeight: 900,
                    display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
                    cursor: submitting ? "not-allowed" : "pointer",
                    pointerEvents: "auto",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                  }}
                >
                  {submitting ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
                  <span>{validCount}件の{config.label}を実行</span>
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Prefix Drum Roll（共通コンポーネント化） */}
          <DrumRoll
            items={prefixes}
            value={activePrefix}
            onChange={(p) => setActivePrefix(p)}
            onSelect={(p) => focusInput(p)}
            accentColor={config.color}
          />
        </div>
      )}

      {/* ═══════════════════════════════════════════════
         貸出モード: 受注
      ═══════════════════════════════════════════════ */}
      {mode === "lend" && opStyle === "order" && !selectedOrder && (
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {ordersLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
              <Loader2 size={24} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
            </div>
          ) : pendingOrders.length === 0 ? (
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 20, padding: "40px 20px", textAlign: "center" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <CheckCircle2 size={32} color="#94a3b8" />
              </div>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>未対応の受注はありません</p>
              <p style={{ fontSize: 13, color: "#64748b" }}>顧客がアプリから発注するとここに表示されます</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {pendingOrders.map((order) => {
                const dateStr = order.createdAt ? new Date(order.createdAt.toMillis()).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
                return (
                  <button key={order.id} onClick={() => openFulfillment(order)}
                    style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 16, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", textAlign: "left", width: "100%" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{order.customerName}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{dateStr}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#475569", background: "#f1f5f9", padding: "4px 8px", borderRadius: 6 }}>{order.tankType}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                      <span style={{ fontSize: 28, fontWeight: 900, color: "#3b82f6" }}>{order.quantity}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>本</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════
         返却モード: リクエスト + 全貸出タンク
      ═══════════════════════════════════════════════ */}
      {mode === "return" && !showManualReturn && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {/* 手動返却ボタン */}
          <button
            onClick={() => setShowManualReturn(true)}
            style={{
              width: "100%", padding: "10px", borderRadius: 12, border: "1.5px solid #e2e8f0",
              background: "#fff", color: "#10b981", fontSize: 13, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              cursor: "pointer", marginBottom: 16, transition: "all 0.15s",
            }}
          >
            <ArrowDownToLine size={16} />
            手動返却
          </button>

          {/* Section 1: 返却リクエスト */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, color: "#475569", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 4, height: 16, borderRadius: 2, background: "#10b981", display: "inline-block" }} />
              返却リクエスト
            </h3>
            {approvalsLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                <Loader2 size={20} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
              </div>
            ) : returnGroups.length === 0 ? (
              <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
                <CheckCircle2 size={24} color="#94a3b8" style={{ marginBottom: 8 }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: 0 }}>未確認の返却リクエストはありません</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {returnGroups.map((group) => (
                  <button key={group.customerId} onClick={() => openReturnGroup(group)}
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
          </div>

          {/* Section 2: 全貸出タンク */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 800, color: "#475569", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 4, height: 16, borderRadius: 2, background: "#3b82f6", display: "inline-block" }} />
              全貸出タンク
            </h3>
            {bulkLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                <Loader2 size={20} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
              </div>
            ) : locationKeys.length === 0 ? (
              <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
                <CheckCircle2 size={24} color="#10b981" style={{ marginBottom: 8 }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: 0 }}>貸出中のタンクはありません</p>
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
                            一括返却
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
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════
         返却モード: 手動返却（ダイヤル入力）
      ═══════════════════════════════════════════════ */}
      {mode === "return" && showManualReturn && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
            {/* 隠し数字入力（フォーカス用）: position:absolute の祖先になるよう左カラムに配置 */}
            <input
              ref={inputRef}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              value={inputValue}
              onChange={handleInputChange}
              style={{ position: "absolute", opacity: 0, width: 1, height: 1, overflow: "hidden", pointerEvents: "none", caretColor: "transparent" }}
            />
            {/* Top OK Button Area */}
            <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button
                  onClick={() => setShowManualReturn(false)}
                  style={{
                    width: 36, height: 36, borderRadius: 8, border: "none",
                    background: "#f1f5f9", cursor: "pointer", color: "#64748b",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}
                >
                  <ArrowLeft size={16} />
                </button>
                <button
                  onClick={handleManualOkTrigger}
                  disabled={!activePrefix}
                  style={{
                    flex: 1, padding: "8px", borderRadius: 12, border: "none",
                    background: lastAdded ? "#10b981" : (activePrefix ? config.color : "#e2e8f0"),
                    color: (activePrefix || lastAdded) ? "#fff" : "#94a3b8",
                    fontSize: 20, fontWeight: 900,
                    boxShadow: (activePrefix || lastAdded) ? `0 4px 12px ${lastAdded ? '#10b981' : config.color}40` : "none",
                    cursor: activePrefix ? "pointer" : "not-allowed",
                    transition: "background 0.2s, box-shadow 0.2s"
                  }}
                >
                  {lastAdded
                    ? lastAdded
                    : (!activePrefix ? "OK入力" : inputValue ? `${activePrefix} - ${inputValue}` : `${activePrefix} - OK`)}
                </button>
              </div>
            </div>

            {/* Queue List */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>送信リスト</span>
                {opQueue.length > 0 && (
                  <span style={{ background: config.color, color: "#fff", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 800 }}>
                    {opQueue.length}
                  </span>
                )}
              </div>
              {opQueue.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#cbd5e1", marginTop: 20 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>右側のリストからアルファベットを選び、</p>
                  <p style={{ margin: "4px 0", fontSize: 14, fontWeight: 600 }}>タンクの数字を入力してください</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {opQueue.map((item) => (
                    <div key={item.uid} style={{
                      background: "#fff", padding: "12px 16px", borderRadius: 12,
                      borderLeft: `5px solid ${item.valid ? config.color : "#ef4444"}`,
                      boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.05em", color: "#0f172a" }}>
                            {item.tankId}
                          </span>
                          {item.tag !== "normal" && (
                            <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: item.tag === "unused" ? "#d1fae5" : "#fee2e2", color: item.tag === "unused" ? "#047857" : "#b91c1c" }}>
                              {item.tag === "unused" ? "未使用" : "未充填"}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: item.valid ? "#64748b" : "#ef4444", fontWeight: 600, marginTop: 4 }}>
                          {item.valid ? `現在: ${item.status || "不明"} ` : item.error}
                        </div>
                      </div>
                      <button onClick={() => removeFromQueue(item.uid)} style={{ border: "none", background: "none", color: "#cbd5e1", padding: 8, cursor: "pointer" }}>
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* タグ選択（常時表示）: タップでON/OFF、再タップで通常に戻る */}
            <div style={{
              padding: "8px 16px", background: "#fff", borderTop: "1px solid #e2e8f0",
              flexShrink: 0, zIndex: 20,
            }}>
              <div style={{ display: "flex", gap: 6 }}>
                {([
                  { id: "defect" as TagType, label: "未充填", icon: AlertCircle, color: "#ef4444" },
                  { id: "unused" as TagType, label: "未使用", icon: Droplets, color: "#10b981" },
                ]).map(tag => {
                  const active = returnTag === tag.id;
                  return (
                    <button
                      key={tag.id}
                      onClick={() => setReturnTag(active ? "normal" : tag.id)}
                      style={{
                        flex: 1, padding: "8px 4px", borderRadius: 10,
                        background: active ? `${tag.color}15` : "#fff",
                        border: `2px solid ${active ? tag.color : "#e2e8f0"}`,
                        color: active ? tag.color : "#94a3b8",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                        cursor: "pointer", transition: "all 0.15s",
                      }}
                    >
                      <tag.icon size={14} />
                      <span style={{ fontSize: 10, fontWeight: 800 }}>{tag.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Floating 送信ボタン */}
            {opQueue.length > 0 && (
              <div style={{
                position: "absolute", bottom: 52, left: 0, right: 0,
                padding: "0 16px 8px", zIndex: 21, pointerEvents: "none",
              }}>
                <button
                  onClick={() => handleSubmit()}
                  disabled={submitting}
                  style={{
                    width: "100%", padding: "12px", borderRadius: 12, border: "none",
                    background: config.color, color: "#fff",
                    fontSize: 15, fontWeight: 900,
                    display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
                    cursor: submitting ? "not-allowed" : "pointer",
                    pointerEvents: "auto",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                  }}
                >
                  {submitting ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
                  <span>{validCount}件の返却を実行</span>
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Prefix Drum Roll（共通コンポーネント化） */}
          <DrumRoll
            items={prefixes}
            value={activePrefix}
            onChange={(p) => setActivePrefix(p)}
            onSelect={(p) => focusInput(p)}
            accentColor={config.color}
          />
        </div>
      )}

      {/* ═══════════════════════════════════════════════
         充填モード: ダイヤル入力 (既存と同じ)
      ═══════════════════════════════════════════════ */}
      {mode === "fill" && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
            {/* 隠し数字入力（フォーカス用）: position:absolute の祖先になるよう左カラムに配置 */}
            <input
              ref={inputRef}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              value={inputValue}
              onChange={handleInputChange}
              style={{ position: "absolute", opacity: 0, width: 1, height: 1, overflow: "hidden", pointerEvents: "none", caretColor: "transparent" }}
            />
            {/* Top OK Button Area */}
            <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
              <button
                onClick={handleManualOkTrigger}
                disabled={!activePrefix}
                style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: lastAdded ? "#10b981" : (activePrefix ? config.color : "#e2e8f0"),
                  color: (activePrefix || lastAdded) ? "#fff" : "#94a3b8",
                  fontSize: 20, fontWeight: 900,
                  boxShadow: (activePrefix || lastAdded) ? `0 4px 12px ${lastAdded ? '#10b981' : config.color}40` : "none",
                  cursor: activePrefix ? "pointer" : "not-allowed",
                  transition: "background 0.2s, box-shadow 0.2s"
                }}
              >
                {lastAdded
                  ? lastAdded
                  : (!activePrefix ? "OK入力" : inputValue ? `${activePrefix} - ${inputValue}` : `${activePrefix} - OK`)}
              </button>
            </div>

            {/* Queue List */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>送信リスト</span>
                {opQueue.length > 0 && (
                  <span style={{ background: config.color, color: "#fff", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 800 }}>
                    {opQueue.length}
                  </span>
                )}
              </div>

              {opQueue.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#cbd5e1", marginTop: 20 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>右側のリストからアルファベットを選び、</p>
                  <p style={{ margin: "4px 0", fontSize: 14, fontWeight: 600 }}>タンクの数字を入力してください</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {opQueue.map((item) => (
                    <div key={item.uid} className="queue-anim" style={{
                      background: "#fff", padding: "12px 16px", borderRadius: 12,
                      borderLeft: `5px solid ${item.valid ? config.color : "#ef4444"}`,
                      boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      animation: "slideInLeft 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
                    }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.05em", color: "#0f172a" }}>
                            {item.tankId}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: item.valid ? "#64748b" : "#ef4444", fontWeight: 600, marginTop: 4 }}>
                          {item.valid ? `現在: ${item.status || "不明"} ` : item.error}
                        </div>
                      </div>
                      <button onClick={() => removeFromQueue(item.uid)} style={{ border: "none", background: "none", color: "#cbd5e1", padding: 8, cursor: "pointer", marginRight: -8 }}>
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Floating Action Area */}
            {opQueue.length > 0 && (
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                padding: "12px 16px max(12px, env(safe-area-inset-bottom, 12px))",
                background: "linear-gradient(transparent, rgba(248,250,252,0.95) 20%)",
                zIndex: 20, pointerEvents: "none",
              }}>
                <button
                  onClick={() => handleSubmit()}
                  disabled={submitting}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 12, border: "none",
                    background: config.color, color: "#fff",
                    fontSize: 16, fontWeight: 900,
                    display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
                    cursor: submitting ? "not-allowed" : "pointer",
                    pointerEvents: "auto",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  }}
                >
                  {submitting ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
                  <span>{validCount}件の{config.label}を実行</span>
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Prefix Drum Roll（共通コンポーネント化） */}
          <DrumRoll
            items={prefixes}
            value={activePrefix}
            onChange={(p) => setActivePrefix(p)}
            onSelect={(p) => focusInput(p)}
            accentColor={config.color}
          />
        </div>
      )}

      <style>{`
        @keyframes slideInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
