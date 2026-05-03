"use client";

import { ArrowLeft, Loader2, Send, X } from "lucide-react";
import DrumRoll from "@/components/DrumRoll";
import QuickSelect from "@/components/QuickSelect";
import type { QuickSelectOption } from "@/components/QuickSelect";
import ReturnTagSelector from "@/components/ReturnTagSelector";
import type { CustomerSnapshot } from "@/lib/operation-context";
import type { UseManualTankOperationResult } from "../hooks/useManualTankOperation";
import type { ModeConfigItem, OpMode, TagType } from "../types";

interface ManualOperationPanelProps {
  mode: OpMode;
  config: ModeConfigItem;
  prefixes: string[];
  customerOptions?: QuickSelectOption[];
  selectedCustomerId?: string;
  setSelectedCustomerId?: (customerId: string) => void;
  manual: UseManualTankOperationResult;
  onBack?: () => void;
}

export default function ManualOperationPanel({
  mode,
  config,
  prefixes,
  customerOptions = [],
  selectedCustomerId = "",
  setSelectedCustomerId,
  manual,
  onBack,
}: ManualOperationPanelProps) {
  const {
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
  } = manual;
  const isLend = mode === "lend";
  const isReturn = mode === "return";
  const isFill = mode === "fill";

  const customerSnapshotFromOption = (customerId: string): CustomerSnapshot | null => {
    const option = customerOptions.find((item) => typeof item !== "string" && item.value === customerId);
    if (!option || typeof option === "string") return null;
    return { customerId: option.value, customerName: option.label };
  };

  const handleCustomerConfirm = (customerId: string) => {
    const customer = customerSnapshotFromOption(customerId);
    if (!customer) {
      alert("貸出先を取得できませんでした。貸出先を選び直してください。");
      return;
    }
    void handleSubmit(true, customer);
  };

  return (
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
          {isReturn && onBack ? (
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button
                onClick={onBack}
                style={{
                  width: 36, height: 36, borderRadius: 8, border: "none",
                  background: "#f1f5f9", cursor: "pointer", color: "#64748b",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}
              >
                <ArrowLeft size={16} />
              </button>
              <OkButton
                activePrefix={activePrefix}
                inputValue={inputValue}
                lastAdded={lastAdded}
                color={config.color}
                onClick={handleManualOkTrigger}
                compact
              />
            </div>
          ) : (
            <OkButton
              activePrefix={activePrefix}
              inputValue={inputValue}
              lastAdded={lastAdded}
              color={config.color}
              onClick={handleManualOkTrigger}
            />
          )}
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
                <div key={item.uid} className={!isReturn ? "queue-anim" : undefined} style={{
                  background: "#fff", padding: "12px 16px", borderRadius: 12,
                  borderLeft: `5px solid ${item.valid ? config.color : "#ef4444"}`,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  ...(!isReturn ? { animation: "slideInLeft 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)" } : {}),
                }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.05em", color: "#0f172a" }}>
                        {item.tankId}
                      </span>
                      {!isFill && item.tag !== "normal" && (
                        <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: item.tag === "unused" ? "#d1fae5" : "#fee2e2", color: item.tag === "unused" ? "#047857" : "#b91c1c" }}>
                          {item.tag === "unused" ? "未使用" : "未充填"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: item.valid ? "#64748b" : "#ef4444", fontWeight: 600, marginTop: 4 }}>
                      {item.valid ? `現在: ${item.status || "不明"} ` : item.error}
                    </div>
                  </div>
                  <button onClick={() => removeFromQueue(item.uid)} style={{ border: "none", background: "none", color: "#cbd5e1", padding: 8, cursor: "pointer", marginRight: isReturn ? undefined : -8 }}>
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {isLend && setSelectedCustomerId && (
          <div style={{
            padding: "8px 16px", background: "#fff", borderTop: "1px solid #e2e8f0",
            flexShrink: 0, zIndex: 20,
          }}>
            <QuickSelect
              options={customerOptions}
              value={selectedCustomerId}
              onChange={setSelectedCustomerId}
              onConfirm={handleCustomerConfirm}
              color={config.color}
              placeholder="貸出先を選択して実行..."
            />
          </div>
        )}

        {isReturn && (
          <div style={{
            padding: "8px 16px", background: "#fff", borderTop: "1px solid #e2e8f0",
            flexShrink: 0, zIndex: 20,
          }}>
            <ReturnTagSelector<TagType>
              value={returnTag}
              onChange={setReturnTag}
              options={[
                { value: "uncharged", label: "未充填" },
                { value: "unused", label: "未使用" },
              ]}
              compact
            />
          </div>
        )}

        {opQueue.length > 0 && (
          <FloatingSubmitButton
            mode={mode}
            config={config}
            validCount={validCount}
            submitting={submitting}
            onClick={() => handleSubmit(!isReturn)}
          />
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
  );
}

interface OkButtonProps {
  activePrefix: string | null;
  inputValue: string;
  lastAdded: string | null;
  color: string;
  onClick: () => void;
  compact?: boolean;
}

function OkButton({ activePrefix, inputValue, lastAdded, color, onClick, compact = false }: OkButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={!activePrefix}
      style={{
        width: compact ? undefined : "100%", flex: compact ? 1 : undefined,
        padding: compact ? "8px" : "14px", borderRadius: 12, border: "none",
        background: lastAdded ? "#10b981" : (activePrefix ? color : "#e2e8f0"),
        color: (activePrefix || lastAdded) ? "#fff" : "#94a3b8",
        fontSize: 20, fontWeight: 900,
        boxShadow: (activePrefix || lastAdded) ? `0 4px 12px ${lastAdded ? "#10b981" : color}40` : "none",
        cursor: activePrefix ? "pointer" : "not-allowed",
        transition: "background 0.2s, box-shadow 0.2s",
      }}
    >
      {lastAdded
        ? lastAdded
        : (!activePrefix ? "OK入力" : inputValue ? `${activePrefix} - ${inputValue}` : `${activePrefix} - OK`)}
    </button>
  );
}

interface FloatingSubmitButtonProps {
  mode: OpMode;
  config: ModeConfigItem;
  validCount: number;
  submitting: boolean;
  onClick: () => void;
}

function FloatingSubmitButton({ mode, config, validCount, submitting, onClick }: FloatingSubmitButtonProps) {
  const isLend = mode === "lend";
  const isReturn = mode === "return";
  const wrapperStyle = isLend
    ? {
        position: "absolute" as const, bottom: 56, left: 0, right: 0,
        padding: "0 16px 8px", zIndex: 21, pointerEvents: "none" as const,
      }
    : isReturn
      ? {
          position: "absolute" as const, bottom: 52, left: 0, right: 0,
          padding: "0 16px 8px", zIndex: 21, pointerEvents: "none" as const,
        }
      : {
          position: "absolute" as const, bottom: 0, left: 0, right: 0,
          padding: "12px 16px max(12px, env(safe-area-inset-bottom, 12px))",
          background: "linear-gradient(transparent, rgba(248,250,252,0.95) 20%)",
          zIndex: 20, pointerEvents: "none" as const,
        };

  return (
    <div style={wrapperStyle}>
      <button
        onClick={onClick}
        disabled={submitting}
        style={{
          width: "100%", padding: mode === "fill" ? "14px" : "12px", borderRadius: 12, border: "none",
          background: config.color, color: "#fff",
          fontSize: mode === "fill" ? 16 : 15, fontWeight: 900,
          display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
          cursor: submitting ? "not-allowed" : "pointer",
          pointerEvents: "auto",
          boxShadow: isLend || isReturn ? "0 4px 16px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.15)",
        }}
      >
        {submitting ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
        <span>{validCount}件の{mode === "return" ? "返却" : config.label}を実行</span>
      </button>
    </div>
  );
}
