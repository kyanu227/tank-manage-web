# Firestore 書き込み境界 監査

調査日: 2026-05-04
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
- `transactionsRepository.updateTransactionInBatch(writer, ...)` は `writer.update(...)` の抽象化なので、`batch.update` の直接 grep には出ない箇所も書き込み境界として扱う。

---

## 0. サマリ

- 現行コードでは、portal の `transactions` 作成、admin/settings の staff/orderMaster/customerUsers 保存、portal setup は page 直書きから service / repository 経由へ移動済み。
- page 直下に残る Firestore 書き込みは主に `CustomerManagementPage` の `customers` CRUD、`admin/permissions` の `settings/adminPermissions` 保存、`staff/inhouse` の `tanks.logNote` 更新。
- hook 内に残る業務書き込みは `useOrderFulfillment`、`useReturnTagProcessing`、`useBulkReturnByLocation`。特に `transactions` 更新と `tanks` 更新を伴う staff operation は高リスクなので、最初の実装 PR では触らない。
- `tank-operation.ts` は `tanks` / `logs` 状態遷移と revision / void の正本境界。明示設計なしに分割・移動しない。
- `submitTankEntryBatch.ts` は新規 `tanks` 作成 + `tankProcurements` + `logs` をまとめる procurement workflow。高リスクだが現状の境界は妥当。
- `customerUsers` と `pending_link` transactions の連動更新は `customer-linking-service.ts` に寄っており、page 直書きではない。
- settings / master 系は helper/service に寄っているものが多い。将来は `edit_history` を差し込める service 境界へ揃える候補。

---

## 1. 書き込み境界一覧

