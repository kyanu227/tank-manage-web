# ADR-002 — Custody model

- **Status**: Accepted
- **Date**: 2026-08-02
- **Affected domains**: tank-lifecycle (1), rental-operations (2), return-workflow (3), maintenance (4), inhouse (5), billing (9), read-models (11)

## Context

`location` field が**2つの異なる意味**を1つの field で持っている。

- 物理的な場所: `"倉庫"` / `"自社"` / `"-"`（maintenance / inhouse workflow が書く）
- 貸出先の顧客表示名: 貸出時に `customerName` が入る

判別は文脈依存で型では区別できない。これが `buildCustomerIdentityGroup` の location fallback → `legacy-location:` グループ → `resolvePricing` の名前一致検索という**legacy 文字列経路すべての根**になっている。

## Decision

### コード境界: discriminated union

```ts
type TankCustody =
  | { kind: "warehouse" }
  | { kind: "in_house" }
  | { kind: "customer"; customerId: string; customerNameSnapshot: string };
```

### Firestore 保存: flat field

```ts
type TankCustodyFields = {
  custodyKind: "warehouse" | "in_house" | "customer";
  custodyCustomerId: string | null;
  custodyCustomerNameSnapshot: string | null;
};
```

### 不変条件

```text
custodyKind == "customer" → custodyCustomerId 必須 / custodyCustomerNameSnapshot 必須
custodyKind != "customer" → 両方 null
```

### kind は3つだけ

`warehouse` / `in_house` / `customer`。修理業者・検査機関・輸送中は**現在確認されていない将来要件**なので先回りして追加しない。実在要件が確認された時点で kind 追加で対応する。

### terminal status（`disposed`）の扱い — 本ADRで決定

**custody と status は直交する。`disposed` に専用 custody を与えず、`none` kind も追加しない。**

根拠: `dispose.allowedPrev` は `["empty", "filled", "damaged"]`（`tank-rules.ts`）であり、**`lent` / `unreturned` からは破棄できない**。したがって破棄時点のタンクは必ず自社保管下にあり、`custodyKind: "warehouse"` が事実として正しい。破棄後もその値を保持する。

`none` を追加した場合の害: `custodyKind: "none"` × `status: "lent"` のような**新しい無効組合せ**を型が許すようになり、本 ADR が解こうとしている問題を再生産する。3 kind で全 8 status を矛盾なく表現できる。

| status | custodyKind |
|---|---|
| `filled` / `empty` / `damaged` / `defective` | `warehouse` |
| `in_house` | `in_house` |
| `lent` / `unreturned` | `customer` |
| `disposed` | 破棄時点の値を保持（`dispose.allowedPrev` より必ず `warehouse`） |

### `location` field

現在状態の `location` は clean-break で**削除する**。
**ただし historical operation event に残す当時の場所・顧客名 snapshot は削除しない**（design-principles §2.2 の業務不変条件）。

## Decision drivers

1. **Firestore は nested object の query / Rules / index が不利**。「貸出中の顧客で絞る」が主要 query なので flat が実務的
2. **human repairability** — Firebase Console で1 field ずつ読める形が少人数保守で効く
3. union の型安全性は、**union を上流に置けば**得られる（下記 Implementation boundary）

## Rejected alternatives

**B. nested custody object を Firestore に保存**
却下理由: query / Rules / index が冗長になり、Console 可読性が落ちる。得られる型安全性は「union を上流に置く」で代替できる。

**C. `status` + `customerId` から custody を導出し、独立 field を持たない**
却下理由: 導出ロジックを Rules 側にも二重実装することになる。将来の複数倉庫で `status` の意味が膨張する。「なぜこの場所なのか」がコードを読まないと分からず human repairability が最も低い。

**D. `none` kind を追加**
却下理由: 上記のとおり新しい無効組合せを生む。3 kind で全 status を表現できる。

## Consequences

- `location` を読む全コードの書き換えが必要（billing / dashboard / bulk-return / portal）
- Rules の field list 更新が**必須**（下記）。怠ると新 field が無防備になる
- 修理業者への外出しが業務化した場合、kind 追加の schema 変更が必要になる

## Implementation boundary

**union を上流へ置く（重要）**: 第二稿は「`tank-operation.ts` が唯一の writer だから入口で union を受ければ安全」としたが、**両方誤り**だった。

- `tanks` の writer は**3つ**: `tank-operation.ts` / `submitTankEntryBatch` / `tank-tag-service.ts`
- writer 内部で place と customer が**独立に決まる**: place は `finalStep.location ?? input.location ?? "倉庫"`、customer は `resolveNextTankCustomerProjection()` という別の action-code 分岐

したがって末端の `toCustodyFields()` では上流2系統を統合できない。**`TransitionStep` が `custody: TankCustody` を持ち、`planTankTransition` が生成する**構造にし、`resolveNextTankCustomerProjection` をその union の projection にする。

**強制は3層すべてで行う**（application だけでは不十分）:

| 層 | 内容 |
|---|---|
| plan | `TransitionStep.custody` を union にし、独立構築の経路をなくす |
| **Rules** | 組合せを検証する（**非バイパス層。これが本体**） |
| architecture test | flat field の直接構築を禁止 |

**Rules 側で必ず更新する箇所**: `isTankProjectionChanged` / `tankSnapshotMatches` / `isInitialTankOperationSnapshotUpdate` / `isTankRestoreSnapshotUpdate` の field list。あわせて ADR 外だが `!isTankProjectionChanged()` の blanket allow を deny-by-default へ反転する（design-principles §21.5）。

## Verification

- custody union → flat の変換 unit test
- **Rules test: `custodyKind != "customer"` なのに `custodyCustomerId` が入る update が拒否される**
- **Rules test: 未知 field を含む update が拒否される**
- 全 workflow の payload 固定テスト（custody 値の一致）
- correction / void で custody が完全復元されること

## Reconsideration trigger

- 修理業者 / 検査機関 / 輸送業者が物理的に custody を持つ運用が発生
- 複数倉庫の区別が必要になる
- 1タンクが複数の custody を同時に持つ（考えにくいが）

## Related documents

- [design-principles.md](../design-principles.md) §8.5
- [clean-break-cutover-plan.md](../clean-break-cutover-plan.md) Phase 2
