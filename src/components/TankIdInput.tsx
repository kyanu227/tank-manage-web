"use client";

import { useRef } from "react";
import DrumRoll from "@/components/DrumRoll";

/**
 * タンクID入力（業務ラッパー）
 *
 * - プレフィックス選択（DrumRoll）+ 数字入力 + OK入力ボタンを束ねる
 * - 数字が規定桁に達したら自動で onCommit される
 * - OK入力ボタンを押した場合も onCommit される（数字未入力時は "OK" を補完）
 * - ページ固有のUIは headerSlot / beforeConfirm / footerSlot から差し込める
 *
 * 現状のスタッフ画面（充填・返却手動モード相当）と同じ挙動になるよう設計。
 * 貸出モードは2カラム構成のためこのコンポーネントを直接は利用せず、
 * DrumRoll を個別配置する。
 */
export type TankIdInputProps = {
  /** プレフィックス一覧（例: ["A", "B", "C"]） */
  prefixes: readonly string[];
  /** 現在選択中のプレフィックス */
  activePrefix: string | null;
  /** プレフィックスが変わったときの通知 */
  onPrefixChange: (prefix: string) => void;
  /** 数字入力の現在値 */
  numberValue: string;
  /** 数字入力の変更通知（数字のみが渡る） */
  onNumberChange: (v: string) => void;
  /** タンクID確定時の通知（`${prefix}-${number or "OK"}`） */
  onCommit: (tankId: string) => void;
  /** OK入力ボタンのラベル。デフォルト "OK入力" */
  confirmLabel?: string;
  /** アクセント色（ドラム・ボタン・選択枠）。デフォルト #3b82f6 */
  accentColor?: string;
  /** 数字の桁数。デフォルト 2 */
  digits?: number;
  /** 直近に追加されたタンクID（ボタン上に一瞬表示）。null なら通常表示 */
  lastAdded?: string | null;

  /** OK入力ボタンの前に差し込むヘッダー領域 */
  headerSlot?: React.ReactNode;
  /** OK入力ボタンの直前（送信リスト等）に差し込む領域 */
  beforeConfirm?: React.ReactNode;
  /** フッター領域に差し込む領域 */
  footerSlot?: React.ReactNode;
};

export default function TankIdInput({
  prefixes,
  activePrefix,
  onPrefixChange,
  numberValue,
  onNumberChange,
  onCommit,
  confirmLabel = "OK入力",
  accentColor = "#3b82f6",
  digits = 2,
  lastAdded = null,
  headerSlot,
  beforeConfirm,
  footerSlot,
}: TankIdInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, "");
    if (val.length > digits) return;
    onNumberChange(val);
    if (val.length === digits && activePrefix) {
      onCommit(`${activePrefix}-${val}`);
      onNumberChange("");
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const handleOkClick = () => {
    if (!activePrefix) return;
    const payload = numberValue || "OK";
    onCommit(`${activePrefix}-${payload}`);
    onNumberChange("");
    if (inputRef.current) inputRef.current.focus();
  };

  const handlePrefixChange = (p: string) => {
    onPrefixChange(p);
    onNumberChange("");
    if (inputRef.current) inputRef.current.focus();
  };

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {headerSlot}

        {/* OK入力ボタン（上部） */}
        <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleOkClick}
            disabled={!activePrefix}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: 12,
              border: "none",
              background: lastAdded ? "#10b981" : activePrefix ? accentColor : "#e2e8f0",
              color: activePrefix || lastAdded ? "#fff" : "#94a3b8",
              fontSize: 20,
              fontWeight: 900,
              boxShadow:
                activePrefix || lastAdded
                  ? `0 4px 12px ${lastAdded ? "#10b981" : accentColor}40`
                  : "none",
              cursor: activePrefix ? "pointer" : "not-allowed",
              transition: "background 0.2s, box-shadow 0.2s",
            }}
          >
            {lastAdded
              ? lastAdded
              : !activePrefix
              ? confirmLabel
              : numberValue
              ? `${activePrefix} - ${numberValue}`
              : `${activePrefix} - OK`}
          </button>
        </div>

        {/* ページ固有UI（送信リスト・タグ選択等） */}
        {beforeConfirm}

        {footerSlot}
      </div>

      {/* 右カラム: プレフィックスドラム */}
      <DrumRoll
        items={prefixes}
        value={activePrefix}
        onChange={onPrefixChange}
        onSelect={handlePrefixChange}
        accentColor={accentColor}
      />

      {/* 数字入力（隠し） */}
      <input
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        value={numberValue}
        onChange={handleInputChange}
        style={{
          position: "absolute",
          opacity: 0,
          width: 1,
          height: 1,
          overflow: "hidden",
          pointerEvents: "none",
          caretColor: "transparent",
        }}
      />
    </div>
  );
}
