# Staff Operation Service Boundary Design

作成日: 2026-05-04

対象:

- `src/features/staff-operations/hooks/useOrderFulfillment.ts`
- `src/features/staff-operations/hooks/useReturnTagProcessing.ts`

---

## 1. 目的

staff operation 系 hook に残っている高リスクな Firestore 書き込みを、将来の小 PR で service 境界へ移すための設計を定義する。

今回の設計対象は、次の 3 操作である。

1. `useOrderFulfillment.approveOrder`
2. `useOrderFulfillment.fulfillOrder`
3. `useReturnTagProcessing.processReturnTags`

今回の PR では実装コードを変更しない。`transactions` / `tanks` / `logs` の整合性、`applyBulkTankOperations` の contract、`extraOps` の atomicity を崩さずに後続実装を分割するための地図を作る。

---

## 2. 現状の問題

### 2.1 hook が UI と業務書き込みを同時に持っている

`useOrderFulfillment` は、受注一覧の取得、スキャン UI state、数量 validation、alert / confirm、承認書き込み、貸出完了書き込みを同じ hook 内に持つ。

`useReturnTagProcessing` は、返却タグ一覧の取得、グルーピング、選択 state、処理直前の tank 再取得、返却 action 解決、タンク状態遷移、return transaction 完了を同じ hook 内に持つ。

この状態では、UI state の変更と業務データの不変条件変更が同じ差分に混ざりやすい。特に `transactions` / `tanks` / `logs` は業務履歴と請求・在庫状態に影響するため、hook 内の小さな整理でも実データ整合性に波及し得る。

### 2.2 `transactions` と `tanks/logs` の atomicity が見えにくい

`fulfillOrder` と `processReturnTags` は、`applyBulkTankOperations()` の `extraOps` に `transactions/{id}` の更新を渡している。このため、タンク状態遷移、ログ作成、transaction completion は同じ Firestore transaction に参加している。

この atomicity は維持する必要がある。service 化で `applyBulkTankOperations()` の外側に `transactions` 更新を分離すると、次のような不整合が起き得る。

- タンク貸出とログ作成は成功したが、order transaction が `completed` にならない。
- return transaction は `completed` になったが、タンク状態とログが更新されない。
- retry 時に transaction status と tank/log の状態が二重実行前提でずれる。

### 2.3 return 側 status と order 側 status を混ぜる余地がある

order 側は `pending` / `pending_approval` / `approved` / `completed` を扱う。一方、return 側の処理待ちは `pending_return` であり、`pending_approval` は使わない。

service 境界を曖昧にすると、order 承認と return タグ処理を同じ汎用 transaction service に押し込み、status の意味を混線させるリスクがある。

---

## 3. 現状の責務分解

### 3.1 `useOrderFulfillment.approveOrder`

現在の処理:

- `order.customerId` がない場合は承認不可として alert。
- UI で confirm。
- `requireStaffIdentity()` で actor を取得。
- `transactions/{orderId}` を `approved` に更新。
- `approvedAt`, `approvedBy`, `approvedByStaffId`, `approvedByStaffName`, `approvedByStaffEmail`, `updatedAt` を保存。
- 成功後に `fetchOrders()` を呼ぶ。

性質:

- `tanks` / `logs` には触らない。
- order 側の `pending_approval` を `approved` に上げる操作。
- Firestore 書き込みは単一 transaction document の update。
- 後続の service 抽出では最初に切り出しやすい。

### 3.2 `useOrderFulfillment.fulfillOrder`

現在の処理:

- UI state の `selectedOrder` と `scannedTanks` から valid tanks を作る。
- `selectedOrder.items` と tank type ごとのスキャン数を照合する。
- `requireStaffIdentity()` で actor を取得。
- order の customer snapshot を `OperationContext` として作る。
- 各 tank に対して `ACTION.LEND`、`logAction: "受注貸出"`、customer location、order note を組み立てる。
- `applyBulkTankOperations(inputs, extraOps)` を呼ぶ。
- `extraOps` 内で `transactions/{orderId}` を `completed` に更新。
- `fulfilledAt`, `fulfilledBy`, `fulfilledByStaffId`, `fulfilledByStaffName`, `fulfilledByStaffEmail`, `updatedAt` を保存。
- 成功後に alert、modal close、`fetchOrders()`、`fetchData()` を呼ぶ。

性質:

- `tanks` / `logs` / `transactions` の同時更新。
- `applyBulkTankOperations` の transaction 内に transaction completion を参加させる必要がある。
- UI の scan validation と業務 validation が混ざっている。

