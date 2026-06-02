import type { ReturnCondition } from "./operation-context";
import { RETURN_TAG, type ReturnTag } from "./tank-rules";

export type { ReturnTag } from "./tank-rules";

export const STORED_RETURN_TAG_MARKER = {
  UNUSED: "[TAG:unused]",
  UNCHARGED: "[TAG:uncharged]",
  KEEP: "[TAG:keep]",
} as const;

export type WritableReturnTagMarker =
  | typeof STORED_RETURN_TAG_MARKER.UNUSED
  | typeof STORED_RETURN_TAG_MARKER.UNCHARGED;

export type ReadableReturnTagMarker =
  | WritableReturnTagMarker
  | typeof STORED_RETURN_TAG_MARKER.KEEP;

type StoredMarkerReadOptions = {
  allowKeep?: boolean;
};

const RETURN_TAG_VALUES: readonly ReturnTag[] = [
  RETURN_TAG.NORMAL,
  RETURN_TAG.UNUSED,
  RETURN_TAG.UNCHARGED,
  RETURN_TAG.KEEP,
];

export function isReturnTag(value: unknown): value is ReturnTag {
  return typeof value === "string" && RETURN_TAG_VALUES.includes(value as ReturnTag);
}

export function normalizeReturnTag(value: unknown): ReturnTag {
  if (typeof value !== "string") return RETURN_TAG.NORMAL;
  const normalized = value.trim();
  return isReturnTag(normalized) ? normalized : RETURN_TAG.NORMAL;
}

export function conditionToReturnTag(value: unknown): ReturnTag {
  return normalizeReturnTag(value);
}

export function returnTagToReturnCondition(tag: ReturnTag): ReturnCondition {
  return normalizeReturnTag(tag);
}

export function returnTagToStoredMarker(tag: ReturnTag): WritableReturnTagMarker | null {
  switch (tag) {
    case RETURN_TAG.UNUSED:
      return STORED_RETURN_TAG_MARKER.UNUSED;
    case RETURN_TAG.UNCHARGED:
      return STORED_RETURN_TAG_MARKER.UNCHARGED;
    default:
      return null;
  }
}

export function returnTagToStoredLogNote(tag: ReturnTag): string {
  // KEEP は処理中の選択状態。現行保存形式では normal と同じく空文字にする。
  return returnTagToStoredMarker(tag) ?? "";
}

export function storedMarkerToReturnTag(
  value: unknown,
  options: StoredMarkerReadOptions = {}
): ReturnTag {
  const marker = typeof value === "string" ? value.trim() : "";
  if (marker === STORED_RETURN_TAG_MARKER.UNUSED) return RETURN_TAG.UNUSED;
  if (marker === STORED_RETURN_TAG_MARKER.UNCHARGED) return RETURN_TAG.UNCHARGED;
  if (options.allowKeep && marker === STORED_RETURN_TAG_MARKER.KEEP) {
    return RETURN_TAG.KEEP;
  }
  return RETURN_TAG.NORMAL;
}
