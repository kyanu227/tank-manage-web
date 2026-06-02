# Action / Status Code Pivot Design

## 1. Purpose

この文書は、Firestore に日本語値として保存されている ACTION / STATUS を、将来的に `TankActionCode` / `TankStatusCode` へ移行するための設計方針を固定する。

目的は以下。

- UI label と Firestore 保存値を分離する
- 多言語 UI と保存 schema を混同しない
- query、集計、状態遷移の正本を安定させる
- 将来の報酬分割、共同作業者、分析機能の前提を整える

このプロジェクトはまだ実運用前で、既存 Firestore データはない。そのため、既存データとの互換性、legacy backfill、旧保存値への長期対応は不要とする。

ただし、既存コード依存を無視して一括変更してよいわけではない。`ACTION` / `STATUS` は表示文言ではなく、状態遷移、Firestore query、trace、billing、sales、analytics、返却フローに関わる正本値である。実装は docs、型準備、`OP_RULES`、write、query、aggregation、cleanup の順で分割する。

## 2. Current State

現状の正本は `src/lib/tank-rules.ts` の日本語値である。

`STATUS` は以下。

- `充填済み`
- `空`
- `貸出中`
- `未返却`
- `自社利用中`
- `破損`
- `不良`
- `破棄`

`ACTION` は以下を含む。

- `貸出`
- `返却`
- `未使用返却`
- `返却(未充填)`
- `持ち越し`
- `充填`
- `自社利用`
- `自社利用(事後)`
- `自社返却`
- `自社返却(未使用)`
- `自社返却(未充填)`
- `破損報告`
- `修理済み`
- `耐圧検査完了`
- `破棄`

現状の依存は以下。

- `OP_RULES` は日本語 action/status を前提にしている
- `tanks.status` は日本語値で保存されている
- `logs.action` / `logs.transitionAction` / `logs.prevStatus` / `logs.newStatus` は日本語値で保存されている
- `tank-operation.ts` は日本語 action/status を使って状態遷移と保存を行う
- `repositories/tanks.ts`、portal、bulk return、inhouse、repair、inspection は `where("status", ...)` に依存している
- `tank-trace.ts`、billing、sales、staff analytics、staff mypage、dashboard は日本語 action/status に依存している

一方で、以下はすでに code 化済み、または code 化の土台がある。

- `ReturnTag`: `normal` / `unused` / `uncharged` / `keep`
- `transactions.type`
- `transactions.status`
- `OperationSource`
- `OperationWorkflow`
- `TankActionCode`
- `TankStatusCode`
- `getTankActionLabel`
- `getTankStatusLabel`

## 3. Target Schema

最終的な保存 schema は、既存 field 名を維持したまま code 値へ切り替える方針を目標とする。

```ts
type TankDoc = {
  status: TankStatusCode;
  location?: string;
  latestLogId?: string;
  updatedAt?: Timestamp;
};

type LogDoc = {
  action: TankActionCode;
  transitionAction?: TankActionCode;
  prevStatus?: TankStatusCode;
  newStatus?: TankStatusCode;
  logStatus: "active" | "superseded" | "voided";
  location?: string;
  customerId?: string;
  customerName?: string;
};
```

方針:

- Firestore には表示文言を保存しない
- 日本語 / 英語 label は label helper で出す
- `logStatus: active / superseded / voided` は revision 機構なので変更しない
- `location` / `customerId` 整理は別 Phase とする
- `ReturnTag` はすでに code 化済みなので、この pivot の対象外とする
- procurement / supply-order などの業務ログは、`logs.action` や `logs.newStatus` を持つ場合だけ別途確認する

## 4. Code Mapping Policy

`src/lib/tank-action-status-codes.ts` は現在、以下の責務を持つ。

- legacy 日本語値と `TankActionCode` / `TankStatusCode` の mapping
- code から legacy 日本語値への mapping
- action / status の分類 helper
- legacy 日本語値を受け取る分類 helper

code pivot 後の方針:

- `TankActionCode` / `TankStatusCode` を正本型にする
- label helper は code から表示文言を返す正方向 helper として残す
- legacy mapping helper は cleanup Phase で縮小する
- legacy fallback は、pivot 中の確認用として一時的に残してよい
- `codeToLegacyAction` / `codeToLegacyStatus` は、保存値正本が code になった後は表示用途に使わない

UI 表示は以下を使う。

- `getTankActionLabel(code, locale)`
- `getTankStatusLabel(code, locale)`
- `getReturnTagLabel(tag, locale)`
- operation message helper

