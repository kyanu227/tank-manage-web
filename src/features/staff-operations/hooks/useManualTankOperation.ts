"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { useTankOperationPolicy } from "@/hooks/useTankOperationPolicy";
import type { Locale } from "@/lib/locale";
import {
  getManualOperationConfirmMessage,
  getManualOperationSuccessMessage,
  getManualReturnConfirmMessage,
  getManualReturnSuccessMessage,
} from "@/lib/operation-messages";
import { tryParseTankId } from "@/lib/tank-id";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { coerceTankStatusCode } from "@/lib/tank-action-status-codes";
import { getTankStatusLabel } from "@/lib/tank-action-status-labels";
import type { CustomerSnapshot, OperationContext } from "@/lib/operation-context";
import { planTankTransition } from "@/lib/tank-transition-policy";
import {
  returnTagToReturnCondition,
  returnTagToStoredLogNote,
} from "@/lib/return-tag-rules";
import {
  RETURN_TAG,
  type ReturnTag,
  resolveReturnActionCode,
  validateTransitionCode,
} from "@/lib/tank-rules";
import type { ModeConfigItem, OpMode, QueueItem, TagType, TankMap } from "../types";

interface UseManualTankOperationParams {
  mode: OpMode;
  config: ModeConfigItem;
  locale: Locale;
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
  locale,
  allTanks,
  selectedCustomer,
  fetchData,
}: UseManualTankOperationParams): UseManualTankOperationResult {
  const {
    runtimeTransitionEnforcement,
    loading: policyLoading,
  } = useTankOperationPolicy();
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

  const evaluateQueueTank = useCallback((rawTankId: string, tag: TagType) => {
    const tankIdResult = tryParseTankId(rawTankId);
    const tankId = tankIdResult.ok
      ? tankIdResult.canonicalTankId
      : tankIdResult.normalizedInput || rawTankId.trim().toUpperCase();
    const tank = tankIdResult.ok ? allTanks[tankId] : undefined;
    const currentStatus = tank?.status || "";
    let valid = tankIdResult.ok;
    let error = tankIdResult.ok ? "" : tankIdResult.reason;
    let recoveryCandidate = false;

    if (!tankIdResult.ok) {
      valid = false;
    } else if (!tank) {
      valid = false;
      error = "未登録タンク";
    } else {
      const statusCode = coerceTankStatusCode(currentStatus);
      if (!statusCode) {
        valid = false;
        error = "タンク状態が不正です";
      } else {
        const actionToValidate = mode === "return"
          ? resolveReturnActionCode(tag as ReturnTag, statusCode)
          : mode;
        if (!validateTransitionCode(statusCode, actionToValidate)) {
          if (policyLoading) {
            valid = false;
            error = "操作方針を確認中です";
          } else {
            const previewTargetCustomer = mode === "lend"
              ? selectedCustomer ?? {
                  // UI preview専用。実際の顧客はsubmit時とtransaction内で再検証する。
                  customerId: "__recovery_preview_customer__",
                  customerName: "選択予定の貸出先",
                }
              : null;
            const previewPlan = planTankTransition({
              policyMode: runtimeTransitionEnforcement,
              current: {
                status: statusCode,
                customerId: tank.customerId,
                customerName: tank.customerName,
                location: tank.location,
              },
              requestedAction: actionToValidate,
              targetCustomer: previewTargetCustomer,
              targetLocation: mode === "lend"
                ? selectedCustomer?.customerName ?? "選択予定の貸出先"
                : "倉庫",
            });
            if (previewPlan.ok && previewPlan.plan.kind === "recovery") {
              valid = true;
              recoveryCandidate = true;
              error = "";
            } else {
              valid = false;
              error = `${getTankStatusLabel(statusCode, locale)} は不可`;
            }
          }
        }
      }
    }

    return { tankId, currentStatus, valid, recoveryCandidate, error };
  }, [allTanks, locale, mode, policyLoading, runtimeTransitionEnforcement, selectedCustomer]);

  // policy読込み完了や顧客選択後に、読込み中にscanした候補も再評価する。
  useEffect(() => {
    setOpQueue((previous) => {
      let changed = false;
      const next = previous.map((item) => {
        const evaluated = evaluateQueueTank(item.tankId, item.tag);
        if (
          item.tankId === evaluated.tankId
          && item.status === evaluated.currentStatus
          && item.valid === evaluated.valid
          && item.recoveryCandidate === evaluated.recoveryCandidate
          && item.error === evaluated.error
        ) {
          return item;
        }
        changed = true;
        return {
          ...item,
          tankId: evaluated.tankId,
          status: evaluated.currentStatus,
          valid: evaluated.valid,
          recoveryCandidate: evaluated.recoveryCandidate,
          error: evaluated.error,
        };
      });
      return changed ? next : previous;
    });
  }, [evaluateQueueTank]);

  const addToQueue = useCallback((rawTankId: string) => {
    const evaluated = evaluateQueueTank(rawTankId, returnTag);
    const tankId = evaluated.tankId;
    if (opQueue.some((q) => q.tankId === tankId)) return;

    setOpQueue((prev) => [
      {
        uid: `${Date.now()}_${Math.random()}`,
        tankId,
        status: evaluated.currentStatus,
        valid: evaluated.valid,
        recoveryCandidate: evaluated.recoveryCandidate,
        error: evaluated.error,
        tag: returnTag,
      },
      ...prev,
    ]);

    setLastAdded(tankId);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => {
      setLastAdded(null);
    }, 1500);
  }, [evaluateQueueTank, opQueue, returnTag]);

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

    const keepCount = mode === "return"
      ? validItems.filter((item) => item.tag === RETURN_TAG.KEEP).length
      : 0;
    const returnCount = validItems.length - keepCount;

    if (!skipConfirm) {
      const confirmMessage = mode === "return"
        ? getManualReturnConfirmMessage(locale, {
            tankCount: validItems.length,
            returnCount,
            keepCount,
          })
        : getManualOperationConfirmMessage(mode, locale, {
            tankCount: validItems.length,
          });
      if (!confirm(confirmMessage)) return;
    }

    setSubmitting(true);
    try {
      const actor = requireStaffIdentity();
      const baseContext: OperationContext = {
        actor,
        source: "manual",
        workflow: "tank_operation",
        ...(mode === "lend" && effectiveCustomer
          ? { customer: effectiveCustomer }
          : {}),
      };

      await applyBulkTankOperations(
        validItems.map((item) => {
          const tag = (item.tag || RETURN_TAG.NORMAL) as ReturnTag;
          const statusCode = coerceTankStatusCode(item.status ?? "");
          if (!statusCode) {
            throw new Error(`[${item.tankId}] タンク状態が不正です`);
          }
          const resolvedAction = mode === "return"
            ? resolveReturnActionCode(tag, statusCode)
            : mode;

          const currentTank = allTanks[item.tankId];
          let finalLocation = "倉庫";
          let finalTankNote = "";
          let finalLogNote = "";

          if (mode === "lend") {
            finalLocation = effectiveCustomer?.customerName ?? "";
          } else if (mode === "return") {
            if (tag === RETURN_TAG.KEEP) {
              finalLocation = currentTank?.location || "不明";
              finalLogNote = "持ち越し";
            } else {
              const storedLogNote = returnTagToStoredLogNote(tag);
              finalTankNote = storedLogNote;
              finalLogNote = storedLogNote;
            }
          }

          return {
            tankId: item.tankId,
            transitionAction: resolvedAction,
            currentStatus: item.status || "",
            context: mode === "return"
              ? {
                  ...baseContext,
                  returnCondition: returnTagToReturnCondition(tag),
                }
              : baseContext,
            location: finalLocation,
            tankNote: finalTankNote,
            logNote: finalLogNote,
          };
        })
      );

      const successMessage = mode === "return"
        ? getManualReturnSuccessMessage(locale, {
            tankCount: validItems.length,
            returnCount,
            keepCount,
          })
        : getManualOperationSuccessMessage(mode, locale, {
            tankCount: validItems.length,
          });
      alert(successMessage);
      setOpQueue([]);
      fetchData();
    } catch (e: unknown) {
      const errorMessage = e && typeof e === "object" && "message" in e
        ? String((e as { message: unknown }).message)
        : undefined;
      alert("エラー: " + errorMessage);
    } finally {
      setSubmitting(false);
    }
  }, [allTanks, fetchData, locale, mode, opQueue, selectedCustomer]);

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
