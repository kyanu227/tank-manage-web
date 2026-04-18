"use client";

import { useCallback, useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
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
 * - tanks: ID昇順ソート済みの配列
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
      const snap = await getDocs(collection(db, "tanks"));
      const list: TankDoc[] = [];
      const map: Record<string, TankDoc> = {};
      const pSet = new Set<string>();
      snap.forEach((d) => {
        const raw = d.data() as any;
        const t: TankDoc = {
          id: d.id,
          status: String(raw.status ?? ""),
          location: raw.location != null ? String(raw.location) : undefined,
          staff: raw.staff != null ? String(raw.staff) : undefined,
          type: raw.type != null ? String(raw.type) : undefined,
          note: raw.note != null ? String(raw.note) : undefined,
          logNote: raw.logNote != null ? String(raw.logNote) : undefined,
          updatedAt: raw.updatedAt,
          nextMaintenanceDate: raw.nextMaintenanceDate,
        };
        list.push(t);
        map[d.id] = t;
        const m = d.id.match(/^([A-Z]+)/i);
        if (m) pSet.add(m[1].toUpperCase());
      });
      list.sort((a, b) => a.id.localeCompare(b.id));
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
