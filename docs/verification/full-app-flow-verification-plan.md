# Full App Flow Verification Plan

作成日: 2026-05-08

対象:

- Security Rules deploy 後の全機能回帰検証
- 本番アプリフロー検証
- 画面別 / 機能別の検証マトリクス

この document は検証計画である。この PR では本番アプリ操作、Firestore data create / update / delete、deploy は実行しない。

---

## 1. Current State

- main commit: `4e36970e5bc368a50e38cd059bee61735464e6a9`
- Security Rules deploy: 完了済み
- deploy command: `firebase --project okmarine-tankrental deploy --only firestore:rules`
- deploy exit code: 0
- rollback: 不要
- Hosting deploy: 今回は未実行
- 無指定 `firebase deploy`: 未実行
- Firestore Console / script による本番 data 直接 edit: 未実行
- PR #61 post-deploy smoke:
  - staff / admin: pass
  - portal: partial。setup 未完了 portal session のため `/portal/setup` に redirect した

---

## 2. Purpose

Security Rules deploy 後に、主要画面と業務フローが本番 Firebase project 上で期待どおり動くかを確認する。

この検証は単なる smoke test ではない。画面表示だけでなく、必要に応じてアプリ通常フロー経由の write を確認する。

ただし、本番 data を壊さないため、write 操作は検証用 customer / portal account / tank / note が明確な場合だけ実行する。

---

## 3. Verification Levels

| level | name | definition | default handling |
|---|---|---|---|
| L0 | read-only | login / display / list / detail / dashboard / read query の確認 | 先に実行してよい |
| L1 | safe write | 検証用 data だけに閉じる create / update。通常フローで作成し、業務影響が限定的 | 対象 data を明記してから実行 |
| L2 | high-risk write | tank status、logs、transactions completion、settings、permissions、master、billing、void / edit / delete など業務状態や履歴に影響する操作 | 個別承認が必要 |
| L3 | destructive / irreversible | delete、void、履歴が残る修正、請求や売上に影響する操作、実運用中 tank の状態変更 | 原則停止。専用手順が必要 |

---

## 4. Global Stop Conditions

以下に該当する場合は検証実行を止める。

- 対象 branch / commit が不明。
- 本番 project / local dev / Hosting URL のどれを触っているか不明。
- 検証用 customer / portal account / tank / note が決まっていない write 操作。
- 実運用中の tank / customer / staff / transaction に影響する可能性がある操作。
- delete / void / edit / return / fulfill / repair / inspection / billing など履歴や業務状態に残る操作で、事前承認がない。
- permission-denied が出たあと、原因を記録せずに再試行しようとしている。
- partial update が疑われる。
- Firestore Console / script で本番 data を直接編集しようとしている。
- Security Rules deploy / Hosting deploy / `firebase deploy` を実行しようとしている。
- 検証結果を記録する担当者 / 時間がない。

---

## 5. Verification Data Policy

本番 write を行う場合は、事前に以下を決める。

| item | required decision |
|---|---|
| verification customer | 実業務に影響しない customer。既存顧客を使う場合は明示承認が必要 |
| setup-complete portal account | 検証用 customerUser。実顧客 account は使わない |
| verification tank | **`A-99`（専用L2検証タンク、実運用外）。定義は §5.1**。貸出 / 返却 / 充填 / 破損 / 修理 / 耐圧検査の状態変更に使ってよい |
| verification note | `VERIFY-PR<NN>-<YYYYMMDD>`（抽出系PR）/ `VERIFY-<PURPOSE>-<YYYYMMDD>`（その他）。後で検索できる marker を使う。運用は §5.2 |
| rollback expectation | 通常フローで戻せるのか、履歴が残るだけで戻せないのかを事前に書く |

Firestore Console / script で検証用 data を直接作成・更新・削除しない。必要な data はアプリ通常フローで作る。

---

### 5.1 専用L2検証タンク（確定: `A-99`）

更新: 2026-07-22。従来この plan は「verification tank = 実運用に使われていない tank」と概念定義するのみで具体的 tank ID が未指定だった。そのため抽出系PR（PR-01〜PR-10）の L2 手動確認が停止条件（§4「検証用 tank が決まっていない write 操作」）に該当し、PR-01（#143）でも L2 は未実施のまま merge された。本節でこれを解消し、専用 L2 検証 tank を 1 本確定する。

