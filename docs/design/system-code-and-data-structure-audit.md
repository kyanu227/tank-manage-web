# logs / tanks / transactions とコード構造の横断監査

## 1. 目的

このドキュメントは、現行のタンク管理 Web アプリにおけるコード構造、業務責務、`logs` / `tanks` / `transactions` のデータ構造を横断的に棚卸しし、次フェーズの再設計に必要な判断材料を整理するための監査メモである。

今回の目的は最終設計を決めることではない。現行実装から以下を読み取ることに限定する。

- どの情報が現行構造から読めるか
- どの情報が読めない、または不安定か
- どの情報が正本、snapshot、導出情報、表示用情報として扱われているか
- どの業務責務が page / hook / service / repository / domain rule に置かれているか
- 今後の請求、売上、報酬、trace、修正取消、Security Rules hardening で詰まりそうな箇所はどこか

この監査結果をもとに、次フェーズでユーザーの設計思想を反映し、`logs` / `tanks` / `transactions` とコード責務を再設計する。

## 2. 現在地

直近の前提は以下。

- PR #82 merge / Hosting deploy 済み
  - 手動返却の keep / 持ち越し対応
  - keep は `ACTION.CARRY_OVER`
  - `貸出中` から `未返却` へ遷移
  - `[TAG:keep]` は `tank.logNote` に残さない
- PR #83 merge / Hosting deploy 済み
  - bulk return 側の keep / 持ち越し正式接続
  - keep は `STATUS.LENT` のみ選択・実行可能
  - `STATUS.UNRETURNED` には keep option を出さない
  - keep 実行時は location 維持、`tankNote` 空、`logNote: "持ち越し"`
- PR #84 merge / Hosting deploy 済み
  - 返却画面を `本日の貸出分` / `前日以前の貸出中` / `日付不明` / `長期貸出` に分離
  - `貸出先 x 日付プール` 単位で一括処理
  - ただし、これは `tanks.updatedAt` を貸出日の近似として使った UI 改善であり、長期的な正本設計ではない

関連 docs から読み取れる前提は以下。

- `logs.staffId` は staff の正本参照、`staffName` は当時名 snapshot として扱う方針がある。
- `logs.customerId` は customer の正本参照、`customerName` は当時名 snapshot として扱う方針がある。
- `logs.location` は履歴表示用の当時名、`tanks.location` は現在場所表示用の文字列として残す方針がある。
- `tanks.customerId` は未決事項であり、勝手に実装しない。
- `tanks.status`、`transactions.status`、`logs.logStatus` は別レイヤーの状態であり、同一視しない。
- `tank-operation.ts` はタンク状態遷移とログ作成の高リスク境界であり、単純な repository 化対象ではない。
- read repository 化は主に完了済みだが、write repository 化は別フェーズ。

## 3. コード構造の現状

### page 層

`src/app/**/page.tsx` は、画面表示だけでなく、Firestore 読み取り、集計、業務判断、更新呼び出しを持つ箇所がまだ多い。

代表例:

| 箇所 | 現状の責務 |
|---|---|
| `src/app/staff/dashboard/page.tsx` | タンク集計、ログ一覧、未充填報告一覧、修正、取消、履歴表示、bulk correction UI を同一 page で保持 |
| `src/app/admin/page.tsx` | 今日のログ、貸出中タンク、pending transactions、未充填報告、稼働スタッフ数を page 内で集計 |
| `src/app/admin/billing/page.tsx` | active logs と customers を直接読み、月次請求の初期集計を page 内で実行 |
| `src/app/admin/sales/page.tsx` | active logs と `monthly_stats` を直接読み、日次 / 月次統計を page 内で集計 |
| `src/app/admin/staff-analytics/page.tsx` | active logs を staffId で集計し、スタッフ実績ランキングを page 内で作成 |
| `src/app/portal/page.tsx` | `tanks.location` と `logs.location` を `customerName` で検索し、現在貸出と履歴を表示 |
| `src/app/portal/return/page.tsx` | `tanks.updatedAt` を貸出日の近似として表示し、portal return transaction を作成 |
| `src/app/portal/unfilled/page.tsx` | `tanks.location` と `status` から顧客の貸出中タンクを取得し、未充填報告 transaction を作成 |

page 層には、今後 stats / query / workflow service に切り出した方がよい責務が残っている。

### component 層

`ReturnTagSelector`、`QuickSelect`、各種 selector / display component は、概ね UI 入力・表示に寄っている。ただし、返却タグの表示ラベルや style は UI にあるため、業務分類の source of truth として使うべきではない。

### hook 層

`src/features/staff-operations/hooks/*` は UI 状態管理だけでなく、操作入力の組み立て、返却タグから `ACTION` への解決、bulk 処理対象の grouping などを担っている。

| hook | 主な責務 | 注意点 |
|---|---|---|
| `useManualTankOperation` | 手動貸出 / 返却 / 充填の UI state、対象 tank validation、`applyBulkTankOperations` 呼び出し | `tankNote` / `logNote`、customer snapshot、location 決定、keep / unused / uncharged の分岐を持つ |
| `useBulkReturnByLocation` | 貸出中タンクの読み取り、日付プール grouping、tag-only 更新、一括返却実行 | `tanks.updatedAt` を貸出日の近似に使う。`tanks.logNote` を一時タグ storage として使う |
| `useOrderFulfillment` | 受注一覧、承認、貸出対象 validation、fulfillment service 呼び出し | タンク状態と受注 item の照合を hook が持つ |
| `useReturnTagProcessing` | pending return transaction の取得、顧客単位 grouping、condition 選択、processing service 呼び出し | return condition の最終決定 UI state を持つ |

