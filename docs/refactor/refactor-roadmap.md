# 階層構造リファクタ ロードマップ

調査日: 2026-05-02
前提: 旧 schema 互換、legacy fallback、backfill は **考慮しない**。既存コードに残る fallback は撤去対象であり、移行後の前提にしない。
依拠ドキュメント:
- [page-feature-boundary-audit.md](./page-feature-boundary-audit.md)
- [firestore-write-boundary-audit.md](./firestore-write-boundary-audit.md)
- [../identity-and-operation-logging-design.md](../identity-and-operation-logging-design.md)
- [../../AGENTS.md](../../AGENTS.md)
- [../../SITEMAP.md](../../SITEMAP.md)

このドキュメントの目的:
1. **何を最初に動かすか** を順序として固定する
2. **同じ PR に混ぜると危険なもの** を明示する
3. **UI デザイン変更前に必ず済ませるべきタスク** を切り出す

---

## 0. 全体方針

### 0.1 ゴール

```
page.tsx
  └ hook (UI state / workflow)
       └ service (業務不変条件 + 複数コレクション同時更新)
            └ repository (Firestore I/O)
                 └ Firestore
```

- page.tsx は薄い殻（30 行程度を目安、業務 page でも 100 行未満）。
- workflow hook は **service を呼ぶだけ** にし、Firestore SDK を import しない。
- service は **identity を必須引数で受け取る**（`OperationActor` / `CustomerSnapshot` / `OperationContext`）。
- repository は **Firestore I/O と正規化のみ**。session / staff 推定は持たない。

### 0.2 不変条件（触らない）

- `src/lib/tank-operation.ts` … 触らない（明示指示なしに変更しない）
- `src/lib/tank-rules.ts` の `STATUS` / `ACTION` / `OP_RULES` … 触らない
- `src/lib/tank-trace.ts` … 触らない
- `firestore.rules` / `firebase.json` … 触らない
- `tankProcurements` の schema、revision chain、void の業務不変条件 … 触らない

### 0.3 進め方の原則

- **1 PR = 1 service or 1 ページ移行** を基本単位。
- service 化と UI reorganize は別 PR。
- 旧 field 削除（例: `approvedBy` / `fulfilledBy` 文字列）は read 側の確認を 1 PR で済ませてから、削除を別 PR で。
- 各 PR で `npx tsc --noEmit --pretty false` を必ず通す。

### 0.4 重要課題の扱い

- **Admin settings 分離**: `admin/settings/page.tsx` は staff / customerUsers / orderMaster / portal settings / inspection settings を抱えているため、UI 改修前に service 境界を作る。
- **portal identity**: `customerId` に `customerUserUid` や `session.uid` を混ぜない。未紐付け customer user は `createdByUid` + `pending_link` で表し、顧客正本の `customerId` と分離する。
- **staff dashboard 肥大化**: 1450 行規模の page に集計・編集・bulk correction が集まっている。UI を触る前に snapshot hook と correction service を切り出す。

---

## 1. 最も危険な責務混在 TOP 10

> 行数や grep 数ではなく「**触ったときに壊れる範囲の広さ**」で順位付け。

