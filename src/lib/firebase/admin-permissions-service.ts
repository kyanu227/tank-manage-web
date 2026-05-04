import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export type AdminPermissionPages = Record<string, string[]>;

export async function savePermissions(
  pages: AdminPermissionPages,
): Promise<void> {
  await setDoc(doc(db, "settings", "adminPermissions"), {
    pages,
    updatedAt: new Date().toISOString(),
  });
}