hook 層は現状の UI と業務操作の接着面として機能しているが、将来的に workflow service に寄せるべき分岐がある。

### service 層

service 層は、複数 collection の更新や portal / staff workflow のまとまりを担い始めている。

| service | 主な責務 |
|---|---|
| `src/lib/firebase/order-fulfillment-service.ts` | order 承認、order fulfillment、`applyBulkTankOperations` と `transactions` 更新の atomic 接続 |
| `src/lib/firebase/return-tag-processing-service.ts` | pending return transaction の条件確定、tank operation、transaction 完了 |
| `src/lib/firebase/portal-transaction-service.ts` | portal order / return / unfilled report の transaction 作成 |
| `src/lib/firebase/tank-tag-service.ts` | `tanks.logNote` への tag-only 更新 |
| `src/lib/firebase/customer-linking-service.ts` | pending transactions と customerUsers / customers の紐付け |

service 層は存在するが、すべての workflow が service に集約されているわけではない。特に dashboard の correction / void、admin stats、billing、sales は page から直接処理している。

### repository 層

`src/lib/firebase/repositories/*` は主に Firestore 読み取りの adapter として機能している。

| repository | 現状 |
|---|---|
| `tanksRepository` | `getTank` / `getTanks` は実装済み。`updateTankFields` など書き込み系は未実装 |
| `logsRepository` | active logs、root logs、tank logs、staff / customer / action / range 検索を提供。write は持たない |
| `transactionsRepository` | transaction の create / update / query を提供。transaction workflow write の薄い adapter でもある |

repository 層は業務不変条件を持たない。`tanks.status` の遷移や `logs` の revision / void は repository ではなく `tank-operation.ts` が担っている。

### domain rule / operation 層

| ファイル | 現状の責務 |
|---|---|
| `src/lib/tank-rules.ts` | `STATUS`、`ACTION`、`RETURN_TAG`、状態遷移 rule、返却タグから action への解決 |
| `src/lib/tank-operation.ts` | tank lifecycle write の中心。状態遷移 validation、`logs` 作成、`tanks` 更新、bulk operation、correction、void |
| `src/lib/operation-context.ts` | 操作 actor と customer snapshot の型 / helper |
| `src/lib/billing-rules.ts` | 現時点では action から billable を導出する軽量 rule |
| `src/lib/incentive-rules.ts` | 報酬対象 action の分類と取消 model |
| `src/lib/tank-trace.ts` | trace 用の direct Firestore read。repository 化は未完了 |

`tank-operation.ts` は、現行の `logs` と `tanks` の整合性を最も強く担う中心点である。ここを変更する場合は、データ正本の設計と同時に扱う必要がある。

## 4. 業務責務とコード層の対応

| 業務 | 主な入口 | 主な write 経路 | 依存する主な data |
|---|---|---|---|
| 貸出 | staff manual / order fulfillment | `applyBulkTankOperations` | `tanks.status`, `tanks.location`, `logs.action`, `logs.transitionAction`, customer snapshot |
| 返却 | staff manual / bulk return / return tag processing | `applyBulkTankOperations` | `tanks.status`, `tanks.location`, `tanks.logNote`, return tag / transaction condition |
| 未使用返却 | manual / bulk / return tag processing | `ACTION.RETURN_UNUSED` | return tag, `logs.action`, `logs.transitionAction` |
| 未充填返却 | manual / bulk / return tag processing | `ACTION.RETURN_UNCHARGED` | return tag, `transactions` unfilled report, trace logs |
| 持ち越し | manual / bulk / return tag processing | `ACTION.CARRY_OVER` | `STATUS.LENT` -> `STATUS.UNRETURNED`, location preserved |
| 充填 | staff manual | `ACTION.FILL` | `STATUS.EMPTY` -> `STATUS.FILLED`, location often `倉庫` |
| 自社利用 | staff inhouse page / manual operation | `ACTION.IN_HOUSE_USE` | `STATUS.FILLED` -> `STATUS.IN_HOUSE` |
| 自社返却 | staff inhouse page / return rules | self return actions | `STATUS.IN_HOUSE` -> `STATUS.EMPTY` or `STATUS.FILLED` |
| 破損報告 | staff damage page | `ACTION.DAMAGE_REPORT` | `STATUS.EMPTY` / `FILLED` / `IN_HOUSE` -> `STATUS.DAMAGED` |
| 修理済み | staff maintenance page | `ACTION.REPAIRED` | `STATUS.DAMAGED` / `DEFECTIVE` -> `STATUS.EMPTY` |
| 耐圧検査 | staff maintenance page | `ACTION.INSPECTION` | status 維持、`nextMaintenanceDate` 更新候補 |
| 破棄 | staff maintenance page | `ACTION.DISPOSE` | `STATUS.DISPOSED` |
| 返却タグ処理 | staff orders return tab | `return-tag-processing-service` + `applyBulkTankOperations` | pending return transactions, final condition |
| portal order | portal order page | `portal-transaction-service` | `transactions.type=order`, requested snapshot, items |
| portal return | portal return page | `portal-transaction-service` | `transactions.type=return`, `condition`, tankId |
| portal unfilled report | portal unfilled page | `portal-transaction-service` | `transactions.type=uncharged_report`, tankId |
| staff dashboard | staff dashboard page | read + `applyLogCorrection` / `voidLog` | active logs, tanks, unfilled reports |
| admin dashboard | admin page | read only | active logs, tanks, pending transactions |
| billing | admin billing page | read only | active logs, customers |
| staff analytics | admin staff analytics page | read only | active logs grouped by staffId |
| trace | `tank-trace.ts` | read only | active logs by tankId/action/timestamp |
| edit / void / correction | staff dashboard | `applyLogCorrection` / `voidLog` | `logs.rootLogId`, `revision`, `logStatus`, tank snapshots |

