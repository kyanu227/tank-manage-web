# logs / tanks data structure audit

作成日: 2026-05-21

対象 commit: `c75ef505a8391f7bb04709abf15b2965cb236e23`

対象 repository: `kyanu227/tank-manage-web`

## 1. 目的と範囲

この文書は、`logs` と `tanks` の現行データ構造を棚卸しし、今後の再設計に必要な判断材料を整理する監査ドキュメントである。

今回の範囲:

- docs-only
- 実装コード変更なし
- Firestore data create/update/delete なし
- `firestore.rules` 変更なし
- `firebase.json` 変更なし
- package files 変更なし
- Hosting deploy なし
- Firestore deploy なし
- Security Rules deploy なし
- seed / migration / script 実行なし

この文書は再設計案ではない。`currentLentAt` などの具体 field を採用するかどうかは決めず、現行構造の情報価値、限界、代替可能性、正本として残すべき情報を精査する。

返却画面の日付プールや時間判定はサブ目的である。主目的は、今後の貸出、返却、持ち越し、請求、集計、トレース、修正、取消まで見据えて、最低限の冗長性で最大限の情報を読み取れる `logs` / `tanks` 構造を再設計するための現状把握である。

## 2. 調査対象

主に確認した実装:

| 領域 | ファイル |
|---|---|
| tank lifecycle rule | `src/lib/tank-rules.ts` |
| tank / log write boundary | `src/lib/tank-operation.ts` |
| common types | `src/lib/tank-types.ts`, `src/lib/operation-context.ts` |
| read repositories | `src/lib/firebase/repositories/tanks.ts`, `src/lib/firebase/repositories/logs.ts`, `src/lib/firebase/repositories/transactions.ts` |
| return tag temp update | `src/lib/firebase/tank-tag-service.ts` |
| order fulfillment | `src/lib/firebase/order-fulfillment-service.ts`, `src/features/staff-operations/hooks/useOrderFulfillment.ts` |
| return tag processing | `src/lib/firebase/return-tag-processing-service.ts`, `src/features/staff-operations/hooks/useReturnTagProcessing.ts` |
| manual / bulk operations | `src/features/staff-operations/hooks/useManualTankOperation.ts`, `src/features/staff-operations/hooks/useBulkReturnByLocation.ts` |
| portal transaction creation | `src/lib/firebase/portal-transaction-service.ts` |
| dashboard correction / void | `src/app/staff/dashboard/page.tsx` |
| portal read paths | `src/app/portal/page.tsx`, `src/app/portal/return/page.tsx`, `src/app/portal/unfilled/page.tsx` |
| admin / billing / sales | `src/app/admin/page.tsx`, `src/app/admin/billing/page.tsx`, `src/app/admin/sales/page.tsx`, `src/app/admin/staff-analytics/page.tsx` |
| trace / billing / incentive helpers | `src/lib/tank-trace.ts`, `src/lib/billing-rules.ts`, `src/lib/incentive-rules.ts` |
| procurement / non-tank logs | `src/features/procurement/lib/submitTankEntryBatch.ts`, `src/lib/firebase/supply-order.ts` |

## 3. 現行 `tanks` ドキュメント構造

`tanks/{tankId}` は、現在状態のスナップショットとして使われている。履歴の正本は `logs` へ寄せる方針だが、現行 UI の多くは `tanks` を直接読んで現在表示や処理対象抽出を行う。

| field | 現行の意味 | 主な書き込み元 | 主な読み取り元 | 監査評価 |
|---|---|---|---|---|
| `status` | 物理タンクの現在状態。`STATUS` の値 | `tank-operation.ts`, `submitTankEntryBatch` | ほぼ全画面、返却/貸出/充填 validation、dashboard、portal | 現在状態 snapshot として必須 |
| `location` | 現在場所、貸出先名、自社、倉庫などの表示文字列 | `tank-operation.ts`, `submitTankEntryBatch` | portal, bulk return, dashboard, order validation | snapshot として必要。ただし意味が多重 |
| `staff` | 最後の状態遷移を行ったスタッフ名 | `tank-operation.ts`, procurement | 一部 UI 表示、自社利用一覧 | 表示 snapshot。正本 ID ではない |
| `updatedAt` | `tanks` の最終更新日時 | `tank-operation.ts`, `submitTankEntryBatch` | portal return の貸出日表示、bulk return 日付プール、差分 helper | 汎用更新日時。貸出日時の正本には弱い |
| `latestLogId` | その tank の最新 active log ID | `tank-operation.ts` | correction / void の整合確認、将来 trace 候補 | snapshot pointer として重要。ただし repository getLog 未実装 |
| `logNote` | 最新操作由来のタグ・メモ。返却タグ一時状態にも使われる | `tank-operation.ts`, `tank-tag-service.ts` | bulk return, inhouse, repository mapping | 意味が混在。正本には不向き |
| `note` | タンク自体のメモ | procurement, admin/maintenance 表示系 | repair / inspection 表示 | タンク属性 snapshot。操作履歴とは別 |
| `type` | タンク種別 | `submitTankEntryBatch` | order fulfillment validation, procurement UI | タンク属性として必要 |
| `nextMaintenanceDate` | 次回耐圧検査期限。旧 GAS 互換で文字列も許容 | `submitTankEntryBatch`, inspection | inspection page, repository mapping | タンク属性として必要 |
| `maintenanceDate` | 耐圧検査実施日 | inspection `tankExtra` | 現状の主 read は限定的 | 属性候補。型・表示責務は要整理 |
| `createdAt` | タンク登録日時 | `submitTankEntryBatch` | 現状の主 read は限定的 | 監査・登録履歴補助 |

### 3.1 `tanks` 更新の基本形

`tank-operation.ts` の通常 operation は、次の snapshot を `tanks` に反映する。

