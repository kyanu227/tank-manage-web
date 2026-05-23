/**
 * Read-only Firestore tank ID format audit.
 *
 * This script only reads Firestore collections and prints aggregate counts plus
 * small ID examples. It intentionally does not import or call write APIs such as
 * addDoc, setDoc, updateDoc, deleteDoc, writeBatch, or runTransaction.
 *
 * Credentials:
 * - Preferred: GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 * - Local fallback: ./firebase-service-account.json when present
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import type { ServiceAccount } from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

type TankIdCategory =
  | "canonical_numeric"
  | "compact_numeric"
  | "raw_numeric"
  | "canonical_ok_exception"
  | "compact_ok_exception"
  | "canonical_three_or_more_numeric"
  | "compact_three_or_more_numeric"
  | "helper_parseable_other"
  | "arbitrary_suffix_invalid"
  | "invalid_helper_parse_unavailable"
  | "empty_or_missing";

type ClassifiedTankId = {
  raw: string;
  normalizedInput: string;
  category: TankIdCategory;
  helperParseable: boolean;
  canonicalTankId: string | null;
  wouldNormalizeToDifferentId: boolean;
};

type CategoryBucket = {
  count: number;
  examples: string[];
};

type CategorySummary = Record<TankIdCategory, CategoryBucket>;

type LogsAudit = {
  totalDocs: number;
  categorySummary: CategorySummary;
  byLogKind: Record<string, Partial<Record<TankIdCategory, number>>>;
  activeTankLogExactTankIdMisses: {
    count: number;
    examples: string[];
  };
  parseableButDifferent: {
    count: number;
    examples: string[];
  };
};

type TransactionsAudit = {
  totalDocs: number;
  categorySummary: CategorySummary;
  byType: Record<string, Partial<Record<TankIdCategory, number>>>;
  fieldsSeen: Record<string, number>;
};

const CATEGORY_ORDER: TankIdCategory[] = [
  "canonical_numeric",
  "compact_numeric",
  "raw_numeric",
  "canonical_ok_exception",
  "compact_ok_exception",
  "canonical_three_or_more_numeric",
  "compact_three_or_more_numeric",
  "helper_parseable_other",
  "arbitrary_suffix_invalid",
  "invalid_helper_parse_unavailable",
  "empty_or_missing",
];

const MAX_EXAMPLES = 12;
const HYPHEN_VARIANTS_RE = /[‐‑‒–—―ーｰ−]/g;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  initializeReadOnlyFirebaseAdmin();
  const db = getFirestore();

  const tankRefs = await db.collection("tanks").listDocuments();
  const tankIds = tankRefs.map((ref) => ref.id).sort((a, b) => a.localeCompare(b));
  const tankIdSet = new Set(tankIds);
  const tanksAudit = auditTankIds(tankIds);

  const logsSnap = await db.collection("logs").select("tankId", "logKind", "logStatus").get();
  const logsAudit = auditLogs(logsSnap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      tankId: data.tankId,
      logKind: stringValue(data.logKind) || "(missing)",
      logStatus: stringValue(data.logStatus) || "(missing)",
    };
  }), tankIdSet);

  const transactionsSnap = await db.collection("transactions").select("type", "tankId", "tankIds").get();
  const transactionsAudit = auditTransactions(transactionsSnap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      type: stringValue(data.type) || "(missing)",
      tankId: data.tankId,
      tankIds: data.tankIds,
    };
  }));

  const output = {
    auditedAt: new Date().toISOString(),
    tanks: {
      totalDocs: tankIds.length,
      ...tanksAudit,
    },
    logs: logsAudit,
    transactions: transactionsAudit,
  };

  console.log(JSON.stringify(output, null, 2));
}

function initializeReadOnlyFirebaseAdmin(): void {
  if (getApps().length > 0) return;

  const explicitCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const localServiceAccountPath = resolve(process.cwd(), "firebase-service-account.json");
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "okmarine-tankrental";

  if (explicitCredentials) {
    initializeApp({
      credential: applicationDefault(),
      projectId,
    });
    return;
  }

  if (existsSync(localServiceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(localServiceAccountPath, "utf8")) as ServiceAccount;
    initializeApp({
      credential: cert(serviceAccount),
      projectId,
    });
    return;
  }

  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

function auditTankIds(ids: string[]): {
  categorySummary: CategorySummary;
  parseableButDifferent: { count: number; examples: string[] };
} {
  const categorySummary = createCategorySummary();
  const parseableButDifferent = createCounterWithExamples();

  ids.forEach((id) => {
    const classified = classifyTankId(id);
    addExample(categorySummary[classified.category], id);
    if (classified.wouldNormalizeToDifferentId) {
      addExample(parseableButDifferent, `${id} -> ${classified.canonicalTankId}`);
    }
  });

  return {
    categorySummary,
    parseableButDifferent,
  };
}

function auditLogs(
  logs: Array<{ id: string; tankId: unknown; logKind: string; logStatus: string }>,
  tankIdSet: Set<string>,
): LogsAudit {
  const categorySummary = createCategorySummary();
  const byLogKind: LogsAudit["byLogKind"] = {};
  const activeTankLogExactTankIdMisses = createCounterWithExamples();
  const parseableButDifferent = createCounterWithExamples();

  logs.forEach((log) => {
    const raw = stringValue(log.tankId);
    const classified = classifyTankId(raw);
    addExample(categorySummary[classified.category], raw || "(missing)");
    addCategoryCount(byLogKind, log.logKind, classified.category);

    if (classified.wouldNormalizeToDifferentId) {
      addExample(parseableButDifferent, `${raw} -> ${classified.canonicalTankId}`);
    }

    if (log.logKind === "tank" && log.logStatus === "active" && raw && !tankIdSet.has(raw)) {
      addExample(activeTankLogExactTankIdMisses, raw);
    }
  });

  return {
    totalDocs: logs.length,
    categorySummary,
    byLogKind,
    activeTankLogExactTankIdMisses,
    parseableButDifferent,
  };
}

function auditTransactions(
  transactions: Array<{ id: string; type: string; tankId: unknown; tankIds: unknown }>,
): TransactionsAudit {
  const categorySummary = createCategorySummary();
  const byType: TransactionsAudit["byType"] = {};
  const fieldsSeen: Record<string, number> = {};

  transactions.forEach((transaction) => {
    const values: Array<{ field: string; value: string }> = [];
    const singleTankId = stringValue(transaction.tankId);
    if (singleTankId) values.push({ field: "tankId", value: singleTankId });
    if (Array.isArray(transaction.tankIds)) {
      transaction.tankIds.forEach((value) => {
        const tankId = stringValue(value);
        if (tankId) values.push({ field: "tankIds[]", value: tankId });
      });
    }

    if (values.length === 0) {
      addExample(categorySummary.empty_or_missing, "(missing)");
      addCategoryCount(byType, transaction.type, "empty_or_missing");
      fieldsSeen.none = (fieldsSeen.none ?? 0) + 1;
      return;
    }

    values.forEach(({ field, value }) => {
      fieldsSeen[field] = (fieldsSeen[field] ?? 0) + 1;
      const classified = classifyTankId(value);
      addExample(categorySummary[classified.category], value);
      addCategoryCount(byType, transaction.type, classified.category);
    });
  });

  return {
    totalDocs: transactions.length,
    categorySummary,
    byType,
    fieldsSeen,
  };
}

function classifyTankId(value: string | null): ClassifiedTankId {
  const raw = value ?? "";
  const normalizedInput = normalizeInputForParse(raw);
  if (!normalizedInput) {
    return {
      raw,
      normalizedInput,
      category: "empty_or_missing",
      helperParseable: false,
      canonicalTankId: null,
      wouldNormalizeToDifferentId: false,
    };
  }

  const parsed = tryParseLikeTankIdHelper(normalizedInput);
  if (parsed) {
    const canonicalTankId = formatTankId(parsed);
    return {
      raw,
      normalizedInput,
      category: parseableCategory(normalizedInput),
      helperParseable: true,
      canonicalTankId,
      wouldNormalizeToDifferentId: canonicalTankId !== normalizedInput,
    };
  }

  if (/^[A-Z]+-?[A-Z]+$/.test(normalizedInput) || /^[A-Z]+-[A-Z0-9]+$/.test(normalizedInput)) {
    return invalidClassification(raw, normalizedInput, "arbitrary_suffix_invalid");
  }

  return invalidClassification(raw, normalizedInput, "invalid_helper_parse_unavailable");
}

function normalizeInputForParse(input: string): string {
  return input
    .trim()
    .replace(HYPHEN_VARIANTS_RE, "-")
    .toUpperCase();
}

function tryParseLikeTankIdHelper(input: string): { prefix: string; kind: "numeric"; number: number } | { prefix: string; kind: "ok" } | null {
  const match = input.match(/^([A-Z]+)-?([0-9]+|OK)$/);
  if (!match) return null;
  if (match[2] === "OK") {
    return {
      prefix: match[1],
      kind: "ok",
    };
  }
  const number = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(number) || number < 0) return null;
  return {
    prefix: match[1],
    kind: "numeric",
    number,
  };
}

function formatTankId(parts: { prefix: string; kind: "numeric"; number: number } | { prefix: string; kind: "ok" }): string {
  if (parts.kind === "ok") return `${parts.prefix}-OK`;
  return `${parts.prefix}-${String(parts.number).padStart(2, "0")}`;
}

function parseableCategory(input: string): TankIdCategory {
  if (/^[A-Z]+-OK$/.test(input)) return "canonical_ok_exception";
  if (/^[A-Z]+OK$/.test(input)) return "compact_ok_exception";
  if (/^[A-Z]+-\d{3,}$/.test(input)) return "canonical_three_or_more_numeric";
  if (/^[A-Z]+\d{3,}$/.test(input)) return "compact_three_or_more_numeric";
  if (/^[A-Z]+-\d{2}$/.test(input)) return "canonical_numeric";
  if (/^[A-Z]+\d{2}$/.test(input)) return "compact_numeric";
  if (/^[A-Z]+-?\d$/.test(input)) return "raw_numeric";
  return "helper_parseable_other";
}

function invalidClassification(
  raw: string,
  normalizedInput: string,
  category: TankIdCategory,
): ClassifiedTankId {
  return {
    raw,
    normalizedInput,
    category,
    helperParseable: false,
    canonicalTankId: null,
    wouldNormalizeToDifferentId: false,
  };
}

function createCategorySummary(): CategorySummary {
  return Object.fromEntries(
    CATEGORY_ORDER.map((category) => [category, createCounterWithExamples()]),
  ) as CategorySummary;
}

function createCounterWithExamples(): CategoryBucket {
  return { count: 0, examples: [] };
}

function addExample(bucket: CategoryBucket, value: string): void {
  bucket.count += 1;
  if (bucket.examples.length >= MAX_EXAMPLES) return;
  if (bucket.examples.includes(value)) return;
  bucket.examples.push(value);
}

function addCategoryCount(
  target: Record<string, Partial<Record<TankIdCategory, number>>>,
  group: string,
  category: TankIdCategory,
): void {
  if (!target[group]) target[group] = {};
  target[group][category] = (target[group][category] ?? 0) + 1;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
