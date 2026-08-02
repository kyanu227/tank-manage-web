# ADR-005 — Billing finalization

- **Status**: Accepted（設計原則として確定。実装は deferred）
- **Date**: 2026-08-02
- **Affected domains**: billing (9), audit-correction (12)

## Context

現在の請求候補（`InvoiceCandidate`）は `logs` の projection から**毎回導出**される derived read model であり、永続化されていない。

これは preview としては正しい。しかし請求書を発行した後に根拠 log が訂正されると、**既に顧客へ送付した請求書の金額が後から変わる**。会計上これは許されない。

一方で、請求確定・発行という業務 workflow が製品要件として固まっていない段階で schema を決めるのは先回りになる。

## Decision

### 原則（今回確定）

```text
billing preview
  = operation event から再生成可能な derived read model

finalized / issued invoice
  = 発行時点の immutable snapshot（別の source of truth）
```

一般原則として: **業務上不可逆なイベントの結果を、可変な derived read model として扱わない。**

### 実装する場合の制約（今回確定）

- 確定請求書を raw logs とは**別の source of truth** として保存する
- 発行後の log correction で既発行請求書を**黙って書き換えない**
- 発行後の修正は取消・再発行・調整明細等の**明示的な workflow** で扱う
- preview と finalized invoice を**同じ型・同じ collection として扱わない**

### 実装時期

**今回の clean-break 必須経路には含めない。** design principle として確定し、実装は製品機能着手時まで deferred とする。

## Decision drivers

1. 「送付済み請求書の金額が後から変わる」は会計上の欠陥であり、原則としては今確定できる
2. しかし確定 workflow（誰が・いつ・どの単位で発行するか、取消の扱い）が未定のまま schema を決めると、ほぼ確実に作り直しになる
3. clean-break の必須経路に入れると cutover 全体が製品判断待ちでブロックされる
4. preview を毎回導出する現行方式は、確定機能がない現状では**正しい**

## Rejected alternatives

**A. 今回の clean-break で確定請求書を実装する**
却下理由: 製品要件が未定。design-principles §3「将来要件の先回り抽象化をしない」に反する。cutover をブロックする。

**B. 原則も含めて全部 deferred にする**
却下理由: 原則を決めずに実装を始めると、preview と finalized を同じ型で扱う設計が既定路線として固定されやすい。原則だけ先に固定するのは安価で、後戻りを防ぐ。

## Consequences

- 確定請求書機能が実装されるまで、log 訂正は請求候補にそのまま反映される（現状どおり）
- 実装時に `invoiceId` と確定 snapshot schema を新設する
- ADR-003（rental cycle identity）と連動する可能性がある — 確定請求書と個別貸出 cycle を永続的に突合する要件が出れば、`rentalCycleId` の再検討 trigger になる

## Implementation boundary

- 今回変更するもの: **なし**
- 将来実装する場合の所有: billing domain (9)。`tanks` / `logs` は書かない
- preview の計算式（`calculate.ts`）は変更しない

## Verification

（実装時）

- 確定後に根拠 log を訂正しても、確定請求書の金額が変わらないこと
- 訂正が検出され、警告として表示されること（自動書き換えしないこと）
- preview と finalized が型レベルで区別されること

## Reconsideration trigger

- 請求書の発行運用が製品要件として確定する
- 発行後訂正の業務ルール（取消 / 再発行 / 調整明細）が決まる

## Related documents

- [design-principles.md](../design-principles.md) §13.5
- [billing-rule-design.md](../../billing-rule-design.md)
- [ADR-003](./ADR-003-rental-cycle-identity.md)
