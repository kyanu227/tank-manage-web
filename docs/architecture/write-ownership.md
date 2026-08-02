# Write Ownership の正本設計

- 作成日: 2026-07-19
- 対象commit: 7a118a4c1bce2b12bd272a6de8a69291e9d8d2ef（main HEAD）
- 再監査: 2026-08-03、main `71c191c`。§1 の page / hook / component からの Firestore write SDK 直接呼び出し 0件が維持されていることを実測確認
- 入力: [residual-structure-audit-2026-07-19.md](../refactor/residual-structure-audit-2026-07-19.md) §4（collection別write経路一覧）。R-xx は同監査の項目ID
- 位置づけ: collection / document / field 単位の write owner の正本。「owner」= そのfieldを書いてよい唯一の経路群

## 1. 大原則

1. page / hook / component から Firestore write SDK（`addDoc` / `setDoc` / `updateDoc` / `writeBatch` / `runTransaction` / `deleteDoc`）を直接呼ばない。現行HEADで違反0（R-11）。**回帰禁止**
2. 既存tankの状態遷移（tanks + logs + tankAggregationRevision）は `src/lib/tank-operation.ts` のみが書く。新規tankと初期logの作成は procurement の `submitTankEntryBatch` が唯一の例外
3. 新しいwrite経路を作る場合は、実装前に本表へownerを追記する
4. 複数機能が同じfieldを異なる意味で書く構造は作らない。既知の例外は §2 の `tanks.logNote` のみ（暫定容認・解消は別設計）

2026-08-03 の main `71c191c` 再監査でも、`src/app/**` / `src/components/**` / `src/hooks/**` から write SDK を直接呼ぶ箇所は **0件**だった。この解消済み境界を再実装せず、enforcement で回帰を止める。

## 2. tanks

| field | owner（許可されるwrite経路） | 備考 |
|---|---|---|
| 既存tankの更新: status / location / staff / customerId / customerName / maintenanceDate / nextMaintenanceDate / latestLogId / logNote / updatedAt | `applyTankOperation` / `applyBulkTankOperations` / `commitPlannedOperations`（tank-operation.ts:364-675。snapshot一括反映は:1138-1161）、訂正 `applyLogCorrection`（:817-1030）、取消 `voidLog`（:1036-1095） | operation projectionが書くfield一式。`note`はoperationでは書かない |
| 新規tank doc作成時の初期値: status / location / type / note / nextMaintenanceDate / updatedAt / createdAt | `submitTankEntryBatch`（submitTankEntryBatch.ts:131-140） | 新規作成の唯一経路。既存tankに対して type / note / createdAt を書くruntime経路はない |
| customerId / customerName | 同上（operation projection） | 現在貸出projection（tank-types.ts:9-12）。**顧客identityの正本ではない**（正本はcustomers / logs）。operation経由以外の書き込み禁止 |
| logNote | ①operation時のtankNote反映: tank-operation.ts:601-618,1146 ②返却tag marker単独write: `updateTankReturnTagMarker`（tank-tag-service.ts:5-17） | **二重owner（暫定容認）**。②の呼び出し元は useBulkReturnByLocation と inhouse page — PR-09 / PR-05 で各workflow service経由へ移管する（owner関数は変えない）。返却確定前の一時tag stateとしての利用（R-17）は機能干渉リスクとして認識済み。解消はschema変更を伴うため構造化PRと分離した別設計 |

禁止される直接write: 既存tankに対する上記以外の部分update一切。新規tank docの作成は `submitTankEntryBatch` のみ。

## 3. logs

| 区分 | owner |
|---|---|
| tank lifecycle log（作成） | tank-operation.ts（作成 :624-660） |
| log correction revision | `applyLogCorrection`（tank-operation.ts:817-1030）が唯一の owner |
| log void | `voidLog`（tank-operation.ts:1036-1095）が唯一の owner |
| recovery review | `reviewOperationLogs`（operation-review-service.ts:164-312） |
| procurement log（logKind分離済み R-31） | `submitTankEntryBatch` |
| 資材発注 log | `submitSupplyOrder`（supply-order.ts:33-50） |

禁止: 上記以外のlogs write。既存logsの一括書き換え（AGENTS.md）。

log correction / void の write owner は role に依存しない。全 active staff に作成後 72 時間以内という同じ条件を適用し、管理者・準管理者の期限 bypass は設けない（[ADR-007](./adr/ADR-007-staff-log-correction-authority.md)）。この方針は owner を増やすものではなく、actor identity の記録・Rules 照合、revision chain、tank snapshot 復元、transaction atomicity を変更しない。admin operation review の管理者制限は対象外であり維持する。

## 4. transactions

共通writer: `createTransaction` / `updateTransactionInBatch`（repositories/transactions.ts:74-108）。
`updateTransaction` は現行caller無し — 削除候補（機械的整理PR）。

| type | 作成 | 更新・確定 |
|---|---|---|
| order | `createPortalOrder`（portal-transaction-service.ts:42-71） | pending_link更新 `linkCustomerUsersToCustomers`（customer-linking-service.ts:73-147、customerUsersとbatch）/ 承認 `approveOrder`（order-fulfillment-service.ts:14-27、**単独updateDoc**）/ 完了 `fulfillOrder`（同:48-70、operationと完了更新をatomicに実行） |
| return | `createPortalReturnRequests` / `createPendingPortalReturnRequest`（portal-transaction-service.ts:73-83,148-163） | 確定 `confirmPendingReturnRequests`（return-tag-processing-service.ts:69-88,182-207、operationとatomic） |
| uncharged_report | `createPortalUnfilledReports`（portal-transaction-service.ts:85-106） | update経路なし。handling fields追加（R-23）はschema扱いで別設計 |

