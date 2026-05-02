# page / feature / hook / service / repository 境界 監査

調査日: 2026-05-02
範囲: `src/app/**` `src/features/**` `src/hooks/**` `src/lib/**` `src/components/**`
目的: 「どこに何の責務が散らばっているか」を一望にして、壊れにくい階層への移行計画の根拠を作る。
方針: 旧 schema 互換、legacy fallback、backfill は考慮しない。既存コードに残る fallback は現状課題として記録し、移行後の前提にはしない。

---

## 0. 観測サマリ

- `src/app/**/page.tsx` は **薄い殻 / 厚いページ** の二極化が進んでいる。
  - 薄い殻に成功している例:
    - [src/app/staff/lend/page.tsx](../../src/app/staff/lend/page.tsx) `7 行`
    - [src/app/staff/return/page.tsx](../../src/app/staff/return/page.tsx) `7 行`
    - [src/app/staff/fill/page.tsx](../../src/app/staff/fill/page.tsx) `7 行`
    - [src/app/staff/tank-purchase/page.tsx](../../src/app/staff/tank-purchase/page.tsx) `7 行`
    - [src/app/staff/tank-register/page.tsx](../../src/app/staff/tank-register/page.tsx) `7 行`
    - [src/app/staff/order/page.tsx](../../src/app/staff/order/page.tsx) `14 行` (`/staff/supply-order` への redirect)
    - [src/app/staff/page.tsx](../../src/app/staff/page.tsx) `16 行`
    - [src/app/page.tsx](../../src/app/page.tsx) `14 行`
  - 殻に失敗している（=Firestore I/O・業務判断・状態遷移・複数コレクション一括更新を直接抱えている）例:
    - [src/app/staff/dashboard/page.tsx](../../src/app/staff/dashboard/page.tsx) `1451 行`
    - [src/app/admin/settings/page.tsx](../../src/app/admin/settings/page.tsx) `1070 行`
    - [src/app/admin/customers/page.tsx](../../src/app/admin/customers/page.tsx) `637 行`
    - [src/app/portal/unfilled/page.tsx](../../src/app/portal/unfilled/page.tsx) `502 行`
    - [src/app/portal/order/page.tsx](../../src/app/portal/order/page.tsx) `428 行`
    - [src/app/portal/return/page.tsx](../../src/app/portal/return/page.tsx) `361 行`
    - [src/app/staff/inhouse/page.tsx](../../src/app/staff/inhouse/page.tsx) `277 行`
    - [src/app/admin/permissions/page.tsx](../../src/app/admin/permissions/page.tsx) `236 行`
    - [src/app/admin/sales/page.tsx](../../src/app/admin/sales/page.tsx) `235 行`
    - [src/app/staff/inspection/page.tsx](../../src/app/staff/inspection/page.tsx) `413 行`
    - [src/app/staff/repair/page.tsx](../../src/app/staff/repair/page.tsx) `329 行`

- repository (`src/lib/firebase/repositories/*`) は **読み取りはほぼ揃っている**、**書き込みは未着手**。
  - 実装済 read: `tanksRepository.getTank/getTanks` `logsRepository.getActiveLogs/getActiveLogsByStaffId/getActiveLogsByCustomerId/getActiveLogsByTank/getLogsByRoot` `transactionsRepository.getOrders/getReturns/getPendingTransactions/findPendingLinksByUid`。
  - 未実装（throw "not implemented"）の skeleton: `tanks.listenTanks/getTanksByIds/updateTankFields*`、`logs.getLog/getLogsByTank/getLatestActiveLogForTank/getLogsByAction/getLogsInRange/listen*`、`transactions.createTransaction/updateTransaction/getTransaction/getUnchargedReports/listenOrders/listenReturnApprovals/markOrderApproved/markOrderCompletedInBatch`。

- service / operation 境界に位置する関数:
  - tank 状態遷移: `applyTankOperation` / `applyBulkTankOperations` / `appendTankOperation` / `applyLogCorrection` / `voidLog` ([src/lib/tank-operation.ts](../../src/lib/tank-operation.ts))
  - tank 登録・購入: `submitTankEntryBatch` ([src/features/procurement/lib/submitTankEntryBatch.ts](../../src/features/procurement/lib/submitTankEntryBatch.ts))
  - 資材発注: `submitSupplyOrder` ([src/lib/firebase/supply-order.ts](../../src/lib/firebase/supply-order.ts))
  - 管理マスタ更新: `saveAdminMoneySettings` / `saveAdminNotificationSettings` ([src/lib/firebase/admin-money-settings.ts](../../src/lib/firebase/admin-money-settings.ts), [admin-notification-settings.ts](../../src/lib/firebase/admin-notification-settings.ts))
  - identity helper: `staff-auth.ts` (`findActiveStaffByEmail` / `findStaffProfileByEmailReadOnly` / `setStaffAuthMirrorInBatch`) と `customer-user.ts` (`ensureCustomerUser` / `saveCustomerPortalSession`)。