業務操作の write は `tank-operation.ts` に集まりつつある。一方で、業務判断の一部は hook / page / service に分散している。

## 5. tanks データ構造の現状

`tanks` は現在状態の snapshot として使われている。現行 repository が読み取る主な field は以下。

| field | 現行の意味 | 主な更新経路 | 主な読み取り箇所 | 評価 |
|---|---|---|---|---|
| `id` / doc id | tankId | tank 登録時 | 全体 | 正本 ID |
| `status` | 現在状態 | `applyTankOperation` / procurement | staff / portal / admin / bulk return | 現在 snapshot の正本 |
| `location` | 現在場所 / 貸出先表示名 | `applyTankOperation` / procurement | portal, bulk return, dashboard, billing 近辺 | 表示 snapshot。顧客 identity の正本には弱い |
| `staff` | 直近操作スタッフ名 | `applyTankOperation` | 一部 UI | 表示 snapshot。staff identity には弱い |
| `updatedAt` | tank doc の最終更新日時 | `applyTankOperation` / procurement | portal return, bulk return date pool | 汎用更新日時。貸出日時の正本には不適 |
| `latestLogId` | 現在 snapshot に対応する最新 active log id | `applyTankOperation` / correction / void | correction / void / trace の入口 | 整合上重要。ただし revision / void と一体で扱う必要あり |
| `logNote` | 現在メモ、または返却タグ一時状態 | `applyTankOperation` / `tank-tag-service` | bulk return tag 判定、表示 | 意味が混在。正本情報には弱い |
| `note` | tank 固有メモ | procurement / 一部登録系 | repository, UI | tank 属性メモ |
| `type` | タンク種別 | procurement / 登録 | order fulfillment validation 等 | tank 属性 |
| `nextMaintenanceDate` | 次回耐圧 / maintenance 予定 | procurement / maintenance 系 | maintenance UI 等 | tank 属性 snapshot |
| `createdAt` | 作成日時 | procurement | 限定的 | 登録監査 |

現行 `tanks` からは現在状態と現在 location は高速に読める。一方で、現在貸出の開始日時、現在貸出 log、現在 customerId、現在貸出 staffId は明示的には持っていない。

## 6. logs データ構造の現状

`logs` は tank lifecycle の履歴・監査・復元の正本になり得る構造を持つ。`applyTankOperation` が作る tank log の主な field は以下。

| field | 現行の意味 | 作成 / 更新経路 | 主な読み取り箇所 | 評価 |
|---|---|---|---|---|
| `tankId` | 対象 tank | `applyTankOperation` | 全ログ表示、trace、repository | 正本 |
| `action` | 表示用の操作名 | `applyTankOperation` の `logAction` または transition action | UI / 集計 / trace | 表示寄り。集計正本としては揺れがある |
| `transitionAction` | 状態遷移 rule 上の action | `applyTankOperation` | 今後の正規分類候補 | 業務分類の正本候補 |
| `prevStatus` | 操作前 status | `applyTankOperation` | history / audit | 監査用正本 |
| `newStatus` | 操作後 status | `applyTankOperation` | history / audit | 監査用正本 |
| `location` | 操作後 location / 当時表示名 | `applyTankOperation` | portal, billing, history | 表示 snapshot。customer identity には弱い |
| `staffId` | 操作 staff ID | `OperationContext` | staff analytics / mypage | staff identity 正本 |
| `staffName` | 操作 staff 当時名 | `OperationContext` | 表示 | 表示 snapshot |
| `staffEmail` | 操作 staff email | `OperationContext` | 監査 | 監査 snapshot |
| `customerId` | 操作対象 customer ID | `OperationContext.customer` | customer 履歴候補 | customer identity 正本候補。ただし未設定経路あり |
| `customerName` | 操作対象 customer 当時名 | `OperationContext.customer` | 表示 | 表示 snapshot |
| `note` | 操作メモ | `TankOperationInput.logNote` | dashboard / trace | 業務メモ。命名が `logNote` 入力とずれる |
| `logNote` | tank snapshot 側メモ | `TankOperationInput.tankNote` | dashboard / history | `tanks.logNote` と近い意味。正本には注意 |
| `timestamp` | 操作発生時刻 | serverTimestamp | 集計 / trace / history | 操作時刻の正本候補 |
| `originalAt` | 初版操作時刻 | correction 時にも維持 | dashboard sort / audit | correction 後の原操作時刻 |
| `revisionCreatedAt` | revision 作成時刻 | create / correction | edit window 判定 | revision 時刻 |
| `logStatus` | active / superseded / voided | create / correction / void | repository active filter | log lifecycle status |
| `logKind` | tank / procurement / order 等 | 各 write 経路 | dashboard edit eligibility | collection 内種別 |
| `rootLogId` | revision root | create / correction | history | revision chain の root |
| `revision` | revision number | create / correction | history | revision chain |
| `prevTankSnapshot` | 操作前 tank snapshot | create / correction | void / audit | 復元に重要 |
| `nextTankSnapshot` | 操作後 tank snapshot | create / correction | correction / audit | 復元に重要 |
| `previousLogIdOnSameTank` | 同 tank の直前 latestLogId | create / correction | void 後復元 | chain 復元に重要 |
| `editedAt` / `editedBy*` / `editReason` | correction metadata | `applyLogCorrection` | dashboard history | 監査用 |
| `voidedAt` / `voidedBy*` / `voidReason` | void metadata | `voidLog` | dashboard history | 監査用 |

`logs` には revision / void / snapshot 復元に必要な情報が多く入っている。ただし、`action` が表示名と業務分類を兼ねており、`logNote` / `note` の意味も入力名と保存名がずれている。

