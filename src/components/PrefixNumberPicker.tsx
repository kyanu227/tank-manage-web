"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * タンクID選択（Prefix + Number の2段選択）
 *
 * ドラムロールに代わる入力手法。ログ編集・管理系のID選択で使う想定。
 *
 * 使い方:
 *   <PrefixNumberPicker
 *     tankIds={tanks.map((t) => t.id)}
 *     value={selectedTankId}
 *     onChange={setSelectedTankId}
 *     onSelect={handleSelect}
 *   />
 *
 * 仕様:
 *   - tankId形式は `^([A-Z]+)-(\d{2})$` 固定。非該当は無視
 *   - 左カラム: 存在する prefix 一覧（縦並びボタン）
 *   - 右カラム: 選択中 prefix に紐づく number 一覧（グリッド、存在する番号のみ）
 *   - prefix 切替で number 選択はリセット
 *   - prefix が1つだけなら自動選択（number は自動確定しない）
 *   - onChange: prefix変更で null、number確定で tankId
 *   - onSelect: number確定時のみ呼ばれる
 */
export type PrefixNumberPickerProps = {
  tankIds: string[];
  value: string | null;
  onChange: (tankId: string | null) => void;
  onSelect?: (tankId: string) => void;
  accentColor?: string;
};

const TANK_ID_RE = /^([A-Z]+)-(\d{2})$/;

export default function PrefixNumberPicker({
  tankIds,
  value,
  onChange,
  onSelect,
  accentColor = "#3b82f6",
}: PrefixNumberPickerProps) {
  const byPrefix = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const id of tankIds) {
      const m = id.match(TANK_ID_RE);
      if (!m) continue;
      const [, prefix, number] = m;
      if (!map.has(prefix)) map.set(prefix, new Set());
      map.get(prefix)!.add(number);
    }
    const result: Record<string, string[]> = {};
    Array.from(map.keys())
      .sort()
      .forEach((p) => {
        result[p] = Array.from(map.get(p)!).sort();
      });
    return result;
  }, [tankIds]);

  const prefixes = useMemo(() => Object.keys(byPrefix), [byPrefix]);

  const parsed = value?.match(TANK_ID_RE) ?? null;
  const selectedPrefix = parsed ? parsed[1] : null;
  const selectedNumber = parsed ? parsed[2] : null;

  // number 未選択でも「どの prefix を見ているか」を保持する内部 state
  const [pendingPrefix, setPendingPrefix] = useState<string | null>(
    selectedPrefix ?? (prefixes.length === 1 ? prefixes[0] : null),
  );

  // value や tankIds の変化に追従
  useEffect(() => {
    if (selectedPrefix) {
      setPendingPrefix(selectedPrefix);
    } else if (prefixes.length === 1) {
      setPendingPrefix(prefixes[0]);
    }
  }, [selectedPrefix, prefixes]);

  const activePrefix = selectedPrefix ?? pendingPrefix;
  const numbers = activePrefix ? byPrefix[activePrefix] ?? [] : [];

  const handlePrefixClick = (p: string) => {
    if (activePrefix === p) return;
    setPendingPrefix(p);
    if (value) onChange(null);
  };

  const handleNumberClick = (n: string) => {
    if (!activePrefix) return;
    const id = `${activePrefix}-${n}`;
    onChange(id);
    onSelect?.(id);
  };

  const btnBase: React.CSSProperties = {
    padding: "12px 14px",
    borderRadius: 10,
    border: "2px solid #e5e7eb",
    background: "#fff",
    color: "#111",
    fontWeight: 700,
    fontSize: 16,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
    lineHeight: 1,
  };

  const activeStyle = (on: boolean): React.CSSProperties =>
    on
      ? {
          borderColor: accentColor,
          background: accentColor,
          color: "#fff",
          boxShadow: `0 2px 8px ${accentColor}33`,
        }
      : {};

  return (
    <div style={{ display: "flex", gap: 12, width: "100%", alignItems: "stretch" }}>
      {/* 左: Prefix box */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minWidth: 88,
          maxHeight: 360,
          overflowY: "auto",
          padding: 2,
        }}
      >
        {prefixes.length === 0 ? (
          <div style={{ color: "#999", fontSize: 13, padding: 8 }}>
            タンクがありません
          </div>
        ) : (
          prefixes.map((p) => {
            const on = activePrefix === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => handlePrefixClick(p)}
                style={{ ...btnBase, ...activeStyle(on), minWidth: 80 }}
              >
                {p}
              </button>
            );
          })
        )}
      </div>

      {/* 右: Number box */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          maxHeight: 360,
          overflowY: "auto",
          padding: 2,
        }}
      >
        {!activePrefix ? (
          <div
            style={{
              color: "#9ca3af",
              padding: "32px 16px",
              textAlign: "center",
              fontSize: 14,
            }}
          >
            左からPrefixを選択してください
          </div>
        ) : numbers.length === 0 ? (
          <div
            style={{
              color: "#9ca3af",
              padding: "32px 16px",
              textAlign: "center",
              fontSize: 14,
            }}
          >
            該当する番号がありません
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
              gap: 8,
            }}
          >
            {numbers.map((n) => {
              const on =
                selectedPrefix === activePrefix && selectedNumber === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => handleNumberClick(n)}
                  style={{
                    ...btnBase,
                    ...activeStyle(on),
                    padding: "14px 0",
                    fontSize: 18,
                    textAlign: "center",
                  }}
                >
                  {n}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