| # | 場所 | 何が混ざっているか | 壊れるとどう困るか |
|--:|---|---|---|
| 1 | [src/app/admin/settings/page.tsx](../../src/app/admin/settings/page.tsx) `237-460` | `staff` + `staffByEmail` + `customerUsers` + `transactions` の 4 コレクションを同一 page で同時更新。`assertNotChangedSinceLoad` / `linkedByStaff*` / mirror 削除 / pending transactions 昇格まで全部 page | 認証・顧客紐付け・受注承認待ち列が同時に壊れる |
| 2 | [src/app/staff/dashboard/page.tsx](../../src/app/staff/dashboard/page.tsx) `140-475` | ログ取得 + customers 取得 + 集計 + 編集モード state + 単件 / 一括 correction の orchestration が 1450 行に同居 | ログ編集の業務不変条件が page で破られると revision chain が壊れる |
| 3 | [src/app/portal/order/page.tsx](../../src/app/portal/order/page.tsx) `60-86` ／ [portal/return/page.tsx](../../src/app/portal/return/page.tsx) `106-137` ／ [portal/unfilled/page.tsx](../../src/app/portal/unfilled/page.tsx) `103-128` | 3 ページが **異なる** `customerId` / `createdByUid` フォールバック (`session.uid \|\| "legacy_customer"` 等) を持つ | 顧客識別子が紐付かず請求・履歴・承認が壊れる |
| 4 | [src/app/admin/customers/page.tsx](../../src/app/admin/customers/page.tsx) `183-277` | 顧客マスタ CRUD と重複名チェックを page で実装。`customers` への直接 `addDoc` / `updateDoc` | `customers` を貸出先・請求単位の正本にする方針に対して、保存境界が page に残り続ける |
| 5 | [src/features/staff-operations/hooks/useOrderFulfillment.ts](../../src/features/staff-operations/hooks/useOrderFulfillment.ts) `96-121` ／ `214-278` | 受注承認 (transactions update) と受注貸出完了 (tank operation + transaction batch) が同 hook。新旧 actor field を **両方** 書く | 受注フローの業務不変条件が hook 内に閉じておらず、UI 起因のリグレッションが起きやすい |
| 6 | [src/features/staff-operations/hooks/useReturnTagProcessing.ts](../../src/features/staff-operations/hooks/useReturnTagProcessing.ts) `72-143` | 返却タグ処理の「直前再 read → bulk write → transaction batch」シーケンスが hook | 順序が壊れると幽霊 tank が生まれる可能性 |
| 7 | [src/app/staff/inhouse/page.tsx](../../src/app/staff/inhouse/page.tsx) `68-86` ／ [src/features/staff-operations/hooks/useBulkReturnByLocation.ts](../../src/features/staff-operations/hooks/useBulkReturnByLocation.ts) `65-81` | `tanks.logNote` を `writeBatch().update()` で **直接書き換え**。`tank-operation.ts` を経由しない逃げ道 | tag 付け以外のフィールドに誰かが拡張すると、状態遷移を伴わない更新で `latestLogId` がずれる |
| 8 | [src/lib/firebase/staff-auth.ts](../../src/lib/firebase/staff-auth.ts) `110-155` | read-only と称する `findActiveStaffByEmail` が **mirror が無いと書き込みする**。失敗は `console.warn` で握りつぶし | mirror が壊れた状態で読み取り経路から書き戻され、根本原因が隠れる |
| 9 | [src/app/admin/notifications/page.tsx](../../src/app/admin/notifications/page.tsx) ／ [src/app/admin/settings/page.tsx](../../src/app/admin/settings/page.tsx) | `alertMonths` / `validityYears` を **2 箇所** (`notifySettings/config` と `settings/inspection`) に書き、read 側 (`useInspectionSettings`) は片方しか見ない | 管理画面で設定したつもりが反映されない |
| 10 | [src/app/staff/inspection/page.tsx](../../src/app/staff/inspection/page.tsx) `101-126` | 「次回耐圧期限 = 今日 + N 年」を page で組み立てて `tankExtra` 注入。inspection 業務不変条件が page に漏れている | 期限算出ロジックが管理画面の閾値設定と分かれて存在し、両方を同期し損ねる |

---

## 2. 推奨 PR シーケンス

> 番号は実施順。各 PR は **コミット 1 本** ではなく PR 単位を想定。

### Phase A: portal identity の正本化（基盤）

#### PR 1. `lib/portal/portalIdentity.ts` 追加

- 内容:
  - `getCustomerPortalIdentity(): CustomerSnapshot | null`
  - `requireCustomerPortalIdentity(): CustomerSnapshot`
  - `useCustomerPortalIdentity(): CustomerSnapshot | null`
- 触らない: 既存の `customerSession` 構造 / portal page の `addDoc`
- 効果: portal の `customerUserUid` / `customerId` / `customerName` 解決の **唯一の入口** ができる。`customerId` に uid fallback を入れない契約をここで固定する