- 識別子の正本化は、tank operation / logs では到達済み。残課題は portal transaction と transaction 承認 actor の境界。
  - `tank-operation.ts` の log 書き込みは `OperationContext` を必須化済み。`logs.staffId` / `logs.customerId` を top-level で書く形に到達済み（[docs/identity-and-operation-logging-design.md](../identity-and-operation-logging-design.md) に準拠）。
  - 受注完了 / 返却承認の **transactions 直接 update** は `approvedByStaffId` / `fulfilledByStaffId` 系を併記済み。ただし旧 `approvedBy` / `fulfilledBy`（名前文字列）も残っているため、service 抽出後に読み手確認をして別 PR で停止する。
  - portal の transaction 書き込みは `customerId` に `session.uid` を混ぜる余地があり、identity helper を通っていない。移行後は `customerId` fallback を廃止し、`customerUserUid` / `customerId` / `customerName` の意味を service 境界で固定する。

---

## 1. page.tsx の責務

> 「page.tsx は薄い殻にする」が SITEMAP.md §9 にも書かれた既存の設計軸。本節は **どの page がそれを破っているか** を、責務ごとにマトリクス化する。

### 1.1 page.tsx 責務マトリクス

凡例:
- 🟢 = 責務を持たない（理想形）
- 🟠 = 部分的に持つ
- 🔴 = まるごと page に貼り付いている
- ✖ = ページとして該当しない

| ページ | 行数 | Firestore I/O 直書き | 集計・判断 | 状態遷移 / ログ書込 | 複数コレクション同時更新 |
|---|---:|:---:|:---:|:---:|:---:|
| [admin/page.tsx](../../src/app/admin/page.tsx) | 132 | 🟢 (repository 経由) | 🟠 (本日件数 / unique staff 集計) | ✖ | ✖ |
| [admin/customers/page.tsx](../../src/app/admin/customers/page.tsx) | 637 | 🔴 (`addDoc/updateDoc` 直書き) | 🟠 (重複名チェック) | ✖ | ✖ |
| [admin/settings/page.tsx](../../src/app/admin/settings/page.tsx) | 1070 | 🔴 (`writeBatch` 3 本 + `setDoc` 2 本) | 🔴 (status 派生 / 重複 email チェック / `assertNotChangedSinceLoad`) | ✖ | 🔴 (`staff` + `staffByEmail` mirror, `customerUsers` + `transactions`) |
| [admin/permissions/page.tsx](../../src/app/admin/permissions/page.tsx) | 236 | 🔴 (`setDoc` 直書き) | 🟠 (デフォルト pages 構築) | ✖ | ✖ |
| [admin/money/page.tsx](../../src/app/admin/money/page.tsx) | 162 | 🟢 (`saveAdminMoneySettings` 経由) | 🟠 (rank ソート / dirty 管理) | ✖ | ✖ |
| [admin/notifications/page.tsx](../../src/app/admin/notifications/page.tsx) | 211 | 🟢 (`saveAdminNotificationSettings` 経由) | 🟠 (dirty / deleted ID 管理) | ✖ | ✖ |
| [admin/sales/page.tsx](../../src/app/admin/sales/page.tsx) | 235 | 🟠 (`monthly_stats` を直 query) | 🔴 (action 判定→日次集計、前日比) | ✖ | ✖ |
| [admin/billing/page.tsx](../../src/app/admin/billing/page.tsx) | 109 | 🟠 (`customers` を直 fetch) | 🔴 (顧客名 → 単価マップ + 月絞り + 合計) | ✖ | ✖ |
| [admin/staff-analytics/page.tsx](../../src/app/admin/staff-analytics/page.tsx) | 73 | 🟢 (`logsRepository.getActiveLogs()`) | 🔴 (action 判定で staff 別集計) | ✖ | ✖ |
| [portal/page.tsx](../../src/app/portal/page.tsx) | 171 | 🟢 (repository 経由) | 🟠 (location 一致で貸出中件数) | ✖ | ✖ |
| [portal/order/page.tsx](../../src/app/portal/order/page.tsx) | 428 | 🔴 (`addDoc(transactions)`) | 🟠 (cart 集計、deliveryType 判定) | ✖ | ✖ |
| [portal/return/page.tsx](../../src/app/portal/return/page.tsx) | 361 | 🔴 (`addDoc(transactions)` / `getDoc(settings/portal)`) | 🔴 (auto-return 時刻判定 + キーで重複防止 + condition→type 変換) | ✖ | ✖ |
| [portal/unfilled/page.tsx](../../src/app/portal/unfilled/page.tsx) | 502 | 🔴 (`addDoc(transactions)`) | 🔴 (lent 一覧から prefix 抽出 / 既追加チェック) | ✖ | ✖ |
| [portal/setup/page.tsx](../../src/app/portal/setup/page.tsx) | 233 | 🔴 (`updateDoc(customerUsers)`) | 🟠 (setupCompleted 派生) | ✖ | ✖ |
| [portal/login/page.tsx](../../src/app/portal/login/page.tsx) | 239 | 🟢 (`ensureCustomerUser` / `saveCustomerPortalSession`) | 🟠 (status 判定で分岐) | ✖ | ✖ |
| [portal/register/page.tsx](../../src/app/portal/register/page.tsx) | 233 | 🟢 (同上) | 🟠 (パスワード確認) | ✖ | ✖ |
| [staff/page.tsx](../../src/app/staff/page.tsx) | 16 | 🟢 | 🟢 | ✖ | ✖ |
| [staff/lend, return, fill/page.tsx](../../src/app/staff/lend/page.tsx) | 7 / 7 / 7 | 🟢 | 🟢 | ✖ | ✖ |
| [staff/tank-purchase, tank-register/page.tsx](../../src/app/staff/tank-purchase/page.tsx) | 7 / 7 | 🟢 | 🟢 | ✖ | ✖ |
| [staff/inhouse/page.tsx](../../src/app/staff/inhouse/page.tsx) | 277 | 🔴 (`writeBatch` で `tanks.logNote` を直更新) | 🟠 (logNote → tag 派生 + 楽観更新) | 🟠 (`applyTankOperation` 自体は呼ぶ。未承認 `IN_HOUSE_USE_RETRO` を直叩き) | 🟠 (tank 単発 update はある) |
| [staff/damage/page.tsx](../../src/app/staff/damage/page.tsx) | 179 | 🟢 | 🟠 (queue 管理) | 🟢 (`applyBulkTankOperations` 経由) | 🟢 |
| [staff/repair/page.tsx](../../src/app/staff/repair/page.tsx) | 329 | 🟢 | 🟠 (DAMAGED/DEFECTIVE filter) | 🟢 | 🟢 |
| [staff/inspection/page.tsx](../../src/app/staff/inspection/page.tsx) | 413 | 🟢 | 🔴 (期限判定 / nextMaintenanceDate を YMD 文字列で組み立て / tankExtra 注入) | 🟢 | 🟢 |
| [staff/mypage/page.tsx](../../src/app/staff/mypage/page.tsx) | 177 | 🟢 (`getActiveLogsByStaffId`) | 🔴 (action 文字列で lend/return/fill 集計) | ✖ | ✖ |
| [staff/dashboard/page.tsx](../../src/app/staff/dashboard/page.tsx) | 1451 | 🔴 (`customers` を直 fetch) | 🔴 (status 集計 / 場所別 / 本日集計 / 編集権判定 / bulk option 構築) | 🔴 (`applyLogCorrection` / `voidLog` を直 orchestrate、bulk loop 含む) | ✖ |
| [staff/supply-order/page.tsx](../../src/app/staff/supply-order/page.tsx) | 184 | 🟠 (`orderMaster` を直 fetch) | 🟠 (cart 集計) | 🟢 (`submitSupplyOrder` 経由) | 🟢 |

