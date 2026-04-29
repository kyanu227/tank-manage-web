# 管理画面接続計画

現場 staff 画面で使っている設定・変数・マスタを、管理画面から安全に変更できるようにするための接続計画。

この文書は設計のみを扱う。既存コードの変更、repository 移行、Security Rules 変更、`tank-operation.ts` 変更は行わない。

2026-04-29 時点の現行mainでは、`destinations` 管理UI・read/write は削除済み。Firestore 上の旧 `destinations` データ削除は別作業。portal Auth / customerUsers 本番化と Firestore Rules 本番反映は未実装・未deployであり、本書では設計予定として扱う。

## 調査メモ

- 対象コード:
  - `src/app/staff/**`
  - `src/app/admin/**`
  - `src/lib/tank-operation.ts`
  - `src/lib/tank-rules.ts`
  - `docs/database-schema.md`
  - `docs/data-layer-design.md`
- `docs/database-design.md` は現時点では存在しないため、同等の設計資料として `docs/database-schema.md` を参照した。
- staff 画面の一部処理は `src/features/**` と `src/hooks/**` に委譲されているため、staff 画面から直接使われる範囲で参照した。
- data layer migration と競合しないため、この計画では repository 実装や置き換え順には踏み込まない。

## 方針

- 管理画面から変更する対象は「運用値」「マスタ」「権限」「表示・通知設定」に限定する。
- タンク状態遷移、ログ revision、取消・編集制御などの業務不変条件は `tank-operation.ts` / `tank-rules.ts` 側に残す。
- staff 画面からの業務操作は、引き続き `applyTankOperation` / `applyBulkTankOperations` / `applyLogCorrection` / `voidLog` を通す。
- 単純なマスタ更新は管理画面から直接保存してよいが、業務履歴や認証ミラー更新を伴うものは service/operation 相当の処理を通す。
- 料金、権限、スタッフ、貸出先名、耐圧設定など、後から結果が変わる値は変更履歴を残す。

## 管理画面から変更すべき項目一覧

| 項目 | 現在の保存先 | 現在の利用箇所 | 更新方式 | 変更履歴 | 権限注意 | 優先度 |
|---|---|---|---|---|---|---|
| スタッフ名・メール・パスコード・有効/無効 | `staff`, `staffByEmail` | `StaffAuthGuard`, `useStaffSession`, staff 操作ログの操作者名, admin layout | service 必須。`staff` と `staffByEmail` を同時更新 | 必須 | 管理者のみ推奨。パスコード表示・変更は特に制限 | P0 |
| スタッフ role | `staff`, `staffByEmail` | `AdminAuthGuard`, `settings/adminPermissions`, dashboard のログ修正権限 | service 必須。認証ミラーと整合 | 必須 | 管理者のみ。準管理者が自権限を拡張できないこと | P0 |
| スタッフ rank | `staff`, `rankMaster` | `useStaffSession`, 将来の報酬・ランク計算 | マスタ更新 + staff 更新 | 推奨 | 管理者のみまたは金銭権限者 | P1 |
| 管理ページ権限 | `settings/adminPermissions` | `AdminAuthGuard`, admin layout, permissions page | 単純設定更新 | 必須 | 管理者のみ。管理者権限は常に残す | P0 |
| 耐圧検査の有効年数 | `settings/inspection.validityYears` | `staff/inspection`, `staff/dashboard`, `useInspectionSettings` | 単純設定更新 | 必須 | 管理者または準管理者でも可だが履歴必須 | P0 |
| 耐圧検査の告知開始月数 | `settings/inspection.alertMonths` | `staff/inspection`, `staff/dashboard`, `useInspectionSettings` | 単純設定更新 | 必須 | 同上 | P0 |
| 発注品目マスタ | `orderMaster` | `staff/order`, `TankEntryScreen` のタンク種別候補 | 単純マスタ更新 | 推奨 | 管理者/準管理者可。削除は慎重 | P0 |
| タンク種別候補 | 現状は `orderMaster(category=="tank")` + code fallback | `staff/tank-purchase`, `staff/tank-register`, `TankEntryScreen` | 当面は `orderMaster` に寄せる。将来は `tankTypeMaster` 検討 | 推奨 | 現場入力に直結するため変更履歴推奨 | P1 |
| 貸出先名・有効/無効 | `customers` | `OperationsTerminal` の貸出先候補, `staff/dashboard`, billing/admin | service 推奨。正本は `customers`。`destinations` は廃止済み | 必須 | 準管理者可でもよいが名称変更は注意 | P0 |
| 貸出先別単価 | `customers.price10/price12/priceAluminum` | `admin/billing`, 将来の請求計算 | service 推奨。正本は `customers` | 必須 | 金銭権限者のみ | P1 |
| ポータル利用者と貸出先の紐付け | `customerUsers.customerId/customerName/status`, `transactions` pending link 更新 | `admin/settings` customer tab, 将来の portal Auth | service 必須。pending transaction 更新を伴う | 必須 | 管理者/準管理者可。誤紐付けは業務影響大 | P0 |
| 操作単価 | `priceMaster` | `admin/money`, `incentive-rules.ts` の設計上の入力 | 単純マスタ更新。ただし計算側接続は別確認 | 必須 | 金銭権限者のみ | P1 |
| ランク条件 | `rankMaster` | `admin/money`, `incentive-rules.ts` の設計上の入力 | 単純マスタ更新 | 必須 | 金銭権限者のみ | P1 |
| 通知先メール | `notifySettings/config.emails` | `admin/notifications` | 単純設定更新 | 推奨 | 管理者/準管理者可。個人情報扱い | P2 |
| LINE通知設定 | `lineConfigs` | `admin/notifications` | 単純マスタ更新。token は秘匿扱い | 必須 | 管理者のみ推奨。token 表示制限が必要 | P2 |
| 自動返却時刻 | `settings/portal` | 顧客ポータル返却画面 | 単純設定更新 | 推奨 | staff 画面では未使用。ポータル影響あり | P2 |
| ログ修正可能時間 | 現状 code 定数 `72h` が `staff/dashboard` と `tank-operation.ts` に存在 | `staff/dashboard`, `applyLogCorrection`, `voidLog` | operation/service 必須。設定化するなら `settings/logCorrection` | 必須 | 管理者のみ。現場不正防止に直結 | P2 |
| タンク初期登録時の保管場所候補 | 現状 code 固定 `["倉庫", "自社"]` | `TankEntryScreen` | 当面固定。設定化するなら `settings/tankEntry` | 推奨 | 業務フローに影響。急がない | P3 |
| メンテナンス画面のタブ/ナビ | code 固定 | `staff/layout`, `MaintenanceTabs`, `ProcurementTabs` | code 管理 | 不要 | 権限は page permissions 側で管理 | P3 |