#### PR 2. `lib/portal/portalTransactionService.ts` 追加 + portal/order を service 経由に

- 内容:
  - `createOrderTransaction({ identity, cart, deliveryType, deliveryTargetName, note })`
  - `portal/order/page.tsx` の `addDoc` を service 呼び出しに差し替え
- 触らない: schema、`portal/return` `portal/unfilled`
- 効果: 1 ページで service 化パターンが確立される。未紐付け customer user は `createdByUid` + `pending_link` で扱い、`customerId` fallback は保存しない

#### PR 3. `portal/return` を `portalTransactionService.createReturnTransaction` に移行

- 内容:
  - `createReturnTransaction({ identity, items, source })` を追加
  - 自動返却ロジック (`useEffect` 内のスケジュール判定) を `usePortalAutoReturn(identity)` に切り出し
  - `getDoc(doc(db, "settings", "portal"))` を `useAutoReturnSettings()` hook に切り出し
- 触らない: 自動返却の実時刻判定仕様

#### PR 4. `portal/unfilled` を `portalTransactionService.createUnchargedReportTransaction` に移行

#### PR 5. `portal/setup` の `customerUsers.updateDoc` を `customer-user.ts` に集約

- 内容:
  - `completePortalSetup({ uid, profile })` を `customer-user.ts` に追加
  - portal/setup/page.tsx は service 呼び出しのみ

> **PR 1〜5 の効果**: `localStorage.customerSession` の読み取りパスが portal 全体で 1 種類になり、`legacy_customer` 等のリテラルと `customerId = session.uid` 型の fallback が消える。

---

### Phase B: マスタ・設定の service 化（孤立度高い）

#### PR 6. `customersRepository` + `customersService` 新設

- 内容:
  - `customersRepository.getCustomers({ activeOnly })` / `getCustomer(id)` / `getCustomerSnapshots()`
  - `customersService.createCustomer(input)` / `updateCustomer(id, patch)` / `setCustomerActive(id, isActive)`
  - `admin/customers/page.tsx` を service 経由に差し替え
- 触らない: `customers` schema、price field 名

#### PR 7. `settingsRepository` + `adminPermissionsService` 新設

- 内容:
  - `settingsRepository.getAdminPermissions()` / `setAdminPermissions(pages)`
  - `settingsRepository.getPortalSettings()` / `setPortalSettings(patch)`
  - `settingsRepository.getInspectionSettings()` / `setInspectionSettings(patch)`
  - `admin/permissions/page.tsx` の `setDoc` を差し替え
  - `admin/settings/page.tsx` の `settings/portal` / `settings/inspection` の保存を差し替え
  - `AdminAuthGuard.tsx` の `getDoc(doc(db, "settings", "adminPermissions"))` も repository 経由に
  - `useInspectionSettings.ts` も repository 経由に
- 触らない: `notifySettings/config` の重複 field 整理（PR 12 で）

#### PR 8. `orderMasterService` 新設 + admin/settings の orderMaster タブ移行

- 内容:
  - `orderMasterService.saveOrderItems({ items, dirty, deleted })`
  - admin/settings の orderMaster タブから writeBatch を消す

#### PR 9. `tanksRepository.updateTankFields()` 実装 + tag 更新の集約

- 内容:
  - `tanksRepository.updateTankFields(tankId, patch)` を実装。allow list は `note / type / nextMaintenanceDate / logNote` のみ
  - `tankTagService.updateTag({ tankId, tag })` を新設し、`logNote` ↔ `[TAG:xxx]` 変換を service に閉じる
  - `staff/inhouse/page.tsx` の `writeBatch().update().commit()` を service 経由に
  - `useBulkReturnByLocation.ts` の同パターンも service 経由に
- 触らない: `[TAG:unused]` / `[TAG:uncharged]` という enum 表現自体

---

### Phase C: workflow service 化

#### PR 10a. `transactionService` 新設（受注 / 返却の承認・完了）