| item | value |
|---|---|
| tank ID | `A-99`（入力 `A99` / `A-99` は helper で canonical `A-99` に正規化される） |
| 初期 status | `空`（`empty`） |
| location | `倉庫` |
| 種別（type） | 任意（例: `アルミ`）。検証用のため業務的意味は持たせない |
| memo（tank.note） | `L2検証専用タンク（実運用外）` を推奨。data 上で test tank と判別できるようにする |
| 位置づけ | 実物のない construct-isolated な検証専用 tank。実運用の貸出 rotation には入れない |
| 現況 | **作成済み（2026-07-22）**。`/staff/tank-register` 経由で作成。`/staff/dashboard` で `status=空` / `location=倉庫` / `action=タンク登録`（logKind=procurement）を確認済み |

なぜ `空/倉庫` 開始か:

- `破損報告`（`ACTION.DAMAGE_REPORT`）の許容元 status は `空 / 充填済み / 自社利用中`、遷移先は `破損`、location は `倉庫` に設定される。
- `修理済み`（`ACTION.REPAIRED`）の許容元は `破損 / 不良`、遷移先は `空`、location は `倉庫` に設定される。
- したがって `空/倉庫` から開始すると、破損→修理は `空/倉庫 → 破損/倉庫 → 空/倉庫` の完全往復になり、**net の状態変化はゼロ・追加されるのは logs 2 本のみ**。delete / void なしで自然復元できる（§5.2 の rollback）。

#### 作成手順（一度きりの L3 write。ユーザー個別承認済み）

Firestore Console / script による直接 create は禁止（§4）。必ずアプリ通常フローで作成する。

1. 経路: `/staff/tank-register`（`TankEntryScreen` mode=`register`）。staff ログイン必須（`requireStaffIdentity()`）。
2. 入力:
   - タンクID: `A99`（`追加` で `A-99` に正規化される）
   - タンク種別: 任意（例: `アルミ`）
   - 初期ステータス: `空`
   - 保管場所: `倉庫`
   - 次回耐圧期限: 空欄
   - メモ: `L2検証専用タンク（実運用外）`
3. `1本を登録` → 確認ダイアログ `1本を登録しますか？` → 実行。
4. 期待 write（1 transaction, atomic）:
   - `tanks/A-99` create: `{ status: empty, location: 倉庫, type, note, createdAt, updatedAt }`
   - `tankProcurements/*` create: `{ kind: "register", tankIds: ["A-99"], initialStatus: empty, unitCost: 0, totalCost: 0, ... }`（register mode は unitCost=0 固定 → **費用計上なし**）
   - `logs/*` create: `{ action: "タンク登録", newStatus: empty, logKind: "procurement", logStatus: "active", ... }`
5. 既存 `A-99` があると register transaction は `A-99 は既に登録されています` で throw する（上書き事故は起きない）。
6. 期待表示: `1本を登録しました`。

#### 非干渉の根拠（本番 Firestore 直結環境での安全性）

現行 dev は本番 Firestore に直結する（`config.ts` に Emulator 切替なし。`FIRESTORE_EMULATOR_HOST` で自動接続するのは Admin SDK のみで、Web SDK singleton `db` は本番へ向く）。その前提で `A-99` が他フローと干渉しない理由:

- **ID衝突なし**: `A-99` は実物のない専用 ID。register の存在チェックと form の `tankMap` チェックにより、既存 tank を上書きしない。
- **貸出 rotation 非参加**: `A-99` は実物がないため現場 scan されず、実顧客へ貸し出されない。触るのは検証実行者のみ。
- **請求非対象**: register は `unitCost=0`（費用計上なし）。請求は customerId 単位の貸出で数えるため、実顧客へ貸さない `A-99` は請求・売上集計に入らない。破損/修理は請求に影響しない。
- **集計フットプリント（唯一の常設コスト）**: `A-99` は tank 総数 +1 として dashboard / 一覧に出る。検証実行中のみ一時的に `修理待ち`（破損）に現れる。緩和策: memo で test tank と明示 / 破損→修理を連続実行して `破損` の窓を最小化 / 検証間は `空/倉庫` の idle 状態で待機（実運用の予備 tank と区別がつかない良性状態）。
- **原子性・追記型**: 全操作は通常 app-flow 遷移（`applyBulkTankOperations` / `applyTankOperation` 経由、transaction・追記型ログ）。partial update は §4 で即停止。
- **恒久廃止時**: `A-99` を将来完全に廃止する場合も、delete ではなく通常フローの `破棄`（`ACTION.DISPOSE`）で行い、履歴を残す。

