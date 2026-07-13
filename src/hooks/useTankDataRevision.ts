"use client";

import { useEffect, useState } from "react";
import { subscribeTankDataRevision } from "@/lib/firebase/tank-aggregation-revision-service";

export type TankDataRevisionHealth = "loading" | "ready" | "error";

export interface TankDataRevisionState {
  revision: number;
  health: TankDataRevisionHealth;
  ready: boolean;
  error: Error | null;
}

/** revision値だけでなく、初回取得完了と購読エラーも呼出元へ伝える。 */
export function useTankDataRevisionState(): TankDataRevisionState {
  const [state, setState] = useState<TankDataRevisionState>({
    revision: 0,
    health: "loading",
    ready: false,
    error: null,
  });

  useEffect(() => subscribeTankDataRevision(
    (revision) => {
      setState({
        revision,
        health: "ready",
        ready: true,
        error: null,
      });
    },
    (error) => {
      setState((current) => ({
        revision: current.revision,
        health: "error",
        ready: false,
        error,
      }));
      console.error("タンクデータrevisionの購読に失敗しました:", error);
    },
  ), []);

  return state;
}

/** raw logsやpending状態が変わった際に、開いている画面を再取得させる。 */
export function useTankDataRevision(): number {
  return useTankDataRevisionState().revision;
}
