# ADR-004 — Return tag draft

- **Status**: Accepted
- **Date**: 2026-08-02
- **Affected domains**: tank-lifecycle (1), return-workflow (3), inhouse (5)

## Context

返却タグの一時選択状態を `tanks.logNote` に marker（`[TAG:unused]` 等）として保存している。これは複数の問題を同時に抱えている。

| 問題 | 証拠 |
|---|---|
| **write owner が2つ** | `tank-operation.ts`（operation の tankNote 反映）と `tank-tag-service.ts`（marker 単独 write） |
| 第2 writer が**非 transactional** | `tank-tag-service.ts:9` の bare `updateDoc`。`runTransaction` なし・`expectedCycle` なし → **stale guard を迂回** |
| **部分成功が発生しうる** | 一括返却で tag write が transaction 外にあるため、一部タンクにだけ tag が付いた状態になりうる（design-principles §15 違反） |
| tag が**黙って消える** | 任意の tank 操作が `tankLogNote = input.tankNote ?? ""` を `logNote` へ書き、選択済み tag を上書きする |
| marker 語彙が **Rules に埋まっている** | `firestore.rules` の `logNote in ["", "[TAG:unused]", "[TAG:uncharged]"]`。これが export された `updateLogNote` から任意文字列が入るのを防ぐ唯一の砦 |

## Decision

**返却タグ選択は UI local state に限定する。**

- cross-device 引継ぎを要件にしない
- 同一 draft の複数 staff 共同編集を要件にしない
- `tanks.logNote` へ draft を保存しない
- `tanks.pendingReturnTag` を**新設しない**
- current tank state と操作準備中 draft を混ぜない
- `[TAG:*]` 等の marker 語彙を **Rules から削除対象**にする
- operation 確定時に typed `returnCondition` だけを event へ保存する

## Decision drivers

1. **案A だけが実装を「純粋な削除」にする** — `tank-tag-service.ts` と2つの呼び出し元を消し、Rules から marker 関連を削るだけ。他案は新しい write owner・TTL・cleanup を**増やす**
2. cross-device 共有の要件が**実証されていない**。design-principles §18「先回りしない」
3. draft を `tanks` に置く案は、stale guard 迂回と部分成功という現行の欠陥を**そのまま再生産する**
4. 一時 UI 状態を永続化しない（design-principles §9）

## Rejected alternatives

**B. return transaction に持たせる**
却下理由: 「申請」ではない staff 側の一時選択を申請 collection に混ぜると、request と event の分離（§12）が崩れる。

**C. 専用 `returnDrafts` collection**
却下理由: 現時点で cross-device 要件がない。TTL 設計・stale draft の cleanup・新しい write owner を導入するコストに見合わない。**将来 cross-device draft が必要になった場合はこれを採る**（tank current projection には戻さない）。

**D. `tanks.pendingReturnTag`**
却下理由: current state に draft が混入する元の問題を再生産する。加えて stale guard と atomicity の**両方を迂回する**。

## Consequences

- 端末をまたいだ作業継続はできない。1人が1端末で選択から確定まで完結する運用になる
- ブラウザをリロードすると選択が失われる
- `tanks.logNote` の write owner が `tank-operation.ts` のみに一本化される
- `tanks` への `runTransaction` 外 write が0件になる

## Implementation boundary

**application と Rules の2本立てが必須**（marker 語彙が Rules にあるため、application 側だけでは完了しない）。

| PR | 内容 |
|---|---|
| application | `tank-tag-service.ts` と呼び出し元2箇所（`bulk-return-workflow.ts` / `inhouse-return-workflow.ts`）の削除。draft を React state へ |
| **Rules-only** | `isReturnTagMarkerOnlyUpdate` と `isTankProjectionChanged` の `logNote` 項目を削除 |

design-principles §6「Rules 変更と application 変更を混ぜない」を守るため、必ず分ける。

**注**: `repositories/tanks.ts` の `TankFieldsPatch` に `logNote` field があり（現在 `not implemented` stub）、実装される前に write-ownership へ反映すること。

## Verification

- architecture test: `tanks` への `runTransaction` 外 write が0件
- Rules test: `logNote` の marker 単独 update が拒否される
- 返却 workflow の payload 固定テスト（`returnCondition` が typed で渡ること）
- 一括返却の atomicity テスト（部分成功が発生しないこと）

## Reconsideration trigger

- 端末をまたぐ draft 引継ぎが実業務で必要になる → **案C**（`returnDrafts` collection）を採る。`tanks` には戻さない
- 複数 staff の同時 draft 編集が必要になる

## Related documents

- [design-principles.md](../design-principles.md) §9.1
- [write-ownership.md](../write-ownership.md)
