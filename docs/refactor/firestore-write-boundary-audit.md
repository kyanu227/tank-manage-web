# Firestore 書き込み境界 監査

調査日: 2026-05-02
範囲: `src/**` 配下の `addDoc` / `setDoc` / `updateDoc` / `writeBatch` / `runTransaction` / `deleteDoc` 全件

> 旧 schema 互換、legacy fallback、backfill は考慮しない。既存コードに残る fallback は撤去対象として扱い、移行後の前提にはしない。
> 詳細な責務分担の議論は [page-feature-boundary-audit.md](./page-feature-boundary-audit.md)、移行手順は [refactor-roadmap.md](./refactor-roadmap.md) を参照。

---

## 0. サマリ

- **Firestore 直接書き込みの呼び出し箇所**: `runTransaction` / `writeBatch` / `addDoc` / `setDoc` / `updateDoc` の入口で計 27 箇所（`import` 行を除く）。下のマトリクスは、`extraOps` 内の `batch.update` などレビュー上重要な書き込みも補助行として併記する。
- うち、page.tsx に張り付いている主な書き込み入口: admin/customers ×3、admin/permissions ×1、admin/settings ×5、portal/order ×1、portal/return ×1、portal/setup ×1、portal/unfilled ×1、staff/inhouse ×1。
  - ※ admin/settings の `writeBatch` 3 本は、`batch.set` `batch.update` `batch.delete` で内部に複数の書き込み操作を含む。
- service / lib に分離済みの主要書き込み: `tank-operation.ts`、`submitTankEntryBatch.ts`、`supply-order.ts`、`admin-money-settings.ts`、`admin-notification-settings.ts`。
- features hook 内に張り付いている書き込み: `useOrderFulfillment.ts`、`useReturnApprovals.ts`、`useBulkReturnByLocation.ts`。
- `customer-user.ts` の `ensureCustomerUser` は portal Auth の正規経路。`staff-auth.ts` 内の `setDoc` は read 経路からの自動 mirror 修復であり、service 境界として再検討対象。

---

## 1. 全件マトリクス

> 「業務操作」列は、その書き込みが「ユーザーから見て何をしているか」を 1 行で表す。
> 「移行先」列は、本ドキュメントが提案する **service / repository への配線**。
> 既に正しい階層にあるものは「現状維持」と記載する。

### 1.1 src/lib/tank-operation.ts （tank operation service の本体）

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 1 | 244 | `runTransaction` | `tanks` + `logs` | 単一タンクの状態遷移 + ログ作成 (`applyTankOperation`) | **現状維持**。設計書 §17 の方針通り、ここが書き込みの正本 |
| 2 | 273 | `runTransaction` | `tanks` + `logs` (+ extraOps) | 複数タンクの一括状態遷移 + ログ作成 + batch 参加 (`applyBulkTankOperations`) | **現状維持**。受注貸出 / 返却承認 / 一括返却の中核 |
| 3 | 375 | `runTransaction` | `logs` + `tanks` | 既存ログの編集 (revision chain) (`applyLogCorrection`) | **現状維持** |
| 4 | 507 | `runTransaction` | `logs` + `tanks` | ログの取消 (void) (`voidLog`) | **現状維持** |

→ 評価: **このファイルは触らない**。CLAUDE.md / AGENTS.md でも繰り返し「`tank-operation.ts` は明示指示なしに触らない」と禁則化されている。

---

### 1.2 src/features/procurement/lib/submitTankEntryBatch.ts

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 5 | 56 | `runTransaction` | `tanks` (新規) + `tankProcurements` + `logs` | タンク購入 / 登録 (新規 `tankId` 重複チェック → 一括 `set`) | **現状維持**。`tank-operation.ts` の対象外（既存 tank の遷移ではなく **新規作成**）。procurement service として正しく独立している |

---

