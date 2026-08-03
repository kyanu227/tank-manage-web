import type { ReturnSegmentKey, ReturnSegmentStat } from "./components/ReturnSegmentGestureLauncher";

/** 返却一覧の表示順。区分は見出しだけで表され、切替 UI としては現れない */
export const RETURN_SEGMENT_ORDER: ReturnSegmentKey[] = ["normal", "customer_requests", "long_term"];

interface VisibleReturnSegmentsInput {
  /** ジェスチャーで選択中の区分。選択中は対象ゼロでもその区分を残す */
  activeSegment: ReturnSegmentKey | null;
  segments: ReturnSegmentStat[];
  /** 一括返却側（通常返却 / 長期貸出）が読み込み中または失敗中か */
  bulkBusy: boolean;
  /** 返却タグ処理待ちが読み込み中または失敗中か */
  tagsBusy: boolean;
}

/**
 * 対象がゼロの区分は見出しごと描かない。
 * ただし読み込み中・失敗中は状態を伝えるために残す。
 */
export function resolveVisibleReturnSegments({
  activeSegment,
  segments,
  bulkBusy,
  tagsBusy,
}: VisibleReturnSegmentsInput): ReturnSegmentKey[] {
  if (activeSegment) return [activeSegment];

  return RETURN_SEGMENT_ORDER.filter((segment) => {
    const stat = segments.find((candidate) => candidate.key === segment);
    if ((stat?.customerCount ?? 0) > 0 || (stat?.tankCount ?? 0) > 0) return true;
    return segment === "customer_requests" ? tagsBusy : bulkBusy;
  });
}
