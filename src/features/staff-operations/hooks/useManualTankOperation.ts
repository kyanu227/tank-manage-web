"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import type { CustomerSnapshot } from "@/lib/operation-context";
import {
  RETURN_TAG,
  resolveReturnAction,
  validateTransition,
  type ReturnTag,
  type TankAction,
} from "@/lib/tank-rules";
import type { ModeConfigItem, OpMode, QueueItem, TagType, TankMap } from "../types";

interface UseManualTankOperationParams {
  mode: OpMode;
  config: ModeConfigItem;
  allTanks: TankMap;
  selectedCustomer?: CustomerSnapshot | null;
  fetchData: () => Promise<void>;
}

export interface UseManualTankOperationResult {
  returnTag: TagType;
  setReturnTag: (tag: TagType) => void;
  opQueue: QueueItem[];
  activePrefix: string | null;
  setActivePrefix: (prefix: string | null) => void;
  inputValue: string;
  inputRef: RefObject<HTMLInputElement | null>;
  lastAdded: string | null;
  submitting: boolean;
  validCount: number;
  focusInput: (prefix: string) => void;
  handleInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleManualOkTrigger: () => void;
  removeFromQueue: (uid: string) => void;
  handleSubmit: (skipConfirm?: boolean, customerOverride?: CustomerSnapshot | null) => Promise<void>;
  reset: () => void;
}

export function useManualTankOperation({
  mode,
  config,
  allTanks,
  selectedCustomer,
  fetchData,
}: UseManualTankOperationParams): UseManualTankOperationResult {
  const [returnTag, setReturnTag] = useState<TagType>("normal");
  const [opQueue, setOpQueue] = useState<QueueItem[]>([]);
  const [activePrefix, setActivePrefix] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setOpQueue([]);
    setReturnTag("normal");
    setInputValue("");
    setActivePrefix(null);
  }, []);

  const focusInput = useCallback((prefix: string) => {
    setActivePrefix(prefix);
    setInputValue("");
    // prefix変更時にアニメ即キャンセル
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    setLastAdded(null);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const addToQueue = useCallback((tankId: string) => {
    if (opQueue.some((q) => q.tankId === tankId)) return;

    const tank = allTanks[tankId];
    const currentStatus = tank?.status || "";
    let valid = true;
    let error = "";

    if (!tank) {
      valid = false;
      error = "未登録タンク";
    } else {
      const actionToValidate: TankAction = mode === "return"
        ? resolveReturnAction(returnTag as ReturnTag, currentStatus)
        : config.action;
      const v = validateTransition(currentStatus, actionToValidate);
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
  }, [allTanks, config.action, mode, opQueue, returnTag]);

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
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
  }, [activePrefix, addToQueue, lastAdded]);

  const handleManualOkTrigger = useCallback(() => {
    if (!activePrefix) return;
    let payload = inputValue;
    if (!payload) payload = "OK";
    const tankId = `${activePrefix}-${payload}`;
    addToQueue(tankId);
    setInputValue("");
    if (inputRef.current) inputRef.current.focus();
  }, [activePrefix, addToQueue, inputValue]);

  const removeFromQueue = useCallback((uid: string) => {
    setOpQueue((prev) => prev.filter((q) => q.uid !== uid));
  }, []);

  const handleSubmit = useCallback(async (
    skipConfirm = false,
    customerOverride?: CustomerSnapshot | null
  ) => {
    const validItems = opQueue.filter((q) => q.valid);
    if (validItems.length === 0) return;

    const effectiveCustomer = customerOverride ?? selectedCustomer ?? null;

    if (mode === "lend" && !effectiveCustomer) {
      alert("貸出先を選択してください。");
      return;
    }

    if (!skipConfirm) {
      const keepCount = mode === "return"
        ? validItems.filter((item) => item.tag === RETURN_TAG.KEEP).length
        : 0;
      const returnCount = validItems.length - keepCount;
      const confirmMessage = keepCount > 0
        ? `返却: ${returnCount}本 / 持ち越し: ${keepCount}本を処理しますか？`
        : `${config.label}：${validItems.length}本を処理しますか？`;
      if (!confirm(confirmMessage)) return;
    }

    setSubmitting(true);
    try {
      const actor = requireStaffIdentity();
      const context = {
        actor,
        ...(mode === "lend" && effectiveCustomer
          ? { customer: effectiveCustomer }
          : {}),
      };

      await applyBulkTankOperations(
        validItems.map((item) => {
          const tag = (item.tag || RETURN_TAG.NORMAL) as ReturnTag;
          const resolvedAction: TankAction = mode === "return"
            ? resolveReturnAction(tag, item.status || "")
            : config.action;

          const currentTank = allTanks[item.tankId];
          let finalLocation = "倉庫";
          let finalNote = "";

          if (mode === "lend") {
            finalLocation = effectiveCustomer?.customerName ?? "";
          } else if (mode === "return") {
            if (tag === RETURN_TAG.KEEP) {
              finalLocation = currentTank?.location || "不明";
              finalNote = "[TAG:keep]";
            } else if (tag === RETURN_TAG.UNUSED) finalNote = "[TAG:unused]";
            else if (tag === RETURN_TAG.UNCHARGED) finalNote = "[TAG:uncharged]";
          }

          return {
            tankId: item.tankId,
            transitionAction: resolvedAction,
            currentStatus: item.status || "",
            context,
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
  }, [allTanks, config.action, config.label, fetchData, mode, opQueue, selectedCustomer]);

  const validCount = useMemo(() => opQueue.filter(q => q.valid).length, [opQueue]);

  return {
    returnTag,
    setReturnTag,
    opQueue,
    activePrefix,
    setActivePrefix,
    inputValue,
    inputRef,
    lastAdded,
    submitting,
    validCount,
    focusInput,
    handleInputChange,
    handleManualOkTrigger,
    removeFromQueue,
    handleSubmit,
    reset,
  };
}