### 1.3 src/lib/firebase/supply-order.ts

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 6 | 49 | `writeBatch` | `orders` + `logs` | 資材発注 (品目ごとに `orders` 追加 + サマリ `logs` 1 件) | **現状維持**。`OperationActor` を受け取る正しい service。ただし将来的に `features/procurement/lib/submitSupplyOrder.ts` に移して procurement feature にまとめても良い |

---

### 1.4 src/lib/firebase/admin-money-settings.ts

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 7 | 35 | `writeBatch` | `priceMaster` + `rankMaster` | 単価・ランクの差分保存（dirty / deleted を分離して update / delete） | **現状維持**。admin/money page から呼ばれる service として完成 |

---

### 1.5 src/lib/firebase/admin-notification-settings.ts

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 8 | 30 | `writeBatch` | `notifySettings/config` + `lineConfigs` | 通知設定（メール宛先 / アラート月数 / 有効年数 / LINE 設定）の差分保存 | **現状維持**。**ただし** `notifySettings/config` の `alertMonths` / `validityYears` と `settings/inspection` の同名 field が **責務重複** している。要整理（後述 §3） |

---

### 1.6 src/lib/firebase/customer-user.ts

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 9 | 62 | `setDoc` | `customerUsers/{uid}` | 新規 portal user の初期作成 (`ensureCustomerUser`) | **現状維持**。portal identity 解決の中核 |
| 10 | 80 | `setDoc(merge)` | `customerUsers/{uid}` | 既存 portal user の email/displayName/lastLoginAt 更新 | **現状維持** |

