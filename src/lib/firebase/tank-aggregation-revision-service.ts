import {
  doc,
  onSnapshot,
  type DocumentData,
  type DocumentReference,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  normalizeTankAggregationRevisions,
} from "@/lib/tank-aggregation-revision";

export {
  nextTankAggregationRevisions,
  normalizeAggregationRevision,
  normalizeTankAggregationRevisions,
} from "@/lib/tank-aggregation-revision";
export type {
  TankAggregationRevisionChange,
  TankAggregationRevisions,
} from "@/lib/tank-aggregation-revision";

export const TANK_AGGREGATION_REVISION_DOCUMENT_PATH = "settings/tankAggregationRevision";

export function getTankAggregationRevisionRef(): DocumentReference<DocumentData> {
  return doc(db, "settings", "tankAggregationRevision");
}

export function subscribeTankDataRevision(
  onRevision: (revision: number) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    getTankAggregationRevisionRef(),
    (snapshot) => {
      const revisions = normalizeTankAggregationRevisions(
        snapshot.exists() ? snapshot.data() : null,
      );
      onRevision(revisions.tankDataRevision);
    },
    (error) => onError?.(error),
  );
}

export function subscribeOfficialAggregationRevision(
  onRevision: (revision: number) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    getTankAggregationRevisionRef(),
    (snapshot) => {
      const revisions = normalizeTankAggregationRevisions(
        snapshot.exists() ? snapshot.data() : null,
      );
      onRevision(revisions.officialAggregationRevision);
    },
    (error) => onError?.(error),
  );
}