### 1.2 page.tsx から hook / service へ移すべき塊

優先度の高い順。

1. **dashboard の集計ロジックと bulk correction オーケストレーション**
   - 場所: [src/app/staff/dashboard/page.tsx](../../src/app/staff/dashboard/page.tsx) `140-475`
   - 問題: 「ログの取得」「customers の取得」「集計」「編集モード state」「単件 / 一括 correction の orchestration」が全部 page に張り付いている。
   - 移行先案:
     - data: `useDashboardLogs(...)` (hook) → `dashboardService.getDashboardSnapshot()` (service) → `logsRepository.getActiveLogs` + `customersRepository.getActiveCustomerSnapshots`（後者は新設）
     - operation: `dashboardCorrectionService.bulkChangeLocation()` / `bulkVoidLogs()` を新設し、page 側は loop しない（service 内で `applyLogCorrection` を順次呼ぶ）
     - 「編集権判定 (`canModifyLog`)」「`StaffCorrectionRole` 正規化」は `tank-operation.ts` か新 `lib/log-correction-policy.ts` に寄せる

2. **portal 系 transaction 作成（order / return / unfilled）**
   - 場所:
     - [src/app/portal/order/page.tsx](../../src/app/portal/order/page.tsx) `60-86`
     - [src/app/portal/return/page.tsx](../../src/app/portal/return/page.tsx) `106-137`
     - [src/app/portal/unfilled/page.tsx](../../src/app/portal/unfilled/page.tsx) `103-128`
   - 問題:
     - 全ての portal page が `addDoc(transactions)` を直叩きしていて、`customerId` 解決ロジック (`session.customerId || session.uid`) が page ごとに散らばる。
     - identity helper (`getCustomerPortalIdentity` 相当) が未実装。
     - `customerSession.uid` を `customerId` の fallback として書いてしまう余地がある（identity-and-operation-logging-design §11 / §19 で問題視されている）。
   - 移行先案:
     - `lib/portal/portalIdentity.ts` … `getCustomerPortalIdentity()` / `requireCustomerPortalIdentity()`
     - `lib/portal/portalTransactionService.ts` … `createOrderTransaction(input)` / `createReturnTransaction(input)` / `createUnchargedReportTransaction(input)`
     - page 側は input オブジェクトを組み立てて service を呼ぶだけにする
     - `customerId` が未確定の利用者は `createdByUid = customerUserUid` と `pending_link` で扱い、`customerId` に uid fallback を保存しない
     - 自動返却の時刻判定 (`portal/return/page.tsx` `83-100`) は `usePortalAutoReturn(session)` に切り出す

