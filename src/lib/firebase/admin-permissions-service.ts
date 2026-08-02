import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  decodeAdminPermissions,
  normalizeAdminCapabilityGrantsForSave,
  type AdminCapabilityGrants,
} from "@/lib/admin/admin-permissions";
import { db } from "@/lib/firebase/config";

export type AdminPermissionsLoadResult =
  | {
      kind: "valid";
      capabilities: AdminCapabilityGrants;
      source: "capabilities" | "legacy-paths";
      ignoredLegacyPaths: readonly string[];
    }
  | { kind: "missing"; capabilities: AdminCapabilityGrants }
  | { kind: "malformed"; reason: string };

export async function getAdminPermissions(): Promise<AdminPermissionsLoadResult> {
  const snap = await getDoc(doc(db, "settings", "adminPermissions"));
  const decoded = decodeAdminPermissions(snap.exists() ? snap.data() : undefined);

  if (decoded.kind === "missing") {
    return { kind: "missing", capabilities: {} };
  }

  return decoded;
}

export async function saveAdminPermissions({
  capabilities,
  actorRole,
}: {
  capabilities: AdminCapabilityGrants;
  actorRole: string;
}): Promise<void> {
  if (actorRole !== "管理者") {
    throw new Error("権限設定は管理者だけが変更できます。");
  }
  await setDoc(doc(db, "settings", "adminPermissions"), {
    capabilities: normalizeAdminCapabilityGrantsForSave(capabilities),
    updatedAt: new Date().toISOString(),
  });
}