## 保存先コレクション案

| 保存先 | 用途 | 現状 | 方針 |
|---|---|---|---|
| `staff` | スタッフ正本 | 管理画面設定タブで編集 | 継続。変更履歴を追加する |
| `staffByEmail` | 認証・Rules 用ミラー | `staff` 保存時に同期 | 直接編集禁止。service から更新 |
| `settings/adminPermissions` | 管理ページ権限 | 既存 | 継続。管理者権限を常に保持 |
| `settings/inspection` | 耐圧検査設定 | 既存 | staff 画面と管理画面の接続済み。履歴追加が次 |
| `settings/portal` | ポータル設定 | 既存 | staff 画面対象外。別計画で管理 |
| `settings/logCorrection` | ログ修正可能時間など | 未作成 | P2 で検討。`tank-operation.ts` と同時に設計 |
| `orderMaster` | 発注品目・タンク種別候補 | 既存 | 当面継続。タンク種別候補としても利用 |
| `customers` | 貸出先・請求単位 | 既存 | 正本に寄せる |
| `destinations` | 旧貸出先/料金 | 廃止済み | コード参照・書き込み・管理 UI は削除済み。Firestore データ削除は別作業 |
| `customerUsers` | ポータル利用者 | 既存。ただし portal Auth 本番化は未実装 | 貸出先紐付けは service 化。portal 移行は Rules とセットで別レビュー |
| `priceMaster` | 操作単価 | 既存 | 金銭権限者のみ編集 |
| `rankMaster` | ランク条件 | 既存 | 金銭権限者のみ編集 |
| `notifySettings` | 通知設定 | 既存 | P2。staff 現場設定とは分離 |
| `lineConfigs` | LINE通知設定 | 既存 | token 管理に注意 |
| `edit_history` | 変更監査ログ | 既存 | 重要設定の変更履歴に使う |
| `delete_history` | 削除監査ログ | 既存 | マスタ削除時に使う |

## 現在の利用箇所詳細

### staff 操作・貸出/返却/充填

