# Firestore 書き込み境界 監査

調査日: 2026-05-04
更新日: 2026-05-05
範囲: `src/**`

検索 API:

- `addDoc`
- `setDoc`
- `updateDoc`
- `writeBatch`
- `runTransaction`
- `deleteDoc`
- `batch.set`
- `batch.update`
- `batch.delete`
- `transaction.set`
- `transaction.update`
- `transaction.delete`

補足:

- `deleteDoc` の直接使用は検出なし。
- `transaction.set` / `transaction.update` / `transaction.delete` のリテラル一致は検出なし。ただし `runTransaction` 内の writer 変数は `tx` で、`tx.set` / `tx.update` として存在するため、`runTransaction` の行で監査対象に含める。
- `transactionsRepository.updateTransactionInBatch(writer, ...)` は `writer.update(...)` の抽象化なので、`batch.update` の直接 grep に出ない箇所も書き込み境界として扱う。
- 2026-05-05 時点では、PR #21 から PR #29 の完了内容を反映済み。

---

## 0. サマリ

- page / hook に残っていた低から中リスクの書き込みは、PR #21 から PR #24 で service 境界へ移動または削除済み。
  - `customersService`
  - `adminPermissionsService.savePermissions`
  - `tankTagService.updateLogNote`
  - `findActiveStaffByEmail()` の fallback auto-repair write 削除
- staff operation の主要な高リスク書き込みは、PR #25 で設計を固定し、PR #26 から PR #28 で service 境界へ移動済み。
  - `orderFulfillmentService.approveOrder`
  - `orderFulfillmentService.fulfillOrder`
  - `returnTagProcessingService.processReturnTags`
- PR #29 で staff operation の手動検証シナリオを docs 化済み。
- `useOrderFulfillment` と `useReturnTagProcessing` は、Firestore direct write / workflow write を持たず、UI state / input / alert / confirm / refetch / selection state を担う hook に寄った。
- `applyBulkTankOperations` と `extraOps` の atomicity は service 側で維持する方針。`transactions` / `tanks` / `logs` の同時更新を `applyBulkTankOperations()` の外へ分離しない。
- `tank-operation.ts` は引き続き `tanks` / `logs` 状態遷移、revision、void の正本境界。明示設計なしに分割・移動しない。
- `submitTankEntryBatch.ts`、`customer-linking-service.ts`、settings / master 系 helper、`staff-sync-service.ts` は現状維持。
- `staffByEmail` mirror 自体は残る。auto-repair write は削除済みだが、mirror 完全撤去は別設計。
- Security Rules は未着手。今回の write boundary 整理とは別テーマとして扱う。

---

## 1. PR #21 から PR #29 の反映

| PR | 内容 | 現在の状態 | 監査 doc 上の扱い |
|---|---|---|---|
| #21 | `customersService` 抽出 | `CustomerManagementPage` の customers write は service 呼び出しへ移動済み | 完了済み |
| #22 | `adminPermissionsService.savePermissions` 抽出 | `settings/adminPermissions` 保存は service 呼び出しへ移動済み | 完了済み |
| #23 | `tankTagService.updateLogNote` 抽出 | `tanks.logNote` 更新は field 限定 service へ移動済み | 完了済み |
| #24 | `findActiveStaffByEmail()` fallback auto-repair write 削除 | mirror がない場合も `staff` query fallback のみ。read 経路で `staffByEmail` に書かない | 完了済み |
| #25 | staff operation service boundary design | service 境界、`applyBulkTankOperations`、`extraOps`、atomicity 方針を docs 化 | 完了済み |
| #26 | `orderFulfillmentService.approveOrder` 抽出 | order approval の transaction update は service へ移動済み | 完了済み |
| #27 | `orderFulfillmentService.fulfillOrder` 抽出 | order fulfillment の `applyBulkTankOperations` と transaction completion は service へ移動済み | 完了済み |
| #28 | `returnTagProcessingService.processReturnTags` 抽出 | return tag processing の tank preflight / transition / transaction completion は service へ移動済み | 完了済み |
| #29 | staff operation manual verification docs | order approve / fulfill、return tag normal / unused / uncharged / keep の手動検証台本を追加 | 完了済み |

