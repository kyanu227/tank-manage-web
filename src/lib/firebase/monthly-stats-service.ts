import { collection, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  getTankAggregationRevisionRef,
} from "@/lib/firebase/tank-aggregation-revision-service";
import {
  isOfficialAggregationSnapshotStale,
  normalizeAggregationRevision,
  normalizeTankAggregationRevisions,
} from "@/lib/tank-aggregation-revision";

export interface MonthlyStat {
  id: string;
  month: string;
  location: string;
  lends: number;
  returns: number;
  unused: number;
  defaults: number;
  /** archive生成時に反映済みだった正式集計revision。 */
  officialAggregationRevision: number;
  /** 正式集計対象の変更後に再生成が必要な保存済みcache。 */
  isStale: boolean;
}

export async function getMonthlyStats(): Promise<MonthlyStat[]> {
  const [snap, revisionSnapshot] = await Promise.all([
    getDocs(query(collection(db, "monthly_stats"), orderBy("month", "desc"))),
    getDoc(getTankAggregationRevisionRef()),
  ]);
  const currentRevision = normalizeTankAggregationRevisions(
    revisionSnapshot.exists() ? revisionSnapshot.data() : null,
  ).officialAggregationRevision;
  const list: MonthlyStat[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const officialAggregationRevision = normalizeAggregationRevision(
      data.officialAggregationRevision,
    );
    list.push({
      id: docSnap.id,
      ...data,
      officialAggregationRevision,
      isStale: isOfficialAggregationSnapshotStale(
        officialAggregationRevision,
        currentRevision,
      ),
    } as MonthlyStat);
  });
  return list;
}
