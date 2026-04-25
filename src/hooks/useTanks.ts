"use client";

import { useCallback, useEffect, useState } from "react";
import { tanksRepository } from "@/lib/firebase/repositories";
import type { TankDoc } from "@/lib/tank-types";

export interface UseTanksResult {
  tanks: TankDoc[];
  tankMap: Record<string, TankDoc>;
  prefixes: string[];
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * tanks コレクション全件を取得する共通フック。
 * - tanks: ID昇順ソート済みの配列（ソートは tanksRepository.getTanks 側で実施）
 * - tankMap: id -> TankDoc の辞書
 * - prefixes: タンクIDの先頭アルファベット（A-Zソート済）
 * - loading: 初回ロード/再取得中フラグ
 * - refetch: 再取得トリガ
 *
 * ステータス等の絞り込みは呼び出し側で useMemo 等により実施する。
 */
export function useTanks(): UseTanksResult {
  const [tanks, setTanks] = useState<TankDoc[]>([]);
  const [tankMap, setTankMap] = useState<Record<string, TankDoc>>({});
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      // ソート・正規化済みの一覧を取得
      const list = await tanksRepository.getTanks();
      // 派生値（tankMap / prefixes）はフック側で構築する
      const map: Record<string, TankDoc> = {};
      const pSet = new Set<string>();
      list.forEach((t) => {
        map[t.id] = t;
        const m = t.id.match(/^([A-Z]+)/i);
        if (m) pSet.add(m[1].toUpperCase());
      });
      setTanks(list);
      setTankMap(map);
      setPrefixes(Array.from(pSet).sort());
    } catch (e) {
      console.error("useTanks refetch failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { tanks, tankMap, prefixes, loading, refetch };
}
