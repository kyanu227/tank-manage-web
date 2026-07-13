export type FirestoreRestValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number | "NaN" | "Infinity" | "-Infinity" }
  | { timestampValue: string }
  | { stringValue: string }
  | { bytesValue: string }
  | { referenceValue: string }
  | { geoPointValue: { latitude: number; longitude: number } }
  | { arrayValue: { values?: FirestoreRestValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreRestValue> } };

export type FirestoreRestDocument = {
  name: string;
  fields?: Record<string, FirestoreRestValue>;
  createTime?: string;
  updateTime?: string;
};

export type FirestoreRunQueryResult = {
  document?: FirestoreRestDocument;
  readTime?: string;
  skippedResults?: number;
};

export type FirestoreBatchGetResult = {
  found?: FirestoreRestDocument;
  missing?: string;
  readTime?: string;
};

export type FirestoreWrite = {
  update?: {
    name: string;
    fields: Record<string, FirestoreRestValue>;
  };
  delete?: string;
  currentDocument?: {
    exists?: boolean;
    updateTime?: string;
  };
};

export type FirestoreCommitResponse = {
  writeResults?: Array<{ updateTime?: string }>;
  commitTime?: string;
};

export type TransitionSnapshotDocumentKind = "tank" | "tank_log" | "transaction";

export type TransitionSnapshotDocumentV1 = {
  kind: TransitionSnapshotDocumentKind;
  name: string;
  fields: Record<string, FirestoreRestValue>;
  createTime: string;
  updateTime: string;
  fieldSha256: string;
};

export type TransitionSnapshotInventoryV1 = {
  totalLogs: number;
  preservedNonTankLogs: number;
  unknownLogs: 0;
  totalTransactions: number;
  preservedTransactions: number;
  unknownTransactions: 0;
};

export type TransitionSnapshotManifestV1 = {
  version: 1;
  scope: "transitionPlanRequiredV1";
  snapshotId: string;
  createdAt: string;
  readTime: string;
  projectId: string;
  databaseId: string;
  databaseUid: string;
  mainCommit: string;
  keyId: string;
  migrationMarkerPath: string;
  counts: {
    tanks: number;
    tankLogs: number;
    transactions: number;
    restoreWrites: number;
  };
  inventory: TransitionSnapshotInventoryV1;
  documentPathSha256: string;
  sourceCensusSha256: string;
  snapshotDocumentsSha256: string;
  subcollectionsChecked: number;
};

export type TransitionSnapshotPayloadV1 = {
  manifest: TransitionSnapshotManifestV1;
  documents: TransitionSnapshotDocumentV1[];
};

export type EncryptedTransitionSnapshotEnvelopeV1 = {
  version: 1;
  algorithm: "AES-256-GCM";
  snapshotId: string;
  keyId: string;
  ivBase64: string;
  authTagBase64: string;
  payloadSha256: string;
  ciphertextSha256: string;
  ciphertextBase64: string;
};

export type TransitionSourceCensus = {
  documents: TransitionSnapshotDocumentV1[];
  readTime: string;
  inventory: TransitionSnapshotInventoryV1;
  markerDocument: FirestoreRestDocument | null;
};
