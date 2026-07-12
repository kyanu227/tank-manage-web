import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export type AdminPermissionPages = Record<string, string[]>;

export async function getAdminPermissions(
  controlledPagePaths: readonly string[],
): Promise<AdminPermissionPages> {
  const snap = await getDoc(doc(db, "settings", "adminPermissions"));
  if (snap.exists()) {
    return snap.data().pages as AdminPermissionPages;
  }

  return buildDefaultAdminPermissions(controlledPagePaths);
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
  const defaults: AdminPermissionPages = {};
  controlledPagePaths.forEach((path) => {
    defaults[path] = ["管理者"];
  });
  defaults["/admin"] = ["管理者", "準管理者"];
  return defaults;
}