### 3.3 `useReturnTagProcessing.processReturnTags`

現在の処理:

- UI state の `selectedReturnGroup` と `returnTagSelections` から selected items を作る。
- 未選択の場合は alert。
- `requireStaffIdentity()` で actor を取得。
- return group の customer snapshot を `OperationContext` として作る。
- 処理直前に `tanksRepository.getTank(item.tankId)` で現在の tank を再取得する。
- `condition` から return tag を決める。
- `condition === "keep"` の場合は `ACTION.CARRY_OVER`、それ以外は `resolveReturnAction(tag, currentStatus)` を使う。
- `condition === "keep"` の場合は現在 location を維持し、それ以外は `"倉庫"` にする。
- `applyBulkTankOperations(inputs, extraOps)` を呼ぶ。
- `extraOps` 内で selected return transactions を `completed` に更新。
- `finalCondition`, `fulfilledAt`, `fulfilledBy`, `fulfilledByStaffId`, `fulfilledByStaffName`, `fulfilledByStaffEmail` を保存。
- 成功後に alert、selection clear、`fetchPendingReturnTags()`、`fetchBulkTanks()` を呼ぶ。

性質:

- return 側の正 status は `pending_return`。
- 処理待ちの間に tank status が変わる可能性があるため、処理直前の再取得は業務 validation として重要。
- `transactions` / `tanks` / `logs` の同時更新。

---

## 4. Service 候補

### 4.1 `orderFulfillmentService.approveOrder(...)`

候補 path:

- `src/features/staff-operations/services/order-fulfillment-service.ts`

想定 input:

```ts
type ApproveOrderInput = {
  orderId: string;
  customerId?: string;
  customerName: string;
  actor: OperationActor;
};
```

責務:

- order が顧客に紐付いていることを業務 validation する。
- `transactions/{orderId}` を `approved` に更新する。
- actor snapshot と timestamp を保存する。
- `pending_approval` は order 側の概念として扱い、return 側 status を扱わない。

hook に残すもの:

- confirm 文言。
- `approvingOrderId` state。
- alert 表示。
- `fetchOrders()`。

### 4.2 `orderFulfillmentService.fulfillOrder(...)`

候補 path:

- `src/features/staff-operations/services/order-fulfillment-service.ts`

想定 input:

```ts
type FulfillOrderInput = {
  order: PendingOrder;
  scannedTankIds: string[];
  tankSnapshotById: TankMap;
  actor: OperationActor;
};
```

責務:

- order items と scanned tanks の数量・種別 validation。
- `OperationContext` の作成。
- `ACTION.LEND` の bulk operation input 作成。
- `applyBulkTankOperations(inputs, extraOps)` の呼び出し。
- `extraOps` 内で `transactions/{orderId}` を `completed` に更新する。
- `fulfilledAt` / `fulfilledBy*` / `updatedAt` の保存。

hook に残すもの:

- selected order modal state。
- scanned tanks UI state。
- 入力中 prefix / input focus / last added animation。
- alert / close / refetch。
- UI 表示に必要な scanned tank の valid/error state。

注意:

- service 抽出後も transaction completion は `extraOps` 内に残す。
- `transactions` 更新を `applyBulkTankOperations()` の外へ出さない。
- `tank-operation.ts` は変更しない。

### 4.3 `returnTagProcessingService.processReturnTags(...)`

候補 path:

- `src/features/staff-operations/services/return-tag-processing-service.ts`

想定 input:

```ts
type ProcessReturnTagsInput = {
  group: ReturnGroup;
  selections: ReturnTagSelectionMap;
  actor: OperationActor;
};
```

責務:

- selected return items の抽出と未選択 validation。
- customer snapshot の作成。
- 処理直前の `tanksRepository.getTank()`。
- `condition` から `ReturnTag` / `TankAction` / location / note を決定。
- 存在しない tank を拒否する。
- `applyBulkTankOperations(inputs, extraOps)` の呼び出し。
- `extraOps` 内で selected return transactions を `completed` に更新する。
- `finalCondition` / `fulfilledAt` / `fulfilledBy*` の保存。

hook に残すもの:

- return group の selection UI state。
- `returnTagProcessingSubmitting` state。
- alert。
- modal / selected group clear。
- `fetchPendingReturnTags()` と `fetchBulkTanks()`。

注意:

- return 側は `pending_return` を処理対象とし、`pending_approval` を扱わない。
- `resolveReturnAction()` の呼び出しは service へ移してよいが、`tank-rules.ts` の rule は変更しない。
- keep の location 維持挙動を変えない。

---

## 5. Hook に残す責務

hook は UI workflow の殻として残す。

- UI state。
- loading / submitting state。
- `selectedOrder` / `selectedReturnGroup`。
- `scannedTanks` / `returnTagSelections`。
- input handling。
- alert / confirm。
- modal open / close。
- refetch 呼び出し。
- service に渡す input のうち UI 固有 state の取りまとめ。

hook が持たない方がよいもの:

- Firestore document path の組み立て。
- transaction status 更新 payload。
- actor snapshot field の保存形式。
- `applyBulkTankOperations` の呼び出し。
- `extraOps` の組み立て。
- tank 状態再取得と transition action 解決。

---

## 6. Service に移す責務

service は business workflow の境界として扱う。

- transaction status 更新。
- actor snapshot 保存。
- customer snapshot 保存。
- selected items の業務 validation。
- `applyBulkTankOperations` の input 作成。
- `applyBulkTankOperations` の呼び出し。
- `extraOps` での `transactions` 更新。
- 処理直前の tank 再取得。
- `finalCondition` / `approvedAt` / `fulfilledAt` / `approvedBy*` / `fulfilledBy*` の保存。
- Firestore timestamp と `updatedAt` の統一。

service は UI 表示を直接行わない。validation error は `throw new Error(message)` または typed result で hook に返し、alert は hook が出す。

---

## 7. Repository に持たせてはいけない責務

repository は Firestore collection の薄い read/write helper に留める。

repository に持たせないもの:

- UI alert / confirm。
- selected state。
- scanned tanks UI state。
- actor 推定。
- customer 推定。
- order 承認 workflow 全体。
- order fulfillment workflow 全体。
- return tag processing workflow 全体。
- `applyBulkTankOperations` の組み立て。
- order / return status の業務遷移判断。

`transactionsRepository.updateTransactionInBatch()` のような writer 参加 helper は残してよい。ただし、それを呼ぶ順序、payload、atomicity は service が所有する。

---

## 8. `applyBulkTankOperations` と `extraOps` の扱い

`applyBulkTankOperations(inputs, extraOps)` は、`tanks` / `logs` の状態遷移と caller 追加書き込みを同じ Firestore transaction に入れるための contract として維持する。

方針:

- `tank-operation.ts` は変更しない。
- `extraOps` は service 内で組み立てる。
- `extraOps` の中では `transactions/{id}` の completion 更新だけを行う。
- `transactions` completion を `applyBulkTankOperations` の外へ出さない。
- `extraOps` 内で UI state や alert を参照しない。
- `extraOps` 内の payload は actor/customer snapshot と timestamp に限定し、後続 UI state を混ぜない。

将来 `transactionsRepository.updateTransactionInBatch(writer, id, patch)` を使う場合も、writer は `applyBulkTankOperations` から渡された `TankOperationWriter` を使い、atomicity を維持する。

---

## 9. Atomicity 方針

### 9.1 approve

`approveOrder` は単一 `transactions/{orderId}` 更新で完結する。`tanks` / `logs` とは atomic にする対象がない。

ただし、status と actor snapshot は同じ update payload に含める。

### 9.2 fulfill

`fulfillOrder` は以下を同じ Firestore transaction に入れる。

- target tanks の status / location / latestLogId 更新。
- corresponding logs の作成。
- `transactions/{orderId}` の `completed` 更新。

この atomicity を壊さないため、service 化後も `applyBulkTankOperations` の `extraOps` に transaction update を渡す。

### 9.3 return tag processing

`processReturnTags` は以下を同じ Firestore transaction に入れる。

- selected tanks の status / location / latestLogId 更新。
- corresponding logs の作成。
- selected `transactions/{returnId}` の `completed` 更新。

処理直前の tank 再取得は service の preflight として残す。`applyBulkTankOperations` 内でも transaction 中に tank を読むため、preflight は action / location / note 決定のための入力であり、最終的な状態遷移 validation は `tank-operation.ts` 側に残る。

---

## 10. Actor / Customer Context

actor は `OperationActor` として service に渡す方針を第一候補にする。

理由:

- 現行 hook は `requireStaffIdentity()` を直接呼んでいる。
- service が browser localStorage / session に依存すると、domain workflow と認証 UI の境界が曖昧になる。
- 後続で admin actor や batch actor を渡しやすい。

