# ADR-001 — Tank identity

- **Status**: Accepted
- **Date**: 2026-08-02
- **Affected domains**: tank-lifecycle (1), procurement (6), audit-correction (12)

## Context

`tanks/{tankId}` は物理タンクの刻印番号（`A-01` 等）を Firestore document ID として使っている。`tank-id.ts` が表記ゆれ（`A-1` / `Ａ-０１` / `A01`）を canonical 形へ正規化する。

surrogate な内部IDを新設すべきかが論点だった。判断材料として2つの異なる事象が混同されていたため、まず分離した。

| 事象 | 現行実装 |
|---|---|
| **log の tank association 訂正**（誤スキャン・誤入力で別タンクのログを作った） | **実装済み**。`LogCorrectionPatch.tankId`（`tank-operation.ts:168`）で log を別タンクへ付け替え、新旧両タンクを更新する |
| **tank document の rename**（識別子そのものの変更） | **実装なし**。全 write 経路を走査して該当0件 |

## Decision

- canonical `tankId` を物理タンクの業務 identity とする
- `tanks/{tankId}` の Firestore document ID としても使用する
- surrogate `internalTankId` は**導入しない**
- runtime で tank document を rename する一般 API は**作らない**
- log の誤 association 訂正と document rename を混同しない
- 実運用前の誤登録は reset または削除・正規再登録で修正する

## Decision drivers

1. tankId は物理タンクに刻印された、現場が読む唯一の識別子。surrogate を挟むと現場が見る番号と system identity が乖離し、障害時の照合コストが上がる
2. 表記ゆれは identity の不安定さではなく**入力の正規化問題**であり、`tank-id.ts` の canonical 化で既に解決している
3. 誤入力の訂正は **log 側の訂正**で成立しており、tank document の identity を変える必要がない
4. surrogate を入れると全 operation に `tankId → internalId` の解決が1段増える（§17 の「1つの間接参照は1つの調査コスト」）

## Rejected alternatives

**A. surrogate `internalTankId` を document ID にし、`tankId` を可変属性にする**
却下理由: 現時点で document rename を要求する業務がない。存在しない要件のための抽象化は design-principles §3 Non-goals に反する。導入コスト（全 operation の解決経路 + unique index 相当の整合管理）が、得られる柔軟性に見合わない。

**B. 両方持つ（surrogate + 業務ID）**
却下理由: A のコストに加えて、どちらが正本かという問い自体が新しい混乱源になる。

## Consequences

- tank document の identity は不変。番号を変える運用が発生した場合は、削除・再登録が唯一の手段になる
- log の tank 付け替え訂正は引き続き必要であり、削除してはならない
- 実運用開始後に刻印変更が必要になった場合、本 ADR の再検討が必須になる（下記 trigger）

## Implementation boundary

- 変更するもの: なし（現行実装を追認する決定）
- 維持するもの: `tank-id.ts` の canonical 化、`LogCorrectionPatch.tankId`
- **cross-tank 訂正の非対称性**を実装時に意識すること: 旧タンクは `oldLog.prevTankSnapshot` から復元し、新タンクは**現在状態**から plan を適用する。1操作の中に2種類の復元semanticsがある

## Verification

- `tank-id.ts` の canonical 化 unit test（既存）
- tank 付け替え訂正の payload 固定テスト（既存 `tank-operation.test.ts`）
- architecture test: tank document の rename を行う write 経路が存在しないこと

## Reconsideration trigger

次のいずれかが業務要件になった時点で本 ADR を再検討する。

- 物理刻印の打ち直し
- 登録後の業務番号変更
- 1つの物理タンクが複数の業務番号を持つ
- document rename を伴う正規業務要求

## Related documents

- [design-principles.md](../design-principles.md) §8.2
- [domain-map.md](../domain-map.md) §2 domain 1
