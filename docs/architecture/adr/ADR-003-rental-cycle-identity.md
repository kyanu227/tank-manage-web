# ADR-003 — Rental cycle identity

- **Status**: Accepted
- **Date**: 2026-08-02
- **Affected domains**: tank-lifecycle (1), billing (9), customer-portal (7), read-models (11)

## Context

`customerId + latestLogId` が stale guard として機能している。これを業務上の「貸出期間 identity」としても使えるか、あるいは専用の `rentalCycleId` を永続化すべきかが論点だった。

第二稿は「`latestLogId` は充填・破損報告でも変わるから cycle identity ではない」と書いたが、**これは事実誤り**だった。`tank-rules.ts` の `CODE_OP_RULES` を確認すると:

- `fill.allowedPrev: ["empty"]` — `lent` から遷移**できない**
- `damage_report.allowedPrev: ["empty", "filled", "in_house"]` — `lent` から遷移**できない**
- `lent` から可能なのは `return` / `return_unused` / `return_uncharged`（すべて cycle を閉じる）と `carry_over`（`lent → unreturned`）のみ

貸出中に `latestLogId` を変える経路は、当初想定よりはるかに狭い。

| 経路 | 扱い |
|---|---|
| `carry_over` | billing が既に**cycle 境界として扱っている**（`source-logs.ts`）。実質的に問題にならない |
| `inspection`（`allowedPrev: []` = 無制限） | `lent` からも実行でき、customer projection を null にして返却 log なしに rental を終わらせる |

そして `inspection` の無制限許可は **ADR外の業務判断で「貸出中の耐圧検査は認めない」と確定**した（design-principles §8.8）。これにより最後の実質例外も消える。

## Decision

**現時点では永続的な `rentalCycleId` を新設しない。**

概念を次のように分離して扱う。

| 概念 | 意味 | 担い手 |
|---|---|---|
| `latestLogId` | optimistic concurrency / stale guard token | `tanks.latestLogId` |
| rental cycle | typed lifecycle event 列から**再構築する**業務区間 | `collectBillingSourceLogMatches` |
| `operationGroupId` | 一括操作の group identity（**実在要件が出た場合のみ**） | 未実装 |
| `idempotencyKey` | 同一 command の重複実行防止（**実在要件が出た場合のみ**） | 未実装 |

- **`latestLogId` を `rentalCycleId` と呼ばない。** 別概念である
- 貸出中に正規の別操作で `latestLogId` が変わっても、stale guard としては**正常**
- billing は typed event projection から cycle を再構築する
- portal return 等の stale 防止は、候補作成時の `customerId` と `latestLogId` を transaction 内で照合する

## Decision drivers

1. cycle ID を永続化すると、開始 log・終了 log・`tanks` projection の3箇所に同じ ID を保つ必要が生じ、write owner が増え、訂正・取消時の整合コストが跳ね上がる
2. 現行の event 列からの再構築は**動作しており**、`eventId = logId:stepIndex` で冪等性も確保されている
3. 貸出中に cycle が曖昧になる唯一の実質ケース（`inspection` from `lent`）は、**ID 追加ではなく `allowedPrev` の修正で解決する**。新しい識別子を増やすより1行の policy 修正のほうが正しい解
4. design-principles §3「将来要件の先回り抽象化をしない」

## Rejected alternatives

**A. `rentalCycleId` を永続化する**
却下理由: 上記1。加えて、解こうとしていた問題（`inspection` from `lent`）が policy 修正で消えるため、導入理由自体が失われた。

**B. `latestLogId` を cycle identity として流用する**
却下理由: 別概念。`carry_over` で値が変わるため cycle 全体を通じて不変ではない。名前を流用すると将来必ず誤解を生む。

## Consequences

- billing は毎回 event 列から cycle を再構築する。`getActiveLogs()` が無制限読み取りである点は別課題として残る（domain-map G13）
- cycle を外部から直接参照する query は書けない。必要になったら本 ADR を再検討する
- correction / void 後の cycle 対応付けは event 列の再走査に依存する

## Implementation boundary

- 変更するもの: なし（新設しないという決定）
- **併せて実施するもの**: `inspection.allowedPrev` の最小集合化（design-principles §8.8 / ADR外の業務判断）
- `operationGroupId` / `idempotencyKey` は**実在要件が確認されるまで実装しない**

## Verification

- 遷移 policy test で `inspection` が customer custody 状態から実行できないことを固定する
- billing の cycle 再構築 unit test（既存 `source-logs` テスト）
- `eventId` 冪等性のテスト（既存）

## Reconsideration trigger

- cycle 単位の外部参照が必要になる
- correction / void 後も不変の cycle ID が必要になる
- 確定請求書と個別貸出 cycle を永続的に突合する必要が出る（ADR-005 と連動）
- event 列からの再構築で query cost または監査性が**実測上**不足する

## Related documents

- [design-principles.md](../design-principles.md) §8.3, §8.8
- [ADR-005](./ADR-005-billing-finalization.md)
