"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { applyBulkTankOperations } from "@/lib/tank-operation";
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
  selectedDest: string;
  selectedCustomerId?: string | null;
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
  handleSubmit: (skipConfirm?: boolean) => Promise<void>;
  reset: () => void;
}

export function useManualTankOperation({
  mode,
  config,
  allTanks,
  selectedDest,
  selectedCustomerId,
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
  }, [allTanks, config.action, opQueue, returnTag]);

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

  const handleSubmit = useCallback(async (skipConfirm = false) => {
    const validItems = opQueue.filter((q) => q.valid);
    if (validItems.length === 0) return;

    if (mode === "lend" && !selectedDest) {
      alert("貸出先を選択してください。");
      return;
    }
    if (mode === "lend" && !selectedCustomerId) {
      alert("貸出先IDを取得できませんでした。貸出先を選び直してください。");
      return;
    }

    if (!skipConfirm && !confirm(`${config.label}：${validItems.length}本を処理しますか？`)) return;

    setSubmitting(true);
    try {
      const actor = requireStaffIdentity();
      const context = {
        actor,
        ...(mode === "lend" && selectedCustomerId
          ? { customer: { customerId: selectedCustomerId, customerName: selectedDest } }
          : {}),
      };

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
  }, [config.action, config.label, fetchData, mode, opQueue, selectedCustomerId, selectedDest]);

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
