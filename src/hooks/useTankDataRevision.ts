"use client";

import { useEffect, useState } from "react";
import { subscribeTankDataRevision } from "@/lib/firebase/tank-aggregation-revision-service";

/** raw logsやpending状態が変わった際に、開いている画面を再取得させる。 */
export function useTankDataRevision(): number {
  const [revision, setRevision] = useState(0);

  useEffect(() => subscribeTankDataRevision(
    setRevision,
    (error) => {
      console.error("タンクデータrevisionの購読に失敗しました:", error);
    },
  ), []);

  return revision;
}