3. **admin/settings の staff / customerUsers 同時更新**
   - 場所: [src/app/admin/settings/page.tsx](../../src/app/admin/settings/page.tsx) `237-460` (`saveStaff` / `saveCustomerUsers`)
   - 問題: 1 ページで以下を全部やっている。
     - `staff` の重複 email チェック
     - `staffByEmail` mirror の作成・削除
     - `customerUsers` の status 派生（identity-and-operation-logging-design §17 の方針との整合）
     - `customers` map から `customerName` を解決して `transactions.customerId` 紐付け
     - `linkedByStaff*` の actor 解決 (`resolveAdminOperationActor`)
     - `findPendingLinksByUid` の二次 read
   - 移行先案:
     - `lib/admin/staffSyncService.ts` … `saveStaffMembers({ staffList })` で `staff` + `staffByEmail` の同期更新を完結
     - `lib/admin/customerLinkingService.ts` … `linkCustomerUsersToCustomers({ assignments })` で `customerUsers` と pending `transactions` の `customerId` 整合を確定
     - admin actor 解決は `lib/admin/adminActor.ts` に独立させ、両 service で共有
   - 注意: ここは「管理画面接続」優先順位 §4「`staff` / `staffByEmail` 更新の service 境界」直撃なので、重要度高い。

4. **portal/setup の `customerUsers` 直接更新**
   - 場所: [src/app/portal/setup/page.tsx](../../src/app/portal/setup/page.tsx) `80-95`
   - 移行先案: `customer-user.ts` または `lib/portal/customerUserService.ts` の `completePortalSetup({ uid, profile })` に寄せる。`portal/setup` からは `customerId` / `customerName` / `disabled` を保存しない方針を維持し、`computeCustomerUserStatus` も service 側に隠す。

5. **inhouse / bulk-return の `tanks.logNote` 直更新**
   - 場所:
     - [src/app/staff/inhouse/page.tsx](../../src/app/staff/inhouse/page.tsx) `68-86`
     - [src/features/staff-operations/hooks/useBulkReturnByLocation.ts](../../src/features/staff-operations/hooks/useBulkReturnByLocation.ts) `65-81`
   - 問題: tag 表示用の `logNote` フィールドだけを `writeBatch().update()` で書き替えている。`tank-operation.ts` を介さない **状態遷移を伴わない属性更新**。
   - 移行先案: `tanksRepository.updateTankFields()` (現状 not-implemented) に寄せて、「state 遷移無しの tank field patch」として正式に許可する。allow list は `note / type / nextMaintenanceDate / logNote` まで。
   - もしくは `lib/tank-tag-service.ts` に閉じる（`logNote` は tag 表現に縛る）。

6. **admin/sales / admin/billing / admin/staff-analytics の集計**
   - 場所:
     - [src/app/admin/sales/page.tsx](../../src/app/admin/sales/page.tsx) `24-60`
     - [src/app/admin/billing/page.tsx](../../src/app/admin/billing/page.tsx) `19-55`
     - [src/app/admin/staff-analytics/page.tsx](../../src/app/admin/staff-analytics/page.tsx) `13-32`
   - 問題: action 文字列 (`貸出` / `返却` / `充填`) で if 判定する集計が複数 page に散らばる。同じ集計仕様の **意味の正本** が複数ある。
   - 移行先案: `lib/analytics/` に
     - `aggregateLogsByDay(logs)`
     - `aggregateLogsByCustomer(logs, priceMap)`
     - `aggregateLogsByStaffId(logs)`
     を切り出し、page は呼ぶだけ。`billing-rules.ts` / `incentive-rules.ts` 既存ファイルとの責務すり合わせも要件。

7. **staff/inspection の nextMaintenanceDate 算出**
   - 場所: [src/app/staff/inspection/page.tsx](../../src/app/staff/inspection/page.tsx) `101-126`
   - 問題: `formatDateYMD(today + validityYears 年)` を page で組み立て、`tankExtra` で `applyBulkTankOperations` に渡している。inspection の業務不変条件が page に漏れている。
   - 移行先案: `lib/maintenance/inspectionService.ts` の `completeInspectionsBatch({ tankIds, settings, actor })` に寄せ、page は集計済みの選択 ID を渡すだけにする。

---

## 2. feature 境界

> 「業務フロー単位の塊は `src/features/<feature-name>/` に閉じる」が CLAUDE.md の方針。本節は **現状の features と、本来別 feature にすべきもの** を整理する。

### 2.1 現状の features

| feature | 現状の構成 | 評価 |
|---|---|---|
| `features/staff-operations/` | `OperationsTerminal` + 6 components + 5 hooks + types/constants | 強い feature。貸出 / 返却 / 充填 / 受注 / 返却承認 / 一括返却を 1 feature に押し込んでいる |
| `features/maintenance/` | `useMaintenanceSwipe` + `constants.ts` のみ。3 つの page (damage/repair/inspection) は `src/app/staff/{damage,repair,inspection}/page.tsx` に散在 | feature ディレクトリだけある「殻」状態 |
| `features/procurement/` | `TankEntryScreen` + `useProcurementSwipe` + `submitTankEntryBatch` + `constants` | 比較的まとまっている。supply-order だけ別 (`lib/firebase/supply-order.ts`) |

### 2.2 提案する feature 単位