| file | function / component | 使用 API | collection / doc path の推定 | 現在の層分類 | 書き込みの意味 | リスク | 将来の移行候補 | 今は触らない理由 | 優先度 |
|---|---|---|---|---|---|---|---|---|---|
| `src/lib/tank-operation.ts` | `applyTankOperation` | `runTransaction`, `tx.set`, `tx.update` | `tanks/{tankId}`, `logs/{autoId}` | domain operation service | 単一タンクの状態遷移とログ作成 | 高 | 現状維持 | 状態遷移・ログ・latestLogId の正本境界 | 触らない |
| `src/lib/tank-operation.ts` | `applyBulkTankOperations` | `runTransaction`, `tx.set`, `tx.update`, `extraOps` | `tanks/{tankId}`, `logs/{autoId}`, caller 追加書き込み | domain operation service | 複数タンクの状態遷移とログ作成、受注/返却の transaction 更新を同一 transaction に参加 | 高 | 現状維持 | staff operation の中核。移動ではなく caller 側 service 化で包む | 触らない |
| `src/lib/tank-operation.ts` | `applyLogCorrection` | `runTransaction`, `tx.set`, `tx.update` | `logs/{logId}`, `tanks/{tankId}` | domain operation service | ログ revision 作成とタンク最新状態の差し替え | 高 | 現状維持 | revision chain の不変条件を持つ | 触らない |
| `src/lib/tank-operation.ts` | `voidLog` | `runTransaction`, `tx.update` | `logs/{logId}`, `tanks/{tankId}` | domain operation service | ログ取消とタンク状態復元 | 高 | 現状維持 | void の業務不変条件を持つ | 触らない |
| `src/features/procurement/lib/submitTankEntryBatch.ts` | `submitTankEntryBatch` | `runTransaction`, `tx.set` | `tanks/{tankId}`, `tankProcurements/{autoId}`, `logs/{autoId}` | 業務バッチ / workflow | タンク購入・登録時の重複確認、新規 tanks 作成、procurement/log 作成 | 高 | 現状維持。必要なら procurement domain service として命名整理 | 新規作成 workflow として既に page から分離済み | 後 |
| `src/lib/firebase/supply-order.ts` | `submitSupplyOrder` | `writeBatch`, `batch.set` | `orders/{autoId}`, `logs/{autoId}` | service / 業務 workflow | 資材発注とサマリ log 作成 | 中 | 現状維持。将来は procurement feature 配下へ移す候補 | actor を受け取る service 境界に寄っている | 後 |
| `src/lib/firebase/repositories/transactions.ts` | `createTransaction` | `addDoc` | `transactions/{autoId}` | repository | portal order / return / uncharged_report などの transaction 作成 | 中 | 現状維持。type 別 service は caller 側に置く | createdAt/updatedAt 付与の薄い repository として妥当 | 後 |
| `src/lib/firebase/repositories/transactions.ts` | `updateTransaction` | `updateDoc` | `transactions/{id}` | repository | transaction 単純更新 | 中 | 現状維持。用途ごとの service から呼ぶ | repository helper として薄い境界 | 後 |
| `src/lib/firebase/repositories/transactions.ts` | `updateTransactionInBatch` | `writer.update` | `transactions/{id}` | repository | batch / transaction writer に参加する transaction 更新 | 高 | 現状維持。caller service を作る | `customer-linking-service` や tank operation extraOps から使うため直接移動しない | 後 |
| `src/lib/firebase/portal-transaction-service.ts` | `createPortalOrder` | repository 経由 `addDoc` | `transactions` | service | linked order は `pending`、unlinked order は `pending_link` で作成 | 中 | 現状維持 | page 直書きから移動済み。status 方針も現行設計に一致 | 完了 |
| `src/lib/firebase/portal-transaction-service.ts` | `createPortalReturnRequests` | repository 経由 `addDoc` | `transactions` | service | return transaction を `pending_return` で作成 | 中 | 現状維持 | return 側 status が `pending_return` に統一済み | 完了 |
| `src/lib/firebase/portal-transaction-service.ts` | `createPortalUnfilledReports` | repository 経由 `addDoc` | `transactions` | service | 未充填報告 transaction を `completed` で作成 | 低 | 現状維持 | page 直書きから移動済み | 完了 |
| `src/features/staff-operations/hooks/useOrderFulfillment.ts` | `approveOrder` | `updateDoc` | `transactions/{orderId}` | hook | order の `pending_approval` を `approved` に上げる | 高 | `orderFulfillmentService.approveOrder` | staff 作業導線の挙動に直結。最初は設計 PR で切る | 中 |
| `src/features/staff-operations/hooks/useOrderFulfillment.ts` | `fulfillOrder` | `applyBulkTankOperations` + `batch.update` | `tanks`, `logs`, `transactions/{orderId}` | hook + domain operation service | 受注分のタンク貸出と order transaction 完了を同一 transaction に参加 | 高 | `orderFulfillmentService.fulfillOrder` | `tanks` / `logs` / `transactions` 同時更新。大きな修正と混ぜない | 中 |
| `src/features/staff-operations/hooks/useReturnTagProcessing.ts` | `processReturnTags` | `applyBulkTankOperations` + `batch.update` | `tanks`, `logs`, `transactions/{returnId}` | hook + domain operation service | 返却タグ処理と return transaction 完了 | 高 | `returnTagProcessingService.processReturnTags` | return status とタンク状態遷移の境界。安全なテスト方針が必要 | 中 |
| `src/app/staff/inhouse/page.tsx` | `updateTag` | `writeBatch().update().commit()` | `tanks/{tankId}` | page | 自社利用中タンクの `logNote` タグだけ更新 | 高 | `tankTagService.updateLogNote` | state 遷移ではないが `tanks` 直接更新。2 箇所重複を小 PR で扱う | 高 |
| `src/features/staff-operations/hooks/useBulkReturnByLocation.ts` | `updateTag` | `writeBatch().update().commit()` | `tanks/{tankId}` | hook | 一括返却対象タンクの `logNote` タグだけ更新 | 高 | `tankTagService.updateLogNote` | `staff/inhouse` と同じ重複。state field を許可しない helper が必要 | 高 |
| `src/features/admin-customers/CustomerManagementPage.tsx` | `handleAddCustomer` | `addDoc` | `customers/{autoId}` | page / feature component | 顧客マスタ新規作成 | 中 | `customersService.createCustomer` | 単純 CRUD だが重複名チェックと履歴差し込みをまとめたい | 高 |
| `src/features/admin-customers/CustomerManagementPage.tsx` | `saveCustomer` | `updateDoc` | `customers/{customerId}` | page / feature component | 顧客マスタ編集 | 中 | `customersService.updateCustomer` | 既存 page 状態管理を崩さず service 抽出できる | 高 |
| `src/features/admin-customers/CustomerManagementPage.tsx` | `toggleCustomerStatus` | `updateDoc` | `customers/{customerId}` | page / feature component | 顧客有効/無効切替 | 中 | `customersService.setCustomerActive` | customers 正本化の前段として小さく切れる | 高 |
| `src/app/admin/permissions/page.tsx` | `handleSave` | `setDoc` | `settings/adminPermissions` | page | ページ権限制御の保存 | 中 | `adminPermissionsService.savePermissions` | 単発保存で小さいが AdminAuthGuard の read helper と合わせたい | 高 |
| `src/lib/firebase/admin-settings.ts` | `savePortalSettings` | `setDoc(merge)` | `settings/portal` | 設定 helper | 自動返却時刻の保存 | 中 | 現状維持。将来 `edit_history` 対応 | helper に寄っており page 直書きではない | 中 |
| `src/lib/firebase/admin-settings.ts` | `saveInspectionSettings` | `setDoc(merge)` | `settings/inspection` | 設定 helper | 耐圧検査の有効年数・アラート月数保存 | 中 | 現状維持。通知設定側との正本整理候補 | helper に寄っているが `notifySettings/config` と field が重複 | 中 |
| `src/lib/firebase/admin-money-settings.ts` | `saveAdminMoneySettings` | `writeBatch`, `batch.set`, `batch.update`, `batch.delete` | `priceMaster`, `rankMaster` | service / 設定 helper | 操作単価・ランク条件の差分保存 | 中 | 現状維持。将来 `edit_history` 対応 | dirty/deleted と競合検知が helper 内にまとまっている | 後 |
| `src/lib/firebase/admin-notification-settings.ts` | `saveAdminNotificationSettings` | `writeBatch`, `batch.set`, `batch.update`, `batch.delete` | `notifySettings/config`, `lineConfigs` | service / 設定 helper | メール通知・LINE設定の差分保存 | 中 | 現状維持。`settings/inspection` との責務整理候補 | helper に寄っており page 直書きではない | 中 |
| `src/lib/firebase/order-master-settings.ts` | `saveOrderItems` | `writeBatch`, `batch.set`, `batch.update`, `batch.delete` | `orderMaster` | service / 設定 helper | 発注品目マスタの差分保存 | 中 | 現状維持。将来 `edit_history` 対応 | helper に寄っており page 直書きではない | 後 |
| `src/lib/firebase/staff-sync-service.ts` | `saveStaffMembers` | `writeBatch`, `batch.set`, `batch.update` | `staff`, `staffByEmail` | service | staff と staffByEmail mirror の同期保存 | 中 | 現状維持。将来履歴・権限変更 audit を追加 | page 直書きから service へ寄っている | 中 |
| `src/lib/firebase/staff-auth.ts` | `setStaffAuthMirrorInBatch` / `deleteStaffAuthMirrorInBatch` | `batch.set`, `batch.delete` | `staffByEmail/{emailKey}` | 設定 helper | staff mirror の batch 参加 helper | 中 | 現状維持 | `staff-sync-service` が使う低レベル helper | 後 |
| `src/lib/firebase/staff-auth.ts` | `findActiveStaffByEmail` | `setDoc(merge)` | `staffByEmail/{emailKey}` | 設定 helper / auth helper | mirror が無い場合の認証 lookup 中の自動修復 | 中 | 明示的な mirror rebuild service に分離 | read 経路から write するため注意。挙動変更は認証に影響する | 中 |
| `src/lib/firebase/customer-user.ts` | `ensureCustomerUser` | `setDoc`, `setDoc(merge)` | `customerUsers/{uid}` | service / identity helper | portal user 初期作成、login 時の email/displayName/lastLoginAt 更新 | 中 | 現状維持 | Portal Auth Phase 0 の正規経路 | 後 |
| `src/lib/firebase/portal-profile-service.ts` | `completeCustomerUserSetup` | `updateDoc` | `customerUsers/{uid}` | service | portal 初期設定完了情報の保存 | 中 | 現状維持。必要なら `customer-user.ts` と統合 | page 直書きから service へ寄っている | 後 |
| `src/lib/firebase/customer-linking-service.ts` | `linkCustomerUsersToCustomers` | `writeBatch`, `batch.set`, repository `writer.update` | `customerUsers/{uid}`, `transactions/{id}` | service | 顧客紐付けと `pending_link` order の `pending` 昇格 | 高 | 現状維持 | customerUsers と transactions の連動更新が service に寄っている | 後 |