→ 評価: identity helper と service の中間にある。portal/setup の `updateDoc` (#16) と「portal user の更新」は責務重複しているので、`customer-user.ts` 側に `completePortalSetup({ uid, profile })` を追加して **portal user 書き込みを 1 ファイルに集約** すべき。

---

### 1.7 src/lib/firebase/staff-auth.ts

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 11 | 147 | `setDoc(merge)` | `staffByEmail/{key}` | mirror が無いまま staff lookup が成功した時の **自動修復書き込み** | **要再検討**。read 経路 (`findActiveStaffByEmail`) が write を含む。mirror 修復は `staffSyncService` の保存処理または明示的な rebuild API に寄せ、認証 lookup は read-only にする |

---

### 1.8 src/app/admin/customers/page.tsx — 顧客マスタ画面

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 12 | 197 | `addDoc` | `customers` | 新規顧客作成（重複名チェック後） | **`customersService.createCustomer(input)`** （新設） |
| 13 | 237 | `updateDoc` | `customers/{id}` | 既存顧客の編集保存（行ごとの save ボタン） | **`customersService.updateCustomer(id, patch)`** （新設） |
| 14 | 265 | `updateDoc` | `customers/{id}` | 顧客の active/inactive トグル | **`customersService.setCustomerActive(id, isActive)`** （新設） |

→ いずれも単純な field 更新だが、page にロジックが点在している。`customersRepository` (read) と `customersService` (write) を新設し、page は呼ぶだけにする。
→ 重複名チェック (`findDuplicateCustomerName`) も service に閉じる（service が UNIQUE 違反を例外で返す）。

---

### 1.9 src/app/admin/permissions/page.tsx

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 15 | 76 | `setDoc` (overwrite) | `settings/adminPermissions` | ページ権限の保存 (`pages: {path: roles[]}`) | **`adminPermissionsService.savePermissions(pages)`** （新設） |

→ `AdminAuthGuard` 側でも `getDoc(doc(db, "settings", "adminPermissions"))` をしている。`settingsRepository.getAdminPermissions()` と組で揃えるべき。

---

### 1.10 src/app/admin/settings/page.tsx

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 16 | 241 | `writeBatch` | `staff` + `staffByEmail` | 担当者リスト保存（新規 `set` / 編集 `update` / mirror 同期 / email 変更時の旧 mirror 削除） | **`staffSyncService.saveStaffMembers({ staffList })`** （新設）。staff と staffByEmail mirror の整合は service 内に閉じる |
| 17 | 332 | `writeBatch` | `orderMaster` | 発注品目マスタ保存（新規 / 編集 / 削除 + dirty 比較） | **`orderMasterService.saveOrderItems({ items, dirty, deleted })`** （新設） |
| 18 | 397 | `writeBatch` | `customerUsers` + `transactions` | ポータル利用者の `customerId` 紐付け + pending `transactions` の `customerId/customerName/status` 反映 + `linkedByStaff*` 記録 | **`customerLinkingService.linkCustomerUsersToCustomers({ assignments, actor })`** （新設）。設計書 §17.5 「customer user 紐付け」と直結する |
| 19 | 933 | `setDoc(merge)` | `settings/portal` | 自動返却時刻 (`autoReturnHour` / `autoReturnMinute`) の保存 | **`settingsRepository.setPortalSettings(patch)`** または `portalSettingsService.savePortalSettings(input)` |
| 20 | 1010 | `setDoc(merge)` | `settings/inspection` | 耐圧検査の `validityYears` / `alertMonths` 保存 | **`settingsRepository.setInspectionSettings(patch)`** または `inspectionSettingsService` |

→ admin/settings 1 page で 5 つの異なる業務オペレーションが混在している。タブ単位で page を分割する選択肢もある。

---

### 1.11 src/app/portal/order/page.tsx

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 21 | 68 | `addDoc` | `transactions` (`type=order`) | 顧客が発注（cart の items 配列をまとめて 1 トランザクションとして作成） | **`portalTransactionService.createOrderTransaction({ identity, cart, deliveryType, deliveryTargetName, note })`** （新設） |

→ 注意点:
- `customerId` は `session.uid || "unknown"`、`createdByUid` は `session.customerUserUid || session.uid || "legacy_customer"` という **page にしか存在しない fallback** がある。
- identity-and-operation-logging-design §19 の未決事項は、現行方針では「`customerId` に customer user uid を混ぜない」方向で扱う。
- service 化と同時に `portalIdentity.requireCustomerPortalIdentity()` を導入し、identity 不足時は書き込みを止める。未紐付け customer user の申請だけは `createdByUid = customerUserUid` + `status = pending_link` とし、`customerId` fallback は保存しない。

---

### 1.12 src/app/portal/return/page.tsx

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 22 | 116 | `addDoc` | `transactions` (`type=return`) | 顧客がタンク返却を申請（手動 or 自動） | **`portalTransactionService.createReturnTransaction({ identity, items, source })`** （新設） |

→ 自動返却 (`source: "auto_schedule"`) と手動 (`source: "customer_portal"`) の両方を 1 service で扱う。`localStorage.setItem(autoKey, "1")` の重複防止も hook 側 (`usePortalAutoReturn`) に閉じる。

---

### 1.13 src/app/portal/setup/page.tsx

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 23 | 80 | `updateDoc` | `customerUsers/{uid}` | portal 初期設定 (`selfCompanyName` / `selfName` / `lineName` / `setupCompleted`) の保存 | **`customer-user.ts` に `completePortalSetup({ uid, profile })` を追加**。page から `updateDoc` を消す |

---

### 1.14 src/app/portal/unfilled/page.tsx

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 24 | 109 | `addDoc` | `transactions` (`type=uncharged_report`) | 顧客が未充填タンクを報告（複数を `Promise.all` で並列作成） | **`portalTransactionService.createUnchargedReportTransaction({ identity, tankIds, source })`** （新設）。ループは service 内 |

---

### 1.15 src/app/staff/inhouse/page.tsx

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 25 | 75 | `writeBatch().update().commit()` | `tanks/{id}` | 自社利用中タンクの **tag (`logNote`) のみ** 更新（状態遷移なし） | **`tanksRepository.updateTankFields(tankId, { logNote })`** （未実装）または **`tankTagService.updateTag({ tankId, tag })`** |

→ 単発書き込みなのに `writeBatch` を使っているのは、`batch.update()` を使うため（`batch.set` より安全）。仕様としてはこれで問題ない。
→ ただし `applyTankOperation` を介さない **逃げ道** になっているので、許容するなら repository 経由を強制し、書き込み許可フィールドを `logNote / note / type / nextMaintenanceDate` 限定に絞る必要がある。

---

### 1.16 src/features/staff-operations/hooks/useBulkReturnByLocation.ts

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 26 | 76 | `writeBatch().update().commit()` | `tanks/{id}` | 一括返却画面の tag (`logNote`) 更新 | **#25 と同じ移行先**。`tanksRepository.updateTankFields()` または `tankTagService.updateTag()` |

→ #25 と同じパターンが 2 箇所にある。共通化必須。

---

### 1.17 src/features/staff-operations/hooks/useOrderFulfillment.ts

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| 27 | 106 | `updateDoc` | `transactions/{id}` | 受注承認 (`approveOrder`)。status を `approved` に上げ、`approvedBy*` を記録 | **`transactionService.approveOrder({ orderId, actor })`** （新設）。旧 `approvedBy` 文字列は将来削除候補 |

→ `applyBulkTankOperations` の batch 参加部分（[`useOrderFulfillment.ts:257`](../../src/features/staff-operations/hooks/useOrderFulfillment.ts) 周辺）は `batch.update(transactions, ...)` を **`extraOps` callback** で書いている。これは `tank-operation.ts` の `extraOps` 仕様の正しい使い方。
→ ただし `fulfilledBy` 文字列など旧 field と `fulfilledByStaffId/Name/Email` の併記は service 化後の別 PR で整理する。service 抽出 PR では挙動維持を優先してもよい。

---

### 1.18 src/features/staff-operations/hooks/useReturnApprovals.ts

| # | 行 | API | 対象 | 業務操作 | 移行先 |
|--:|--:|---|---|---|---|
| (extraOps) | 119-130 | `batch.update` (extraOps callback 内) | `transactions/{id}` | 返却承認完了時に各 transaction の status を completed にし `fulfilledBy*` を記録 | **`returnApprovalService.fulfillReturnGroup({ group, approvals, actor })`** （新設）。tank operation と transaction update の組合せを service 化 |

→ 上の表（行 119）は厳密には `extraOps` callback 内のため `addDoc` / `updateDoc` の grep には引っかからない。ただし役割は #27 と同じカテゴリ。
→ approval 直前に `tanksRepository.getTank` で現状再取得しているのは正しい挙動。これは service 内に閉じてしまえば、page / hook から見えなくなる。

---

## 2. コレクション別 書き込みマップ

> 「どのコレクションに、どの service が書くべきか」の役割表。今後新規書き込みを追加する際の判断基準。

| コレクション | 唯一の write 経路（提案） | 現状の write 元 |
|---|---|---|
| `tanks` | `tank-operation.ts` (state 遷移 + log と原子的) ／ `tanksRepository.updateTankFields*` (state 遷移なしの note/type/logNote/nextMaintenanceDate のみ) ／ `submitTankEntryBatch.ts` (新規作成のみ) | `tank-operation.ts` ✅ ／ `submitTankEntryBatch.ts` ✅ ／ `staff/inhouse/page.tsx` ❌ ／ `useBulkReturnByLocation.ts` ❌ |
| `logs` | `tank-operation.ts` のみ ／ `submitTankEntryBatch.ts` (procurement) ／ `supply-order.ts` (order) | 全て service 経由 ✅ |
| `transactions` | `portalTransactionService.*` (create) ／ `orderTransactionService.approve/fulfill` ／ `returnApprovalService.fulfill` ／ `customerLinkingService.link` (`linkedByStaff*`) | `portal/order/page.tsx` ❌ ／ `portal/return/page.tsx` ❌ ／ `portal/unfilled/page.tsx` ❌ ／ `useOrderFulfillment.ts` ❌ ／ `useReturnApprovals.ts` ❌ ／ `admin/settings/page.tsx` ❌ |
| `customers` | `customersService.*` | `admin/customers/page.tsx` ❌ |
| `customerUsers` | `customer-user.ts` (`ensureCustomerUser` / `completePortalSetup` 新設) ／ `customerLinkingService.link` | `customer-user.ts` ✅ ／ `portal/setup/page.tsx` ❌ ／ `admin/settings/page.tsx` ❌ |
| `staff` + `staffByEmail` | `staffSyncService.*` のみ ／ `staff-auth.ts` の **自動 mirror 修復は廃止**（必要なら明示 rebuild API で正常化） | `admin/settings/page.tsx` (✅ helper 利用) / `staff-auth.ts` (修復) ⚠️ |
| `settings/adminPermissions` | `adminPermissionsService` | `admin/permissions/page.tsx` ❌ |
| `settings/portal` | `portalSettingsService` | `admin/settings/page.tsx` ❌ |
| `settings/inspection` | `inspectionSettingsService` | `admin/settings/page.tsx` ❌ |
| `notifySettings` + `lineConfigs` | `admin-notification-settings.ts` | `admin-notification-settings.ts` ✅ |
| `priceMaster` + `rankMaster` | `admin-money-settings.ts` | `admin-money-settings.ts` ✅ |
| `orderMaster` | `orderMasterService` | `admin/settings/page.tsx` ❌ |
| `orders` | `supply-order.ts` | `supply-order.ts` ✅ |
| `tankProcurements` | `submitTankEntryBatch.ts` | `submitTankEntryBatch.ts` ✅ |
| `monthly_stats` / `delete_history` / `edit_history` | 未実装 | 現状 write 無し |

✅ = 想定経路に乗っている／❌ = page・hook から直接書いているので移行が必要／⚠️ = 例外運用

---

## 3. 構造的な指摘

### 3.1 設定 field の責務重複

`alertMonths` と `validityYears` が以下の **2 箇所** にある。

- `notifySettings/config` … admin/notifications で書く
- `settings/inspection` … admin/settings で書く

read 側も `useInspectionSettings` は `settings/inspection` を見るのに対し、`admin/notifications` の保存 UI は `notifySettings/config` に書いている。**実際のアラート判定がどちらを参照しているかが不明確** で、片方の保存が片方を上書きしない。

提案: 「耐圧検査の閾値」は `settings/inspection` 一本に正本化し、`notifySettings` からは削除する（または `notifySettings` 側を「通知メディア固有設定」として、閾値を持たない形にする）。

### 3.2 旧 field と新 identity field の並走

`useOrderFulfillment.approveOrder` / `fulfillOrder` および `useReturnApprovals.fulfillReturns` は、新 field (`approvedByStaffId/Name/Email`、`fulfilledByStaffId/Name/Email`) を書きつつ、旧 field (`approvedBy`、`fulfilledBy` = staff 名文字列) も並走で書いている。

設計書 [docs/identity-and-operation-logging-design.md §9 / §11](../identity-and-operation-logging-design.md) の方針:

> 新規書き込みでは `approvedBy` / `fulfilledBy` のような曖昧な名前文字列 field を増やさない。

新規実装フェーズの前提なので、**旧 field は廃止候補**。ただし service 抽出と旧 field 停止を同じ PR に混ぜるとレビューしづらいため、先に service 化して書き込み箇所を 1 箇所へ寄せ、read 側で旧 field を見ていないことを確認した別 PR で停止する。

### 3.3 portal の `createdByUid` フォールバック

- `portal/order/page.tsx`: `session.customerUserUid || session.uid || "legacy_customer"`
- `portal/return/page.tsx`: `customerUserUid || session.uid || customerId`
- `portal/unfilled/page.tsx`: `customerUserUid || session.uid || customerId`

「`legacy_customer`」リテラルや `customerId` フォールバックが残っており、**identity が解決できない場合に書き込みが許されてしまう**。

設計書 §6 / §19 の「`requireCustomerPortalIdentity()` で identity が無いなら書き込まない」方針に沿うなら、**identity 解決失敗は throw して書き込みを止める** べき。顧客未紐付け状態は `customerId` fallback ではなく `createdByUid` + `pending_link` で表現する。

### 3.4 inhouse の `IN_HOUSE_USE_RETRO` 直叩き

`staff/inhouse/page.tsx:108` で `applyTankOperation({ transitionAction: ACTION.IN_HOUSE_USE_RETRO, ... })` を直接呼んでいる。`tank-rules.ts` の `OP_RULES` で許可されている遷移であれば問題ないが、「事後報告」という業務文脈は service 化したほうが意味が露出する（テスト容易性、業務不変条件の集約）。

提案: `inhouseOperationService.reportInHouseUseRetro({ tankId, actor })`。

### 3.5 `writeBatch` で単発 update する違和感

- `staff/inhouse/page.tsx:75` … `writeBatch(db).update(ref, { logNote }).commit()`
- `useBulkReturnByLocation.ts:76` … 同上

これは `updateDoc(ref, { logNote })` で十分な場面に `writeBatch` を使っている。理由は `batch.update` の API が「**ドキュメントを必ず存在前提で更新する** = 幽霊 doc を作らない」という性質を持つためで、SITEMAP §9-4「`batch.set(..., {merge:true})` は幽霊ドキュメントを作るため原則禁止」と同じ思想。

`updateDoc` 単体で同じ性質を満たすため、単発なら `updateDoc` 使用で問題ない。複数フィールドを違う タイミングで更新する → batch 化する、というのが本来の役割分担。

### 3.6 admin/settings の compound オペレーション

`saveCustomerUsers` (admin/settings/page.tsx:393) は次を 1 ループで実行している:

1. `customerUsers/{uid}` の status / customerId / customerName / updatedAt を merge
2. `transactionsRepository.findPendingLinksByUid(u.uid)` で pending transactions を read
3. 該当 transactions を `pending_link → pending_approval` に昇格、`linkedByStaff*` を記録

これは **「customer user 紐付け」というひとつの業務操作** で、`customerLinkingService.link()` に丸ごと寄せるべき。ループ・read・write の順序やエラー時の atomicity（現状は writeBatch なので一括 commit）も service が責任を持つ。

### 3.7 staff-auth.ts の自動 mirror 修復

`findActiveStaffByEmail` (staff-auth.ts:110-155) は、`staffByEmail` mirror が無いとき **read の延長で `setDoc` する** という挙動を持つ。

問題:
- read-only と称している関数 (`findStaffProfileByEmailReadOnly`) と並んで存在しており、**どちらが書くか** がコードを読まないと分からない。
- 書き込みに失敗しても `console.warn` で抑制している。

対策案:
- `findActiveStaffByEmail` から自動修復を削除し、**read-only のみにする**。mirror の修復は staff 保存 service または明示 rebuild API で行う。
- 一発で全 mirror を作り直したい場合は `staffSyncService.rebuildAllMirrors()` のような明示 API を作って admin から手動で叩く。

---

## 4. 移行優先度（書き込み観点）

### 4.1 先に移すべきもの（リスク低・効果高）

1. **portal の 3 transaction 作成** (#21 #22 #24)
   - identity helper 整備とセットで実施。
   - リスク: 低（read 側は repository 経由）。
   - 効果: 高（customerId 正本化、`legacy_customer` 等のフォールバック撲滅）。

2. **admin/customers の CRUD** (#12 #13 #14)
   - 単純な CRUD で外部依存も少ない。`customersRepository` + `customersService` の最小実装で完結。

3. **admin/permissions / settings/portal / settings/inspection の単発 setDoc** (#15 #19 #20)
   - 1 行 `setDoc` を service 化するだけの移行。
   - admin/settings は同時に「タブごとの分離」を検討する余地がある。

4. **`tanks.logNote` の単発更新の集約** (#25 #26)
   - 共通 `tankTagService.updateTag()` で 2 箇所同時に解消。
   - feature 跨ぎの重複コードを 1 箇所に。

### 4.2 まとめて移したほうが良いもの（複合）

5. **portal/setup の `customerUsers` 更新** (#23) と **`customer-user.ts`**
   - `completePortalSetup({ uid, profile })` を追加し、portal user 関連の書き込みを 1 ファイルに集約。

6. **transaction approval / fulfillment** (#27 + extraOps batch)
   - `transactionService` を新設し、`approveOrder` / `fulfillOrderTransaction` / `fulfillReturnGroup` を扱う。
   - 旧 `approvedBy` / `fulfilledBy` の停止は、service 化後に read 側を確認して別 PR で実施する。

7. **admin/settings の staff / orderMaster / customerUsers 同時更新** (#16 #17 #18)
   - `staffSyncService` `orderMasterService` `customerLinkingService` の 3 service に分割。
   - `staff-auth.ts` の自動 mirror 修復削除は、`staffSyncService` 導入後の小 PR で実施する。

### 4.3 後回しにすべきもの

8. **dashboard の bulk correction オーケストレーション**
   - `applyLogCorrection` / `voidLog` 自体は service として完成しているので、書き込み境界としては既に正しい場所にある。
   - 「ループ・進捗報告」の service 化は **page リファクタの一部** として、page 構造改善と一緒に進める方が無駄が少ない（書き込み境界だけ動かしても得るものが小さい）。

9. **`tank-operation.ts` 周辺の更なる分割**
   - 触らない。設計書通り。

---

## 5. 移行時の注意

- **同じ PR に混ぜない**:
  - portal transaction service 化 PR と「`approvedBy` / `fulfilledBy` 廃止」PR は分ける。読み手が両方を同時に追う必要があると、どちらが何の理由で書き換わったか追えなくなる。
  - service 抽出の機械的リファクタと、UI の reorganize（タブ分割 / レイアウト変更）も分ける。
- **`tanksRepository.updateTankFields()` の許可フィールド**:
  - `status` / `location` / `latestLogId` / `staff` は **絶対に許可しない**。これらは `tank-operation.ts` 経由でしか書かない。
  - allow list を repository 内で enforce し、違反したら throw する。
- **service 内のループ vs `applyBulkTankOperations`**:
  - 同一 tank への複数操作は不可（`applyBulkTankOperations` 内部で重複弾き）。
  - dashboard bulk correction は **同一 tank の最新 active log を順番に編集** するので、どうしても loop。runtime atomic ではなく「途中で失敗したら以降を止めて報告」で良い。

---

## 6. 結論

- 直接書き込み入口 27 件に加え、`extraOps` の `batch.update` も review 対象として明示した。page / hook に残る書き込みは service / repository に寄せる余地がある。
- 既に正しい場所にある書き込みは:
  - `tank-operation.ts` (#1-#4)
  - `submitTankEntryBatch.ts` (#5)
  - `supply-order.ts` (#6)
  - `admin-money-settings.ts` (#7)
  - `admin-notification-settings.ts` (#8)
  - `customer-user.ts` の create / merge (#9 #10)
- 移行は「**portal transaction service**」「**customers service**」「**settings service**」「**transaction approval service**」「**staff sync service**」を主軸に、`customerLinkingService` / `orderMasterService` / `tankTagService` を小さく足す構成でカバーできる。
- 以降の手順は [refactor-roadmap.md](./refactor-roadmap.md) に分離する。