service は受け取った actor を Firestore payload 用 snapshot に展開する。

customer は order / return group から作る snapshot として service が整形する。

- order fulfillment: `order.customerId` / `order.customerName`。
- return tag processing: `group.customerId` / `group.customerName`。

`customerName` はログと現在 location の表示互換に関わるため、実装 PR では既存 payload を変えない。

---

## 11. エラー時の保証

service は次のエラーを投げる。

- 顧客紐付けのない order を承認しようとした。
- scanned tanks の数量または種別が order items と一致しない。
- selected return item が 0 件。
- return tag processing の対象 tank が存在しない。
- tank transition validation が `tank-operation.ts` 内で失敗した。
- Firestore transaction が失敗した。

hook は error message を alert に変換し、loading / submitting state を finally で戻す。

保証:

- `fulfillOrder` と `processReturnTags` は、成功時のみ tanks/logs/transactions がまとめて更新される。
- transaction completion だけが成功する状態、または tank/log だけが成功する状態を作らない。
- validation error では Firestore write を開始しない。

---

## 12. 実装前の検証観点

実装 PR ごとに、最低限次を確認する。

- `npx tsc --noEmit --pretty false`
- `git diff --check`
- 実コード変更 PR では必要に応じて `npm run build`

手動確認候補:

- order 承認で `pending_approval` order が `approved` になる。
- 顧客未紐付け order は承認不可のまま。
- order fulfillment で tank が貸出状態になり、logs が作成され、order transaction が `completed` になる。
- order fulfillment の数量不足・種別不一致は write 前に止まる。
- return tag processing で `pending_return` transaction だけが処理対象になる。
- return tag processing で normal / unused / uncharged / keep の action と location が既存どおり。
- 存在しない tank は write 前に止まる。
- `pending_approval` を return 側に混ぜない。
- `pending_link` は staff operation count / workflow に混ぜない。

---

## 13. PR 分割案

### PR 1. docs-only: service boundary design

今回の PR。

- `useOrderFulfillment` / `useReturnTagProcessing` の service 境界を設計。
- 実装コードは変更しない。

### PR 2. `orderFulfillmentService.approveOrder` のみ抽出

対象:

- `approveOrder` の `transactions/{orderId}` update。

方針:

- `tanks` / `logs` は触らない。
- UI confirm / alert / loading は hook に残す。
- `pending_approval` は order 側だけの status として扱う。
- `updatedAt` / `approvedAt` / `approvedBy*` payload を維持する。

### PR 3. `orderFulfillmentService.fulfillOrder` 抽出

対象:

- order fulfillment の bulk tank operations と transaction completion。

方針:

- `applyBulkTankOperations` の `extraOps` contract を維持。
- order completion update を `extraOps` 内に残す。
- scan UI state は hook に残す。
- `tank-operation.ts` は触らない。

### PR 4. `returnTagProcessingService.processReturnTags` 抽出

対象:

- return tag processing の tank preflight、transition action 決定、bulk tank operations、return transaction completion。

方針:

- return 側の処理待ちは `pending_return` のまま。
- `pending_approval` は扱わない。
- keep の location 維持と `resolveReturnAction` の既存挙動を維持。
- `applyBulkTankOperations` の `extraOps` contract を維持。

### PR 5. follow-up: tests / manual verification / docs update

対象:

- 実装後の手動検証結果の docs 反映。
- 必要に応じた service input 型の整理。
- 必要なら workflow 単位のテスト追加を検討。

---

## 14. 今回実装しない範囲

- `src/**` の実装変更。
- `tank-operation.ts` の変更。
- `applyBulkTankOperations` の contract 変更。
- `tank-rules.ts` の状態遷移ルール変更。
- `transactions` / `tanks` / `logs` の schema 変更。
- Firestore data migration。
- `pending_return` / `pending_approval` の status 方針変更。
- Security Rules。
- Hosting deploy。
- `firestore.rules`。
- `firebase.json`。
- package files。

---

## 15. 結論

`approveOrder` は単一 transaction update なので、最初の実装 PR として切り出しやすい。

`fulfillOrder` と `processReturnTags` は、`applyBulkTankOperations` と `extraOps` によって `tanks` / `logs` / `transactions` の atomicity を保っている。service 化では、この構造を変えずに hook から workflow 書き込みを移すことが重要である。

後続の実装は、`approveOrder`、`fulfillOrder`、`processReturnTags` の順に小さく切る。いずれも UI、status 方針、Firestore schema、Security Rules、Firestore data は変更しない。
