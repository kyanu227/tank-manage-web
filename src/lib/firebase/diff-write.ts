import type { DocumentData } from "firebase/firestore";

export function isNewDocId(id: string): boolean {
  return id.startsWith("new_");
}

export function createDocId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function hasFieldChanges(current: DocumentData | undefined, next: Record<string, unknown>): boolean {
  if (!current) return true;

  return Object.entries(next).some(([key, value]) => {
    const currentValue = current[key];
    if (Array.isArray(value) || Array.isArray(currentValue)) {
      return JSON.stringify(currentValue ?? []) !== JSON.stringify(value ?? []);
    }
    return currentValue !== value;
  });
}

function timestampMillis(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const maybeTimestamp = value as { toMillis?: () => number };
  return typeof maybeTimestamp.toMillis === "function" ? maybeTimestamp.toMillis() : null;
}

export function assertNotChangedSinceLoad(
  loaded: DocumentData | undefined,
  current: DocumentData | undefined,
  label: string
) {
  const loadedUpdatedAt = timestampMillis(loaded?.updatedAt);
  const currentUpdatedAt = timestampMillis(current?.updatedAt);
  if (loadedUpdatedAt != null && currentUpdatedAt != null && loadedUpdatedAt !== currentUpdatedAt) {
    throw new Error(`${label}は他の操作で更新されています。再読込してから保存してください。`);
  }
}