---

## 2. 現在の書き込み境界一覧

| file | function / component | 使用 API | collection / doc path の推定 | 現在の層分類 | 書き込みの意味 | リスク | 現在の方針 | 優先度 |
|---|---|---|---|---|---|---|---|---|
| `src/lib/tank-operation.ts` | `applyTankOperation` | `runTransaction`, `tx.set`, `tx.update` | `tanks/{tankId}`, `logs/{autoId}` | domain operation service | 単一タンクの状態遷移とログ作成 | 高 | 正本境界として現状維持 | 触らない |
| `src/lib/tank-operation.ts` | `applyBulkTankOperations` | `runTransaction`, `tx.set`, `tx.update`, `extraOps` | `tanks/{tankId}`, `logs/{autoId}`, caller 追加書き込み | domain operation service | 複数タンクの状態遷移とログ作成、caller の transaction 更新を同一 transaction に参加 | 高 | 正本境界として現状維持。caller 側 service から使う | 触らない |
| `src/lib/tank-operation.ts` | `applyLogCorrection` | `runTransaction`, `tx.set`, `tx.update` | `logs/{logId}`, `tanks/{tankId}` | domain operation service | ログ revision 作成とタンク最新状態の差し替え | 高 | revision chain の不変条件を持つため現状維持 | 触らない |
| `src/lib/tank-operation.ts` | `voidLog` | `runTransaction`, `tx.update` | `logs/{logId}`, `tanks/{tankId}` | domain operation service | ログ取消とタンク状態復元 | 高 | void の業務不変条件を持つため現状維持 | 触らない |
| `src/features/procurement/lib/submitTankEntryBatch.ts` | `submitTankEntryBatch` | `runTransaction`, `tx.set` | `tanks/{tankId}`, `tankProcurements/{autoId}`, `logs/{autoId}` | 業務バッチ / workflow | タンク購入・登録時の重複確認、新規 tanks 作成、procurement/log 作成 | 高 | 現状維持。必要なら procurement domain service として命名整理 | 後 |
| `src/lib/firebase/supply-order.ts` | `submitSupplyOrder` | `writeBatch`, `batch.set` | `orders/{autoId}`, `logs/{autoId}` | service / 業務 workflow | 資材発注とサマリ log 作成 | 中 | 現状維持 | 後 |
| `src/lib/firebase/repositories/transactions.ts` | `createTransaction` | `addDoc` | `transactions/{autoId}` | repository | portal order / return / uncharged_report などの transaction 作成 | 中 | 現状維持。type 別 service は caller 側に置く | 後 |
| `src/lib/firebase/repositories/transactions.ts` | `updateTransaction` | `updateDoc` | `transactions/{id}` | repository | transaction 単純更新 | 中 | 現状維持。用途ごとの service から呼ぶ | 後 |
| `src/lib/firebase/repositories/transactions.ts` | `updateTransactionInBatch` | `writer.update` | `transactions/{id}` | repository | batch / transaction writer に参加する transaction 更新 | 高 | 現状維持。`extraOps` や domain service から使う | 後 |
| `src/lib/firebase/portal-transaction-service.ts` | `createPortalOrder` | repository 経由 `addDoc` | `transactions` | service | linked order は `pending`、unlinked order は `pending_link` で作成 | 中 | 現状維持 | 完了 |
| `src/lib/firebase/portal-transaction-service.ts` | `createPortalReturnRequests` | repository 経由 `addDoc` | `transactions` | service | return transaction を `pending_return` で作成 | 中 | 現状維持 | 完了 |
| `src/lib/firebase/portal-transaction-service.ts` | `createPortalUnfilledReports` | repository 経由 `addDoc` | `transactions` | service | 未充填報告 transaction を `completed` で作成 | 低 | 現状維持 | 完了 |
| `src/lib/firebase/customers-service.ts` | `createCustomer`, `updateCustomer` | `addDoc`, `updateDoc` | `customers/{autoId}`, `customers/{customerId}` | service | 顧客マスタの作成・更新・有効無効切替 | 中 | PR #21 で page 直書きから移動済み。将来 `edit_history` 差し込み候補 | 完了 |
| `src/lib/firebase/admin-permissions-service.ts` | `savePermissions` | `setDoc` | `settings/adminPermissions` | service | ページ権限制御の保存 | 中 | PR #22 で page 直書きから移動済み。将来 `edit_history` 差し込み候補 | 完了 |
| `src/lib/firebase/tank-tag-service.ts` | `updateLogNote` | `updateDoc` | `tanks/{tankId}` | field-limited service | `tanks.logNote` のみ更新 | 中 | PR #23 で page/hook 重複から移動済み。payload は `{ logNote }` のみ | 完了 |
| `src/lib/firebase/staff-auth.ts` | `findActiveStaffByEmail` | read only | `staffByEmail/{emailKey}`, `staff` query | auth helper | mirror 優先 read、なければ active staff query fallback | 中 | PR #24 で fallback auto-repair write 削除済み | 完了 |
| `src/lib/firebase/staff-auth.ts` | `setStaffAuthMirrorInBatch`, `deleteStaffAuthMirrorInBatch` | `batch.set`, `batch.delete` | `staffByEmail/{emailKey}` | auth mirror helper | `staff-sync-service` の mirror 同期に参加 | 中 | mirror 自体は現状維持。完全撤去は別設計 | 後 |
| `src/lib/firebase/order-fulfillment-service.ts` | `approveOrder` | `updateDoc` | `transactions/{orderId}` | staff operation service | order approval の `approved` 更新と actor snapshot 保存 | 高 | PR #26 で hook から移動済み | 完了 |
| `src/lib/firebase/order-fulfillment-service.ts` | `fulfillOrder` | `applyBulkTankOperations`, `batch.update` | `tanks`, `logs`, `transactions/{orderId}` | staff operation service | order fulfillment の tank/log 更新と order completion | 高 | PR #27 で hook から移動済み。`extraOps` atomicity 維持 | 完了 |
| `src/lib/firebase/return-tag-processing-service.ts` | `processReturnTags` | `applyBulkTankOperations`, `batch.update` | `tanks`, `logs`, `transactions/{returnId}` | staff operation service | return tag processing の tank/log 更新と return completion | 高 | PR #28 で hook から移動済み。`pending_return` semantics 維持 | 完了 |
| `src/lib/firebase/admin-settings.ts` | `savePortalSettings`, `saveInspectionSettings` | `setDoc(merge)` | `settings/portal`, `settings/inspection` | 設定 helper | portal / inspection 設定保存 | 中 | 現状維持。将来 `edit_history` 差し込み候補 | 後 |
| `src/lib/firebase/admin-money-settings.ts` | `saveAdminMoneySettings` | `writeBatch`, `batch.set`, `batch.update`, `batch.delete` | `priceMaster`, `rankMaster` | service / 設定 helper | 操作単価・ランク条件の差分保存 | 中 | 現状維持。将来 `edit_history` 差し込み候補 | 後 |
| `src/lib/firebase/admin-notification-settings.ts` | `saveAdminNotificationSettings` | `writeBatch`, `batch.set`, `batch.update`, `batch.delete` | `notifySettings/config`, `lineConfigs` | service / 設定 helper | メール通知・LINE設定の差分保存 | 中 | 現状維持。inspection field 重複整理は別論点 | 後 |
| `src/lib/firebase/order-master-settings.ts` | `saveOrderItems` | `writeBatch`, `batch.set`, `batch.update`, `batch.delete` | `orderMaster` | service / 設定 helper | 発注品目マスタの差分保存 | 中 | 現状維持。将来 `edit_history` 差し込み候補 | 後 |
| `src/lib/firebase/staff-sync-service.ts` | `saveStaffMembers` | `writeBatch`, `batch.set`, `batch.update` | `staff`, `staffByEmail` | service | staff と staffByEmail mirror の同期保存 | 中 | 現状維持。mirror 完全撤去や権限変更 audit は別設計 | 後 |
| `src/lib/firebase/customer-user.ts` | `ensureCustomerUser` | `setDoc`, `setDoc(merge)` | `customerUsers/{uid}` | service / identity helper | portal user 初期作成、login 時の email/displayName/lastLoginAt 更新 | 中 | 現状維持 | 後 |
| `src/lib/firebase/portal-profile-service.ts` | `completeCustomerUserSetup` | `updateDoc` | `customerUsers/{uid}` | service | portal 初期設定完了情報の保存 | 中 | 現状維持 | 後 |
| `src/lib/firebase/customer-linking-service.ts` | `linkCustomerUsersToCustomers` | `writeBatch`, `batch.set`, repository `writer.update` | `customerUsers/{uid}`, `transactions/{id}` | service | 顧客紐付けと `pending_link` order の `pending` 昇格 | 高 | 現状維持。customerUsers と transactions の連動更新境界 | 後 |
| `src/features/staff-operations/hooks/useManualTankOperation.ts` | manual operation submit | `applyBulkTankOperations` | `tanks`, `logs` | hook + domain operation service | staff manual operation の bulk tank/log 更新 | 高 | 現状維持。別テーマで service 境界を検討 | 要設計 |
| `src/features/staff-operations/hooks/useBulkReturnByLocation.ts` | bulk return submit | `applyBulkTankOperations` | `tanks`, `logs` | hook + domain operation service | 貸出先別一括返却の tank/log 更新 | 高 | tag 更新は PR #23 済み。bulk return workflow は別テーマ | 要設計 |
| `src/app/staff/inhouse/page.tsx` | inhouse operation submit | `applyTankOperation`, `applyBulkTankOperations` | `tanks`, `logs` | page + domain operation service | 自社利用 / 倉庫戻しなどの tank/log 更新 | 高 | logNote 更新は PR #23 済み。operation workflow は別テーマ | 要設計 |
| `src/app/staff/damage/page.tsx` | damage submit | `applyBulkTankOperations` | `tanks`, `logs` | page + domain operation service | 破損報告の tank/log 更新 | 高 | 現状維持。staff operation follow-up 候補 | 要設計 |
| `src/app/staff/repair/page.tsx` | repair submit | `applyBulkTankOperations` | `tanks`, `logs` | page + domain operation service | 修理完了などの tank/log 更新 | 高 | 現状維持。staff operation follow-up 候補 | 要設計 |
| `src/app/staff/inspection/page.tsx` | inspection submit | `applyBulkTankOperations` | `tanks`, `logs` | page + domain operation service | 耐圧検査の tank/log 更新 | 高 | 現状維持。staff operation follow-up 候補 | 要設計 |

