import { canonicalStringify, compareCanonicalStrings } from "./canonical-firestore-value";
import type {
  FirestoreBatchGetResult,
  FirestoreCommitResponse,
  FirestoreRestDocument,
  FirestoreRunQueryResult,
  FirestoreWrite,
} from "./firestore-rest-types";
import {
  assertFirestoreCommitAllowed,
} from "./production-execute-gates";
import type { ProductionCutoverOperation } from "./production-execution-contract";

type AccessTokenProvider = () => Promise<string>;
const FIRESTORE_REQUEST_TIMEOUT_MS = 60_000;

export type FirestoreRestClientOptions = {
  projectId: string;
  databaseId: string;
  emulatorHost?: string;
  accessTokenProvider?: AccessTokenProvider;
  dataPrincipal?: string;
};

export class FirestoreRestClient {
  readonly projectId: string;
  readonly databaseId: string;
  readonly databaseName: string;
  readonly databasePrefix: string;
  readonly emulatorHost?: string;
  readonly dataPrincipal?: string;

  private readonly apiRoot: string;
  private readonly accessTokenProvider?: AccessTokenProvider;
  private verifiedDatabaseUid?: string;

  constructor(options: FirestoreRestClientOptions) {
    this.projectId = requireProjectId(options.projectId);
    this.databaseId = requireDatabaseId(options.databaseId);
    this.databaseName = `projects/${this.projectId}/databases/${this.databaseId}`;
    this.databasePrefix = this.databaseName;
    this.emulatorHost = normalizeEmulatorHost(options.emulatorHost);
    this.apiRoot = this.emulatorHost
      ? `http://${this.emulatorHost}/v1`
      : "https://firestore.googleapis.com/v1";
    if (!this.emulatorHost && !options.accessTokenProvider) {
      throw new Error("本番cutover REST clientには検証済みaccess token providerが必須です");
    }
    if (!this.emulatorHost && !options.dataPrincipal?.trim()) {
      throw new Error("本番cutover REST clientには検証済みdata principalが必須です");
    }
    this.accessTokenProvider = this.emulatorHost ? undefined : options.accessTokenProvider;
    this.dataPrincipal = this.emulatorHost ? undefined : options.dataPrincipal?.trim();
  }

  get documentsRoot(): string {
    return `${this.apiRoot}/${this.databaseName}/documents`;
  }

  fullDocumentName(relativePath: string): string {
    return `${this.databasePrefix}/documents/${normalizeRelativeDocumentPath(relativePath)}`;
  }

  async verifyDatabaseUid(expectedDatabaseUid: string): Promise<void> {
    if (!expectedDatabaseUid.trim()) throw new Error("expected database UIDは必須です");
    if (this.emulatorHost) {
      const expected = emulatorDatabaseUid(this.projectId, this.databaseId);
      if (expectedDatabaseUid !== expected) {
        throw new Error(`Emulator database UIDが一致しません: expected=${expected}`);
      }
      this.verifiedDatabaseUid = expected;
      return;
    }
    const database = await this.request<Record<string, unknown>>(
      "GET",
      `${this.apiRoot}/${this.databaseName}`,
    );
    if (database.name !== this.databaseName) {
      throw new Error(`Firestore database nameが一致しません: ${String(database.name ?? "missing")}`);
    }
    if (typeof database.uid !== "string" || database.uid !== expectedDatabaseUid) {
      throw new Error(`Firestore database UIDが一致しません: ${String(database.uid ?? "missing")}`);
    }
    this.verifiedDatabaseUid = expectedDatabaseUid;
  }

  async beginReadOnlyTransaction(): Promise<string> {
    const response = await this.request<{ transaction?: string }>(
      "POST",
      `${this.documentsRoot}:beginTransaction`,
      { options: { readOnly: {} } },
    );
    if (typeof response.transaction !== "string" || !response.transaction) {
      throw new Error("Firestore read-only transaction tokenを取得できません");
    }
    return response.transaction;
  }

  async rollback(transaction: string): Promise<void> {
    await this.request<Record<string, never>>(
      "POST",
      `${this.documentsRoot}:rollback`,
      { transaction },
    );
  }

  async runCollectionQuery(
    collectionId: string,
    transaction: string,
  ): Promise<{ documents: FirestoreRestDocument[]; readTime: string }> {
    const results = await this.request<FirestoreRunQueryResult[]>(
      "POST",
      `${this.documentsRoot}:runQuery`,
      {
        structuredQuery: {
          from: [{ collectionId: requireIdentifier(collectionId, "collectionId") }],
        },
        transaction,
      },
    );
    if (!Array.isArray(results)) throw new Error("runQuery responseがarrayではありません");
    const documents = results.flatMap((result) => result.document ? [result.document] : []);
    const readTimes = results.flatMap((result) => (
      typeof result.readTime === "string" ? [result.readTime] : []
    ));
    const readTime = readTimes.sort().at(-1);
    if (!readTime) throw new Error(`${collectionId} queryのreadTimeを取得できません`);
    return { documents, readTime };
  }

