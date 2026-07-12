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
  /** archive生成時に反映済みだった正式集計revision。旧形式はnull。 */
  officialAggregationRevision: number | null;
  /** revision fieldを持つarchiveだけを既知として扱う。 */
  revisionStatus: "known" | "unknown";
  /** 旧形式archiveを集計表示から除外する理由を伝える。 */
  revisionWarning?: string;
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
    const revisionState = classifyMonthlyStatRevision(
      data.officialAggregationRevision,
      currentRevision,
    );
    list.push({
      id: docSnap.id,
      ...data,
      ...revisionState,
    } as MonthlyStat);
  });
  return list;
}

export function classifyMonthlyStatRevision(
  savedRevision: unknown,
  currentRevision: unknown,
): Pick<
  MonthlyStat,
  "officialAggregationRevision" | "revisionStatus" | "revisionWarning" | "isStale"
> {
  if (!isAggregationRevision(savedRevision)) {
    const revisionWarning = savedRevision == null
      ? "旧形式の月次アーカイブのため、正式集計revisionとの一致を確認できません。"
      : "月次アーカイブの正式集計revisionが不正なため、現在の正式集計との一致を確認できません。";
    return {
      officialAggregationRevision: null,
      revisionStatus: "unknown",
      revisionWarning,
      isStale: false,
    };
  }

  const officialAggregationRevision = normalizeAggregationRevision(savedRevision);
  return {
    officialAggregationRevision,
    revisionStatus: "known",
    revisionWarning: undefined,
    isStale: isOfficialAggregationSnapshotStale(
      officialAggregationRevision,
      currentRevision,
    ),
  };
}

function isAggregationRevision(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}