また、procurement や supply order 由来の log も同じ `logs` collection に保存される。これらは `logKind` により tank lifecycle log とは区別できるが、集計側が `logKind` を常に考慮しているわけではない。

## 7. transactions データ構造の現状

`transactions` は顧客 portal や staff workflow の依頼・承認・処理待ちを表す。

| field | 現行の意味 | 主な作成 / 更新経路 | 評価 |
|---|---|---|---|
| `type` | `order` / `return` / `uncharged_report` | portal transaction service | workflow 種別の正本 |
| `status` | pending / approved / pending_return / completed / pending_link 等 | transaction service / staff service | transaction workflow 状態 |
| `tankId` | return / uncharged 対象 tank | portal return / unfilled | 個別 tank transaction の対象 |
| `items` | order item 一覧 | portal order | order 内容正本 |
| `customerId` | 紐付け customer | portal identity / linking service | customer identity |
| `customerName` | 当時 / 表示 customer name | portal identity / linking service | 表示 snapshot |
| `createdByUid` | portal user uid | portal transaction service | portal actor 正本 |
| `createdAt` / `updatedAt` | transaction 作成 / 更新時刻 | repository create/update、一部 service | workflow 時刻 |
| `source` | `customer_portal`, `auto_schedule`, `customer_app` など | portal service | 発生元 |
| `condition` | portal return 申請時の condition | portal return | 申請時 condition |
| `finalCondition` | staff processing 後の condition | return tag processing | 最終 condition。既に一部実装済み |
| `requestedSnapshot` | portal order の入力 snapshot | portal order | 依頼時表示用 |
| `deliveryAddress` / `deliveryNote` / `orderNote` | order 補足 | portal order | order 内容 |
| `approvedByStaffId` / `approvedByStaffName` / `approvedAt` | order 承認者 | order fulfillment service | staff 承認 snapshot |
| `fulfilledByStaffId` / `fulfilledByStaffName` / `fulfilledAt` | order / return 処理者 | order fulfillment / return tag processing | staff 処理 snapshot |
| `linkedByStaffId` / `linkedByStaffName` / `linkedAt` | customer 紐付け者 | customer linking service | linking 監査 |

`transactions` は依頼や workflow の正本になり得るが、tank lifecycle の正本ではない。現行では `logs.transactionId` がないため、ある transaction がどの log を生んだかは note や tankId / timestamp / customer から推定する必要がある。

## 8. operation ごとの書き込み内容

| operation | tanks への書き込み | logs への書き込み | transactions との関係 |
|---|---|---|---|
| 貸出 | `status=LENT`, `location=customerName`, `staff`, `latestLogId`, `updatedAt`, `logNote` | `action` は通常 `貸出`。受注貸出では `action="受注貸出"`、`transitionAction=貸出`。customer snapshot あり | order fulfillment では order transaction を `completed` にするが `logs.transactionId` はない |
| 返却 | `status=EMPTY`, `location=倉庫`, `updatedAt` | `transitionAction=返却`、通常は customer snapshot がない経路もある | portal return processing 経由では return transaction を `completed` |
| 未使用返却 | `status=FILLED`, `location=倉庫` | `transitionAction=未使用返却`。manual では `[TAG:unused]` が note 系に残る経路あり | return transaction の condition / finalCondition と対応 |
| 未充填返却 | `status=EMPTY`, `location=倉庫` | `transitionAction=返却(未充填)`。manual では `[TAG:uncharged]` が note 系に残る経路あり | unfilled report transaction は別途存在。return processing では finalCondition と対応 |
| 持ち越し | `status=UNRETURNED`, `location` 維持、`tank.logNote` は空または保存しない | `transitionAction=持ち越し`、`note="持ち越し"` の経路あり | return transaction の finalCondition=keep と対応し得る |
| 充填 | `status=FILLED`, location 多くは `倉庫` | `transitionAction=充填` | transaction なし |
| 自社利用 | `status=IN_HOUSE`, location は自社利用先 / 表示名 | `transitionAction=自社利用` | transaction なし |
| 自社返却 | `status=EMPTY` または `FILLED`, location `倉庫` | self return action | transaction なし |
| 破損報告 | `status=DAMAGED` | `transitionAction=破損報告` | transaction なし |
| 修理済み | `status=EMPTY` | `transitionAction=修理済み` | transaction なし |
| 耐圧検査 | status 維持または rule に従う。`tankExtra` で maintenance field 更新候補 | `transitionAction=耐圧検査` | transaction なし |
| 破棄 | `status=DISPOSED` | `transitionAction=破棄` | transaction なし |
| 返却タグ処理 | condition により返却 / 未使用返却 / 未充填返却 / 持ち越し | `[返却タグ処理] ... (タグ:condition)` の note 系文字列 | return transaction を completed、`finalCondition`、fulfilled staff を保存 |
| manual return | hook が tag を action に解決し `applyBulkTankOperations` | normal / unused / uncharged / keep で note と location が異なる | transaction なし |
| bulk return | grouping 後、tag を action に解決し `applyBulkTankOperations` | keep は `"持ち越し"`。unused / uncharged は tank.logNote tag から解決 | transaction なし |
| order fulfillment | `ACTION.LEND` を bulk operation | `action="受注貸出"`, `transitionAction=貸出`, note に受注ID | order transaction completed |
| dashboard correction | target log を superseded、新 active revision 作成、tank snapshot 更新 | `revision+1`, edit metadata、snapshot | transaction は更新しない |
| dashboard void | target log を voided、tank を prev snapshot に戻す | void metadata | transaction は更新しない |
| procurement | 新規 tank 作成、`tankProcurements` 作成 | `logKind=procurement` の summary log | transaction なし |
| supply order | tank なし | `logKind=order`, `action=資材発注`, `tankId="-"` | `orders` collection |

