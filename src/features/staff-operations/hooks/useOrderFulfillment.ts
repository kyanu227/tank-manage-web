"use client";

import { useCallback, useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import {
  approveOrder as approveOrderTransaction,
  fulfillOrder as fulfillOrderTransaction,
  getOrderApprovalValidationError,
  validateOrderFulfillment,
} from "@/lib/firebase/order-fulfillment-service";
import { transactionsRepository } from "@/lib/firebase/repositories";
import {
  findMatchingItem,
  totalOrderQuantity,
  type PendingOrder,
} from "@/lib/order-types";
import { tryParseTankId } from "@/lib/tank-id";
import { coerceTankStatusCode } from "@/lib/tank-action-status-codes";
import { getTankStatusLabel } from "@/lib/tank-action-status-labels";
import { validateTransitionCode } from "@/lib/tank-rules";
import type { ScannedTank, TankMap } from "../types";
import { getStaffOperationText } from "../i18n";

interface UseOrderFulfillmentParams {
  allTanks: TankMap;
  fetchData: () => Promise<void>;
  locale?: Locale;
}

export interface UseOrderFulfillmentResult {
  ordersLoading: boolean;
  ordersLoadFailed: boolean;
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
  locale = DEFAULT_LOCALE,
}: UseOrderFulfillmentParams): UseOrderFulfillmentResult {
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersLoadFailed, setOrdersLoadFailed] = useState(false);
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
    setOrdersLoadFailed(false);
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
      setOrdersLoadFailed(true);
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
    const validationError = getOrderApprovalValidationError(order);
    if (validationError) {
      alert(getStaffOperationText("customerLinkRequired", locale));
      return;
    }
    if (!confirm(getStaffOperationText("approveConfirm", locale, {
      customerName: order.customerName,
    }))) return;

    setApprovingOrderId(order.id);
    try {
      const actor = requireStaffIdentity();
      await approveOrderTransaction(order.id, actor);
      await fetchOrders();
    } catch (err: unknown) {
      if (locale === "en") console.error("Order approval failed", err);
      alert(locale === "ja" ? `承認エラー: ${errorMessage(err)}` : getStaffOperationText("approvalFailure", locale));
    } finally {
      setApprovingOrderId(null);
    }
  }, [fetchOrders, locale]);

  const orderFocusInput = useCallback((prefix: string) => {
    setOrderActivePrefix(prefix);
    setOrderInputValue("");
    // prefix変更時にアニメ即キャンセル
    if (orderSuccessTimeoutRef.current) clearTimeout(orderSuccessTimeoutRef.current);
    setOrderLastAdded(null);
    if (orderInputRef.current) orderInputRef.current.focus();
  }, []);

  const addScannedTank = useCallback((rawTankId: string) => {
    const tankIdResult = tryParseTankId(rawTankId);
    const tankId = tankIdResult.ok
      ? tankIdResult.canonicalTankId
      : tankIdResult.normalizedInput || rawTankId.trim().toUpperCase();
    if (scannedTanks.some((t) => t.id === tankId)) return;
    if (!selectedOrder) return;

    const totalRequired = totalOrderQuantity(selectedOrder.items);
    const validCount = scannedTanks.filter((t) => t.valid).length;
    if (validCount >= totalRequired) {
      alert(getStaffOperationText("requiredQuantityReached", locale));
      return;
    }

    const tank = tankIdResult.ok ? allTanks[tankId] : undefined;
    let valid = tankIdResult.ok;
    let error = tankIdResult.ok
      ? ""
      : locale === "ja"
        ? tankIdResult.reason
        : getStaffOperationText("invalidTankId", locale);
    if (!tankIdResult.ok) {
      valid = false;
    } else if (!tank) {
      valid = false;
      error = getStaffOperationText("unregisteredTank", locale);
    } else {
      const statusCode = coerceTankStatusCode(tank.status);
      if (!statusCode) {
        valid = false;
        error = getStaffOperationText("invalidTankStatus", locale);
      } else if (!validateTransitionCode(statusCode, "lend")) {
        valid = false;
        error = getStaffOperationText("statusNotLendable", locale, {
          status: getTankStatusLabel(statusCode, locale),
        });
      } else if (tank.location !== "倉庫") {
        valid = false;
        error = getStaffOperationText("notInWarehouse", locale);
      } else {
        // items 配列（種別ごとの要求本数）との突合
        const matched = findMatchingItem(tank.type ?? "", selectedOrder.items);
        if (!matched) {
          valid = false;
          error = getStaffOperationText("typeNotInOrder", locale);
        } else {
          // すでに該当種別を必要数スキャン済みか？
          const scannedSameType = scannedTanks.filter((t) => {
            if (!t.valid) return false;
            const sTank = allTanks[t.id];
            return sTank && sTank.type === tank.type;
          }).length;
          if (scannedSameType >= matched.quantity) {
            valid = false;
            error = getStaffOperationText("typeQuantityReached", locale);
          }
        }
      }
    }

    setScannedTanks(prev => [{ id: tankId, valid, error }, ...prev]);
    setOrderLastAdded(tankId);
    if (orderSuccessTimeoutRef.current) clearTimeout(orderSuccessTimeoutRef.current);
    orderSuccessTimeoutRef.current = setTimeout(() => setOrderLastAdded(null), 1500);
  }, [allTanks, locale, scannedTanks, selectedOrder]);

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
    const validation = validateOrderFulfillment({
      order: selectedOrder,
      scannedTanks,
      allTanks,
    });
    if (!validation.ok) {
      alert(getStaffOperationText("quantityMismatch", locale, {
        scanned: scannedTanks.filter((tank) => tank.valid).length,
        required: totalOrderQuantity(selectedOrder.items),
      }));
      return;
    }
    const { validTanks } = validation;
    setOrderSubmitting(true);
    try {
      const actor = requireStaffIdentity();
      await fulfillOrderTransaction({
        order: selectedOrder,
        validTanks,
        allTanks,
        actor,
      });

      alert(getStaffOperationText("fulfillmentSuccess", locale));
      closeFulfillment();
      fetchOrders();
      fetchData();
    } catch (err: unknown) {
      if (locale === "en") console.error("Order fulfillment failed", err);
      alert(locale === "ja" ? `エラー: ${errorMessage(err)}` : getStaffOperationText("fulfillmentFailure", locale));
    } finally {
      setOrderSubmitting(false);
    }
  }, [allTanks, closeFulfillment, fetchData, fetchOrders, locale, scannedTanks, selectedOrder]);

  return {
    ordersLoading,
    ordersLoadFailed,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