| 利用値 | 現在の場所 | 現在の取得元 | 管理画面接続 |
|---|---|---|---|
| 操作種別 `貸出/返却/充填` | `OperationsTerminal`, `MODE_CONFIG` | `tank-rules.ts` | 管理画面化しない。業務ルール |
| 返却タグ `通常/未使用/未充填` | `CONDITION_LABELS`, `BULK_TAGS` | code 固定 + `tank-rules.ts` | 管理画面化しない。表示文言だけなら別途検討 |
| 貸出先候補 | `useDestinations`, `ManualOperationPanel`, dashboard 一括貸出先変更 | `customers`, logs location | `customers` を正本に寄せる |
| 操作者名 | 各操作 hook/page | `localStorage staffSession` | `staff` 管理と認証フローを正とする |
| 状態遷移可否 | `validateTransition`, `applyTankOperation` | `tank-rules.ts`, `tank-operation.ts` | 管理画面化しない |

### staff メンテナンス

| 利用値 | 現在の場所 | 現在の取得元 | 管理画面接続 |
|---|---|---|---|
| 破損/不良/修理済み | `staff/damage`, `staff/repair` | `STATUS`, `ACTION` | 管理画面化しない |
| 耐圧検査有効年数 | `staff/inspection` | `settings/inspection.validityYears` | 既に接続済み |
| 耐圧検査告知月数 | `staff/inspection`, `staff/dashboard` | `settings/inspection.alertMonths` | 既に接続済み |
| 次回耐圧期限 | `tanks.nextMaintenanceDate` | タンク操作時に更新 | operation 経由。直接編集は慎重 |

### staff 発注/タンク登録

| 利用値 | 現在の場所 | 現在の取得元 | 管理画面接続 |
|---|---|---|---|
| 資材発注品目 | `staff/order` | `orderMaster` | 既に接続済み |
| タンク購入/登録時のタンク種別 | `TankEntryScreen` | `orderMaster(category=="tank")` + 既存 tanks + fallback | `orderMaster` を当面正とする |
| 初期ステータス | `TankEntryScreen` | `STATUS.EMPTY`, `STATUS.FILLED` | 管理画面化しない |
| 初期保管場所 | `TankEntryScreen` | code 固定 `倉庫`, `自社` | P3。必要なら `settings/tankEntry` |
| 購入先・購入日・単価 | `TankEntryScreen`, `submitTankEntryBatch` | 入力値、`tankProcurements` | operation/service 経由 |

### staff ダッシュボード

| 利用値 | 現在の場所 | 現在の取得元 | 管理画面接続 |
|---|---|---|---|
| ステータス集計 | `staff/dashboard` | `tanks`, `STATUS` | 管理画面化しない |
| 耐圧アラート | `staff/dashboard` | `settings/inspection` | 既に接続済み |
| 受注/返却待ち数 | `staff/dashboard` | `transactions` | 管理画面対象外 |
| ログ編集/取消権限 | `staff/dashboard`, `tank-operation.ts` | staff role + code 定数 72h | P2。設定化するなら operation と同時 |
| 一括貸出先変更候補 | `staff/dashboard` | `customers` + logs location | `customers` 正本化が必要 |

## 単純マスタ更新か、operation/service を通すべきか

### 単純マスタ更新でよい

- `settings/inspection`
- `orderMaster`
- `priceMaster`
- `rankMaster`
- `notifySettings/config`
- `lineConfigs`（ただし token 表示・権限に注意）

### service を通すべき

- `staff` 更新
  - `staffByEmail` 同期が必要。
  - role 変更は権限に直結する。
- `customers` / 貸出先更新
  - `logs.location` は履歴表示名として残る。
  - 顧客名変更と過去ログの扱いを明確にする必要がある。
- `customerUsers` 紐付け
  - `transactions(status=="pending_link")` の更新を伴う。
- ログ編集/取消設定
  - `staff/dashboard` と `tank-operation.ts` の両方に関わる。
- タンク登録/購入
  - `tanks`, `tankProcurements`, `logs` を同時に書くため、既存 `submitTankEntryBatch` のような業務ハブを通す。

### operation/service からのみ変更すべき

- `tanks.status`
- `tanks.location`
- `logs` の新規作成・revision・取消
- `transactions` の完了処理とそれに伴うタンク貸出/返却
- `nextMaintenanceDate` の検査完了に伴う更新

## 変更履歴方針