---

### 5.2 標準L2手順: 破損 → 修理 ラウンドトリップ

抽出系PR（PR-01 damage-workflow / PR-02 repair-workflow 等）の L2 手動シナリオ確認は、この固定手順で行う。対象 tank は §5.1 の `A-99`。marker は当該 PR に応じて `VERIFY-PR<NN>-<YYYYMMDD>`（例: PR-02 を 2026-07-22 に確認 → `VERIFY-PR02-20260722`）。

前提: 本手順は L2（tank status / logs への write）。§2 の停止条件に該当がないこと、ユーザー個別承認があること、記録者・記録先PRが決まっていることを確認してから開始する。

| # | step | 操作 | 期待結果 / 期待 write |
|---:|---|---|---|
| 0 | 事前 read 記録 | `/staff/dashboard` 等で `A-99` の現在 status / location を読み、記録する | 期待: `空 / 倉庫`。異なる場合は通常フローで `空/倉庫` に戻すか、原因を記録して停止（§4） |
| 1 | 破損報告 | `/staff/damage` で `A-99` を queue 追加 → note に marker（例 `VERIFY-PR02-20260722`）を入力 → `1件の破損報告` → 確認 `1本の破損報告を送信しますか？` → 送信 | `tanks/A-99`: `status → 破損`, `location → 倉庫`。`logs` に active log（`action=破損報告`, `logNote=marker`, prev/next snapshot）。表示 `1本の破損報告を完了しました` |
| 2 | 期待結果確認 | `/staff/repair` の `修理待ち` と `/staff/dashboard` の最近ログを確認 | `A-99` が `破損` として `修理待ち` に出る。dashboard の最近ログに `破損報告` + marker が active で見える |
| 3 | 修理完了 | `/staff/repair` で `A-99` を選択 → `修理完了（1本）` → 確認 `修理完了：1本を処理しますか？` → 処理 | `tanks/A-99`: `status → 空`, `location → 倉庫`。`logs` に active log（`action=修理済み`）。表示 `1本の修理完了を処理しました` |
| 4 | 復元確認 | `/staff/repair` と `/staff/dashboard` を再確認 | `A-99` が `空/倉庫` に復元。`修理待ち` から消える。marker で `破損報告 → 修理済み` の 2 ログチェーンを追跡できる |

rollback / cleanup:

- **不要**。往復で `A-99` は `空/倉庫` に自然復元される（追加されるのは検証履歴ログのみ）。
- delete / void / Firestore 直接編集は行わない。破損報告・修理済みログは本番アプリ通常フローの検証履歴として残す。

記録:

- 結果は §9 Result Recording Template に沿って、当該 PR 本文（または `docs/verification/<pr>-l2-result.md`）へ記載する。`検証用 tank = A-99`、`marker = VERIFY-PR<NN>-<YYYYMMDD>`、事前 read 値、各 step の actual / result を残す。

他 L2 フローへの拡張:

- 充填・貸出・返却・自社利用・耐圧検査など他の抽出系 PR も、同じ `A-99` を使い「事前 read → 対象 action → 期待遷移確認 → 通常フローで `空/倉庫` へ戻す → 履歴確認」の型で行う。貸出系は §5 の verification customer / portal account の決定も併せて必要（`A-99` を実顧客へ貸さない運用を守る）。

---

## 6. Screen Inventory

`src/app` の `page.tsx` を基準に棚卸しした画面。

### Staff