## 9. UI / 集計 / 請求 / trace から読まれている情報

| 用途 | 読み取り data | 現状の特徴 |
|---|---|---|
| staff main 操作 | `tanks` | tankId / status / location / type を見て操作対象を選ぶ |
| bulk return | `tanks.status`, `tanks.location`, `tanks.updatedAt`, `tanks.logNote` | `updatedAt` を貸出日の近似、`logNote` を返却 tag 一時状態として使う |
| portal home | `tanks.location`, `tanks.status`, `logs.location` | `customerName` 文字列で現在貸出と履歴を検索 |
| portal return | `tanks.location`, `tanks.status`, `tanks.updatedAt` | `updatedAt` を貸出日表示に使う |
| portal unfilled | `tanks.location`, `tanks.status` | `customerName` 文字列で報告可能 tank を制限 |
| staff dashboard | `tanks`, active `logs`, `transactions` unfilled reports | page 内で集計、修正、取消、履歴を処理 |
| admin dashboard | active `logs`, `tanks`, pending `transactions` | page 内で KPI を集計 |
| billing | active `logs`, `customers` | `log.action === "貸出"` と `log.location` で月次請求を作る |
| sales | active `logs`, `monthly_stats` | `action` 文字列で貸出 / 返却 / 充填を分類 |
| staff analytics | active `logs` | `staffId` grouping、`action` 文字列で件数分類 |
| mypage | `logs.staffId` | staffId の active logs を表示 |
| trace | active `logs` by tankId/action/timestamp | `action === "貸出"` / `"充填"` に依存し、`transitionAction` は使っていない |
| correction / void | `logs.rootLogId`, `revision`, `logStatus`, `tanks.latestLogId` | latest active log のみ修正 / 取消可能 |

現行集計は `action` と `location` 文字列に強く依存している。`transitionAction`、`customerId`、`transactionId` を軸にした集計設計はまだ未整備である。

## 10. 読み取れる情報・読めない情報

| 情報 | 現行で読めるか | 根拠 / 不足 |
|---|---|---|
| タンクの現在状態 | 読める | `tanks.status` |
| タンクの現在貸出先 | 表示名は読める | `tanks.location`。customer identity としては弱い |
| タンクの現在貸出担当者 | 表示名は近似で読める | `tanks.staff` は直近操作スタッフ名。貸出担当者とは限らない |
| タンクの直近貸出日時 | logs から推定可能 | active logs by tankId で `transitionAction=貸出` を探せば推定可能。ただし現行 trace は `action=貸出` 依存 |
| タンクが現在貸出中になった日時 | 不安定 | `tanks.updatedAt` は近似。carry-over / tag-only / correction で意味が崩れる |
| タンクが長期貸出になった日時 | 一部読める | `ACTION.CARRY_OVER` log の timestamp。ただし `tanks` snapshot にはない |
| タンクが返却された日時 | 読める | return 系 log の timestamp |
| タンクが未使用返却だったか | 読める | `transitionAction=未使用返却` または action。tag 文字列より transitionAction が安定 |
| タンクが未充填返却だったか | 読める | `transitionAction=返却(未充填)` |
| タンクが持ち越しされたか | 読める | `transitionAction=持ち越し` |
| タンクの請求対象可否 | 導出は可能だが不安定 | `billing-rules.ts` は action から導出。`billable` は logs に保存されない |
| 顧客ごとの貸出本数 | 一部読める | `customerId` があるログなら安定。現行 billing は `location` と `action=貸出` 依存 |
| 顧客ごとの返却本数 | 一部読める | return processing 由来は customer snapshot があるが、manual / bulk では customerId がない場合がある |
| スタッフごとの操作実績 | 読める | `logs.staffId` / `staffName`。分類は action 文字列依存 |
| dashboard edit / void / correction 履歴 | 読める | `rootLogId`, `revision`, `logStatus`, edit / void metadata |
| 返却画面の日付プールに必要な貸出日時 | 現状は不安定 | `tanks.updatedAt` 近似。正本貸出日時ではない |
| 請求・売上・分析に必要な情報 | 一部読める | action/location/customerId/billable/return condition の整理不足 |
| 過去状態復元に必要な情報 | latest log については強い | `prevTankSnapshot`, `nextTankSnapshot`, `previousLogIdOnSameTank` |
| `latestLogId` から辿れる情報 | 読める | 最新 active log の詳細。過去へは `previousLogIdOnSameTank` を辿る設計がある |
| transaction と log の対応関係 | 不安定 | `logs.transactionId` がない。note / timestamp / tankId / customerId から推定になる |

## 11. 正本 / snapshot / 導出可能情報の分類