| feature | 含めるもの | 該当 page |
|---|---|---|
| `staff-operations` | `OperationsTerminal` + 手動/受注/返却承認/一括返却 (現状維持) | `/staff/lend` `/staff/return` `/staff/fill` |
| `maintenance` | `damage` / `repair` / `inspection` の 3 画面ロジック・hook・service。tag 更新 service もここ | `/staff/damage` `/staff/repair` `/staff/inspection` |
| `inhouse-operations` | `inhouse` 画面の事後報告 + 一括返却。`useInHouseTanks` hook を分離 | `/staff/inhouse` |
| `procurement` | `tank-purchase` `tank-register` `supply-order` (新規) | `/staff/tank-purchase` `/staff/tank-register` `/staff/supply-order` |
| `staff-mypage` | mypage の集計 hook と表示 | `/staff/mypage` |
| `staff-dashboard` | dashboard の集計、編集モード state、log correction orchestration | `/staff/dashboard` |
| `portal` | portal home + 各 transaction フロー (order/return/unfilled) + setup ロジック | `/portal/**` |
| `admin/customers` | 顧客マスタ CRUD + service | `/admin/customers` |
| `admin/settings` | 担当者・ポータル利用者・発注品目・ポータル時刻・耐圧設定 | `/admin/settings` |
| `admin/permissions` | settings/adminPermissions 編集 | `/admin/permissions` |
| `admin/money` | 単価 / ランク | `/admin/money` |
| `admin/notifications` | email / LINE | `/admin/notifications` |
| `analytics` | sales / billing / staff-analytics の集計仕様 | `/admin/sales` `/admin/billing` `/admin/staff-analytics` |
| `billing` | 請求計算（`billing-rules.ts` 統合先） | `/admin/billing` |

> `analytics` と `billing` を分けるかは未決。billing は「金額」、analytics は「件数」と切るなら別 feature。`billing-rules.ts` がほぼ未使用なら `analytics/billing-rules.ts` に統合する選択肢もある。

### 2.3 feature の内部規約案

- `features/<feature>/`
  - `components/` … feature 専用のコンポーネント
  - `hooks/` … UI state hook + workflow hook
  - `services/` … Firestore I/O + 業務不変条件（後述「§4 service 境界」を参照）
  - `repositories/` （任意） … 集計用の query helper
  - `types.ts`
  - `constants.ts`

`features/<feature>/index.ts` で公開 API を 1 箇所にまとめると、page から `import { X } from '@/features/foo'` の単線で済む。

---

## 3. hook 境界

### 3.1 hook の分類

| 種別 | 役割 | 例 |
|---|---|---|
| **session / identity hook** | localStorage / Firebase Auth から現在の操作者を取り出す | `useStaffSession` `useStaffIdentity` `useStaffProfile` `getStaffIdentity` `requireStaffIdentity` |
| **data fetching hook** | repository を呼んで state にキャッシュ | `useTanks` `useInspectionSettings` `usePendingOrderCount` `useDestinations`（現状名） |
| **UI state hook** | ローカルな入力値や選択状態を抱える | `useOperationSwipe` `useMaintenanceSwipe` `useProcurementSwipe` |
| **workflow hook** | 入力 + 検証 + service 呼び出し + UI フィードバック | `useManualTankOperation` `useOrderFulfillment` `useReturnApprovals` `useBulkReturnByLocation` |

### 3.2 混ざっている箇所

- **`useManualTankOperation`** ([src/features/staff-operations/hooks/useManualTankOperation.ts](../../src/features/staff-operations/hooks/useManualTankOperation.ts))
  - workflow hook だが、内部で **`requireStaffIdentity` を直接呼んで** identity を組み立て、`applyBulkTankOperations` に渡している。
  - 「identity の取得」は session / identity hook の責務に分けるべき。`useStaffIdentity()` を引数に受け、hook 内では identity を直接読まない方が、テスト性・置換性が上がる。

- **`useOrderFulfillment`** ([src/features/staff-operations/hooks/useOrderFulfillment.ts](../../src/features/staff-operations/hooks/useOrderFulfillment.ts))
  - 受注承認 (`approveOrder`) と受注貸出完了 (`fulfillOrder`) の **2 つの業務操作** が同じ hook に同居。
  - workflow としてはどちらも「受注フロー」だが、書き込み先が違う:
    - approve: `transactions.update` のみ
    - fulfill: `applyBulkTankOperations` + `transactions.update` (batch participate)
  - 内部で `updateDoc(doc(db, "transactions", order.id), ...)` を直接書いている → service 化が必要。

- **`useReturnApprovals`** ([src/features/staff-operations/hooks/useReturnApprovals.ts](../../src/features/staff-operations/hooks/useReturnApprovals.ts))
  - `tanksRepository.getTank` で「承認直前の現状取得」を hook 内で行っている。これは workflow の正しい挙動だが、**順次 await + 承認直前 read + bulk write** という業務シーケンスは service に閉じた方が読みやすい。
  - 加えて `transactions.update` を batch participate で書いている。fulfillment と同じ構造。

- **`useBulkReturnByLocation`** ([src/features/staff-operations/hooks/useBulkReturnByLocation.ts](../../src/features/staff-operations/hooks/useBulkReturnByLocation.ts))
  - データ取得 + tag 更新 (`updateTag`) + 一括返却 (`handleBulkReturnForLocation`) の 3 つを 1 hook にまとめている。tag 更新は **「状態遷移を伴わない `tanks.logNote` 直更新」** であり、データ取得とは性質が違う。
  - 分割案:
    - `useBulkReturnByLocationData()` … 取得 + grouping
    - `tankTagService.updateTag(tankId, tag)` … 単発書き込み
    - `bulkReturnService.returnByLocation({ location, tanks, actor })` … 一括返却

- **`useDestinations`** ([src/features/staff-operations/hooks/useDestinations.ts](../../src/features/staff-operations/hooks/useDestinations.ts))
  - 名前が紛らわしい（`destinations` コレクションは廃止済み）。実体は **customers の active 一覧** を返している。
  - リネーム + 「customers の取得」は repository に降ろし、選択 state だけ hook に残す。

