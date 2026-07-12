import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type DocumentReference,
  type Transaction,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { OperationActor } from "@/lib/operation-context";
import {
  isTransitionEnforcementMode,
  normalizeTankOperationPolicy,
  type TankOperationPolicy,
  type TransitionEnforcementMode,
} from "@/lib/tank-transition-policy";

export const TANK_OPERATION_POLICY_DOCUMENT_PATH = "settings/tankOperationPolicy";
/** Rules保護とemulator smoke完了後、build時に明示的に開放するrollout gate。 */
export const ADVISORY_ACTIVATION_ENABLED =
  process.env.NEXT_PUBLIC_TANK_ADVISORY_ACTIVATION_ENABLED === "true";

export function getTankOperationPolicyRef(): DocumentReference<DocumentData> {
  return doc(db, "settings", "tankOperationPolicy");
}

/** document不存在・field欠落・不正値はstrict。read自体の失敗は呼出元へthrowする。 */
export async function getTankOperationPolicy(): Promise<TankOperationPolicy> {
  const snapshot = await getDoc(getTankOperationPolicyRef());
  return normalizeRuntimeTankOperationPolicy(snapshot.exists() ? snapshot.data() : null);
}

/** transaction内で必ずwriteより先に呼び出す。read失敗時はtransaction全体が中止される。 */
export async function getTankOperationPolicyInTransaction(
  transaction: Transaction,
): Promise<TankOperationPolicy> {
  const snapshot = await transaction.get(getTankOperationPolicyRef());
  return normalizeRuntimeTankOperationPolicy(snapshot.exists() ? snapshot.data() : null);
}

export type SaveTankOperationPolicyInput = {
  transitionEnforcement: TransitionEnforcementMode;
  actor: Pick<OperationActor, "staffId" | "staffName">;
  expectedPolicyRevision?: number;
};

export async function saveTankOperationPolicy(
  input: SaveTankOperationPolicyInput,
): Promise<TankOperationPolicy> {
  if (!isTransitionEnforcementMode(input.transitionEnforcement)) {
    throw new Error("状態遷移モードが不正です。");
  }
  if (!input.actor.staffId.trim() || !input.actor.staffName.trim()) {
    throw new Error("更新者のstaffId/staffNameが必要です。");
  }
  if (
    input.expectedPolicyRevision !== undefined
    && (!Number.isSafeInteger(input.expectedPolicyRevision) || input.expectedPolicyRevision < 0)
  ) {
    throw new Error("expectedPolicyRevisionが不正です。");
  }
  if (input.transitionEnforcement === "advisory" && !ADVISORY_ACTIVATION_ENABLED) {
    throw new Error(
      "Security Rulesの保護・emulator検証が完了するまで自動補完モードは有効化できません。",
    );
  }

  const reference = getTankOperationPolicyRef();
  return runTransaction(db, async (transaction) => {
    const staffReference = doc(db, "staff", input.actor.staffId.trim());
    const [snapshot, staffSnapshot] = await Promise.all([
      transaction.get(reference),
      transaction.get(staffReference),
    ]);
    if (!staffSnapshot.exists()) {
      throw new Error("管理者情報が見つかりません。再ログインしてください。");
    }
    const staff = staffSnapshot.data();
    if (staff.isActive !== true || staff.role !== "管理者") {
      throw new Error("状態遷移モードは有効な管理者だけが変更できます。");
    }
    const current = normalizeTankOperationPolicy(snapshot.exists() ? snapshot.data() : null);
    if (
      input.expectedPolicyRevision !== undefined
      && input.expectedPolicyRevision !== current.policyRevision
    ) {
      throw new Error("操作方針が別の管理者によって更新されています。再読み込みしてください。");
    }

    const policyRevision = current.policyRevision + 1;
    if (!Number.isSafeInteger(policyRevision)) {
      throw new Error("policyRevisionの上限に達しています。");
    }
    const updatedByStaffName = typeof staff.name === "string" && staff.name.trim()
      ? staff.name.trim()
      : input.actor.staffName.trim();
    transaction.set(reference, {
      transitionEnforcement: input.transitionEnforcement,
      policyRevision,
      updatedAt: serverTimestamp(),
      updatedByStaffId: staffReference.id,
      updatedByStaffName,
    }, { merge: true });

    return {
      transitionEnforcement: input.transitionEnforcement,
      policyRevision,
      updatedByStaffId: staffReference.id,
      updatedByStaffName,
    };
  });
}

export function subscribeTankOperationPolicy(
  onPolicy: (policy: TankOperationPolicy) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    getTankOperationPolicyRef(),
    (snapshot) => {
      onPolicy(normalizeRuntimeTankOperationPolicy(snapshot.exists() ? snapshot.data() : null));
    },
    (error) => {
      onError?.(error);
    },
  );
}

/** rollout gateが閉じているbuildでは、document値に関係なく実行モードをstrictへ固定する。 */
function normalizeRuntimeTankOperationPolicy(value: unknown): TankOperationPolicy {
  const policy = normalizeTankOperationPolicy(value);
  if (ADVISORY_ACTIVATION_ENABLED || policy.transitionEnforcement === "strict") return policy;
  return { ...policy, transitionEnforcement: "strict" };
}