---

## 2. 層ごとの現状

### page

残存:

- `src/features/admin-customers/CustomerManagementPage.tsx`
  - `customers` の create / update / active toggle を直接実行。
  - 将来の `customers` 正本化、名称変更時の影響、`edit_history` 差し込みを考えると `customersService` 化の優先度は高い。
- `src/app/admin/permissions/page.tsx`
  - `settings/adminPermissions` を直接 `setDoc`。
  - 単発保存なので小さく切りやすい。
- `src/app/staff/inhouse/page.tsx`
  - `tanks.logNote` タグ更新を直接実行。
  - 状態遷移ではないが `tanks` 書き込みなので、許可フィールド限定 helper を作って page から隠す候補。

現行で page 直書きから解消済み:

- portal order / return / uncharged_report の `transactions` 作成。
- portal setup の `customerUsers` 更新。
- admin/settings の staff / orderMaster / customerUsers / settings 保存。

### hook

残存:

- `useOrderFulfillment.ts`
  - order approval の `transactions` 更新。
  - tank 貸出と order completion を `applyBulkTankOperations` の `extraOps` に参加。
- `useReturnTagProcessing.ts`
  - return tag 処理と return transaction completion を `extraOps` に参加。
- `useBulkReturnByLocation.ts`
  - `tanks.logNote` タグ更新。