| 更新 field | 内容 |
|---|---|
| `status` | `transitionAction` に対応する `getNextStatus()` |
| `location` | input の `location`。省略時 `"倉庫"` |
| `staff` | `OperationContext.actor.staffName` |
| `logNote` | input の `tankNote`。省略時 `""` |
| `latestLogId` | 新規 log ID |
| `updatedAt` | `serverTimestamp()` |
| `tankExtra` | 呼び出し元が渡した任意 field。耐圧検査では `maintenanceDate`, `nextMaintenanceDate` |

`tank-tag-service.ts` は例外的に `tanks.logNote` だけを直接更新する。これは状態遷移 operation ではなく、返却前の一時タグ更新である。

## 4. 現行 `logs` ドキュメント構造

`logs` は、タンク操作履歴、監査、修正、取消の正本になり得る構造を持っている。`tank-operation.ts` 経由の tank log は revision chain を持つ。一方、資材発注やタンク購入/登録など、`logKind` が `tank` ではないログも同じ collection に存在する。

| field | 現行の意味 | 主な書き込み元 | 主な読み取り元 | 監査評価 |
|---|---|---|---|---|
| `tankId` | 対象タンクID。procurement では要約文字列の場合あり | tank operation, procurement, supply order | dashboard, portal, trace, mypage | tank log では正本。非 tank log では意味が異なる |
| `action` | 表示用操作名。例 `貸出`, `受注貸出`, `返却` | operation input / service | dashboard, billing, sales, staff analytics | 表示・集計に使われるが `transitionAction` と分ける必要あり |
| `transitionAction` | 状態遷移 rule 上の action | `tank-operation.ts` | correction, dashboard bulk edit | tank lifecycle の正本 action として重要 |
| `prevStatus` | 操作前 status | `tank-operation.ts` | dashboard / audit | 監査用に必要 |
| `newStatus` | 操作後 status | `tank-operation.ts`, procurement | dashboard / audit | 監査用に必要 |
| `location` | 操作後の場所・貸出先表示名 | `tank-operation.ts` | portal history, billing, dashboard, trace | 表示 snapshot。返却時は `"倉庫"` になるため返却元ではない |
| `staffId` | 操作スタッフ ID | operation context | staff analytics, mypage, dashboard | staff 正本参照として必要 |
| `staffName` | 操作時スタッフ名 snapshot | operation context | dashboard, portal, trace | 表示 snapshot として必要 |
| `staffEmail` | 操作時 staff email snapshot | operation context | audit 補助 | 任意 audit 補助 |
| `customerId` | 関連顧客 ID | operation context | customer logs query, future billing | 顧客正本参照として必要。ただし全 operation には入らない |
| `customerName` | 操作時顧客名 snapshot | operation context | dashboard / future display | 表示 snapshot として必要。ただし全 operation には入らない |
| `note` | ログ本文メモ。現行 `TankOperationInput.logNote` がここに入る | `tank-operation.ts`, procurement, supply order | trace / dashboard | 自由メモ。正本 field の代替には不向き |
| `logNote` | tank snapshot 側の `tankNote` と同じ内容 | `tank-operation.ts` | repository raw spread, dashboard | 命名と意味が混ざる。タグ正本には不向き |
| `timestamp` | 操作発生日時。新規 revision でも元 timestamp を継承 | `tank-operation.ts` | logs repository, portal, billing, sales, trace | 業務時刻の主軸 |
| `originalAt` | 元操作日時 | `tank-operation.ts` | dashboard sort | revision chain の業務時刻として重要 |
| `revisionCreatedAt` | revision 作成日時 | `tank-operation.ts` | correction window, dashboard history | 監査・修正期限に必要 |
| `logStatus` | `active`, `superseded`, `voided` | `tank-operation.ts`, procurement, supply order | all active queries, dashboard | revision 正本状態として必要 |
| `logKind` | `tank`, `procurement`, `order` など | operation / procurement / supply order | dashboard edit eligibility | 同一 collection 内の種別分離に必要 |
| `rootLogId` | revision chain の起点 | `tank-operation.ts` | `getLogsByRoot`, dashboard history | correction 履歴に必要 |
| `revision` | revision number | `tank-operation.ts` | dashboard history | correction 履歴に必要 |
| `supersedesLogId` | この revision が置き換えた log | `applyLogCorrection` | audit | 監査用に必要 |
| `supersededByLogId` | この revision を置き換えた log | `applyLogCorrection` | correction guard | 監査・整合性に必要 |
| `prevTankSnapshot` | 操作前の `status/location/staff/logNote` | `tank-operation.ts` | void / correction / audit | 復元・取消に重要 |
| `nextTankSnapshot` | 操作後の `status/location/staff/logNote` | `tank-operation.ts` | correction / audit | 復元・trace に重要 |
| `previousLogIdOnSameTank` | 同一 tank の直前 log ID | `tank-operation.ts` | void / correction | latest chain 復元に重要 |
| `editedByStaffId` / `editedByStaffName` / `editedByStaffEmail` | revision 作成者 | `applyLogCorrection` | dashboard history | 監査用に必要 |
| `editReason` | 修正理由 | `applyLogCorrection` | dashboard history | 監査用に必要 |
| `voidedByStaffId` / `voidedByStaffName` / `voidedByStaffEmail` | 取消者 | `voidLog` | dashboard history | 監査用に必要 |
| `voidReason` | 取消理由 | `voidLog` | dashboard history | 監査用に必要 |
| `voidedAt` | 取消日時 | `voidLog` | dashboard history | 監査用に必要 |
| `procurementId` | タンク購入/登録履歴 ID | `submitTankEntryBatch` | 現状限定的 | non-tank log 用 metadata |
| `status` | repository type に残る optional field | 現行 tank operation は主に未使用 | 旧互換候補 | 正本 field としては曖昧 |
| `transactionId` | `TankOperationInput.logExtra` で保存可能だが現行 workflow では未使用 | なし | なし | 追加候補。現行は追跡に弱い |

### 4.1 `note` と `logNote` の現行関係

