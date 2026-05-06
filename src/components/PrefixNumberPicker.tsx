"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * タンクID選択（Prefix + Number の2段選択）
 *
 * 既存タンクID一覧から選ぶ入力手法。ログ編集・管理系のID選択で使う想定。
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
 *   - prefix: 存在する prefix 一覧（select）
 *   - number: 選択中 prefix に紐づく number 一覧（select、存在する番号のみ）
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
  emptyMessage?: string;
};

const TANK_ID_RE = /^([A-Z]+)-(\d{2})$/;

export default function PrefixNumberPicker({
  tankIds,
  value,
  onChange,
  onSelect,
  accentColor = "#3b82f6",
  emptyMessage = "選択できるタンクがありません",
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
    } else if (pendingPrefix && !prefixes.includes(pendingPrefix)) {
      setPendingPrefix(null);
    }
  }, [selectedPrefix, prefixes, pendingPrefix]);

  useEffect(() => {
    if (!value) return;
    const m = value.match(TANK_ID_RE);
    if (!m) {
      onChange(null);
      return;
    }
    if (prefixes.length === 0) return;
    const [, prefix, number] = m;
    if (!byPrefix[prefix]?.includes(number)) {
      onChange(null);
    }
  }, [byPrefix, onChange, prefixes.length, value]);

  const activePrefix = selectedPrefix ?? pendingPrefix;
  const numbers = activePrefix ? byPrefix[activePrefix] ?? [] : [];

  const handlePrefixChange = (p: string) => {
    const nextPrefix = p || null;
    if (activePrefix === nextPrefix) return;
    setPendingPrefix(nextPrefix);
    if (value) onChange(null);
  };

  const handleNumberChange = (n: string) => {
    if (!n) {
      onChange(null);
      return;
    }
    if (!activePrefix) return;
    const id = `${activePrefix}-${n}`;
    onChange(id);
    onSelect?.(id);
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    borderRadius: 12,
    border: "2px solid #e5e7eb",
    background: "#fff",
    color: "#111827",
    fontWeight: 800,
    fontSize: 16,
    padding: "12px 14px",
    outline: "none",
    cursor: "pointer",
    minHeight: 48,
  };

  const labelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
    flex: 1,
  };

  const captionStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.04em",
    color: "#94a3b8",
  };

  return (
    <div style={{ display: "flex", gap: 12, width: "100%", alignItems: "flex-end" }}>
      {prefixes.length === 0 ? (
        <div style={{ color: "#9ca3af", fontSize: 14, padding: "12px 0" }}>
          {emptyMessage}
        </div>
      ) : (
        <>
          <label style={labelStyle}>
            <span style={captionStyle}>アルファベット</span>
            <select
              value={activePrefix ?? ""}
              onChange={(e) => handlePrefixChange(e.target.value)}
              style={{
                ...selectStyle,
                borderColor: activePrefix ? accentColor : "#e5e7eb",
              }}
            >
              <option value="">アルファベットを選択</option>
              {prefixes.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            <span style={captionStyle}>番号</span>
            <select
              value={selectedPrefix === activePrefix ? selectedNumber ?? "" : ""}
              onChange={(e) => handleNumberChange(e.target.value)}
              disabled={!activePrefix || numbers.length === 0}
              style={{
                ...selectStyle,
                borderColor: selectedNumber ? accentColor : "#e5e7eb",
                cursor: !activePrefix || numbers.length === 0 ? "not-allowed" : "pointer",
                background: !activePrefix || numbers.length === 0 ? "#f8fafc" : "#fff",
                color: !activePrefix || numbers.length === 0 ? "#94a3b8" : "#111827",
              }}
            >
              <option value="">
                {!activePrefix ? "アルファベットを選択" : "番号を選択"}
              </option>
              {numbers.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}
