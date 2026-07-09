import { collection, doc, getDocs, serverTimestamp, writeBatch, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { assertNotChangedSinceLoad, createDocId, hasFieldChanges, isNewDocId } from "@/lib/firebase/diff-write";

export interface AdminLineConfig {
  uid: string;
  name: string;
  token: string;
  groupId: string;
  targets: string[];
}

export interface SaveAdminNotificationSettingsInput {
  emails: string[];
  alertMonths: number;
  validityYears: number;
  lineConfigs: AdminLineConfig[];
  dirtyLineConfigIds: string[];
  deletedLineConfigIds: string[];
}

export interface AdminNotificationSettings {
  emails: string[];
  alertMonths: number;
  validityYears: number;
  lineConfigs: AdminLineConfig[];
}

const DEFAULT_NOTIFICATION_SETTINGS: Omit<AdminNotificationSettings, "lineConfigs"> = {
  emails: [],
  alertMonths: 6,
  validityYears: 3,
};

export async function loadAdminNotificationSettings(): Promise<AdminNotificationSettings> {
  const [notifySnap, lineSnap] = await Promise.all([
    getDocs(collection(db, "notifySettings")),
    getDocs(collection(db, "lineConfigs")),
  ]);

  let systemSettings = DEFAULT_NOTIFICATION_SETTINGS;
  notifySnap.forEach((docSnap) => {
    if (docSnap.id !== "config") return;
    const data = docSnap.data();
    systemSettings = {
      emails: (data.emails || []) as string[],
      alertMonths: data.alertMonths || DEFAULT_NOTIFICATION_SETTINGS.alertMonths,
      validityYears: data.validityYears || DEFAULT_NOTIFICATION_SETTINGS.validityYears,
    };
  });

  const lineConfigs: AdminLineConfig[] = [];
  lineSnap.forEach((docSnap) => {
    lineConfigs.push({ uid: docSnap.id, ...docSnap.data() } as AdminLineConfig);
  });

  return {
    ...systemSettings,
    lineConfigs,
  };
}

export async function saveAdminNotificationSettings({
  emails,
  alertMonths,
  validityYears,
  lineConfigs,
  dirtyLineConfigIds,
  deletedLineConfigIds,
}: SaveAdminNotificationSettingsInput): Promise<void> {
  const batch = writeBatch(db);

  batch.set(doc(db, "notifySettings", "config"), {
    emails: emails.map((email) => email.trim()).filter(Boolean),
    alertMonths,
    validityYears,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  const lineSnap = await getDocs(collection(db, "lineConfigs"));
  const currentLines = new Map(lineSnap.docs.map((d) => [d.id, d.data()]));
  deletedLineConfigIds.forEach((id) => batch.delete(doc(db, "lineConfigs", id)));

  lineConfigs.forEach((lineConfig) => {
    const id = isNewDocId(lineConfig.uid) ? createDocId("line") : lineConfig.uid;
    const ref = doc(db, "lineConfigs", id);
    const payload = {
      name: lineConfig.name.trim(),
      token: lineConfig.token.trim(),
      groupId: lineConfig.groupId.trim(),
      targets: lineConfig.targets,
    };

    if (isNewDocId(lineConfig.uid)) {
      batch.set(ref, { ...payload, updatedAt: serverTimestamp() });
      return;
    }

    if (!dirtyLineConfigIds.includes(lineConfig.uid)) return;

    const current = currentLines.get(id);
    if (!current) {
      throw new Error(`LINE設定「${lineConfig.name || id}」は他の操作で削除されています。再読込してください。`);
    }

    assertNotChangedSinceLoad(lineConfig as unknown as DocumentData, current, `LINE設定「${lineConfig.name || id}」`);
    if (hasFieldChanges(current, payload)) {
      batch.update(ref, { ...payload, updatedAt: serverTimestamp() });
    }
  });

  await batch.commit();
}