---

## 3. 層ごとの現状

### page

完了済み:

- `src/features/admin-customers/CustomerManagementPage.tsx`
  - customers create / update / active toggle は `customersService` へ移動済み。
- `src/app/admin/permissions/page.tsx`
  - `settings/adminPermissions` 保存は `adminPermissionsService.savePermissions` へ移動済み。
- `src/app/staff/inhouse/page.tsx`
  - `tanks.logNote` 更新は `tankTagService.updateLogNote` へ移動済み。

残存:

- `staff/damage`、`staff/repair`、`staff/inspection`、`staff/inhouse` など、tank operation workflow を page から `applyBulkTankOperations` / `applyTankOperation` へ渡す箇所がある。
- これらは `tank-operation.ts` の正本境界を呼ぶ workflow であり、単純な repository 化対象ではない。
- 次に触る場合は、UI変更や status rule 変更と混ぜず、operation ごとの service boundary design を先に切る。

### hook

完了済み:

- `useOrderFulfillment`
  - `approveOrderTransaction` / `fulfillOrderTransaction` を呼ぶ hook に整理済み。
  - Firestore direct write、`db` / `doc` / `serverTimestamp`、`applyBulkTankOperations`、`batch.update` は hook から除去済み。
- `useReturnTagProcessing`
  - `processReturnTagsTransaction` を呼ぶ hook に整理済み。
  - `tanksRepository`、`resolveReturnAction`、`ACTION`、`RETURN_TAG`、`applyBulkTankOperations`、`batch.update` は hook から除去済み。