`TankOperationInput` では以下のように命名されている。

| input | `logs` へ保存 | `tanks` へ保存 |
|---|---|---|
| `logNote` | `note` | 保存されない |
| `tankNote` | `logNote` | `logNote` |

このため、現行コードを読むときは `logNote` という名前だけで「ログ本文」「タンク最新タグ」「操作メモ」のどれかを判断できない。再設計時は、自由メモ、返却 condition、UI 一時タグ、現在 snapshot を分ける必要がある。

## 5. `transactions` との関係

`transactions` は、顧客起点の発注、返却タグ、未充填報告を保存する。`tanks` / `logs` とは処理時に同じ Firestore transaction に参加する箇所があるが、現行 `logs` には `transactionId` が原則保存されていない。

| transaction type | 作成元 | status flow | `tanks/logs` との接続 | 追跡性 |
|---|---|---|---|---|
| `order` | portal order | `pending_link` / `pending` / `pending_approval` / `approved` / `completed` | `fulfillOrder()` が `applyBulkTankOperations()` と同 transaction で order を `completed` にする | log には `transactionId` なし。`note/logNote/tank.logNote` の `受注ID: {id}` 文字列で弱く追える |
| `return` | portal return / auto return | `pending_return` -> `completed` | `processReturnTags()` が tank/log operation と同 transaction で return を `completed` にする | log には `transactionId` なし。`condition/finalCondition` は transaction 側に残る |
| `uncharged_report` | portal unfilled | 作成時 `completed` | 現行 dashboard は read-only 表示。tank/log の状態は動かさない | tankId/customer/source は transaction 側のみ。tank log とは未接続 |

### 5.1 発注

portal order は `transactions` に `items`, `deliveryType`, `deliveryTargetName`, `note/orderNote/deliveryNote`, `source`, `createdByUid`, 顧客 snapshot を保存する。

staff approve は `transactions/{orderId}` のみを `approved` にする。`tanks` / `logs` はまだ触らない。

staff fulfillment は対象 tank ごとに `transitionAction: ACTION.LEND`, `logAction: "受注貸出"`, `location: order.customerName`, `customerId/customerName` を保存し、同じ Firestore transaction 内で order を `completed` にする。

現行の弱点:

- `logs.transactionId` は保存されない。
- `action === "貸出"` だけを見る集計は `受注貸出` を落とす。
- `transitionAction === "貸出"` を使えば状態遷移上の貸出として拾える。

### 5.2 返却タグ処理

portal return は tank 1 本ごとに `transactions(type="return")` を作る。作成時点では `tanks` / `logs` は動かさない。

staff return tag processing は選択された return transaction を読み、処理直前に tank を再取得し、condition から transition action を決める。処理完了時に `transactions/{returnId}` へ `finalCondition`, `fulfilledAt`, `fulfilledBy*` を保存する。

現行の弱点:

- `logs.transactionId` は保存されない。
- logs 側に `returnCondition` はない。
- `condition` / `finalCondition` は transaction 側にだけ安定して残る。
- logs 側では `action` から通常/未使用/未充填/持ち越しを読めるが、portal request 由来か手動処理由来かは構造化 field では読めない。

### 5.3 未充填報告

portal unfilled は `transactions(type="uncharged_report", status="completed")` を作る。現行 dashboard はこれを品質報告として read-only 表示する。

現行の弱点:

- uncharged report は tank lifecycle log と接続していない。
- 報告後に staff がどう処理したかを `logs` と構造的に紐付ける field はない。
- 請求除外や報酬取消に使うには、別途 workflow / source / transactionId の接続が必要になる可能性がある。

## 6. 各 operation で保存される情報

`tank-operation.ts` 経由の operation は共通して、`logs` に前後 status、前後 tank snapshot、identity、revision metadata を保存し、`tanks` に現在 snapshot を反映する。