| 対象 | 履歴要否 | 理由 | 保存先案 |
|---|---|---|---|
| staff role/passcode/isActive | 必須 | 権限・現場操作可否に直結 | `edit_history` |
| adminPermissions | 必須 | 管理機能アクセスに直結 | `edit_history` |
| inspection settings | 必須 | 対象タンク・期限計算が変わる | `edit_history` |
| customers name/prices/isActive | 必須 | 請求・貸出先候補に影響 | `edit_history` |
| customerUsers link/status | 必須 | 顧客申請の紐付けに影響 | `edit_history` |
| priceMaster/rankMaster | 必須 | 金銭・スコアに影響 | `edit_history` |
| orderMaster | 推奨 | 発注・タンク種別候補に影響 | `edit_history`, 削除時 `delete_history` |
| notifySettings/lineConfigs | 推奨/必須 | 通知漏れ・token 管理に影響 | `edit_history` |
| UI表示色・タブ | 不要 | code 管理でよい | なし |

## 権限上の注意

- `管理者` は全機能アクセス可を維持する。
- `準管理者` に許可する場合も、以下は管理者のみを推奨する。
  - staff role/passcode/isActive
  - adminPermissions
  - priceMaster/rankMaster
  - lineConfigs token
  - ログ修正可能時間
- `settings/adminPermissions` で準管理者のページアクセスを制御しているが、Firestore Rules 側の本番適用状況とは別に考える必要がある。
- staff パスコード運用が残っているため、厳格な Rules 有効化とは別タスクで進める。
- 管理画面上で削除できるマスタは、削除前に参照中データの有無を確認する。
- 顧客名・貸出先名は logs の履歴表示と紐付くため、名称変更時に過去ログを書き換えない方針を明記する。

## 実装優先度

### P0: 既に接続済みだが、安全性を固める

1. `settings/inspection` の変更履歴追加。
2. `staff` / `staffByEmail` 更新の service 境界を明文化。
3. `settings/adminPermissions` の変更履歴追加。
4. `orderMaster` の削除履歴追加。
5. `customers` を貸出先正本として扱う方針を管理画面に反映。

### P1: 現場画面に効くマスタを整理する

1. `orderMaster(category=="tank")` をタンク種別候補の正本として扱う。
2. `customers` 正本方針に沿って、名称変更・有効無効・単価変更の service 境界を決める。
3. 貸出先別単価は `customers` を正本とし、別料金マスタが必要かは請求設計で再判断する。
4. `priceMaster` / `rankMaster` と実際の報酬・実績画面の接続範囲を確認する。

### P2: 業務ルールに近い設定を慎重に扱う

1. ログ編集/取消可能時間を設定化するか判断。
2. 通知設定と耐圧検査設定の重複を整理する。
3. LINE token の表示制限・更新履歴を設計する。
4. portal 設定は staff 現場設定とは別計画で扱う。

### P3: 今は急がない

1. タンク登録時の初期保管場所候補の設定化。
2. staff ナビ・タブ構成の管理画面化。
3. ステータス表示色の設定化。
4. 画面文言・色・アイコンの管理画面化。

## 今は触らない方がいい項目

| 項目 | 理由 |
|---|---|
| `tank-rules.ts` の `STATUS` / `ACTION` / `OP_RULES` | 全画面・`tank-operation.ts` の不変条件。管理画面化すると状態遷移の安全性が落ちる |
| `tank-operation.ts` の transaction/revision 実装 | data layer migration と競合しやすく、業務整合性の中心 |
| `logs` の書き込み API | ログ作成・編集・取消は必ず `tank-operation.ts` 経由 |
| Security Rules | 認証方式・staff パスコード運用とセットで別設計にする |
| repository 移行中のファイル | Claude Code 側の data layer migration と競合する |
| `customers` → `customerId` 参照への全面移行 | 必要だが、既存 logs/location 表示と履歴に影響するため別 migration |
| 通知実行基盤の実装 | 現在は設定画面中心。通知送信処理は別タスク |
| UI/ナビ設定の管理画面化 | 業務価値が低く、コード管理の方が安全 |

## 推奨する次の設計タスク

1. `customers` 正本化後の service 境界を小さな設計書に分ける。
2. `edit_history` / `delete_history` の共通記録フォーマットを決める。
3. `settings/inspection` と `notifySettings` の耐圧関連値の役割を整理する。
4. staff 権限変更時の service 境界を定義する。
5. ログ修正可能時間を設定化するか、現状 code 固定のままにするか決める。