- `useBulkReturnByLocation`
  - `tanks.logNote` 更新は `tankTagService.updateLogNote` へ移動済み。

残存:

- `useOrderFulfillment` に残る責務は UI state、scan validation、alert / confirm、refetch、service input 組み立て。
- `useReturnTagProcessing` に残る責務は selection state、submitting state、alert、selected group clear、refetch。
- `useBulkReturnByLocation` の bulk return workflow と `useManualTankOperation` の manual workflow は、引き続き `applyBulkTankOperations` を呼ぶ。これは別設計候補。

### service / repository / domain operation service

現状維持でよい境界:

- `tank-operation.ts`
- `submitTankEntryBatch.ts`
- `supply-order.ts`
- `portal-transaction-service.ts`
- `customer-linking-service.ts`
- `staff-sync-service.ts`
- `admin-money-settings.ts`
- `admin-notification-settings.ts`
- `admin-settings.ts`
- `order-master-settings.ts`
- `customer-user.ts`
- `portal-profile-service.ts`
- `transactionsRepository`

注意する境界:

- `transactionsRepository` は write helper も持つ。repository が読み取り専用ではないため、用途ごとの service から呼ばれる前提を維持する。
- `staffByEmail` mirror は同期 helper と data が残る。auto-repair write は削除済みだが、完全撤去は認証導線と Security Rules を含む別設計。

