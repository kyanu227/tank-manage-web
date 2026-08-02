import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  decodeAdminPermissions,
  type AdminPermissionPages,
} from "@/lib/admin/admin-permissions";
import { db } from "@/lib/firebase/config";

export type AdminPermissionsLoadResult =
  | { kind: "valid"; pages: AdminPermissionPages }
  | { kind: "missing"; pages: AdminPermissionPages }
  | { kind: "malformed"; reason: string };

export async function getAdminPermissions(
  controlledPagePaths: readonly string[],
): Promise<AdminPermissionsLoadResult> {
  const snap = await getDoc(doc(db, "settings", "adminPermissions"));
  const decoded = decodeAdminPermissions(snap.exists() ? snap.data() : undefined);

  if (decoded.kind === "missing") {
    return {
      kind: "missing",
      pages: buildDefaultAdminPermissions(controlledPagePaths),
    };
  }

  return decoded;
}

export async function savePermissions(
  pages: AdminPermissionPages,
): Promise<void> {
  await setDoc(doc(db, "settings", "adminPermissions"), {
    pages,
    updatedAt: new Date().toISOString(),
  });
}

function buildDefaultAdminPermissions(
  controlledPagePaths: readonly string[],
): AdminPermissionPages {
  const defaults: Record<string, readonly string[]> = {};
  controlledPagePaths.forEach((path) => {
    defaults[path] = ["管理者"];
  });
  defaults["/admin"] = ["管理者", "準管理者"];
  return defaults;
}