  async batchGet(relativePaths: string[]): Promise<Map<string, FirestoreRestDocument | null>> {
    const normalizedPaths = [...new Set(relativePaths.map(normalizeRelativeDocumentPath))]
      .sort(compareCanonicalStrings);
    if (normalizedPaths.length === 0) return new Map();
    const results = await this.request<FirestoreBatchGetResult[]>(
      "POST",
      `${this.documentsRoot}:batchGet`,
      { documents: normalizedPaths.map((path) => this.fullDocumentName(path)) },
    );
    if (!Array.isArray(results)) throw new Error("batchGet responseがarrayではありません");
    const byName = new Map<string, FirestoreRestDocument | null>();
    results.forEach((result) => {
      if (result.found?.name) byName.set(result.found.name, result.found);
      else if (typeof result.missing === "string") byName.set(result.missing, null);
    });
    normalizedPaths.forEach((path) => {
      const name = this.fullDocumentName(path);
      if (!byName.has(name)) throw new Error(`batchGet responseに${name}がありません`);
    });
    return byName;
  }

  async listCollectionIds(relativeDocumentPath: string): Promise<string[]> {
    const path = encodeDocumentPath(normalizeRelativeDocumentPath(relativeDocumentPath));
    const ids: string[] = [];
    let pageToken = "";
    do {
      const response = await this.request<{
        collectionIds?: string[];
        nextPageToken?: string;
      }>(
        "POST",
        `${this.documentsRoot}/${path}:listCollectionIds`,
        { pageSize: 100, ...(pageToken ? { pageToken } : {}) },
      );
      if (response.collectionIds !== undefined && !Array.isArray(response.collectionIds)) {
        throw new Error("listCollectionIds responseが不正です");
      }
      ids.push(...(response.collectionIds ?? []).map((id) => requireIdentifier(id, "collectionId")));
      pageToken = typeof response.nextPageToken === "string" ? response.nextPageToken : "";
    } while (pageToken);
    return [...new Set(ids)].sort(compareCanonicalStrings);
  }

  getVerifiedDatabaseUid(): string | undefined {
    return this.verifiedDatabaseUid;
  }

  async commit(writes: FirestoreWrite[]): Promise<FirestoreCommitResponse>;
  async commit(
    operation: ProductionCutoverOperation,
    writes: FirestoreWrite[],
    authorization?: unknown,
  ): Promise<FirestoreCommitResponse>;
  async commit(
    operationOrWrites: ProductionCutoverOperation | FirestoreWrite[],
    writesOrAuthorization?: FirestoreWrite[] | unknown,
    maybeAuthorization?: unknown,
  ): Promise<FirestoreCommitResponse> {
    const operation = typeof operationOrWrites === "string" ? operationOrWrites : "reset";
    const writes = Array.isArray(operationOrWrites)
      ? operationOrWrites
      : writesOrAuthorization;
    const authorization = Array.isArray(operationOrWrites)
      ? undefined
      : maybeAuthorization;
    if (!Array.isArray(writes)) throw new Error("commit write列が不正です");
    if (writes.length === 0) throw new Error("commit writeが空です");
    // authorization検査前にexact bodyを固定し、token取得待ち中のmutationを送信へ反映しない。
    const serializedRequestBody = serializeFirestoreRestBody({ writes });
    const writeCount = writes.length;
    assertFirestoreCommitAllowed({
      emulatorHost: this.emulatorHost,
      authorization,
      operation,
      projectId: this.projectId,
      databaseId: this.databaseId,
      databaseUid: this.verifiedDatabaseUid,
      dataPrincipal: this.dataPrincipal,
      serializedRequestBody,
      writeCount,
    });
    return this.requestSerialized<FirestoreCommitResponse>(
      "POST",
      `${this.documentsRoot}:commit`,
      serializedRequestBody,
    );
  }

  private async requestSerialized<T>(
    method: "POST",
    url: string,
    serializedBody: string,
  ): Promise<T> {
    return this.request<T>(method, url, undefined, serializedBody);
  }

  private async request<T>(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
    serializedBody?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined || serializedBody !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (this.emulatorHost) {
      headers.Authorization = "Bearer owner";
    } else if (this.accessTokenProvider) {
      headers.Authorization = `Bearer ${await this.accessTokenProvider()}`;
    }
    const response = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(FIRESTORE_REQUEST_TIMEOUT_MS),
      ...(serializedBody !== undefined
        ? { body: serializedBody }
        : body === undefined
          ? {}
          : { body: serializeFirestoreRestBody(body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Firestore REST request failed (${method}, status=${response.status})`);
    }
    if (!text.trim()) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("Firestore REST responseがJSONではありません");
    }
  }
}

export function emulatorDatabaseUid(projectId: string, databaseId: string): string {
  return `emulator:${requireProjectId(projectId)}:${requireDatabaseId(databaseId)}`;
}

/** Firestore doubleValue=-0をJSON.stringifyで0へ変換せず、送信とsize計測を同一化する。 */
export function serializeFirestoreRestBody(body: unknown): string {
  return canonicalStringify(body);
}

function normalizeEmulatorHost(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!/^(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(normalized)) {
    throw new Error("Firestore Emulator hostはloopback host:portだけを指定できます");
  }
  return normalized;
}

function normalizeRelativeDocumentPath(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/");
  if (!normalized || segments.length % 2 !== 0 || segments.some((segment) => !segment)) {
    throw new Error(`Firestore document pathが不正です: ${value}`);
  }
  return segments.join("/");
}

function encodeDocumentPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes("/")) throw new Error(`${label}が不正です`);
  return normalized;
}

function requireProjectId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(normalized)) {
    throw new Error("projectIdが不正です");
  }
  return normalized;
}

function requireDatabaseId(value: string): string {
  const normalized = value.trim();
  if (normalized !== "(default)" && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(normalized)) {
    throw new Error("databaseIdが不正です");
  }
  return normalized;
}