---

## 4. コレクション別 write map

| collection | 現状の write 元 | 境界評価 | 次の方針 |
|---|---|---|---|
| `tanks` | `tank-operation.ts`, `submitTankEntryBatch.ts`, `tankTagService`, staff operation pages/hooks | 状態遷移は正本境界。`logNote` は field-limited service 化済み | `tank-operation.ts` は現状維持。残る operation workflow は別設計 |
| `logs` | `tank-operation.ts`, `submitTankEntryBatch.ts`, `supply-order.ts`, staff operation pages/hooks via `applyBulkTankOperations` | domain operation / workflow 境界にある | 現状維持 |
| `transactions` | `transactionsRepository`, `portal-transaction-service`, `customer-linking-service`, `order-fulfillment-service`, `return-tag-processing-service` | portal create、pending_link 昇格、order/return completion は service 境界に寄った | 現状維持 |
| `customers` | `customersService` | page 直書き解消済み | 将来 `edit_history` や customers 正本化の設計で拡張 |
| `customerUsers` | `customer-user.ts`, `portal-profile-service.ts`, `customer-linking-service.ts` | service/helper 境界に寄っている | 現状維持 |
| `staff`, `staffByEmail` | `staff-sync-service.ts`, `staff-auth.ts` mirror helpers | service/helper 境界。auto-repair write は削除済み | mirror 完全撤去は別設計 |
| `settings/adminPermissions` | `adminPermissionsService` | page 直書き解消済み | 将来 `edit_history` 差し込み候補 |
| `settings/portal`, `settings/inspection` | `admin-settings.ts` | 設定 helper | 現状維持。`edit_history` 差し込み候補 |
| `notifySettings`, `lineConfigs` | `admin-notification-settings.ts` | 設定 helper | 現状維持。inspection field 重複整理は別論点 |
| `priceMaster`, `rankMaster` | `admin-money-settings.ts` | 設定 helper | 現状維持 |
| `orderMaster` | `order-master-settings.ts` | 設定 helper | 現状維持 |
| `orders` | `supply-order.ts` | service | 現状維持 |
| `tankProcurements` | `submitTankEntryBatch.ts` | workflow | 現状維持 |

---

## 5. 残る高リスク境界

1. `src/lib/tank-operation.ts`
   - `tanks` / `logs` 状態遷移、revision、void の正本。
   - 触らない方がよい既存境界。