評価:

- `useOrderFulfillment` と `useReturnTagProcessing` は `tanks` / `logs` / `transactions` の整合に関わるため高リスク。先に docs / test 方針を切る。
- `useBulkReturnByLocation` の tag 更新は `staff/inhouse` と同じ小さい重複なので、次の実装 PR 候補にできる。

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

- `staff-auth.ts` の `findActiveStaffByEmail` は read lookup 中に mirror を自動修復する。認証互換のため現状維持だが、将来は明示的な rebuild / repair service に寄せる候補。
- `transactionsRepository` は write helper も持つ。repository が「読み取り専用」ではないため、用途ごとの service から呼ばれる前提を維持する。

---

## 3. コレクション別 write map

| collection | 現状の write 元 | 境界評価 | 次の方針 |
|---|---|---|---|
| `tanks` | `tank-operation.ts`, `submitTankEntryBatch.ts`, `staff/inhouse/page.tsx`, `useBulkReturnByLocation.ts` | 状態遷移は正本境界にある。`logNote` だけ page/hook に残る | `tankTagService.updateLogNote` を小 PR で検討 |
| `logs` | `tank-operation.ts`, `submitTankEntryBatch.ts`, `supply-order.ts` | service / workflow 境界にある | 現状維持 |
| `transactions` | `transactionsRepository`, `portal-transaction-service`, `customer-linking-service`, `useOrderFulfillment`, `useReturnTagProcessing` | portal create と pending_link 昇格は service 化済み。staff hooks に approval/completion が残る | order/return fulfillment service は後続で慎重に |
| `customers` | `CustomerManagementPage` | page 直書き | `customersService` 化の最小 PR 候補 |
| `customerUsers` | `customer-user.ts`, `portal-profile-service.ts`, `customer-linking-service.ts` | service/helper 境界に寄っている | 現状維持。必要なら identity helper 統合 |
| `staff`, `staffByEmail` | `staff-sync-service.ts`, `staff-auth.ts` | service 化済みだが `staff-auth` 自動修復あり | read 中 write の扱いを別途監査 |
| `settings/adminPermissions` | `admin/permissions/page.tsx` | page 直書き | `adminPermissionsService` 化の最小 PR 候補 |
| `settings/portal`, `settings/inspection` | `admin-settings.ts` | 設定 helper | 現状維持。`edit_history` 差し込み候補 |
| `notifySettings`, `lineConfigs` | `admin-notification-settings.ts` | 設定 helper | 現状維持。inspection field 重複整理は別論点 |
| `priceMaster`, `rankMaster` | `admin-money-settings.ts` | 設定 helper | 現状維持 |
| `orderMaster` | `order-master-settings.ts` | 設定 helper | 現状維持 |
| `orders` | `supply-order.ts` | service | 現状維持 |
| `tankProcurements` | `submitTankEntryBatch.ts` | workflow | 現状維持 |