| operation | 主な入口 | `logs` に保存される主情報 | `tanks` に保存される主情報 | 注意点 |
|---|---|---|---|---|
| 貸出 | manual lend | `action/transitionAction: 貸出`, `customerId/customerName`, `location: customerName`, staff identity | `status: 貸出中`, `location: customerName`, `staff`, `latestLogId`, `updatedAt` | 手動貸出は `action === transitionAction` |
| 受注貸出 | order fulfillment | `action: 受注貸出`, `transitionAction: 貸出`, `customerId/customerName`, `location: order.customerName`, `note/logNote` に受注ID文字列 | `status: 貸出中`, `location`, `logNote: 受注ID...` | `logs.transactionId` はない |
| 通常返却 | manual return / bulk return / return tag processing | `transitionAction/action: 返却`, `newStatus: 空`, staff identity。return tag processing では customer snapshot あり | `status: 空`, `location: 倉庫`, `logNote` は入口により差異 | manual/bulk は customerId なし。返却元は `prevTankSnapshot.location` |
| 未使用返却 | manual / bulk / return tag processing | `action: 未使用返却`, `newStatus: 充填済み` | `status: 充填済み`, `location: 倉庫` | manual は `[TAG:unused]` を note/logNote/tank に残す。bulk は action で表現し logNote は空へ戻す |
| 未充填返却 | manual / bulk / return tag processing | `action: 返却(未充填)`, `newStatus: 空` | `status: 空`, `location: 倉庫` | manual は `[TAG:uncharged]` を残す。bulk は action で表現し logNote は空へ戻す |
| 持ち越し | manual return keep / bulk keep / return tag keep | `action/transitionAction: 持ち越し`, `newStatus: 未返却`, `location` は保持先 | `status: 未返却`, `location` 維持, `updatedAt` 更新 | PR #82-84 後、`[TAG:keep]` は tank.logNote に残さない |
| 充填 | manual fill | `action/transitionAction: 充填`, `newStatus: 充填済み`, staff identity | `status: 充填済み`, `location: 倉庫` | 顧客情報なし |
| 自社利用 | rule only / state diagram | rule は `充填済み -> 自社利用中` | 実行入口は現状限定的 | 通常 `ACTION.IN_HOUSE_USE` の実 UI は見当たらない |
| 自社利用(事後) | `/staff/inhouse` | `action/transitionAction: 自社利用(事後)`, `location: 自社`, `note: 事後報告` | `status: 自社利用中`, `location: 自社` | 事後報告として記録 |
| 自社返却 | `/staff/inhouse` bulk return | `action: 自社返却` 系, `newStatus` は tag により `空` or `充填済み` | `status` 更新, `location: 倉庫` | inhouse return では tag によって action が変わる |
| 破損報告 | `/staff/damage` | `action/transitionAction: 破損報告`, `newStatus: 破損`, `note` に破損内容 | `status: 破損`, `location: 倉庫` | allowedPrev は `空/充填済み/自社利用中` |
| 修理済み | `/staff/repair` | `action/transitionAction: 修理済み`, `newStatus: 空` | `status: 空`, `location: 倉庫` | `破損/不良` から戻す |
| 耐圧検査 | `/staff/inspection` | `action/transitionAction: 耐圧検査完了`, `newStatus: 空` | `status: 空`, `location: 倉庫`, `maintenanceDate`, `nextMaintenanceDate` | `tankExtra` で属性更新 |
| 破棄 | rule only / state diagram | `ACTION.DISPOSE` rule は存在 | 実行 UI は確認できず | 再設計時に実行入口と audit field 要確認 |
| 返却タグ処理 | staff orders return tab | tank log と return transaction completion を同 transaction で実行 | selected tank の状態更新 | transaction 完了は atomic。ただし log に transactionId なし |
| manual return | manual operation hook | tag に応じた action。`keep` は `持ち越し` | tag に応じた status/location/logNote | context に customer は入らない |
| bulk return | bulk return by location | tag に応じた action。`keep` は location 維持 | group 単位で status 更新 | 日付 pool は `tanks.updatedAt` 近似 |
| dashboard edit | `applyLogCorrection` | old active を `superseded`、new active revision を作成。`editReason`, editor fields | latest tank snapshot を新 revision に更新 | 最新 active log だけ編集可能 |
| dashboard void | `voidLog` | target active を `voided`, `voidReason`, voider fields | `prevTankSnapshot` と `previousLogIdOnSameTank` へ戻す | 最新 active log だけ取消可能 |
| tank purchase/register | procurement | `logKind: procurement`, `procurementId`, `newStatus`, note | 新規 tank docs | tank lifecycle revision chain とは別 |
| supply order | supply-order service | `logKind: order`, `tankId: "-"`, `action: 資材発注` | tanks なし | 同じ logs collection だが tank log ではない |

## 7. `logs` から読める情報

| 情報 | 読めるか | 使う field | 不安定な理由 / 注意点 |
|---|---|---|---|
| あるタンクの現在状態に至る操作履歴 | 概ね読める | `tankId`, `timestamp`, `logStatus`, `transitionAction`, `previousLogIdOnSameTank` | repository の `getLogsByTank` / `getLog` は未実装。active query か direct get が必要 |
| 直近貸出日時 | 条件付きで読める | `transitionAction === 貸出`, `timestamp/originalAt` | `action === 貸出` では `受注貸出` を落とす。query 設計が必要 |
| 現在の貸出先 | 条件付きで読める | 最新貸出 log の `customerId/customerName/location`、または latest snapshot | manual/bulk return 後は現在貸出中ではない。`tanks` の方が現在値には強い |
| 現在の貸出担当者 | 条件付きで読める | 最新貸出 log の `staffId/staffName` | `tanks.staff` は最後の操作担当であり貸出担当ではない |
| いつ返却されたか | 読める | `transitionAction/action` が返却系、`timestamp/originalAt` | `action.includes("返却")` は自社返却も含む。分類が必要 |
| いつ持ち越しになったか | 読める | `transitionAction === 持ち越し`, `timestamp/originalAt` | 複数回持ち越し時の「現在の持ち越し開始」を定義する必要あり |
| 未使用返却だったか | 読める | `transitionAction/action === 未使用返却` | `[TAG:unused]` より action を正とする方が安定 |
| 未充填返却だったか | 読める | `transitionAction/action === 返却(未充填)` | portal unfilled report は別 transaction で、返却 log とは別 |
| 請求対象可否 | 部分的に読める | `action/transitionAction`, `billing-rules.ts` | 請求対象を return で見るか lend で見るか未整理。顧客 ID がない return log がある |
| ある顧客に貸し出された本数 | 条件付きで読める | `customerId`, `transitionAction === 貸出` | 旧/手動互換で `customerId` 欠損時は `location` 依存 |
| ある顧客から返却された本数 | 不安定 | return log の `prevTankSnapshot.location`, `customerId`, transactions | manual/bulk return は `location: 倉庫` で customerId なし |
| あるスタッフの操作実績 | 読める | `staffId`, `staffName`, `action`, `timestamp` | non-tank log も混じるため `logKind` 分離が必要 |
| dashboard 編集・取消履歴 | 読める | `rootLogId`, `revision`, `logStatus`, editor/voider fields | active だけ読む画面では過去 revision は `getLogsByRoot()` が必要 |
| 過去状態への復元に必要な情報 | 最新操作については強い | `prevTankSnapshot`, `nextTankSnapshot`, `previousLogIdOnSameTank` | 現行 correction/void は最新 active log のみ対象 |
| 請求や売上集計に使える情報 | 部分的 | `action/transitionAction`, `customerId/location`, `timestamp` | 現行 billing は `action === 貸出` と `location` 依存で `受注貸出` を落とす |
| 返却画面の日付プールに使える貸出日時 | logs なら導出可能 | 最新 `transitionAction === 貸出` の timestamp | 現行 UI は `tanks.updatedAt` 近似。query / snapshot が未整備 |
| `latestLogId` から辿れる情報 | 原理上読める | `latestLogId` -> log -> `previousLogIdOnSameTank` | repository `getLog` 未実装。direct get が必要 |