## 5. 人・組織系

| collection | owner |
|---|---|
| customers | `createCustomer` / `updateCustomer`（customers-service.ts:28-45） |
| customerUsers | `ensureCustomerUser`（customer-user.ts:43-93）/ `completeCustomerUserSetup`（portal-profile-service.ts:18-46）/ `linkCustomerUsersToCustomers`（customer-linking-service.ts:73-147）。制約: portal/setupから customerId / customerName / disabled を保存しない（AGENTS.md） |
| staff | `saveStaffMembers`（staff-sync-service.ts:35-101）/ `updateOwnStaffLocale`（staff-locale-service.ts:19-68）/ `linkStaffUidByEmailAuth`・`writeStaffUidLink`（staff-uid-link-service.ts:140-166）/ `approveStaffJoinRequestForExistingStaff`（staff-join-request-review-service.ts:64-138） |
| staffByEmail | write経路は2つ（R-09）: ①mirror helper `setStaffAuthMirrorInBatch` / `deleteStaffAuthMirrorInBatch`（staff-auth.ts:49-68、caller: staff-sync-service:63-98）②`updateOwnStaffLocale`による直接update（staff-locale-service.ts:55-64、helperを経由しない）。一本化は後続候補（意味変更なしで可能な場合のみPR化） |
| staffByUid | `setStaffUidAuthMirrorInTransaction`（staff-auth.ts:70-87） |

## 6. settings・マスタ・その他

| document / collection | owner |
|---|---|
| settings/adminPermissions | `saveAdminPermissions`（admin-permissions-service.ts）。`capabilities`だけを保存し、旧`pages`はread時変換のみ |
| settings/portal | `savePortalSettings`（admin-settings.ts:59-68） |
| settings/inspection | `saveInspectionSettings`（admin-settings.ts:85-94） |
| settings/billingInvoice | `saveBillingInvoiceSettings`（billing-settings-service.ts:16-31） |
| settings/tankOperationPolicy | `saveTankOperationPolicy`（tank-operation-policy-service.ts:50-115） |
| settings/tankAggregationRevision | tank-operation.ts（:584-594, :974-986, :1082-1092）+ operation-review-service（:270-280） |
| notifySettings/config | `saveAdminNotificationSettings`（admin-notification-settings.ts）。新規writeは`emails`と`updatedAt`のみ。legacyの`alertMonths` / `validityYears`は読まず、merge保存でも触れない |
| priceMaster / rankMaster | writeBatch一括保存（admin-money-settings.ts:65-139。caller: admin/money/page.tsx:104） |
| orderMaster | writeBatch一括保存（order-master-settings.ts:26-74。caller: admin/order-master/page.tsx:80） |
| lineConfigs | admin-notification-settings.ts:86-118 |
| staffJoinRequests | 本人作成・更新: staff-join-requests.ts:132-180 / 承認・却下: staff-join-request-review-service.ts:64-168 |
| operationReviewEvents | operation-review-service.ts:187,296-310 |
| tankProcurements | `submitTankEntryBatch`（src/features/procurement/lib/submitTankEntryBatch.ts:54-83） |
| orders（資材発注） | `submitSupplyOrder`（supply-order.ts:33-50） |

settings / master のwriteは関数単位にまとめる（AGENTS.md: 後から `edit_history` を差し込める形。現時点で `edit_history` / `delete_history` のruntime writerは存在しない R-39 — 実装は新機能として別設計）。

## 7. Atomicity境界（分割禁止）

| 操作 | 境界 |
|---|---|
| tank operation | tanks + logs + tankAggregationRevision（+ transactionId link）を単一transaction（tank-operation.ts） |
| ログ訂正・取消 | active→superseded + 新revision + tanks更新を単一transaction |
| 受注完了（fulfillOrderのみ） | operation + transaction完了更新（order-fulfillment-service:48-70）。承認 `approveOrder` は単独updateであり、atomicity境界を持たない |
| 返却確定 | operation write + transaction完了更新（return-tag-processing-service:163-207）。preflightの再取得・変換（:78-85,122-152）はtransaction外 |
| customerUsers紐付け | customerUsers + pending order（batch、customer-linking-service） |
| staff同期 | staff + staffByEmail mirror(batch、staff-sync-service) |
| procurement | tankProcurements + tanks + logs（runTransaction、submitTankEntryBatch.ts:64-80） |
| recovery review | review + revision（operation-review-service transaction） |

## 8. 責務の要約

- **tank-operation.ts**: 状態遷移validation・strict/advisory・transitionPlan・atomic write・revision/void・aggregationRevision更新の正本。現在位置から移動しない。Repositoryへ分解しない
- **transaction系service**: 作成はportal側service、確定はstaff側service。申請（transactions）と確定（tanks/logs）を混同しない（AGENTS.md）
- **settings/master系service**: 単純保存は薄いserviceでよい。複数collection・権限・履歴・同期を伴うものだけ service / operation を通す

## 9. 将来schema分離が必要な箇所（構造化PRから除外し別設計とする）

| 論点 | 内容 |
|---|---|
| R-10 | **2026-08-02解消**。`settings/inspection`へ一本化。`notifySettings/config`のlegacy fieldはmigration・削除せずruntimeから無視 |
| R-17 | `tanks.logNote` の一時tag state利用の解消（専用field等） |
| R-23 | uncharged_report の handling fields 追加 |
| R-26 | legacy actor文字列 approvedBy / fulfilledBy のwrite停止 |
| R-28 | current loan の専用日時projection（currentLentAt等）追加 |
| R-29 | billing / portal の legacy location・name fallback 削除（請求仕様） |
| R-39 | edit_history / delete_history の実装 |