| 情報 / field | 現行分類 | コメント |
|---|---|---|
| `tanks.status` | 現在 snapshot の正本 | 現在状態の高速 read 用 |
| `tanks.location` | 現在表示 snapshot | 現在場所表示には有効。customer identity の正本にはしない |
| `tanks.staff` | 表示 snapshot | staffId ではないため正本には弱い |
| `tanks.updatedAt` | 最終更新時刻 | 貸出日時や返却日時の代替にしない |
| `tanks.latestLogId` | snapshot 整合キー | revision / void と一体で扱う |
| `tanks.logNote` | 業務メモ / 一時 UI 状態 | tag-only 更新と operation note が混在 |
| `logs.tankId` | 正本 | 操作対象 |
| `logs.transitionAction` | 業務分類の正本候補 | action より安定 |
| `logs.action` | 表示 snapshot / 互換分類 | `受注貸出` などで rule action とずれる |
| `logs.prevStatus` / `newStatus` | 監査用正本 | 状態遷移の結果 |
| `logs.timestamp` | 操作時刻の正本候補 | serverTimestamp |
| `logs.originalAt` | 原操作時刻 | correction 後の sort / audit に重要 |
| `logs.revisionCreatedAt` | revision 時刻 | edit window 判定に使われる |
| `logs.staffId` | staff identity 正本 | staffName は snapshot |
| `logs.customerId` | customer identity 正本候補 | 未設定経路をどう扱うかが課題 |
| `logs.location` | 当時表示 snapshot | customerName 文字列としての互換性はある |
| `logs.note` | 業務メモ | 機械判定情報を入れるには弱い |
| `logs.logNote` | tank note snapshot | 意味整理が必要 |
| `logs.prevTankSnapshot` / `nextTankSnapshot` | 復元用 audit snapshot | void / correction の基盤 |
| `transactions.type` | transaction 種別正本 | order / return / uncharged_report |
| `transactions.status` | workflow 状態正本 | tank status とは別物 |
| `transactions.condition` | 申請時 return condition | staff final condition と分ける |
| `transactions.finalCondition` | 処理後 return condition | return tag processing では既に使用 |
| `transactions.items` | order 内容正本 | tank lifecycle log には重複不要 |
| operation 件数 / 集計 | 導出可能 | logs から read model / monthly archive へ派生 |

## 12. 代替可能性の整理

### logs から導出できるので tanks に正本として持たなくてもよい情報

- 過去の操作履歴
- 最終操作の詳細
- 返却済み日時
- 未使用返却 / 未充填返却 / 持ち越しの履歴
- スタッフごとの操作件数
- 顧客ごとの過去貸出 / 返却件数
- dashboard correction / void の履歴

ただし、頻繁に画面表示・検索する現在状態については、`tanks` に projection として持つ価値がある。

### tanks に現在 snapshot として持つべき情報

- 現在 status
- 現在 location 表示名
- 現在の貸出先 identity を高速に検索するなら `currentCustomerId`
- 現在の貸出開始日時を返却 UI / 長期貸出検知で使うなら `currentLentAt`
- 現在の貸出元 log を辿るなら `currentLentLogId`
- 最新 operation の log を辿るなら `latestLogId`

### logs に正本として必ず残すべき情報

- tankId
- transitionAction
- prevStatus / newStatus
- timestamp / originalAt
- staffId / staffName snapshot
- customerId / customerName snapshot
- 操作後 location snapshot
- return condition / billable / source / workflow など、後で判定が変わると困る業務属性
- prev / next tank snapshot
- revision / void / correction metadata

### transactions にあればよく、logs / tanks に重複しなくてもよい情報

- portal order の依頼項目
- delivery address / delivery note / order note
- portal user uid
- 申請時 requested snapshot
- transaction workflow status

ただし、tank lifecycle の履歴から transaction を辿る必要があるなら、`logs.transactionId` は重複ではなく参照キーになる。

### transactions だけでは不足し、logs / tanks にも残すべき情報

- 実際に tank status を変えた操作
- staff が最終確定した return condition
- 請求可否の根拠
- fulfillment / return processing が生成した tank log との対応
- correction / void による tank snapshot の変化

### `updatedAt` で代替してよい情報

- tank doc が最後に更新された時刻
- list の freshness 表示
- optimistic な並び替え補助

### `updatedAt` では代替すべきでない情報

- 貸出日時
- 現在貸出中になった日時
- 長期貸出になった日時
- 返却日時
- 請求期間の根拠
- 報酬・ランキング・売上計算の根拠

### `logNote` で代替してよい情報

- 人間が読む業務メモ
- 一時的な UI 補助表示
- 互換期間中の tag 表示

### `logNote` では代替すべきでない情報

- return condition
- billable
- transactionId
- workflow source
- customer identity
- staff identity
- revision / void の根拠

### `location` 文字列で代替してよい情報

- 当時の表示名
- 履歴上の場所ラベル
- 倉庫 / 自社利用 / 不明などの表示

### `customerId` / `customerName` を明示すべき情報

- 顧客別請求
- 顧客別履歴
- portal の現在貸出検索
- customerName 変更後も壊れてはいけない分析

### `staff` 文字列で代替してよい情報

- 現在カードの表示名
- 互換表示

### `staffId` / `staffName` を明示すべき情報

- スタッフ実績
- 報酬 / rank
- correction / void の監査
- staff 名変更後も壊れてはいけない履歴

## 13. 現行構造の危険箇所

### `updatedAt` を貸出日時として使っている

`portal/return` と bulk return の日付プールは `tanks.updatedAt` を貸出日時の近似として使っている。これは tag-only 更新では変わらない一方、返却以外の operation / correction / maintenance で変わる可能性があり、貸出日時の正本にはならない。

### `tank.logNote` と `log.logNote` と `log.note` の意味が混ざる

`TankOperationInput.logNote` は `logs.note` に入り、`TankOperationInput.tankNote` は `logs.logNote` と `tanks.logNote` に入る。入力名と保存名の対応が直感的ではない。

さらに `tanks.logNote` は `tank-tag-service` による tag-only 更新でも使われるため、現在メモ、返却タグ、operation 後 snapshot が混在する。

### `[TAG:unused]` / `[TAG:uncharged]` と `[TAG:keep]` の扱いが非対称

unused / uncharged は `tanks.logNote` から読み取る経路がある。keep は PR #82 / #83 以降、`[TAG:keep]` を保存しない方針になったが、legacy 判定として読む経路は残っている。

これは互換としては妥当だが、返却 condition の正本を tag 文字列に置く設計は長期的に避けるべきである。

