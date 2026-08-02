# Architecture 文書の入口

- 第三稿: 2026-08-02（基準 `6c1d4c5` = origin/main。独立レビュー3件を反映）

---

## 3分で読むなら

1. [design-principles.md §2](./design-principles.md) 「互換性と業務不変条件の区別」— **消してよいもの / 消してはいけないもの**
2. 下の「よくある質問 → 答え」表 — 直したい場所の探し方
3. [domain-map.md §8](./domain-map.md) 「現行コードと新設計の主要gap」— 今わかっている問題の全部

それ以外は必要になってから引く。

---

## よくある質問 → 答え

| 質問 | 答え |
|---|---|
| 新しい貸出機能はどこへ追加するか | `features/staff-operations/services/` に workflow を新設 |
| 新しい返却条件はどこへ追加するか | 該当 return workflow + `tank-transition-policy.ts` |
| 新しいbillingルールはどこへ追加するか | `src/lib/billing/` + `settings/billingInvoice` |
| 新しい表示文言はどこへ追加するか | display boundary（`features/*/i18n.ts` 等）。**domainには置かない** |
| customer identityはどこにあるか | `customers/{customerId}` |
| staff identityはどこにあるか | `staff`（`staffByEmail`/`staffByUid` は index） |
| current tank stateはどこにあるか | `tanks`（projection。正本は logs） |
| historical operation eventはどこにあるか | `logs`。読むときは projection 経由 |
| portal requestはどこにあるか | `transactions` |
| どのmoduleがFirestoreへwriteできるか | [write-ownership.md](./write-ownership.md) |
| operationとbillingの境界はどこか | `logs` の projection |
| 一括操作のatomicityはどこで守るか | `tank-operation.ts` の単一 `runTransaction` |
| stale cycleはどこで拒否するか | `tank-operation.ts` の `expectedCycle` 照合 |
| errorはどう表現するか | code + params（design-principles §12.3） |
| **業務用語（貸出・返却・充填…）から探したい** | [domain-map.md §2.0](./domain-map.md) の対応表 |
| **画面から探したい** | [SITEMAP.md](../../SITEMAP.md) |

---

## オーナーに確認したいこと（これが決まらないと実装に進めない）

技術判断は Claude 側で決めています。ここに残したのは**業務を知らないと答えられないもの**だけです。

| # | 質問 | 決まると進むもの |
|---|---|---|
| 1 | タンクの刻印番号を打ち直すことはある？ 間違った番号で登録したとき、今はどう直してる？ | P2-A |
| 2 | タンクの置き場所は「倉庫・自社・お客さん」の3つで足りる？ 修理業者や検査機関に預けることはある？ | P2-A |
| 3 | 耐圧検査は、お客さんに貸したままの状態でも実施することがある？（今のコードは可能になっている） | P2-A / P6-B |
| 4 | 返却タグを選んでいる途中で、別の端末から続きをやることはある？ 同じタンクを2人で同時に触ることは？ | P5-A |
| 5 | ログを後から訂正したとき、**もう出した請求書の金額が変わってもよい**？ それとも当時の金額で固定したい？ | P6-A |

---

## 文書一覧

**重要**: 1・2・4 は `Status: Draft` であり、**まだ正本ではない**。現在有効な正本順位は [document-authority.md](./document-authority.md) **§1 Current authoritative order**。

| # | 文書 | 内容 | Status |
|---|---|---|---|
| 1 | [design-principles.md](./design-principles.md) | 設計原則。互換性と不変条件の区別、依存方向、identity、source of truth、i18n境界、atomicity、failure isolation、test戦略、禁止事項 | **Draft** |
| 2 | [domain-map.md](./domain-map.md) | 業務用語→実装の対応、domain一覧、依存グラフ、**source-of-truth matrix（一覧の正本）**、target tree、gap | **Draft** |
| 3 | [document-authority.md](./document-authority.md) | 正本順位（Current / Proposed）と既存docsの処遇 | 運用中 |
| 4 | [clean-break-cutover-plan.md](./clean-break-cutover-plan.md) | 新schemaへ切り替えるPR順序（reset-first） | **Draft** |
| 5 | [write-ownership.md](./write-ownership.md) | field単位の write owner | 運用中 |
| 6 | [feature-boundaries.md](./feature-boundaries.md) | feature単位の境界 | 運用中 |

**source-of-truth の一覧は [domain-map.md §5](./domain-map.md) が正本**。design-principles §9 は原則のみを述べ、一覧を持たない（二重管理を避けるため）。

---

## 未確定の設計判断（ADR候補）

詳細は [clean-break-cutover-plan.md §5](./clean-break-cutover-plan.md)。

| ADR | 論点 | 種別 |
|---|---|---|
| ADR-001 | tank identity（surrogate要否） | 業務確認（上表 Q1） |
| ADR-002 | custody model と値域 | 業務確認（上表 Q2, Q3） |
| ADR-003 | rental cycle identity | 業務確認（上表 Q3） |
| ADR-004 | return tag draft の置き場所 | 業務確認（上表 Q4） |
| ADR-005 | billing finalization | 業務確認（上表 Q5） |
| ADR-006 | domain の UI対話・locale 依存の是正 | **技術判断。resolver port を推奨。確認不要** |

---

## Domain-local 設計文書

固有のinvariantが十分にあるdomainだけに置く（空の雛形は作らない）。

- return-workflow → [../return-flow-policy.md](../return-flow-policy.md)
- billing → [../billing-rule-design.md](../billing-rule-design.md)
- identity-access → [../identity-and-operation-logging-design.md](../identity-and-operation-logging-design.md)
- display / i18n → [../i18n-ui-display-policy.md](../i18n-ui-display-policy.md) / [../i18n-operation-message-policy.md](../i18n-operation-message-policy.md)