2. `src/features/procurement/lib/submitTankEntryBatch.ts`
   - 新規 `tanks` 作成、`tankProcurements` 作成、`logs` 作成をまとめる procurement workflow。
   - 状態遷移ではないが業務データへの影響が大きいため、現状維持。

3. `src/lib/firebase/customer-linking-service.ts`
   - `customerUsers` 紐付けと `pending_link` order の `pending` 昇格を同一 batch で行う。
   - 現状は service 境界に寄っており、実装修正対象ではない。

4. staff operation の残り workflow
   - `useManualTankOperation`
   - `useBulkReturnByLocation` の bulk return workflow
   - `staff/inhouse` の operation workflow
   - `staff/damage`
   - `staff/repair`
   - `staff/inspection`
   - `applyBulkTankOperations` / `applyTankOperation` を呼ぶため高リスク。対象ごとに service boundary design を切る。

5. settings / master 系
   - `admin-settings.ts`
   - `admin-money-settings.ts`
   - `admin-notification-settings.ts`
   - `order-master-settings.ts`
   - 現状は helper/service 境界として許容。将来 `edit_history` を差し込む候補。

6. `staffByEmail` mirror
   - auto-repair write は削除済み。
   - mirror 同期そのものを完全撤去するかは、認証導線、既存 data、Security Rules を含む別設計。

---

## 6. 次に切る候補

完了済み候補はこの一覧から外した。現時点での候補は次の通り。

1. staff operation 残り workflow の service boundary design
   - 対象: manual operation、bulk return、inhouse、damage、repair、inspection。
   - 理由: `applyTankOperation` / `applyBulkTankOperations` 呼び出しが page/hook に残る。
   - 注意: `tank-operation.ts` の API / contract は変えない。UI変更と混ぜない。

2. `staffByEmail` mirror 廃止方針の設計
   - 対象: `staff-sync-service.ts`、`staff-auth.ts`、Firestore data、Security Rules。
   - 理由: auto-repair write は消えたが mirror 二重管理は残る。
   - 注意: いきなり data 削除しない。認証導線と fallback を確認する。

3. settings / master 系の `edit_history` 設計
   - 対象: `adminPermissionsService`、`admin-settings`、`admin-money-settings`、`admin-notification-settings`、`order-master-settings`。
   - 理由: 管理変更履歴を後から差し込む候補。
   - 注意: 履歴 schema と actor snapshot を先に決める。実装と docs を混ぜない。

4. 手動検証の実施
   - 対象: `docs/verification/staff-operation-manual-verification.md`。
   - 理由: PR #26 から PR #28 で移した staff operation が現場業務として壊れていないことを確認する。
   - 注意: Firestore data を直接編集しない。検証対象環境と対象 document id を記録する。

5. Security Rules
   - 対象: `firestore.rules` と `firebase.json` の扱い。
   - 理由: 現在も Rules deploy は未実行で別テーマ。
   - 注意: write boundary 整理とは別 PR / 別レビューで扱う。Hosting deploy と混ぜない。

---

## 7. 今回の監査更新で変更しない範囲

- `src/**` の実装コード。
- Firestore 書き込み処理の移動。
- import 整理。
- 型修正。
- repository / service の新規実装。
- `firestore.rules`。
- `firebase.json`。
- package files。
- Firestore data。
- Security Rules deploy。
- Hosting deploy。

---

## 8. 結論

PR #21 から PR #29 により、当初の優先候補だった `customers`、`adminPermissions`、`tanks.logNote`、staff auth auto-repair write、order approval / fulfillment、return tag processing は監査上も完了扱いになった。

`useOrderFulfillment` / `useReturnTagProcessing` からは Firestore direct write と workflow write が外れ、hook は UI state / selection / alert / refetch に寄っている。staff operation の主要な order / return flow では、`applyBulkTankOperations` と `extraOps` の atomicity を service 側で維持する構造になった。

残る課題は、`tank-operation.ts` の正本境界を崩さずに周辺 workflow を整理すること、`staffByEmail` mirror の将来方針、settings / master 系の `edit_history` 差し込み、Security Rules の別テーマ化である。次の実装に進む前に、対象を 1 PR 1 論点で切る。