### `location` が複数の意味を持つ

`location` は以下を兼ねている。

- 倉庫
- 顧客名
- 自社利用先
- 不明
- 操作後の場所表示
- billing / portal query の顧客キー

表示 snapshot と identity query が混ざっているため、customerName 変更や同名顧客で壊れやすい。

### `customerName` 文字列と `customerId` の関係が未完成

`logs.customerId` / `customerName` は方針としては整っているが、manual / bulk return など customer context がない経路がある。`tanks` には current customer identity がないため、portal は `location=customerName` で現在貸出を検索している。

### `staff` 文字列と `staffId` / `staffName` の関係

`logs.staffId` は実績集計に使える一方、`tanks.staff` は文字列であり直近操作者表示に近い。現在貸出担当者として扱うと、返却タグ更新、maintenance、correction 後に意味がずれる。

### `latestLogId` と revision / void / correction

`latestLogId` は latest active log の整合に重要だが、correction / void は latest log のみを対象にしている。過去 log の修正や複数 operation の rollback を扱う場合は、現在の制約を明示的に維持するか、別設計が必要になる。

### `previousLogIdOnSameTank` と復元可能性

void 時に `previousLogIdOnSameTank` を使って tank の `latestLogId` を戻す構造はある。ただし、全履歴を chain として辿る読み取り API / UI はまだ限定的で、trace は direct query に依存している。

### tank snapshot と logs のズレ

`tanks` は現在 snapshot、`logs` は履歴の正本になり得るが、`tanks` に現在貸出情報が少ないため UI は `updatedAt` や `location` で補っている。今後 snapshot field を追加する場合、correction / void がそれを復元できるよう `prevTankSnapshot` / `nextTankSnapshot` の対象も見直す必要がある。

### manual return / bulk return / return tag processing の保存形が違う

同じ return condition でも、manual / bulk は tag や note に依存し、return tag processing は transaction `condition` / `finalCondition` を持つ。長期的には `logs.returnCondition` などの正規 field で揃える余地がある。

### tag-only 更新と状態遷移 operation が混ざる

`tank-tag-service` は `tanks.logNote` だけを更新し、`logs` を作らない。これは一時 UI 状態としては軽いが、状態遷移 operation と同じ `logNote` field に見えるため、監査上の意味が混ざる。

### billing / sales / reward の将来実装に不足がある

現行 billing / sales / staff analytics は `action` 文字列と `location` に依存している。`受注貸出` のような表示 action は `transitionAction=貸出` と異なるため、集計漏れのリスクがある。

請求可否や報酬可否は現行では rule から導出しているが、後で rule が変わると過去集計が変わる可能性がある。

## 14. 今後の拡張軸と要求される情報

| 拡張軸 | 要求される情報 | 現行の不足 / 論点 |
|---|---|---|
| 請求 | customerId、貸出 / 返却対応、return condition、billable、単価 snapshot | `location` 集計では弱い。`billable` を保存するか導出するか要判断 |
| 売上 | action category、customerId、timestamp、monthly archive | `action` 文字列依存から `transitionAction` 軸へ寄せたい |
| スタッフ実績 | staffId、action category、対象本数、取消反映 | `staffId` はある。reward 対象 rule と void / correction の反映設計が必要 |
| 報酬 / rank | reward eligibility、revocation、trace source | 未充填返却時に直前充填者を辿る必要がある |
| 顧客別履歴 | customerId、customerName snapshot、tankId、timestamp | manual / bulk で customerId が欠ける可能性 |
| タンク trace | tankId、transitionAction、timestamp、staffId、customerId、transactionId | 現行 trace は action 文字列と direct query 依存 |
| 長期貸出管理 | currentLentAt、currentLentLogId、carriedOverAt、currentCustomerId | `updatedAt` では弱い |
| 未充填 / 未使用 / 持ち越し分析 | returnCondition、finalCondition、source、workflow | tag / note 文字列では弱い |
| 返却漏れ検知 | 現在貸出 snapshot、貸出開始日時、返却予定 / auto return transaction | `tanks` に current loan snapshot がない |
| 修正 / 取消 / 監査 | rootLogId、revision、snapshots、actor、reason、transaction link | snapshots はあるが追加 snapshot field と連動が必要 |
| portal 顧客操作 | createdByUid、customerId、transaction status、source | transaction はあるが log との対応が弱い |
| admin 統計 | stats / query layer、read model、monthly archive | page 内集計が多い |
| Firestore 読み取り最適化 | customerId / staffId / tankId / transitionAction index、projection | `location` query 依存を減らす設計が必要 |
| Security Rules hardening | collection ごとの write 境界、allowed fields、workflow status | service / operation の責務整理が前提 |

一部は現行 docs からの推測を含む。特に請求、報酬、rank、monthly archive の正確な業務仕様はユーザー判断が必要である。

## 15. 追加候補 field の評価

