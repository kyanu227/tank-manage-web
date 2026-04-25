"use client";

import { useCallback, useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { getStaffName } from "@/hooks/useStaffSession";
import { db } from "@/lib/firebase/config";
import { transactionsRepository } from "@/lib/firebase/repositories";
import {
  findMatchingItem,
  totalOrderQuantity,
  type PendingOrder,
} from "@/lib/order-types";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { ACTION, validateTransition } from "@/lib/tank-rules";
import type { ScannedTank, TankMap } from "../types";

interface UseOrderFulfillmentParams {
  allTanks: TankMap;
  fetchData: () => Promise<void>;
}

export interface UseOrderFulfillmentResult {
  ordersLoading: boolean;
  pendingOrders: PendingOrder[];
  selectedOrder: PendingOrder | null;
  scannedTanks: ScannedTank[];
  orderActivePrefix: string | null;
  setOrderActivePrefix: (prefix: string | null) => void;
  orderInputValue: string;
  orderInputRef: RefObject<HTMLInputElement | null>;
  orderLastAdded: string | null;
  orderSubmitting: boolean;
  approvingOrderId: string | null;
  fetchOrders: () => Promise<void>;
  approveOrder: (order: PendingOrder) => Promise<void>;
  openFulfillment: (order: PendingOrder) => void;
  closeFulfillment: () => void;
  orderFocusInput: (prefix: string) => void;
  handleOrderInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleOrderOkTrigger: () => void;
  removeScannedTank: (id: string) => void;
  fulfillOrder: () => Promise<void>;
}

export function useOrderFulfillment({
  allTanks,
  fetchData,
}: UseOrderFulfillmentParams): UseOrderFulfillmentResult {
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<PendingOrder | null>(null);
  const [scannedTanks, setScannedTanks] = useState<ScannedTank[]>([]);
  const [orderActivePrefix, setOrderActivePrefix] = useState<string | null>(null);
  const [orderInputValue, setOrderInputValue] = useState("");
  const orderInputRef = useRef<HTMLInputElement>(null);
  const [orderLastAdded, setOrderLastAdded] = useState<string | null>(null);
  const orderSuccessTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [approvingOrderId, setApprovingOrderId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      // 既存挙動を維持: 3 status を並列取得し、呼び出し側でソートする。
      // 正規化（旧スキーマ tankType/quantity 吸収）は repository 境界で行うため、
      // ここでは normalizeOrderDoc は呼ばない。
      const statuses = ["pending", "pending_approval", "approved"] as const;
      const results = await Promise.all(
        statuses.map((status) => transactionsRepository.getOrders({ status }))
      );
      const ordersData: PendingOrder[] = results.flat();
      ordersData.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setPendingOrders(ordersData);
    } catch (err) {
      console.error(err);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  const openFulfillment = useCallback((order: PendingOrder) => {
    setSelectedOrder(order);
    setScannedTanks([]);
    setOrderActivePrefix(null);
    setOrderInputValue("");
  }, []);

  const closeFulfillment = useCallback(() => {
    setSelectedOrder(null);
    setScannedTanks([]);
    setOrderActivePrefix(null);
    setOrderInputValue("");
  }, []);

  const approveOrder = useCallback(async (order: PendingOrder) => {
    if (!order.customerId) {
      alert("顧客に紐付いていない受注は承認できません。管理画面で紐付けてください。");
      return;
    }
    if (!confirm(`${order.customerName} の受注を承認しますか？`)) return;

    setApprovingOrderId(order.id);
    try {
      const staffName = getStaffName();
      await updateDoc(doc(db, "transactions", order.id), {
        status: "approved",
        approvedAt: serverTimestamp(),
        approvedBy: staffName,
        updatedAt: serverTimestamp(),
      });
      await fetchOrders();
    } catch (err: any) {
      alert("承認エラー: " + err.message);
    } finally {
      setApprovingOrderId(null);
    }
  }, [fetchOrders]);

  const orderFocusInput = useCallback((prefix: string) => {
    setOrderActivePrefix(prefix);
    setOrderInputValue("");
    // prefix変更時にアニメ即キャンセル
    if (orderSuccessTimeoutRef.current) clearTimeout(orderSuccessTimeoutRef.current);
    setOrderLastAdded(null);
    if (orderInputRef.current) orderInputRef.current.focus();
  }, []);

  const addScannedTank = useCallback((tankId: string) => {
    if (scannedTanks.some((t) => t.id === tankId)) return;
    if (!selectedOrder) return;

    const totalRequired = totalOrderQuantity(selectedOrder.items);
    const validCount = scannedTanks.filter((t) => t.valid).length;
    if (validCount >= totalRequired) {
      alert("発注数に達しています");
      return;
    }

    const tank = allTanks[tankId];
    let valid = true;
    let error = "";
    if (!tank) {
      valid = false;
      error = "未登録タンク";
    } else {
      const v = validateTransition(tank.status, ACTION.LEND);
      if (!v.ok) {
        valid = false;
        error = v.reason || `[${tank.status}] は貸出不可`;
      } else if (tank.location !== "倉庫") {
        valid = false;
        error = "倉庫にありません";
      } else {
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

    setScannedTanks(prev => [{ id: tankId, valid, error }, ...prev]);
    setOrderLastAdded(tankId);
    if (orderSuccessTimeoutRef.current) clearTimeout(orderSuccessTimeoutRef.current);
    orderSuccessTimeoutRef.current = setTimeout(() => setOrderLastAdded(null), 1500);
  }, [allTanks, scannedTanks, selectedOrder]);

  const handleOrderInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
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
  }, [addScannedTank, orderActivePrefix, orderLastAdded]);

  const handleOrderOkTrigger = useCallback(() => {
    if (!orderActivePrefix) return;
    let payload = orderInputValue;
    if (!payload) payload = "OK";
    const tankId = `${orderActivePrefix}-${payload}`;
    addScannedTank(tankId);
    setOrderInputValue("");
    if (orderInputRef.current) orderInputRef.current.focus();
  }, [addScannedTank, orderActivePrefix, orderInputValue]);

  const removeScannedTank = useCallback((id: string) => {
    setScannedTanks(prev => prev.filter((t) => t.id !== id));
  }, []);

  const fulfillOrder = useCallback(async () => {
    if (!selectedOrder) return;
    const validTanks = scannedTanks.filter((t) => t.valid);
    const totalRequired = totalOrderQuantity(selectedOrder.items);

    // items 配列の各種別について、必要本数をスキャンしきったか確認する
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
    setOrderSubmitting(true);
    try {
      const staffName = getStaffName();
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
            updatedAt: serverTimestamp(),
          });
        }
      );

      alert("受注したタンクを貸し出しました");
      closeFulfillment();
      fetchOrders();
      fetchData();
    } catch (err: any) {
      alert("エラー: " + err.message);
    } finally {
      setOrderSubmitting(false);
    }
  }, [allTanks, closeFulfillment, fetchData, fetchOrders, scannedTanks, selectedOrder]);

  return {
    ordersLoading,
    pendingOrders,
    selectedOrder,
    scannedTanks,
    orderActivePrefix,
    setOrderActivePrefix,
    orderInputValue,
    orderInputRef,
    orderLastAdded,
    orderSubmitting,
    approvingOrderId,
    fetchOrders,
    approveOrder,
    openFulfillment,
    closeFulfillment,
    orderFocusInput,
    handleOrderInputChange,
    handleOrderOkTrigger,
    removeScannedTank,
    fulfillOrder,
  };
}