- 内容:
  - `transactionService.approveOrder({ orderId, actor })`
  - `transactionService.fulfillOrderTransaction({ order, scannedTanks, actor })` … 内部で `applyBulkTankOperations` の `extraOps` 経由
  - `transactionService.fulfillReturnGroup({ group, approvals, actor })` … 同上
  - `useOrderFulfillment.ts` / `useReturnTagProcessing.ts` から書き込みを service 呼び出しに差し替え
  - 既存挙動維持のため、旧 `approvedBy` / `fulfilledBy` 文字列の併記はこの PR では残してよい
- 注意:
  - `applyBulkTankOperations` の `extraOps` 利用は維持し、`tank-operation.ts` は触らない
  - service 抽出 PR では UI 表示と Firestore payload の互換を優先する

#### PR 10b. 旧 actor 文字列 field の停止

- 内容:
  - `grep approvedBy / fulfilledBy` で read 側が `approvedByStaff*` / `fulfilledByStaff*` に寄っていることを確認
  - `transactionService` から旧 `approvedBy` / `fulfilledBy` の書き込みを停止
  - `order-types.ts` の互換 field は、表示互換が不要と確認できるまでは残してよい

#### PR 11a. `staffSyncService` 新設 + admin/settings の staff タブ移行

- 内容:
  - `staffSyncService.saveStaffMembers({ staffList })`
  - admin/settings の `saveStaff` を service 呼び出しに差し替え
  - `staff` + `staffByEmail` mirror の作成・更新・削除を service に閉じる
- 触らない: `staffSession` の format

#### PR 11b. `customerLinkingService` 新設 + admin/settings の portal user 紐付け移行

- 内容:
  - `customerLinkingService.linkCustomerUsersToCustomers({ assignments, actor })`
  - admin/settings の `saveCustomerUsers` を service 呼び出しに差し替え
  - `customerUsers` と pending `transactions` の `customerId/customerName/status/linkedByStaff*` 更新を service に閉じる
- 注意: `linkedByStaff*` の actor 解決経路 (`resolveAdminOperationActor`) は service 内に移す

#### PR 11c. `staff-auth.ts` 自動 mirror 修復削除

- 内容:
  - `findActiveStaffByEmail` から自動 `setDoc(staffByEmail)` を削除
  - mirror 不整合の修復は `staffSyncService` または明示 rebuild API に限定
- 触らない: Google/メール認証フロー、`findStaffProfileByEmailReadOnly`

#### PR 12. `notifySettings` ↔ `settings/inspection` の責務統合

- 内容:
  - 「`alertMonths` / `validityYears` の正本は `settings/inspection`」と決め、`notifySettings/config` 側からは削除
  - `admin-notification-settings.ts` から `alertMonths` / `validityYears` を外す
  - 通知 page の UI も「閾値は耐圧検査タブで設定してください」に変更
- 注意: schema 削除を伴うので read / write 両方を確認した上で実施

---

### Phase D: page を薄くする（業務系）

#### PR 13. inspection / repair / inhouse の operation service 化

- 内容:
  - `maintenance/services/inspectionOperationService.ts` … `completeInspection({ tanks, settings, actor })`
  - `maintenance/services/repairOperationService.ts` … `completeRepair({ tanks, actor })`
  - `inhouse-operations/services/inhouseOperationService.ts` … `reportInHouseUseRetro` / `bulkReturnInHouse`
  - 各 page から `applyTankOperation` / `applyBulkTankOperations` の直叩きを service 呼び出しに差し替え
  - inspection の「次回期限 = 今日 + N 年」算出を service に閉じる
- 触らない: `tank-operation.ts`、状態遷移ルール

#### PR 14. dashboard の集計 hook + correction service 化

- 内容:
  - `staff-dashboard/hooks/useDashboardSnapshot()` … logs + customers + 集計
  - `staff-dashboard/services/dashboardCorrectionService.ts` … `bulkChangeLocation` / `bulkVoid`（内部で `applyLogCorrection` / `voidLog` を順次呼ぶ）
  - dashboard/page.tsx を **薄い殻** にする（目標: 300 行程度。1450 行 → 1/5）