| route | purpose | default level | data impact | rollback | note |
|---|---|---:|---|---|---|
| `/staff` | staff entry / redirect | L0 | none | n/a | `/staff/lend` 相当の導線確認 |
| `/staff/lend` | 手動貸出 / 受注貸出 | L0 / L2 | lend 操作は `tanks` / `logs` / `transactions` に影響 | 状態遷移で戻す。履歴は残る | 実行は検証用 tank / order 必須 |
| `/staff/return` | 手動返却 / return tag processing | L0 / L2 | return 操作は `tanks` / `logs` / `transactions` に影響 | 状態遷移で戻す。履歴は残る | `pending_return` transaction が必要 |
| `/staff/fill` | 充填 | L0 / L2 | `tanks` / `logs` に影響 | 状態遷移で戻す。履歴は残る | 検証用 tank 必須 |
| `/staff/inhouse` | 自社利用 / logNote tag | L0 / L2 | tank status / location / logNote に影響 | 状態遷移で戻す。履歴は残る | 実運用中 tank は不可 |
| `/staff/damage` | 破損報告 | L0 / L2 | tank status / logs に影響 | 修理完了等で戻す。履歴は残る | 検証用 tank 必須 |
| `/staff/repair` | 修理完了 | L0 / L2 | tank status / logs に影響 | 履歴は残る | 破損状態の検証用 tank 必須 |
| `/staff/inspection` | 耐圧検査完了 | L0 / L2 | tank maintenance fields / logs に影響 | 履歴は残る | 検証用 tank 必須 |
| `/staff/dashboard` | status / logs dashboard | L0 / L3 | edit / void / bulk location は logs / tanks に影響 | void/edit は履歴が残る | 表示のみを先に確認 |
| `/staff/mypage` | staff activity | L0 | none | n/a | staff session / stats 表示 |
| `/staff/supply-order` | 備品・資材発注 | L0 / L1 | `orders` 等に発注 data が残る | cancel/delete 手順が必要な場合あり | 検証用 item / note 必須 |
| `/staff/tank-purchase` | タンク購入 | L0 / L2 | procurement data に影響 | 手戻し困難な場合あり | 専用検証 data 必須 |
| `/staff/tank-register` | タンク登録 | L0 / L3 | `tanks` / procurement / logs に新規 data | 削除や無効化方針が必要 | 原則別手順 |
| `/staff/order` | legacy redirect | L0 | none | n/a | `/staff/supply-order` redirect 確認 |

### Admin

| route | purpose | default level | data impact | rollback | note |
|---|---|---:|---|---|---|
| `/admin` | admin dashboard | L0 | none | n/a | permission-denied がないこと |
| `/admin/sales` | sales statistics | L0 | none | n/a | 集計表示 |
| `/admin/staff-analytics` | staff analytics | L0 | none | n/a | staff stats 表示 |
| `/admin/customers` | customer master | L0 / L2 | customer create/update/active toggle | 変更履歴や元値が必要 | write は個別承認 |
| `/admin/customers/users` | portal users / customer linking | L0 / L2 | `customerUsers` / pending_link transaction に影響 | unlink 方針が必要 | 検証用 portal user 必須 |
| `/admin/billing` | invoice / billing | L0 / L3 | 請求書生成や売上確定に影響する可能性 | 手戻し困難 | 表示のみ |
| `/admin/staff` | staff master / join requests | L0 / L2 | staff / staffByEmail / staffByUid / staffJoinRequests に影響 | 手戻し方針が必要 | 既存 staff 編集は不可 |
| `/admin/permissions` | page permissions | L0 / L3 | `settings/adminPermissions` に影響 | 誤ると管理画面アクセスに影響 | 表示のみ。write は専用手順 |
| `/admin/money` | price / rank master | L0 / L3 | `priceMaster` / `rankMaster` に影響 | 請求・報酬に影響 | 表示のみ |
| `/admin/order-master` | order item master | L0 / L2 | `orderMaster` に影響 | 元値記録が必要 | 検証 item は専用手順 |
| `/admin/settings` | legacy redirect | L0 | none | n/a | portal settings への redirect 確認 |
| `/admin/settings/portal` | portal settings | L0 / L3 | `settings/portal` に影響 | 業務時刻に影響 | 表示のみ |
| `/admin/settings/inspection` | inspection settings | L0 / L3 | inspection config に影響 | tank maintenance に影響 | 表示のみ |
| `/admin/notifications` | notify settings | L0 / L3 | mail / LINE notification settings に影響 | 通知事故リスク | 表示のみ |
| `/admin/state-diagram` | transition diagram | L0 | none | n/a | static display |
| `/admin/security-rules` | rules overview | L0 | none | n/a | deploy 後も表示できること |

### Portal