- **page 内に紛れた hook 化されていない fetch ロジック**
  - `useEffect` 内で直接 `getDocs` / `getDoc` を叩いているもの:
    - `customers`: dashboard, billing, settings, customers
    - `orderMaster`: supply-order, settings, TankEntryScreen
    - `settings`: permissions, admin/settings, portal/return
    - `priceMaster` / `rankMaster`: money
    - `notifySettings` / `lineConfigs`: notifications
    - `monthly_stats`: sales
  - これらは「data fetching hook + repository」に分離するのが最低ライン。

### 3.3 推奨追加 hook

- `useStaffIdentity()` …（既に存在）。workflow hook はこれを props/引数で受ける形に統一。
- `useCustomerPortalIdentity()` … `customerSession` から `customerUserUid` / `customerId` / `customerName` を取り出す。`customerId` が無い場合に uid で代替しない。
- `useDashboardSnapshot()` … dashboard 用の集計済みスナップショット (logs / customers / summary)。
- `useCustomerOptions()` … customers の active 一覧 + `CustomerSnapshot[]` 化（dashboard / staff-operations / settings から呼ぶ共通化）。
- `useAutoReturnSettings()` … `settings/portal` の `autoReturnHour` / `autoReturnMinute` を購読し、portal/return から `getDoc` を消す（既存 `useInspectionSettings` と同じパターン）。

---

## 4. service / operation 境界

### 4.1 既存の service 群

| ファイル | 役割 | 評価 |
|---|---|---|
| [src/lib/tank-operation.ts](../../src/lib/tank-operation.ts) | tank 状態遷移 + log 書き込みの正本 | 完成度高い。`OperationContext` 必須化済み |
| [src/lib/firebase/staff-auth.ts](../../src/lib/firebase/staff-auth.ts) | staff / staffByEmail 同期 helper | service と repository が混ざっている (read-only 関数 + batch helper + 自動 mirror 修復) |
| [src/lib/firebase/customer-user.ts](../../src/lib/firebase/customer-user.ts) | portal 認証 + customerUser 作成 / 更新 | identity helper と service の中間 |
| [src/lib/firebase/supply-order.ts](../../src/lib/firebase/supply-order.ts) | 資材発注 (orders + logs を batch) | 単機能 service。`OperationActor` を受け取る正しい形 |
| [src/features/procurement/lib/submitTankEntryBatch.ts](../../src/features/procurement/lib/submitTankEntryBatch.ts) | tank 購入 / 登録 (`tanks` + `tankProcurements` + `logs` を transaction) | 単機能 service。`tank-operation.ts` の API を通っていないが、**新規登録は `appendTankOperation` の対象外** なので別経路で正しい |
| [src/lib/firebase/admin-money-settings.ts](../../src/lib/firebase/admin-money-settings.ts) | priceMaster / rankMaster の差分保存 | service。dirty / deleted を呼び出し側から渡す形 |
| [src/lib/firebase/admin-notification-settings.ts](../../src/lib/firebase/admin-notification-settings.ts) | notifySettings + lineConfigs の差分保存 | 同上 |

### 4.2 不足している service / operation

- **portal transaction service**
  - `createOrderTransaction(input)` / `createReturnTransaction(input)` / `createUnchargedReportTransaction(input)`
  - identity 解決と createdAt の付与、`pending_link` 判定（`customerUsers` 紐付け前は `createdByUid = customerUserUid` で保持し、`customerId` には uid fallback を書かない）。
  - 現状 page が直 `addDoc` しており、3 ページで 3 通りの `createdByUid` fallback を持っている。移行後は fallback を 1 箇所に集約するのではなく、identity 不足時の停止 / `pending_link` 化を service の契約にする。

- **transaction approval / fulfillment service**
  - `approveOrderTransaction(orderId, actor)` … 受注承認だけ
  - `fulfillOrderTransaction({ order, scannedTanks, actor })` … 受注貸出完了 (tank + transaction)
  - `fulfillReturnGroup({ returnGroup, approvals, actor })` … 返却承認完了
  - これらは **どれも tank-operation の batch participate と transactions.update を組み合わせる** という同じパターン。共通の `executeApprovalWithTankOperations()` を service 層に置けば、approver の identity field (`approvedByStaffId/Name/Email`) を 1 箇所で正規化できる。

- **log correction orchestration service**
  - dashboard の bulk 操作（`bulkLocationChange` / `bulkVoid`）は現状 page で `for (const log of selectedLogs) { await applyLogCorrection(...) }` のループ。
  - service 化して、失敗ログの集約・進捗報告 (callback) を一元化する。`applyLogCorrection` 自体は維持。

- **inhouse / inspection / repair の operation service**
  - 現状 page から `applyTankOperation` / `applyBulkTankOperations` を直叩き。これは「業務不変条件」（例: inspection の `nextMaintenanceDate = today + N年` は **inspection 固有のルール**）が page に漏れる原因。
  - 提案:
    - `inhouseOperationService.reportInHouseUseRetro({ tankId, actor })`
    - `inhouseOperationService.bulkReturnInHouse({ tanks, actor })`
    - `repairOperationService.completeRepair({ tanks, actor })`
    - `inspectionOperationService.completeInspection({ tanks, settings, actor })`
    - 中で `applyBulkTankOperations` を呼ぶ。`tankExtra` の組み立てや次回期限計算は service に閉じる。