- 注意:
  - UI を一切変えない。**ロジックの場所だけ動かす** PR にする
  - bulk loop の挙動（一部失敗時のレポート）を service の戻り値で表現する

#### PR 15. analytics service 化（sales / billing / staff-analytics）

- 内容:
  - `analytics/aggregateLogsByDay(logs)`
  - `analytics/aggregateLogsByCustomer(logs, priceMap)` … billing-rules.ts と統合検討
  - `analytics/aggregateLogsByStaffId(logs)`
  - 3 page を薄い殻にする
- 触らない: `monthly_stats` schema

#### PR 16. supply-order の orderMaster fetch を repository 化

- 内容:
  - `orderMasterRepository.listOrderItems({ category })` を新設
  - `staff/supply-order/page.tsx` の `getDocs(collection(db, "orderMaster"))` を repository 経由に
  - `TankEntryScreen.tsx` の同様の fetch も repository 経由に

---

### Phase E: 共通化と仕上げ

#### PR 17. `lib/auth/staffSessionStore.ts` 新設

- 内容:
  - `staffSession` の read / write / clear を 1 ファイルに集約
  - `StaffAuthGuard` / `AdminAuthGuard` / `useStaffSession` / dev-auth が全て同 store を使う
  - `localStorage.setItem("staffSession", ...)` を grep で 0 件にする
- 触らない: format（`{ id, name, role, rank, email }`）

#### PR 18. `EventBus` or React Context 化検討

- 内容:
  - `window.dispatchEvent("staffLogin")` / `"opStyleChange"` を Context or 専用 store に置き換え
  - 1 PR で全部やらず、「opStyleChange の Context 化」と「staffLogin の Context 化」を分割
- 注意: 既存の薄い殻 page の独立性は維持

#### PR 19. `useDestinations` を `useCustomerOptions` にリネーム

- 内容:
  - `destinations` という古い名称を完全廃止（既に廃止済 schema との混乱を解消）
  - `useCustomerOptions()` から `customersRepository.getCustomers({ activeOnly })` を呼ぶ
  - `selectedCustomer: CustomerSnapshot | null` を返す形は維持

---

## 3. 同じ PR に混ぜると危険なもの

| 混ぜてはいけない組合せ | 理由 |
|---|---|
| service 抽出 ＋ UI reorganize | 差分が「ロジック移動」なのか「UI 改修」なのか追えなくなる |
| service 抽出 ＋ 旧 field 削除 (`approvedBy` / `fulfilledBy`) | 読み手側の影響範囲が混在する。PR 10a → PR 10b の順で分ける |
| `customersService` 化 ＋ `useDestinations` リネーム | repository / service の追加と命名変更は分ける（リネーム PR は機械的、service 化 PR は意味的） |
| `tanksRepository.updateTankFields()` の追加 ＋ `tank-operation.ts` の拡張 | 直書き許可と core operation の同時変更。core 不変条件が壊れた時に切り分け不能 |
| portal identity 移行 ＋ Firebase Auth 認証フロー変更 | session 構造変更は他の PR と分ける |
| Phase A の portal 移行 ＋ Phase D の dashboard 移行 | 影響範囲が広すぎる。Phase 順を守る |
| Hosting deploy ＋ schema 変更コミット | AGENTS.md `deploy / commit 分離ルール` に違反 |

---

## 4. UI デザイン変更の前に必ず済ませるべきタスク

> 「UI を作り直す前に、ロジックを動かしておかないと、UI 改修の差分にロジック修正が紛れ込んで読めなくなる」を防ぐためのリスト。