## 5. OP_RULES Pivot Policy

現状:

- `OP_RULES` は日本語 `ACTION` を key にしている
- `allowedPrev` は日本語 `STATUS`
- `nextStatus` も日本語 `STATUS`
- `validateTransition`, `getNextStatus`, `resolveReturnAction`, `resolveReturnStatus` は日本語値前提

目標:

- `OP_RULES` の key は `TankActionCode`
- `allowedPrev` は `TankStatusCode[]`
- `nextStatus` は `TankStatusCode`
- UI label は `getTankActionLabel` / `getTankStatusLabel` で出す

注意:

- `OP_RULES` と `tank-operation.ts` は隣接 Phase で扱う
- `OP_RULES` だけ code 化して保存処理が日本語のままだと、状態遷移が壊れる
- 保存 pivot と query pivot の順序を間違えると、画面が空になる
- `resolveReturnAction` は ReturnTag と status の両方に関わるため、返却フローの manual / bulk / inhouse の確認が必要

## 6. Write Pivot Policy

`tank-operation.ts` で切り替える保存値は以下。

- `tanks.status`
- `logs.action`
- `logs.transitionAction`
- `logs.prevStatus`
- `logs.newStatus`

対象処理:

- `applyTankOperation`
- `applyBulkTankOperations`
- `applyLogCorrection`
- `voidLog`
- revision / void の snapshot 復元

方針:

- `tanks.status` は `TankStatusCode` で保存する
- `logs.action` / `logs.transitionAction` は `TankActionCode` で保存する
- `logs.prevStatus` / `logs.newStatus` は `TankStatusCode` で保存する
- `logStatus` は変更しない
- `OperationActor` / `OperationContext` に locale を混ぜない
- UI label と保存 action/status を混同しない
- revision / void は、過去 snapshot を復元するため、old log の action/status field が code 前提で扱えることを確認する

## 7. Query Pivot Policy

query pivot の対象は以下。

- `src/lib/firebase/repositories/tanks.ts`
- portal pages
- bulk return
- inhouse
- repair
- inspection
- `tank-trace.ts`

方針:

- `where("status", "==", STATUS.LENT)` などを code 値へ移行する
- `statusIn` も `TankStatusCode[]` 前提へ移行する
- 保存 pivot と query pivot の整合を取る
- 必要 index を確認する
- portal の `location == customerName` 依存は別問題として扱う

注意:

- write が code 保存なのに query が日本語のままだと一覧が空になる
- query が code 前提なのに既存テストデータが日本語保存値だと一覧が空になる
- 実運用前なので backfill は不要だが、seed / test data の再作成が必要

## 8. Aggregation Pivot Policy

集計 pivot の対象は以下。

- billing
- sales
- staff analytics
- staff mypage
- dashboard

現状の例:

- `action === "貸出"`
- `action.includes("返却")`
- `action === "充填"`
- 日本語 `ACTION` 定数による分類

方針:

- action 分類は `TankActionCode` か code classification helper へ移行する
- `includes("返却")` のような日本語文字列判定を削除する
- billing / sales は計算結果に影響するため、UI label より慎重に扱う
- 表示だけの箇所と計算箇所を分ける
- staff analytics / staff mypage は、件数やランキングに影響するため query / write pivot 後にまとめて確認する

## 9. Implementation Options

### A案: Reading Helper First

保存値は日本語のまま、読み取り側だけ helper 経由にする。

メリット:

- 低リスク
- 表示箇所から段階的に日本語判定を減らせる

リスク:

- 最終形に進みにくい
- query / 集計 / 状態遷移の正本は日本語のまま残る
- legacy helper が長く残る

推奨度: medium

### B案: tank-rules / OP_RULES Code Pivot

`ACTION` / `STATUS` / `OP_RULES` を code 正本へ寄せる。

メリット:

- 状態遷移の正本が code になる
- `tank-operation.ts` の保存 pivot へ進みやすい
- UI label と業務値の分離が本格化する

リスク:

- `tank-operation.ts` と隣接対応しないと壊れる
- query / 集計との整合確認が必要

推奨度: high

### C案: New Code Fields In Parallel

`tanks.statusCode`, `logs.actionCode`, `logs.prevStatusCode`, `logs.newStatusCode` などを併用する。

メリット:

- 互換性が高い
- 段階移行しやすい

リスク:

- 既存データなしの前提では schema が重い
- 二重 field の不整合が起きる
- cleanup が増える