---

## 4. 高リスク候補

1. `src/lib/tank-operation.ts`
   - `tanks` / `logs` 状態遷移、revision、void の正本。
   - 触らない方がよい既存境界。

2. `src/features/staff-operations/hooks/useOrderFulfillment.ts`
   - order approval と fulfillment の `transactions` 更新が hook に残る。
   - fulfillment は `applyBulkTankOperations` と `batch.update(transactions)` を同一 transaction に参加させるため、抽出時は `tanks` / `logs` / `transactions` の整合性を維持する必要がある。

3. `src/features/staff-operations/hooks/useReturnTagProcessing.ts`
   - return tag 処理でタンク状態遷移と return transaction completion を同時に行う。
   - `pending_return` の意味と現場作業の境界に直結するため、status 変更とは混ぜない。

4. `src/app/staff/inhouse/page.tsx` と `src/features/staff-operations/hooks/useBulkReturnByLocation.ts`
   - `tanks.logNote` のみだが、`tanks` 直接更新が page/hook に重複している。
   - state / location / latestLogId を絶対に触らない helper が必要。

5. `src/lib/firebase/customer-linking-service.ts`
   - `customerUsers` 紐付けと `pending_link` order の `pending` 昇格を同一 batch で行う。
   - 現状は service 境界に寄っており、実装修正対象ではない。

6. `src/features/procurement/lib/submitTankEntryBatch.ts`
   - 新規 `tanks` 作成と `logs` 作成を担う。
   - 状態遷移ではないが業務データへの影響が大きいため、現状維持。

---

## 5. 次に切るべき小 PR 候補

1. `customersService` の最小追加
   - 対象: `CustomerManagementPage` の `addDoc` / `updateDoc` 3 箇所。
   - 理由: page 直書きで、`customers` 正本化・履歴差し込みの前段として効果が高い。
   - 注意: UI 変更、schema 変更、既存 customers データ更新は混ぜない。

2. `adminPermissionsService.savePermissions`
   - 対象: `admin/permissions/page.tsx` の `setDoc` 1 箇所。
   - 理由: 単発で小さい。`AdminAuthGuard` 側の read helper と将来揃えやすい。
   - 注意: 権限仕様変更はしない。

3. `tankTagService.updateLogNote`
   - 対象: `staff/inhouse` と `useBulkReturnByLocation` の `tanks.logNote` 更新 2 箇所。
   - 理由: 重複しており、許可フィールド限定の helper に寄せる価値がある。
   - 注意: `status` / `location` / `staff` / `latestLogId` は絶対に扱わない。`tank-operation.ts` は触らない。

4. `staff-auth` mirror 自動修復の扱いを docs / design で切る
   - 対象: `findActiveStaffByEmail` の `setDoc(merge)`。
   - 理由: read 経路が write を含む例外。
   - 注意: 認証導線に影響するため、実装変更は別 PR で明示的に。

5. order / return fulfillment service 設計
   - 対象: `useOrderFulfillment` と `useReturnTagProcessing`。
   - 理由: hook に高リスク業務書き込みが残る。
   - 注意: いきなり実装しない。`applyBulkTankOperations` の `extraOps` contract と validation 方針を先に決める。

---

## 6. 今回の監査で変更しない範囲

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

## 7. 結論

現行の書き込み境界は、2026-05-02 時点の監査より service / repository へ寄っている。特に portal transaction 作成、portal setup、admin/settings の複合保存は page 直書きから解消済み。

一方で、`customers`、`adminPermissions`、`tanks.logNote`、staff operation の `transactions` approval/completion はまだ page / hook に残る。最初の実装 PR にするなら、業務状態遷移を触らない `customersService` または `adminPermissionsService` が最小で安全。`tanks` / `logs` / `transactions` を同時更新する staff operation は、次の docs / design PR で境界を決めてから実装する。