| 項目 | 該当 PR | 理由 |
|---|---|---|
| portal 3 page の identity 集約 | PR 1〜4 | UI を作り直すと `addDoc` の周りも触ることになり、`customerId` フォールバックの修正が UI 差分に紛れる |
| portal/setup の `customerUsers` 更新を `customer-user.ts` に集約 | PR 5 | setup フォームの UI 変更時に identity ロジックも触ることになる |
| `customersService` 新設 + admin/customers 移行 | PR 6 | 顧客管理 UI を変える前に、CRUD 経路を service に固定 |
| `tankTagService` + `tanksRepository.updateTankFields()` | PR 9 | tag UI を変える前に、書き込み経路を 1 本化 |
| `transactionService` 新設 | PR 10a〜10b | 受注 / 返却 UI を変える前に、actor 記録の正本化を完了 |
| `staffSyncService` + `customerLinkingService` 新設 | PR 11a〜11b | 担当者管理画面・ポータル利用者紐付け画面の UI を変える前に、複合書き込みを service に閉じる |
| dashboard の集計 hook + correction service 化 | PR 14 | dashboard UI を作り直す PR が大きすぎるとレビュー不能。先にロジックを動かす |
| `useDestinations` → `useCustomerOptions` リネーム | PR 19 | 命名が紛らわしい状態で UI に手を入れると認識ミスが起きやすい |

> 逆に、**UI 改修と一緒にやってよい** こと:
> - レイアウト調整、tabUI、スワイプ表示、color tokens
> - アイコン / PWA 画像更新は UI-only 扱いだが、AGENTS.md の分離ルールに従って別 PR / 別 commit にする

---

## 5. 後回しにすべきタスク

| 項目 | 後回し理由 |
|---|---|
| `tank-operation.ts` 内部の repository 化 | AGENTS.md / SITEMAP.md で明示的に保留。設計書 §17 で「書き込み系 repository 化は別フェーズ」 |
| `tank-trace.ts` の repository 化 | 同上 |
| Cloud Functions 化 | 明示指示まで保留 |
| `monthly_stats` の自動集計バッチ | 構想止め。SITEMAP §5-7 |
| `delete_history` / `edit_history` の本格運用 | 設計書 §17 と AGENTS.md §3。新管理更新を service にまとめる準備が先 |
| `tankProcurements` ↔ `tank-operation.ts` の合流 | 新規作成 vs 状態遷移は別経路で正しい。合流させる必要なし |
| 軽量多言語化 | AGENTS.md 優先順位 §13 |
| `tanks.customerId` 追加 | 設計書 §3 / §14 で未決定事項。「customer data model」決定後 |
| `tank-rules.ts` の管理画面化 | AGENTS.md §管理画面接続「管理画面化しないもの」に明記 |
| `passcode login` の再有効化 | feature flag (`NEXT_PUBLIC_ENABLE_STAFF_PASSCODE_LOGIN`) で制御中。本タスクの対象外 |
| `dev-auth bypass` (`dev-staff` ID) の本物データ衝突対策 | 設計書 §19 で確認事項として残っているが、本リファクタ範囲外 |

---

## 6. 進捗のトラッキング

- PR 完了時には以下を PR 説明または完了報告に併記:
  1. どの page / hook が薄くなったか
  2. どの Firestore 直書きが消えたか
  3. 旧 field の廃止有無
  4. tsc / build の結果
  5. UI に変更が無いことの確認手段

---

## 7. 想定される副次効果

- `customerId` を正本にした検索・集計が後追いで楽になる（identity-and-operation-logging-design §13 の index 設計が活きる）。
- 編集 / 取消 の actor 記録が transaction approval と共通化され、`edit_history` / `delete_history` の **後付けが容易** になる（AGENTS.md §管理画面接続）。
- 各 service が `OperationActor` を引数で要求する形に揃うと、テストで mock した actor を渡しやすくなる。
- `tank-operation.ts` を一切触らずに到達できる（不変条件を壊す PR が出にくい構造）。

---

## 8. 出力契約

このドキュメントの想定読者は、次の 3 種類:

1. **次の PR を切る人**: §2 のシーケンスを上から順に消化していく
2. **レビュアー**: §1 の TOP 10 と §3 の禁則組合せをチェックリストに使う
3. **UI デザイナー / フロントの作り直しを担う人**: §4 の前提条件を完了したことを確認してから着手する

各 PR が完了するたびに、**このドキュメントの該当 PR 行に ✅ を打って差分を残す**運用を推奨する。