| route | purpose | default level | data impact | rollback | note |
|---|---|---:|---|---|---|
| `/portal/login` | portal login | L0 | auth session only | sign out | Google popup は環境制約あり |
| `/portal/register` | account registration | L1 / L2 | Firebase Auth / customerUsers に影響 | Auth user cleanup が必要 | 検証用 account 必須 |
| `/portal/setup` | customerUser setup | L1 | `customerUsers` profile update | 元値に戻すには app flow / admin linking 方針が必要 | setup 完了済み account は編集不要 |
| `/portal` | portal dashboard | L0 | login update / session update | n/a | setup-complete account で確認 |
| `/portal/order` | portal order create | L1 | `transactions` order create | cancel/delete 方針が必要 | 検証用 order marker 必須 |
| `/portal/return` | portal return create | L1 / L2 | `transactions` return create | staff processing で完了。履歴は残る | 検証用 lent tank 必須 |
| `/portal/unfilled` | uncharged report create | L1 / L2 | `transactions` uncharged_report create | staff/admin 処理方針が必要 | 検証用 tank 必須 |

---

## 7. Functional Flow Matrix

| flow | primary screens | level | expected result | data impact | rollback / cleanup | required pre-approval |
|---|---|---:|---|---|---|---|
| staff login | `/staff/lend` | L0 | Firebase Auth staff account で staff UI に入れる | none | sign out | no |
| admin login | `/admin` | L0 | admin UI に入れる | none | sign out | no |
| portal login setup-complete | `/portal` | L0 | setup 完了 account で dashboard に入れる | login update 程度 | n/a | account 確認 |
| portal setup incomplete | `/portal/setup` | L1 | setup 完了できる | `customerUsers` update | 元値に戻す方針が必要 | yes |
| portal order create | `/portal/order` | L1 | `pending` or `pending_link` order が作成される | `transactions` create | 検証 order として残すか、後続で完了 | yes |
| staff order approve | `/staff/lend` | L2 | order が `approved` になる | `transactions` update | 履歴として残る | yes |
| staff order fulfill | `/staff/lend` | L2 | order completed、tank lend、logs create | `transactions` / `tanks` / `logs` write | 状態遷移で戻す。履歴は残る | yes |
| portal return create | `/portal/return` | L1 / L2 | `pending_return` transaction が作成される | `transactions` create | staff return tag processing で完了 | yes |
| return tag processing normal | `/staff/return` | L2 | return completed、tank returned、logs create | `transactions` / `tanks` / `logs` write | 履歴は残る | yes |
| return tag processing unused | `/staff/return` | L2 | unused return として完了 | `transactions` / `tanks` / `logs` write | 履歴は残る | yes |
| return tag processing uncharged | `/staff/return` | L2 | uncharged return として完了 | `transactions` / `tanks` / `logs` write | 履歴は残る | yes |
| return tag processing keep | `/staff/return` | L2 | carry-over として完了 | `transactions` / `tanks` / `logs` write | 履歴は残る | yes |
| portal unfilled report create | `/portal/unfilled` | L1 / L2 | uncharged_report transaction が作成される | `transactions` create | 対応方針が必要 | yes |
| staff manual lend | `/staff/lend` | L2 | tank が貸出中になる、log 作成 | `tanks` / `logs` write | 返却で戻す。履歴は残る | yes |
| staff manual return | `/staff/return` | L2 | tank が倉庫側へ戻る、log 作成 | `tanks` / `logs` write | 履歴は残る | yes |
| staff fill | `/staff/fill` | L2 | tank が充填済みになる、log 作成 | `tanks` / `logs` write | 状態遷移で戻す。履歴は残る | yes |
| staff damage | `/staff/damage` | L2 | tank が破損扱いになる、log 作成 | `tanks` / `logs` write | repair flow が必要。履歴は残る | yes |
| staff repair | `/staff/repair` | L2 | repair complete | `tanks` / `logs` write | 履歴は残る | yes |
| staff inspection | `/staff/inspection` | L2 | inspection complete | `tanks` / `logs` write | 履歴は残る | yes |
| inhouse use / return | `/staff/inhouse` | L2 | in-house state transition / logs create | `tanks` / `logs` write | 状態遷移で戻す。履歴は残る | yes |
| log edit / void | `/staff/dashboard` | L3 | revision / void rules work | `logs` / related fields | 戻しにくい。履歴が残る | separate procedure |
| customers master write | `/admin/customers` | L2 / L3 | customer save / active toggle works | `customers` write | 元値と復旧手順が必要 | separate procedure |
| portal user linking | `/admin/customers/users` | L2 | `customerUsers` linked, pending_link promoted | `customerUsers` / `transactions` write | unlink 方針が必要 | separate procedure |
| staff master write | `/admin/staff` | L2 / L3 | staff save / active toggle works | `staff` / `staffByEmail` write | auth/login に影響 | separate procedure |
| permissions save | `/admin/permissions` | L3 | permissions persist | `settings/adminPermissions` write | admin access に影響 | separate procedure |
| portal settings save | `/admin/settings/portal` | L3 | settings persist | `settings/portal` write | portal behavior に影響 | separate procedure |
| notification settings save | `/admin/notifications` | L3 | notify settings persist | notify settings write | 通知事故リスク | separate procedure |
| billing generation | `/admin/billing` | L3 | invoice flow works | billing artifacts / sales impact | 手戻し困難 | separate procedure |