## 8. `tanks` から読める情報

| 情報 | 読めるか | 使う field | 不安定な理由 / 注意点 |
|---|---|---|---|
| 現在の状態 | 読める | `status` | snapshot として強い |
| 現在の貸出先 | 表示名は読める | `location` | `customerId` はない。倉庫/顧客/自社が同じ field |
| 現在の担当者 | 最終操作担当は読める | `staff` | 貸出担当ではなく最後の状態遷移担当 |
| 最後に更新された日時 | 読める | `updatedAt` | tag-only update では更新されない場合がある。意味は汎用 |
| 最後に貸出された日時 | 読めない | なし | `updatedAt` は返却/持ち越し/充填/修正でも更新される |
| 現在貸出中になった日時 | 読めない | なし | `status: 貸出中` でも updatedAt が貸出時とは限らない可能性 |
| 長期貸出になった日時 | 近似のみ | `status: 未返却`, `updatedAt` | 持ち越し操作時刻としては近いが正本ではない |
| 直近の業務メモ | 部分的 | `logNote`, `note` | `logNote` はタグ・メモ・受注IDが混在 |
| 返却タグの一時状態 | 読める | `logNote` | tag-only 更新と状態遷移 operation が混在 |
| 現在の貸出 batch / group | 読めない | なし | order ID は `logNote` 文字列に弱く残るだけ |
| 請求に必要な情報 | 不足 | `status`, `location`, `updatedAt` | 返却 condition、billable、貸出/返却対応がない |
| trace に必要な情報 | 一部 | `latestLogId`, current snapshot | full history は `logs` が必要 |

## 9. 代替可能な情報と代替不能な情報

### 9.1 `logs` から導出できるので `tanks` に正本として持たなくてもよい情報

| 情報 | 導出元 | 条件 |
|---|---|---|
| 最後の操作種別 | 最新 active log の `transitionAction/action` | `latestLogId` を辿れること |
| 最後の操作日時 | 最新 active log の `timestamp/originalAt` | 同上 |
| 最後の操作スタッフ | 最新 active log の `staffId/staffName` | `tanks.staff` は表示 snapshot としては便利 |
| 現在 snapshot の前後差分 | 最新 active log の `nextTankSnapshot` | tank operation 経由ログに限る |
| 未使用/未充填/通常返却の種別 | return log の `transitionAction/action` | tag 文字列ではなく action を使う |

### 9.2 `tanks` に snapshot として持った方がよい情報

| 情報 | 理由 |
|---|---|
| `status` | 現在在庫・操作可否の主 query に必須 |
| 現在場所の表示名 | portal / staff / dashboard が頻繁に読む |
| 現在顧客 ID / 顧客名 snapshot | 再設計候補。`location` 文字列だけでは顧客正本参照に弱い |
| 現在貸出開始日時 | 再設計候補。返却画面の日付 pool、督促、長期貸出判定に有用 |
| 現在貸出 log ID | 再設計候補。trace / 請求 / 返却元特定に有用 |
| `latestLogId` | correction / trace の入口として軽量 |
| tank 属性 (`type`, `note`, `nextMaintenanceDate`) | lifecycle log から導出する情報ではない |

### 9.3 `logs` に必ず正本として残すべき情報

| 情報 | 理由 |
|---|---|
| 操作 action / transition action | 状態遷移と表示名の両方に必要 |
| 操作時刻 | 集計・監査・請求・trace の主軸 |
| 操作 actor ID / snapshot | staff 実績と監査に必要 |
| 顧客 ID / 顧客名 snapshot | 顧客名変更後も当時表示と正本参照を両立するため |
| 操作前後 status | 状態復元・監査に必要 |
| 操作前後 tank snapshot | void / correction / trace に必要 |
| revision / void metadata | 編集・取消を消さずに監査するため |
| transaction reference | 追加候補。受注・返却タグ・未充填報告との追跡に必要 |
| return condition / billable | 追加候補。請求・集計の正本にするなら必要 |

### 9.4 `transactions` にあればよく、`logs` / `tanks` に重複しなくてもよい情報

| 情報 | 理由 |
|---|---|
| 発注明細 `items` | order transaction の正本。tank log に全明細を重複させる必要は薄い |
| deliveryType / deliveryTargetName | 発注ごとの配達条件。tank 現在場所とは別 |
| portal createdByUid / requested snapshot | 顧客申請の正本 |
| return request の作成時 condition | 顧客が申請した値として transaction に残す |
| uncharged_report の source / createdByUid | 報告 transaction の正本 |

### 9.5 `transactions` だけでは不足し、`logs` / `tanks` にも残すべき情報

| 情報 | 理由 |
|---|---|
| 実際に処理された return condition | staff が変更して完了できるため、operation log 側にも確定値がある方が追跡しやすい |
| 実際に貸し出した tank ID と処理時刻 | order items は希望数量であり、実際にどの tank が出たかは tank log |
| transactionId / operation link | order / return / unfilled と tank operation の対応を後から追うため |
| billable 判定 | 請求再計算の仕様変更に備え、当時の確定判定を持つかは設計判断が必要 |

### 9.6 `updatedAt` で代替してよい / すべきでない情報

| 扱い | 情報 |
|---|---|
| 代替してよい | 画面の最終更新順、軽い freshness 表示、差分更新の競合検知 |
| 代替すべきでない | 貸出日時、現在貸出開始日時、持ち越し日時、返却日時、請求対象期間、責任追跡の操作時刻 |

### 9.7 `logNote` で代替してよい / すべきでない情報

| 扱い | 情報 |
|---|---|
| 代替してよい | 表示補助メモ、暫定タグの UI 表示、受注IDの人間向け補足 |
| 代替すべきでない | return condition 正本、transactionId、billable、customerId、operation source、貸出開始日時、持ち越し日時 |