| field | 必要性 | 代替可能性 | リスク / 注意 |
|---|---|---|---|
| `tanks.currentLentAt` | 高 | logs から導出可能だが UI / 長期貸出で頻出 | correction / void / carry-over での更新規則が必要 |
| `tanks.currentLentLogId` | 高 | latest lend log query で代替可能 | `受注貸出` などを `transitionAction` で拾う必要 |
| `tanks.currentCustomerId` | 高 | logs / location から推定可能だが不安定 | customerName 変更に強くなる。未紐付け時の扱い要設計 |
| `tanks.currentCustomerName` | 中 | `location` で代替可能 | 表示 snapshot と location の分離が目的なら有効 |
| `tanks.currentLentByStaffId` | 中 | lend log から導出可能 | 現在担当者の定義が必要。直近操作者とは別 |
| `tanks.currentLentByStaffName` | 中 | lend log から導出可能 | 表示 snapshot。staff 名変更後の扱いを決める |
| `tanks.carriedOverAt` | 中 | carry-over log から導出可能 | 複数回 carry-over の意味を決める必要 |
| `tanks.lastReturnedAt` | 低から中 | return log から導出可能 | 現在表示で必要なら snapshot。請求正本にはしない |
| `tanks.lastActionAt` | 中 | `latestLogId` の log から導出可能 | 一覧性能用 projection としては有効 |
| `tanks.lastAction` | 中 | latest log から導出可能 | 表示用。業務正本にはしない |
| `tanks.loanBatchId` | 要判断 | operationGroupId / transactionId で代替可能 | batch の定義を先に決める必要 |
| `logs.transactionId` | 高 | note / timestamp から推定可能だが不安定 | order / return / unfilled と log の追跡に有効 |
| `logs.returnCondition` | 高 | action / tag / transaction から推定可能 | unused / uncharged / keep / normal を構造化できる |
| `logs.billable` | 要判断 | rule から導出可能 | 過去請求を固定したいなら保存。rule 変更に注意 |
| `logs.operationGroupId` | 中から高 | timestamp / batch input から推定可能 | bulk return / order fulfillment の一括単位 trace に有効 |
| `logs.source` | 中 | workflow / action から推定可能 | manual / portal / auto / order / tag processing の区別に有効 |
| `logs.workflow` | 中 | source と action から推定可能 | UI / service 入口単位の監査に有効 |
| `transactions.finalCondition` | 高 | 現行 return tag processing で使用済み | staff 確定後 condition として維持する価値が高い |
| `transactions.fulfilledByStaffId` / `fulfilledByStaffName` | 高 | logs staff から推定可能な場合あり | transaction 処理者 snapshot として既に使用価値あり |

追加 field は、単に増やすのではなく「正本」「projection」「表示 snapshot」「監査 link」のどれかを明示して採用する必要がある。

## 16. 削除・縮小候補 field の評価

| field / 使い方 | 評価 | 方針候補 |
|---|---|---|
| `tanks.logNote` に返却 tag を入れる | 縮小候補 | 一時 UI tag field と業務メモを分離する |
| `logs.logNote` | 意味整理候補 | `logs.note` との役割を再定義する |
| `logs.note` に機械判定情報を入れる | 縮小候補 | returnCondition / source / transactionId などへ構造化する |
| `tanks.staff` | 表示 snapshot に限定 | staff identity として使わない |
| `location` を customer query key にする | 縮小候補 | `customerId` query へ移行し、location は表示 snapshot に限定 |
| `action` 文字列で集計する | 縮小候補 | `transitionAction` または category field を集計軸にする |
| `STATUS.DEFECTIVE` | 将来削除候補 | docs 上、未充填と破損 / 不良を分ける方針に寄せる |
| non-tank `logs` と tank lifecycle `logs` の同居 | 要判断 | `logKind` で継続するか collection 分離するか検討 |

削除や縮小は既存データ互換に影響するため、すぐに実装せず、読み取り互換期間と migration 方針を設計する必要がある。

## 17. 最初にユーザーが設計判断すべき論点

1. `logs` を tank lifecycle の正本、`tanks` を現在 projection として明確に定義するか。
2. `transactions` は依頼 / workflow の正本に限定し、tank lifecycle の正本にはしないか。
3. `tanks` に現在貸出 snapshot としてどこまで持つか。最低候補は `currentLentAt`, `currentLentLogId`, `currentCustomerId`, `currentCustomerName`。
4. `logs.transactionId` を追加し、transaction と tank lifecycle log を明示的に結ぶか。
5. `logs.returnCondition` と `transactions.finalCondition` の役割をどう分けるか。
6. 請求可否 `billable` を logs に保存するか、常に rule から導出するか。
7. 貸出と返却を billing 上どう対応付けるか。貸出時課金、返却時課金、月次集計のどれを正本にするか。
8. 持ち越しを請求 / 長期貸出 / 返却漏れ検知でどう扱うか。
9. `location` は表示 snapshot に限定し、customer identity は `customerId` に寄せるか。
10. staff 実績と報酬は `staffId` と `transitionAction` だけで足りるか、operationGroup / source / billable も必要か。
11. correction / void は今後も latest log のみ許可するか、過去 log の修正まで拡張するか。
12. non-tank log を同じ `logs` collection に残すか、将来的に監査 log と tank lifecycle log を分けるか。
13. page 内集計を stats / query service に移す優先順位をどうするか。
14. Security Rules hardening の前に、write service / operation 境界をどこまで固めるか。

## 18. 次フェーズで ChatGPT と再設計すべきこと

次フェーズでは、この監査をもとに以下を分けて再設計するのが安全である。

1. `system-architecture-principles.md`
   - page / hook / service / repository / domain rule / stats / trace の責務
   - Firestore direct write の許容境界
   - correction / void / workflow service の位置付け

2. `data-model-architecture.md`
   - `logs` / `tanks` / `transactions` の正本、snapshot、導出情報
   - 追加 field の採用可否
   - 既存 field の意味整理
   - revision / void / correction と新 snapshot field の整合

3. `future-feature-design-boundaries.md`
   - 請求、売上、スタッフ実績、報酬、rank、顧客別履歴、trace、長期貸出、返却漏れ検知、Security Rules hardening の境界
   - どの機能が logs 正本、transactions 正本、read model、monthly archive を使うか

実装はその後に小さく分けるべきである。推奨順は、docs-only の最終設計、型定義と read 互換、write service の最小更新、UI の参照切り替え、集計の stats layer 化、index / rules の別 PR、という流れである。