- **customers service**
  - 現状 admin/customers/page.tsx が `addDoc` / `updateDoc` を直叩き。
  - 提案: `customersRepository`（read）と `customersService`（write）を新設。
    - `customersRepository.getCustomers({ activeOnly })`
    - `customersService.createCustomer(input)` / `updateCustomer(id, patch)` / `setCustomerActive(id, isActive)`
    - 重複名チェックは service に閉じる。

- **adminPermissions service**
  - 現状 admin/permissions/page.tsx が `setDoc` を直叩き。
  - 提案: `adminPermissionsService.getPermissions()` / `savePermissions(pages)`。`AdminAuthGuard` 側の `getDoc(doc(db, "settings", "adminPermissions"))` も同じ service に寄せる。

### 4.3 service と repository の責務分離（再確認）

設計書 [docs/identity-and-operation-logging-design.md §4](../identity-and-operation-logging-design.md) の方針を再確認する。

| 層 | 持ってよいもの | 持ってはいけないもの |
|---|---|---|
| **page** | UI と form state、navigation | Firestore SDK、業務判断、複数コレクション同時更新、識別子フォールバック |
| **hook (UI state)** | ローカル state、入力 validation、楽観更新 | Firestore SDK、識別子解決 |
| **hook (workflow)** | input 検証、service 呼び出し、結果 → UI 状態反映 | identity の決定（受け取る側）、transaction batch の組立て |
| **service / operation** | 業務不変条件、複数コレクション同時更新、identity 必須化、`runTransaction` / `writeBatch` 配線 | 画面都合の確認ダイアログ文言、ローカル state |
| **repository** | Firestore query / write の I/O、ドキュメント正規化 | session 解決、staff 推定、業務判断、重複・整合チェック |

---

## 5. repository 境界

### 5.1 現状

- `tanksRepository`: `getTank` / `getTanks` のみ実装。`updateTankFields` / `updateTankFieldsInBatch` / `getTanksByIds` / `listenTanks` は throw 状態。
- `logsRepository`: read 系 (`getActiveLogs` / `getActiveLogsByStaffId` / `getActiveLogsByCustomerId` / `getActiveLogsByTank` / `getLogsByRoot`) は実装済。「**書き込みは絶対に持たない**」というコメントが既に書かれていて、`tank-operation.ts` 経由を強制する設計になっている。
- `transactionsRepository`: `getOrders` / `getReturns` / `getPendingTransactions` / `findPendingLinksByUid` のみ実装。`createTransaction` / `updateTransaction` / `markOrderApproved` / `markOrderCompletedInBatch` は throw 状態（=service 境界をどこに置くかは未決）。

### 5.2 不足する repository（読み取り）

| repository | 関数 | 主な利用元 |
|---|---|---|
| `customersRepository` | `getCustomers({ activeOnly })` / `getCustomer(id)` / `getCustomerSnapshots()` | dashboard, billing, settings, useDestinations, OperationsTerminal |
| `customerUsersRepository` | `getCustomerUser(uid)` / `listCustomerUsers()` / `findCustomerUsersByCustomerId(customerId)` | portal/setup, admin/settings, ensureCustomerUser 内部 |
| `staffRepository` | `getStaffMember(id)` / `listStaff({ activeOnly })` | admin/settings (現状 `getDocs(collection(db, "staff"))` 直叩き) |
| `settingsRepository` | `getPortalSettings()` / `getInspectionSettings()` / `getAdminPermissions()` | useInspectionSettings, AdminAuthGuard, portal/return, admin/settings |
| `orderMasterRepository` | `listOrderItems({ category })` | TankEntryScreen (現状直叩き), supply-order page |
| `priceMasterRepository` / `rankMasterRepository` | `list()` | admin/money (現状直叩き) |
| `notifySettingsRepository` / `lineConfigsRepository` | 同 | admin/notifications (現状直叩き) |

### 5.3 repository に入れてはいけない業務判断

設計書 §12 にある通り、repository は I/O に徹する。

- ❌ identity 推定 (`getStaffName()` 相当を内部で呼ばない)
- ❌ session 読み取り
- ❌ status の派生 (`computeCustomerUserStatus` のような業務判断ロジックは service 側)
- ❌ 重複チェック・差分計算 (`hasFieldChanges` / `assertNotChangedSinceLoad` は service の責務)
- ❌ 「pending → pending_approval」のような業務遷移
- ✅ ドキュメントの素直な型変換 (`toLogDoc` のような正規化) は OK

### 5.4 書き込み repository の最小設計案

「書き込み系も全部 repository に通す」のではなく、**「業務不変条件を伴わない単純 update だけ repository に持たせる」** という設計が現状コメントとも整合する。

```
tanksRepository.updateTankFields(tankId, patch)         // logNote / note / type / nextMaintenanceDate のみ
tanksRepository.updateTankFieldsInBatch(writer, ...)    // batch 参加版

customersRepository.createCustomer(input)
customersRepository.updateCustomer(id, patch)
customersRepository.setCustomerActive(id, isActive)

settingsRepository.setPortalSettings(patch)             // settings/portal merge
settingsRepository.setInspectionSettings(patch)         // settings/inspection merge
settingsRepository.setAdminPermissions(pages)           // settings/adminPermissions overwrite
```