推奨度: low

### D案: Existing Fields Code Pivot

既存 field の保存値を code へ切り替える。

メリット:

- 実運用前なら最終形に最も近い
- schema が単純
- UI label と保存値の責務分離が明確

リスク:

- 影響範囲が大きい
- write / query / aggregation の順序を間違えると壊れる
- seed / test data の再投入が必要

推奨度: high

推奨は D案を最終目標にすること。ただし、一括実装ではなく、docs、type/rules 準備、`OP_RULES`、write、query、aggregation、cleanup の順で分割する。

## 10. Recommended Implementation Order

### Phase 31: Docs-Only Code Pivot Design

今回のタスク。ACTION / STATUS code pivot の設計を docs に固定する。

### Phase 32: Tank Action / Status Code Type Preparation

- `TankActionCode` / `TankStatusCode` を正本型として扱う準備をする
- 既存 helper の不足を確認する
- `tank-rules.ts` 側の型境界を整理する
- まだ Firestore 保存値は変えない

### Phase 33: OP_RULES Code Pivot

- `OP_RULES` を code 正本へ移行する
- `validateTransition`
- `getNextStatus`
- `resolveReturnAction`
- `resolveReturnStatus`
- label は helper で表示する

### Phase 34: tank-operation Write Code Pivot

以下を code 保存へ変更する。

- `tanks.status`
- `logs.action`
- `logs.transitionAction`
- `logs.prevStatus`
- `logs.newStatus`

### Phase 35: Query Pivot

以下の query を code 前提へ変更する。

- `repositories/tanks.ts`
- portal
- bulk return
- inhouse
- repair
- inspection
- `tank-trace.ts` query

### Phase 36: Aggregation Pivot

以下を code classification へ移行する。

- billing
- sales
- staff analytics
- staff mypage
- dashboard action classification

### Phase 37: Cleanup

以下を削除または縮小する。

- legacy 日本語 fallback
- `includes("返却")`
- `codeToLegacyAction`
- `codeToLegacyStatus`
- 表示 helper 内の legacy 判定

cleanup は最後に行う。途中で fallback を消すと、query / 集計 / revision / void の確認漏れが起きやすい。

## 11. Validation Plan

各実装 Phase で最低限実行する。

- `git diff --check`
- `npx tsc --noEmit --pretty false`
- changed files eslint
- 必要に応じて `npm run lint`
- app flow manual test

manual flow:

- 手動貸出
- 手動返却
- 充填
- 一括返却
- 自社使用
- 受注貸出
- portal 返却申請
- 返却タグ処理
- billing
- sales
- staff analytics
- tank trace
- revision / void

注意:

- 既存テストデータに日本語保存値がある場合は削除または再投入する
- 実運用前なので backfill は不要
- seed / test data の再作成は必要
- code pivot 後に日本語保存値のテストデータを残すと、query や集計の確認が誤る

## 12. Do Not Touch In Initial Code Pivot

初期 code pivot では以下を扱わない。

- `tanks.location`
- `tanks.customerId`
- portal の `location == customerName` 廃止
- return flow の業務仕様変更
- payout / collaborators
- Firestore rules deploy
- package 類
- UI label dictionary の全面整理
- customer / portal locale 設計

これらは ACTION / STATUS code pivot と同時に行うと影響範囲が大きくなりすぎる。

## 13. Risks

- 保存 pivot と query pivot の順序を間違えると画面が空になる
- `OP_RULES` と `tank-operation.ts` の不整合で状態遷移が壊れる
- billing / sales / analytics は計算結果に影響する
- `tank-trace.ts` は履歴 action query に依存する
- revision / void は snapshot 復元があるため、保存値変更の影響を受ける
- legacy fallback を早く消しすぎると表示や確認が壊れる
- `customerId` / `location` 整理と同時にやると影響範囲が大きくなりすぎる
- ReturnTag は code 化済みだが、返却フローは ACTION / STATUS と隣接するため、保存値 pivot と混ぜすぎない

## 14. Decision

- 既存データがないため、最終的には既存 field を code 保存値へ pivot する
- ただし一括実装ではなく、docs、rules/type、`OP_RULES`、write、query、aggregation、cleanup の順で分割する
- 日本語 / 英語表示は label helper に任せる
- Firestore には表示文言を保存しない
- `logStatus` は revision 機構なので変更しない
- `ReturnTag` はすでに code 化済みなので対象外
- `customerId` / `location` と payout / collaborators は別 Phase とする