## 10. 冗長性の評価

| field | 正本 | snapshot | 表示 snapshot | 監査 | 導出可能 | 評価 |
|---|---:|---:|---:|---:|---:|---|
| `tanks.status` | no | yes | yes | no | from latest log | 現在 query のため snapshot 必須 |
| `tanks.location` | no | yes | yes | no | from latest log | 必要だが意味を分けたい |
| `tanks.staff` | no | yes | yes | no | from latest log | 表示用。ID なしで正本不可 |
| `tanks.updatedAt` | no | yes | yes | no | no | 汎用更新日時として維持 |
| `tanks.latestLogId` | no | yes | no | yes | no | trace/correction pointer として維持候補 |
| `tanks.logNote` | no | ambiguous | yes | no | from latest log/tag | 意味混在。縮小/分離候補 |
| `tanks.note` | yes | yes | yes | no | no | tank 属性として維持 |
| `tanks.type` | yes | yes | yes | no | no | tank 属性として維持 |
| `tanks.nextMaintenanceDate` | yes | yes | yes | no | no | tank 属性として維持 |
| `logs.action` | yes | no | yes | yes | no | 表示 action として維持 |
| `logs.transitionAction` | yes | no | no | yes | no | lifecycle 集計はこれを優先 |
| `logs.timestamp/originalAt` | yes | no | yes | yes | no | 業務時刻の正本 |
| `logs.location` | no | no | yes | yes | no | 操作後の場所 snapshot |
| `logs.customerId` | yes | no | no | yes | partly | 顧客正本参照として必要 |
| `logs.customerName` | no | no | yes | yes | no | 当時名 snapshot として必要 |
| `logs.staffId` | yes | no | no | yes | no | staff 正本参照として必要 |
| `logs.staffName` | no | no | yes | yes | no | 当時名 snapshot として必要 |
| `logs.note/logNote` | no | no | yes | yes | no | 自由メモとして維持。正本代替不可 |
| `logs.prev/nextTankSnapshot` | yes | no | no | yes | no | correction / void に必要 |
| `logs.previousLogIdOnSameTank` | yes | no | no | yes | no | tank ごとの chain に必要 |
| `logs.rootLogId/revision/logStatus` | yes | no | no | yes | no | revision chain に必要 |
| `logs.transactionId` | yes candidate | no | no | yes | no | 追加候補 |
| `logs.returnCondition` | yes candidate | no | yes | yes | from action partly | 追加候補 |
| `logs.billable` | design candidate | no | no | yes | from action partly | 追加候補。ただし仕様固定が必要 |

## 11. 将来的に追加候補の field 評価

この章は採否判断ではなく、必要性、代替可能性、リスクの評価である。

| field | 必要性 | 代替可能性 | リスク / 注意点 |
|---|---|---|---|
| `tanks.currentLentAt` | 返却日付 pool、督促、長期貸出判定に強い | logs 最新貸出から導出可能だが query cost / index が必要 | 返却・充填時に clear する責務が必要 |
| `tanks.currentLentLogId` | 現在貸出の正本 log への pointer | `latestLogId` とは別。持ち越し後も貸出元を保持できる | correction / void で更新整合が必要 |
| `tanks.currentCustomerId` | 顧客正本参照 | logs 最新貸出から導出可能 | `location` との二重管理が発生 |
| `tanks.currentCustomerName` | 当時/現在表示名 snapshot | customerId から現名取得可能だが履歴表示には snapshot が便利 | 顧客名変更時に過去ログは変えない。現在 snapshot の更新方針が必要 |
| `tanks.currentLentByStaffId` | 貸出担当者追跡 | currentLentLogId から導出可能 | staffName とセットで snapshot か pointer か決める |
| `tanks.currentLentByStaffName` | 表示高速化 | currentLentLogId から導出可能 | 改名時に snapshot として扱う |
| `tanks.carriedOverAt` | 未返却開始日時 / 督促 | `持ち越し` log から導出可能 | 複数回持ち越し時の意味定義が必要 |
| `tanks.lastReturnedAt` | 表示・統計補助 | latest return log から導出可能 | tank 現在状態とは直接関係しないため snapshot 必要性は低め |
| `tanks.lastActionAt` | 現在表示・並び順 | `updatedAt` と近いが tag-only update との差を分けられる | `updatedAt` との役割分担が必要 |
| `tanks.lastAction` | 表示補助 | latest log から導出可能 | 正本ではなく snapshot |
| `tanks.loanBatchId` | 一括貸出 / 受注貸出の grouping | orderId / operationGroupId で代替可能 | tanks に持つと返却後 clear 方針が必要 |
| `logs.transactionId` | order/return/unfilled と operation log の接続に強い | 現状は note 文字列で弱く代替 | 最優先追加候補。ただし type も必要 |
| `logs.returnCondition` | 請求・返却集計に強い | action で部分代替可能 | normal/unused/uncharged/keep を operation 正本にするか判断 |
| `logs.billable` | 請求確定値として強い | action + rules で再計算可能 | 請求ルール変更時に当時判定を固定するか要判断 |
| `logs.operationGroupId` | bulk / order fulfillment の同一処理 grouping | timestamp / transactionId で弱く代替 | bulk retry / partial failure は現状 transaction で防ぐが audit には有用 |
| `logs.source` | manual / order / portal-return / auto / correction の識別 | action/logNote で弱く推定 | 文字列 enum 設計が必要 |
| `logs.workflow` | use case 単位の分類 | `source` と重複し得る | 過剰分類にならないようにする |

## 12. 現行設計の危険箇所

### 12.1 `updatedAt` を貸出日時として使っている箇所

`portal/return` と bulk return の日付プールは、`tanks.updatedAt` を貸出日の近似として使っている。

危険:

- 返却タグの一時更新は `updatedAt` を更新しないが、状態遷移、持ち越し、修正、検査、登録などは更新する。
- `updatedAt` は「最後に tank doc が更新された日時」であり、「現在貸出が開始された日時」ではない。
- 長期貸出や請求期間に使うと、持ち越しや correction で意味が変わる。

### 12.2 `logNote` のタグ混在

`[TAG:unused]` / `[TAG:uncharged]` は、一時 UI タグ、返却結果、最新操作メモの複数意味で使われている。

危険:

- manual return は tag を operation 結果として残す。
- bulk return は tag を action 解決に使った後、非 keep では `tankNote/logNote` を空に戻す。
- return tag processing は `[返却タグ処理]...` の自由文を保存する。
- `logNote` の文字列だけで return condition 正本を扱うと、入口ごとの差異で壊れる。

### 12.3 `tank.logNote` と `log.logNote` の意味混在

`TankOperationInput.tankNote` が `tanks.logNote` と `logs.logNote` に入り、`TankOperationInput.logNote` が `logs.note` に入る。

危険:

- `logNote` という名前から保存先と意味を推測できない。
- 将来の field 追加時に `note` / `logNote` / `tankNote` / `returnCondition` が混線しやすい。

### 12.4 `location` の多重意味

`location` は、倉庫、顧客名、自社、現在保持者、操作後の場所を同じ field で表す。

危険:

- return log の `location` は返却後 `"倉庫"` であり、返却元顧客ではない。
- dashboard / billing / portal は `location` を顧客名として使う箇所がある。
- 顧客名変更時の正本参照には使えない。

### 12.5 `staff` 文字列と `staffId/staffName`

`tanks.staff` は最後の操作スタッフ名であり、`logs.staffId/staffName` のような正本 ID + snapshot ではない。

危険:

- 現在貸出担当者として `tanks.staff` を読むと、返却タグ・持ち越し・充填後には意味が変わる。
- staff 改名や同姓同名に弱い。

### 12.6 `customerName` 文字列と `customerId`

新規 operation では customer context があれば `logs.customerId/customerName` が入る。一方、`tanks` には customerId がない。

危険:

- portal は `tanks.location == customerName` で現在貸出中を読む。
- 顧客名変更時に現在貸出中の検索がずれる可能性がある。
- manual/bulk return は return log に customerId がないため、返却元の正本参照が弱い。

### 12.7 `latestLogId` と revision / void / correction

`latestLogId` は最新 active log を指し、correction / void は `tanks.latestLogId` が対象 log と一致する場合だけ許可される。

危険:

- latest 以外の過去 log は現行 UI から直接 correction / void できない。
- `latestLogId` を辿る read repository が未実装。
- non-tank log は同じ collection にあっても `latestLogId` chain には入らない。

### 12.8 dashboard edit / void が snapshot と logs に与える影響

dashboard edit は old active を `superseded` にし、新 active revision を作り、tank snapshot を更新する。void は active log を `voided` にし、tank snapshot を `prevTankSnapshot` へ戻す。

危険:

- 集計は `logStatus == active` を必ず見る必要がある。
- Firestore `orderBy(timestamp)` は timestamp field がない document を除外するため、dashboard は `orderBy: null` を使い `originalAt ?? timestamp` で再 sort している。
- billing / sales が active log と transitionAction を正しく見る必要がある。

### 12.9 manual / bulk / return tag processing の差異

同じ「返却」概念でも入口により保存内容が異なる。

| 入口 | customerId | return condition | transaction link | tag note |
|---|---|---|---|---|
| manual return | なし | action から推定 | なし | unused/uncharged は tag 文字列あり、keep は `持ち越し` |
| bulk return | なし | action から推定 | なし | keep 以外は空 |
| return tag processing | あり | transaction `condition/finalCondition` | log にはなし | 自由文 note |

この差異は、請求・顧客別返却数・trace の設計前に必ず整理する必要がある。

## 13. 現行構造で保持できている情報

- tank の現在 `status`
- tank の現在 `location` 表示文字列
- tank の最終操作スタッフ名 snapshot
- tank の `latestLogId`
- tank の `type`, `note`, `nextMaintenanceDate`
- tank operation の action / transitionAction
- operation の staffId / staffName / staffEmail
- operation の customerId / customerName。ただし customer context が渡された operation に限る
- operation の timestamp / originalAt / revisionCreatedAt
- operation 前後 status
- operation 前後 tank snapshot
- tank ごとの直前 log pointer
- revision chain / superseded / voided / edit reason / void reason
- order / return / unfilled の portal transaction 本体
- order fulfillment / return tag processing の transaction completion atomicity

## 14. 現行構造で保持できていない情報

- `tanks` 上の現在貸出開始日時
- `tanks` 上の現在貸出 log ID
- `tanks` 上の現在顧客 ID
- `tanks` 上の現在貸出担当 staff ID
- `logs` 上の構造化 `transactionId`
- `logs` 上の構造化 return condition
- `logs` 上の構造化 billable 判定
- `logs` 上の operation group ID
- manual/bulk return log 上の返却元 customerId
- uncharged_report と後続 staff operation の構造的 link
- 現在貸出 batch / order group の snapshot

## 15. 現行構造で読み取れるが不安定な情報

| 情報 | 現行の読み取り方 | 不安定な理由 |
|---|---|---|
| 返却画面の貸出日 | `tanks.updatedAt` | 汎用更新日時であり貸出日時ではない |
| 顧客別現在貸出 | `tanks.location == customerName` | 顧客名文字列依存 |
| 顧客別返却数 | return log の `prevTankSnapshot.location` または transaction | 統一 query がない。customerId 欠損 |
| 受注貸出数 | `action === "受注貸出"` または `transitionAction === "貸出"` | `action === "貸出"` 集計では漏れる |
| 請求対象 | `action` と `billing-rules` | return log と lend log のどちらを正本にするか未整理 |
| 返却 condition | `action`, `logNote`, transaction `condition/finalCondition` | 入口により保存場所が違う |
| 現在貸出担当者 | 最新貸出 log or `tanks.staff` | `tanks.staff` は最後の操作担当 |
| latest chain trace | `latestLogId` / `previousLogIdOnSameTank` | repository read helper 未実装 |