revision chain や同時更新は **必ず service で組み立てる**。

---

## 6. 画面間の依存・共通化

### 6.1 共通 hook

| hook | 利用箇所 |
|---|---|
| `useStaffSession` / `useStaffIdentity` / `useStaffProfile` | staff/* / admin/* で利用 |
| `useTanks` | `staff/inhouse` `staff/damage` `staff/repair` `staff/inspection` `staff/dashboard` `OperationsTerminal` `TankEntryScreen` |
| `useInspectionSettings` | `staff/inspection` のみ。**portal/return も `settings/portal` を直 read している** ので、設定取得 hook の統一余地あり |
| `usePendingOrderCount` | staff/layout のヘッダーバッジ。内部で `transactionsRepository.getOrders` を 3 status 並列実行 |
| `useMaintenanceSwipe` / `useOperationSwipe` / `useProcurementSwipe` | swipe ナビゲーションのみ。各 layout から独立 |

### 6.2 共通 component

| component | 利用箇所 |
|---|---|
| `AuthPanel`（unused?） | `src/components/AuthPanel.tsx` 存在するが `StaffAuthGuard` / `AdminAuthGuard` / portal は独自にフォームを書いている。実利用箇所の確認が必要 |
| `DrumRoll` / `TankIdInput` / `PrefixNumberPicker` / `QuickSelect` | staff の入力系で共有 |
| `MaintenanceTabs` | damage / repair / inspection |
| `ProcurementTabs` | tank-purchase / tank-register / supply-order |
| `StaffSectionTabs` (+ `staff-section-tabs-events.ts`) | OperationsTerminal の「手動 / 受注」切替を `CustomEvent` で伝達 |

### 6.3 共通 lib

| lib | 利用 |
|---|---|
| `tank-rules.ts` | OperationsTerminal hooks / inhouse / damage / repair / inspection / dashboard / portal/return / portal/unfilled |
| `tank-operation.ts` | OperationsTerminal hooks / inhouse / damage / repair / inspection / dashboard |
| `tank-trace.ts` | （未利用？ コード上は調査用 helper として存在するが import 元を確認していない） |
| `order-types.ts` | useOrderFulfillment + transactionsRepository.getOrders 内部 |
| `operation-context.ts` | tank-operation.ts / staff-auth.ts / supply-order.ts / dashboard / OperationsTerminal hooks |
| `firebase/diff-write.ts` | admin-money-settings / admin-notification-settings / admin/settings / admin/money / admin/notifications |
| `firebase/customer-user.ts` | portal/login / portal/register / portal/setup / portal/layout / admin/settings |
| `firebase/staff-auth.ts` | StaffAuthGuard / AdminAuthGuard / admin/settings / useStaffProfile |

### 6.4 ゾーン横断の暗黙依存

- **`localStorage.staffSession`**: StaffAuthGuard と AdminAuthGuard の **両方** が書き込む。dev-auth bypass も書く。読み手は `useStaffSession` と直接 `localStorage.getItem("staffSession")` の両方。
  - リスク: format が変わると 2 ガード + dev-auth + 全 hook を同期更新する必要。
  - 対策: `lib/auth/staffSessionStore.ts` に CRUD を集約し、format バリデーションを 1 箇所にする。

- **`localStorage.customerSession`**: portal/layout / portal/login / portal/register / portal/setup / portal/page / portal/order / portal/return / portal/unfilled が読み書き。
  - 構造: `{ uid, customerUserUid, customerId, customerName, name, selfCompanyName, selfName, lineName, status }`
  - portal page 群は `session.uid || session.customerId` の **fallback パスが page ごとに微妙に違う**（identity-and-operation-logging-design §11 / §19 で議論されている問題そのもの）。移行後は `customerId` に uid を代入せず、未紐付け状態は `pending_link` と `createdByUid` で表す。

- **`window.dispatchEvent(new Event("staffLogin"))`**: 認証完了時の通知。listen 側は確認していない（おそらく usePendingOrderCount などの再 fetch トリガ）。
  - リスク: イベント名の変更が漏れる。
  - 対策: 共通 EventBus or Context に切り替える検討余地。

- **`window.dispatchEvent(new CustomEvent("opStyleChange"))`**: staff/layout → OperationsTerminal の片方向通知。
  - 既に SITEMAP に文書化されている。Context 化で良いが、現行は薄い殻 page の独立性を守る目的で window event を使っている。

- **dev-auth bypass**: `NEXT_PUBLIC_DEV_AUTH_BYPASS=true` のとき StaffAuthGuard / AdminAuthGuard が `DEV_STAFF_SESSION` を localStorage に書く。`dashboard` の correction で actor を必須化済みのため、`dev-staff` という staffId が **本物の staff ドキュメントと衝突しない値** であることを保証する仕掛けが必要（identity-and-operation-logging-design §19 で要確認とされている事項）。

---

## 7. 結論（このドキュメントの位置付け）

- 移行は「page → hook / service / repository」を全 page で同時に進める必要はない。
- 優先度は **「Firestore 直書きが多い page」** から。
- 具体的な順序・分割粒度は [refactor-roadmap.md](./refactor-roadmap.md) に分離する。
- Firestore 書き込みごとの individual な移行先は [firestore-write-boundary-audit.md](./firestore-write-boundary-audit.md) に分離する。