---

## 8. Proposed Execution Order

### Phase 0: Preparation

1. 対象 commit / URL / project を記録する。
2. 検証用 portal account、customer、tank、note marker を決める。
3. 本番 write を許可する flow を明示する。
4. 失敗時の停止連絡と記録方法を決める。

### Phase 1: Read-Only Access Sweep

目的:

- Security Rules deploy 後に主要画面で `permission-denied` が出ないことを確認する。

対象:

- staff 全 route
- admin 全 route
- portal login / setup / dashboard route

この phase では form submit / save / approve / fulfill / return / delete / void は押さない。

### Phase 2: Portal Account Readiness

目的:

- setup-complete portal account で `/portal` / `/portal/order` / `/portal/return` / `/portal/unfilled` に到達できることを確認する。

write:

- setup 未完了 account の setup 完了は L1。検証用 account の場合のみ実行する。

### Phase 3: Low-Risk App Flow Writes

候補:

- portal order create
- portal unfilled report create

条件:

- 検証用 customer / tank / marker が決まっていること。
- 作成された transaction を後続 phase でどう扱うか決まっていること。

### Phase 4: Staff Transaction Flows

候補:

- order approve
- order fulfill
- return tag processing

条件:

- 検証用 order / return transaction / tank が明確。
- fulfillment / return による tank state change が許可済み。
- partial update が起きた場合は即停止。

### Phase 5: Tank State Flows

候補:

- manual lend
- manual return
- fill
- damage
- repair
- inspection
- inhouse use / return

条件:

- 検証用 tank が実運用から外れている。
- 状態遷移の expected が事前に明確。
- rollback は「状態を戻す」ではなく「新しい履歴を追加して戻す」ことを理解している。

### Phase 6: Admin Master / Settings / Billing

原則:

- 別手順。
- read-only 表示確認を先に行う。
- write は対象 field、before value、after value、復旧方法を決めてから実行する。

---

## 9. Result Recording Template

実行 PR / 記録 PR では、以下の形式で結果を残す。

| item | value |
|---|---|
| 実施日時 |  |
| 実行者 |  |
| 対象 commit |  |
| 対象 URL |  |
| 対象 Firebase project |  |
| 検証用 customer | masked / reference only |
| 検証用 portal account | masked |
| 検証用 tank | masked if needed |
| 検証用 marker |  |
| Security Rules deploy | already deployed |
| Hosting deploy during verification | not run |
| Firestore Console / script direct edit | not run |

| scenario | expected | actual | result | data impact | rollback / cleanup | memo |
|---|---|---|---|---|---|---|
|  |  |  | pass / fail / partial / skipped |  |  |  |

---

## 10. Non-Goals For This PR

- 全機能回帰検証を実行しない。
- 本番 Firestore data を create / update / delete しない。
- Firestore Console / script で本番 data を直接編集しない。
- Security Rules deploy しない。
- Hosting deploy しない。
- `firebase deploy` を実行しない。
- `firestore.rules` を変更しない。
- `firebase.json` を変更しない。
- `src/**` を変更しない。
- package files を変更しない。

---

## 11. Next PR Candidates

1. Full app flow read-only sweep result.
2. Setup-complete portal account smoke result.
3. Portal order create / staff approve result.
4. Order fulfill result using verification tanks.
5. Return tag processing result using verification tanks.
6. Tank state operation result using verification tanks.
7. Admin master/settings write verification plan for selected low-risk items.