## 16. 正本にすべき情報

再設計時に正本として扱う候補:

- tank lifecycle operation の `transitionAction`
- operation 表示名としての `action`
- operation timestamp / originalAt
- staffId / staffName snapshot
- customerId / customerName snapshot
- operation 前後 status
- operation 前後 snapshot
- revision / void / correction metadata
- order / return / unfilled transaction ID との接続
- return condition の確定値
- billable の当時確定値。ただし、再計算で足りるかは請求思想の判断が必要

## 17. snapshot として持てばよい情報

再設計時に `tanks` 側 snapshot として持つ価値がある候補:

- current status
- current holder / location display name
- current customerId / customerName
- current lend started at
- current lend log ID
- current lend staff snapshot
- last action / last action at
- latest log ID
- tank attributes: type, note, nextMaintenanceDate

## 18. 導出で足りる情報

明示 snapshot を持たず、必要時に `logs` / `transactions` から導出できる候補:

- tank の過去履歴一覧
- staff 別操作実績
- 日次操作件数
- 最新 operation の詳細
- revision 履歴
- 通常/未使用/未充填/持ち越しの発生履歴
- 受注明細の内容
- portal return request の初期 condition

ただし、導出に必要な query/index/read helper がない場合は、snapshot を持たないこと自体が UI/業務の弱点になる。特に現在貸出中の貸出開始日時は、返却 UI と督促で頻繁に読むため、導出か snapshot かの設計判断が必要である。

## 19. 削除・縮小候補 field

| field | 評価 |
|---|---|
| `tanks.logNote` | 一時タグ、最新操作メモ、受注IDが混ざる。用途を分離したうえで縮小候補 |
| `logs.logNote` | 自由メモ / tank snapshot note として残すなら名前整理候補。return condition 代替には使わない |
| `logs.status` | repository type 上の optional 互換 field。現行正本ではない |
| `tanks.staff` | 表示 snapshot としては便利だが、正本 ID ではない。`lastActionByStaffName` 的な意味へ明確化候補 |
| `location` の顧客正本用途 | field 自体は残すが、顧客正本参照としては縮小すべき |

## 20. 変更リスクが高い箇所

- `tank-operation.ts`
  - tank/log の atomic write、revision chain、void/correction の正本境界。
- `useBulkReturnByLocation.ts`
  - `updatedAt` を日付 pool に使う暫定 UI。
  - `tanks.logNote` の一時 tag。
- `useManualTankOperation.ts`
  - manual return の tag 保存差異。
- `return-tag-processing-service.ts`
  - return transaction completion と tank/log operation の atomicity。
  - `transactionId` 欠損。
- `order-fulfillment-service.ts`
  - order completion と tank/log operation の atomicity。
  - `受注貸出` と `transitionAction: 貸出` の集計差異。
- `staff/dashboard/page.tsx`
  - active log、revision、void、tank snapshot を直接扱う。
- `admin/billing/page.tsx`
  - `action === "貸出"` と `location` に依存し、`受注貸出` / customerId / return billable を十分に扱っていない。
- `admin/sales/page.tsx`
  - `action` 文字列集計に依存。
- `portal/page.tsx`, `portal/return/page.tsx`, `portal/unfilled/page.tsx`
  - `tanks.location == customerName` に依存。
- `tank-trace.ts`
  - `action` 文字列と `timestamp` query に依存。revision/correction との整合は追加検討が必要。

## 21. 最初に設計判断すべき論点

1. `logs` を完全な操作履歴正本、`tanks` を現在 snapshot とする原則を正式化するか。
2. `tanks` に現在貸出情報をどこまで snapshot として持つか。
3. `currentLentAt` / `currentLentLogId` 相当を持つ場合、返却・充填・持ち越し・void/correction でどう更新/復元するか。
4. `location` を現在表示名として残しつつ、`customerId` をどこへ持つか。
5. manual return / bulk return / return tag processing で同じ return condition を同じ構造で保存するか。
6. order / return / unfilled transaction と tank operation log を `transactionId` で接続するか。
7. 請求の正本を貸出 log、返却 log、transaction、月次確定値のどこに置くか。
8. `billable` を logs に当時確定値として保存するか、rules で再計算するか。
9. `logNote` / `note` / 一時 tag / 業務メモの役割を分離するか。
10. dashboard correction / void が追加 snapshot field をどう復元するか。
11. `latestLogId` chain を read repository として整備するか。
12. 現行の `action` 文字列集計を `transitionAction` 中心に置き換えるか。
13. `logs` collection 内の `tank`, `procurement`, `order` log を今後も同居させるか、read model で分離するか。

## 22. 監査結論

現行構造は、`tank-operation.ts` 経由の tank lifecycle については、`logs` に revision chain、前後 snapshot、staff identity、customer snapshot を保存しており、操作履歴・監査・最新操作の取消には比較的強い。

一方で、現在貸出中の意味を UI が頻繁に読む情報、特に貸出開始日時、現在顧客 ID、現在貸出 log ID、現在貸出担当者は `tanks` に snapshot として存在しない。これらは `logs` から導出できるが、現行 repository / index / UI ではまだ安定した read model になっていない。

また、`updatedAt` と `logNote` は便利な暫定 field として使われているが、貸出日時、return condition、transaction link、billable の正本として使うには弱い。`location` も現在表示名としては有用だが、顧客正本参照には不足する。

再設計では、まず `logs` に残す正本情報と `tanks` に持つ現在 snapshot を明確に分ける必要がある。そのうえで、`transactions` との接続、return condition、billable、operation group/source/workflow の採否を決めると、最低限の冗長性で読み取りやすい構造に寄せられる。
