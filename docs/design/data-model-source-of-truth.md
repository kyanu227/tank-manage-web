# Data Model Source of Truth

## Purpose

この文書は、タンク管理 Web アプリの主要 collection と field について、何を source of truth とし、何を snapshot / projection / audit record / derived data として扱うかを整理する設計メモである。

目的は実装を決め切ることではなく、今後 `tanks` / `logs` / `transactions` / `customers` / `staff` 周辺を変更するときの判断基準を固定することである。

特に次の曖昧さを減らす。

- `logs` を現在状態の参照元として使いすぎるかどうか
- `transactions` と `logs` の責務の違い
- `customerName` / `staffName` を正本として扱うべきか、当時名 snapshot として扱うべきか
- `location` を顧客 identity として使う危険性
- `tankId` を表示文字列ではなく canonical identity として扱う境界
- 将来の請求 / 売上 / 報酬 / trace / correction / void に必要な正本情報

## Current Context

直近の関連 PR 状況は以下。

| PR | 状態 | 意味 |
|---|---|---|
| #87 | merged | tankId の audit / design を docs に追加 |
| #88 | merged | `src/lib/tank-id.ts` に pure helper を追加 |
| #89 | merged | procurement / tank registration 側だけ helper に接続。deploy は未実行 |
| #90 | merged | operation 接続前の compatibility audit を docs に追加 |
| #91 | draft | Firestore read-only audit script / doc はあるが、credential 未解決で実データ件数は未取得 |
| #92 | merged | `A-OK` を正式な reserved exception として helper / docs に反映 |

この文書は PR #92 後の main を前提にする。`tankId` は原則 `Prefix-number`、例外として `Prefix-OK` を許容する canonical identity である。

今回の作業では Firestore data、migration、deploy、rules、package files、operation / UI / repository 接続は変更しない。

## Collection Responsibility Matrix

| Collection / module | Primary responsibility | Source of truth | Snapshot / projection | Notes |
|---|---|---|---|---|
| `tanks` | タンクの現在状態 | 現在 status / 現在場所表示 / tank 属性 | `staff`, `location`, `logNote`, `latestLogId` | 現在状態の高速 read 用。履歴正本ではない |
| `logs` | tank lifecycle と関連業務の履歴・監査 | 操作発生、状態遷移、revision / void chain | staffName / customerName / location の当時 snapshot | 現在状態の source of truth にはしない |
| `transactions` | portal / staff workflow の申請・受注・処理待ち | 申請内容、workflow status、portal actor | customerName / staffName snapshot | tank state 自体の正本ではない |
| `customers` | 貸出先・請求先 master | customer identity、名称、単価、有効状態 | 表示名の派生元 | `destinations` は使わない |
| `customerUsers` | portal user と customer の紐付け | Firebase Auth uid、setup 状態、customerId link | selfCompanyName / selfName / lineName | `status` は保存せず派生する方針 |
| `staff` | staff master | staffId、name、email、role、rank、active | 表示名の派生元 | staff identity の正本 |
| `staffByEmail` | auth / rules 用 email mirror | email key -> staffId | role / active snapshot | staff 正本ではなく mirror |
| `staffByUid` | auth / rules 用 uid mirror | uid -> staffId | role / active snapshot | staff 正本ではなく mirror。未deploy rules 論点あり |
| `tankProcurements` | タンク登録 / 購入 event | procurement batch、費用、登録者 | tankIds / logId snapshot | tank lifecycle log とは別の procurement record |
| `orders` | 備品・資材発注 | supply order item | staffName snapshot | tank lifecycle とは別業務 |
| `monthly_stats` | 月次 archive | 集計結果 snapshot | archive | raw logs からの derived read model |
| `edit_history` / `delete_history` | 管理操作監査 | 将来の管理変更履歴 | before / after snapshot | 現時点では本格実装しない |

## Source of Truth Policy

### Core Rule

各情報は、正本をひとつに寄せる。

- current tank state: `tanks`
- tank lifecycle event: `logs`
- portal / workflow request: `transactions`
- customer master: `customers`
- portal auth user: `customerUsers`
- staff master: `staff`
- auth lookup mirror: `staffByEmail` / `staffByUid`
- procurement batch: `tankProcurements`

正本以外の collection に同じ情報を持つ場合は、次のどれかとして明記する。

- display snapshot
- current projection
- audit snapshot
- workflow link
- derived read model

### Do Not Promote Convenience Fields

以下は便利だが、正本として扱うと壊れやすい。

| Field / pattern | Why unsafe as source of truth |
|---|---|
| `tanks.updatedAt` | 汎用更新日時であり、貸出日時・返却日時・請求根拠にはならない |
| `tanks.location` | 倉庫 / 顧客名 / 自社利用 / 不明を兼ねる表示名であり、customer identity ではない |
| `logs.location` | 当時表示 snapshot。顧客名変更後の identity query には弱い |
| `tanks.staff` | 直近操作 staff 表示名であり、貸出担当者 identity ではない |
| `logs.action` | 表示 action と業務 transition が混ざる。集計正本は `transitionAction` 寄りにする |
| `logNote` / `note` | 業務メモであり、return condition や billable などの機械判定正本にはしない |
| `transactions.status` | workflow 状態であり、`tanks.status` ではない |

### Typed Top-level Fields Over `logExtra`

`logExtra` は移行期や workflow-specific metadata の受け皿として便利だが、正本情報を曖昧に詰め込む場所にしない。

今後の集計・請求・trace・監査に必要な情報は、採用時点で top-level typed field として扱う。

候補:

- `logs.transactionId`
- `logs.returnCondition`
- `logs.billable`
- `logs.operationGroupId`
- `logs.source`
- `logs.workflow`

## Snapshot Policy

snapshot は悪ではない。正本と用途を分ければ、過去表示・監査・復元に必要である。

### Keep Snapshot When It Answers "What Was True Then"

`logs.staffName`、`logs.customerName`、`logs.location` は、当時の表示を残す snapshot として有効である。

例:

- staff 名が後で変わっても、過去操作ログには当時の staff 名を表示できる
- customer 名が後で変わっても、過去ログには当時の貸出先名を表示できる
- `logs.location` は当時の場所ラベルとして表示できる

### Do Not Use Snapshot As Identity

snapshot を検索・請求・権限・正規参照の identity として使わない。

| Use case | Preferred identity | Snapshot can display |
|---|---|---|
| 顧客別請求 | `customerId` | `customerName`, `location` |
| 顧客別履歴 | `customerId` | `customerName` |
| staff 実績 | `staffId` | `staffName` |
| tank trace | `canonicalTankId` / `logs.tankId` | tank label |
| portal current loan | future `tanks.currentCustomerId` | `tanks.location` / `currentCustomerName` |

## Tanks Model

`tanks` はタンクの現在状態 snapshot の source of truth とする。

### Should Own

| Information | Field today / candidate | Classification |
|---|---|---|
| tank identity | document id / canonical tankId | source of truth |
| current status | `status` | current source of truth |
| current place display | `location` | current display snapshot |
| latest operation link | `latestLogId` | current projection / consistency link |
| tank type | `type` | tank attribute |
| maintenance date | `nextMaintenanceDate` | tank attribute |
| tank note | `note` | tank attribute / memo |
| current temporary tag | currently `logNote` | temporary UI state, should be separated later |
| last update timestamp | `updatedAt` | freshness timestamp only |

### Should Not Own As Primary History

`tanks` should not be the source of truth for:

- past operations
- return condition history
- staff performance
- billing history
- portal request history
- correction / void history

These belong to `logs`, `transactions`, or derived archive collections.

### Current Loan Snapshot Candidates

Future current-loan fields may be useful, but they must be explicitly projection fields that are restored by correction / void.

Candidates:

- `currentLentAt`
- `currentLentLogId`
- `currentCustomerId`
- `currentCustomerName`
- `currentLentByStaffId`
- `currentLentByStaffName`
- `carriedOverAt`

These are not implemented here. If added later, `prevTankSnapshot` / `nextTankSnapshot` must include them so revision / void can restore them.

## Logs Model

`logs` is the source of truth for tank lifecycle events and audit trails.

### Should Own

| Information | Field | Classification |
|---|---|---|
| target tank | `tankId` | source of truth for event target |
| operation category | `transitionAction` | source of truth candidate |
| display operation name | `action` | display snapshot / compatibility |
| status before / after | `prevStatus`, `newStatus` | audit source of truth |
| actor identity | `staffId` | staff identity at event time |
| actor display | `staffName`, `staffEmail` | audit/display snapshot |
| customer identity | `customerId` | customer identity at event time |
| customer display | `customerName`, `location` | display snapshot |
| event time | `timestamp`, `originalAt` | event time source |
| revision time | `revisionCreatedAt` | revision metadata |
| lifecycle state | `logStatus` | active / superseded / voided |
| log kind | `logKind` | tank / procurement / order etc. |
| revision chain | `rootLogId`, `revision`, supersede fields | audit chain |
| restore data | `prevTankSnapshot`, `nextTankSnapshot`, `previousLogIdOnSameTank` | restoration audit snapshot |

### Should Not Own

`logs` should not become the current-state source of truth.

Avoid using logs as primary storage for:

- current tank status
- current customer on tank
- current staff assignment
- natural sort projection such as `prefix`, `number`, `sortKey`
- mutable master data
- transaction workflow status

`logs` may store enough snapshot data to explain what happened, but `tanks` remains the current-state read model.

### `logKind` Boundary

The `logs` collection contains more than tank lifecycle logs.

| `logKind` | Meaning | Note |
|---|---|---|
| `tank` | lifecycle operation against one tank | trace / correction / void target |
| `procurement` | tank purchase / registration summary | `tankId` may be summary like `A-01 他N本` |
| `order` | supply order log | `tankId` can be `-` |

Any query that treats `logs.tankId` as an exact tank identity should filter to lifecycle-compatible logs or otherwise account for `logKind`.

## Transactions Model

`transactions` is the source of truth for request / workflow state, not for tank state.

### Should Own

| Information | Field |
|---|---|
| workflow type | `type` |
| workflow state | `status` |
| portal actor | `createdByUid` |
| customer link | `customerId`, `customerName` |
| order content | `items`, delivery fields, requested snapshot |
| return request target | `tankId`, `condition` |
| staff final decision | `finalCondition` |
| workflow staff actor | approved / fulfilled / linked staff fields |
| source | `source` |

### Should Not Own

`transactions` should not be used as the source of truth for:

- current `tanks.status`
- actual lifecycle event after staff processing
- correction / void history
- tank trace

When a transaction causes tank state changes, `logs` should record the actual lifecycle event. Long term, `logs.transactionId` should link the lifecycle event back to the request.

## Identity Fields

### Staff

`staff/{staffId}` is the staff master. `staffByEmail` and `staffByUid` are mirrors for auth / rules / lookup.

| Field | Role |
|---|---|
| `staff.id` / document id | staff source identity |
| `staff.name` | current master display name |
| `staff.email` | current master auth/contact value |
| `staff.role` / `rank` / `isActive` | current staff authorization/profile |
| `staffByEmail/{email}` | email mirror, not master |
| `staffByUid/{uid}` | uid mirror, not master |
| `logs.staffId` | event actor identity |
| `logs.staffName` | event actor display snapshot |
| `tanks.staff` | current display snapshot only |

Do not use `tanks.staff` as the source of truth for staff performance or reward.

### Customer

`customers/{customerId}` should be the future source of truth for lending destination / billing unit.

| Field | Role |
|---|---|
| `customers` document id | customer source identity |
| `customers.name` / `companyName` / `formalName` | current master display/billing names |
| `customers.price*` | current customer rate master |
| `customerUsers/{uid}` | portal user account and link to customer |
| `customerUsers.customerId` | portal-user-to-customer link |
| `customerUsers.customerName` | link display snapshot |
| `logs.customerId` | event customer identity |
| `logs.customerName` | event customer display snapshot |
| `tanks.location` | current place display, not customer identity |

Do not use customer name strings as the only key for billing, customer history, or portal current loan search once `customerId` is available.

## Tank ID Policy

`tankId` is a canonical identity, not merely a UI label.

Current helper policy:

- numeric first: `Prefix-number`
- minimum display padding: `A1`, `A01`, `A-01`, `A001` -> `A-01`
- 100+ allowed at domain level: `A100` -> `A-100`
- reserved OK exception: `AOK`, `A-OK`, `a-ok` -> `A-OK`
- arbitrary suffix invalid: `A-NG`, `A-TEST`, `A-SPARE`

Short term, `tanks/{canonicalTankId}` remains the document id model. Long term, if tank ID correction becomes a formal operation, the project must choose between:

- keeping business ID as document id and designing document rename / migration
- introducing internal immutable IDs and making `canonicalTankId` a field

Do not store `logs.prefix`, `logs.number`, or `logs.sortKey` by default. Natural sort belongs in helper logic or `tanks` read projections if Firestore query performance requires it.

## Location / Customer Relationship Risk

`location` currently carries too many meanings:

- warehouse label
- customer display name
- in-house use label
- unknown / fallback label
- history display field
- portal / billing query key

This is acceptable only as a display snapshot. It is risky as identity because:

- customer names can change
- two customers can share display names
- old logs should keep old display names
- current loans need stable customer identity
- billing should not depend on a mutable display string

Recommended direction:

| Need | Preferred field |
|---|---|
| current visual label | `tanks.location` |
| event visual label | `logs.location` |
| event customer identity | `logs.customerId` |
| current loan customer identity | future `tanks.currentCustomerId` |
| billing customer identity | `customerId` from log / read model |
| portal user identity | `customerUsers.customerId` |

## Revision / Void / Edit Policy

The current model is append-style for edits:

- active lifecycle log is not overwritten directly
- correction creates a new active revision
- old active revision becomes `superseded`
- void marks the active log `voided`
- tank snapshot is restored through `prevTankSnapshot` and `previousLogIdOnSameTank`

This should remain the source-of-truth rule for tank lifecycle audit.

Important constraints:

- latest active tank log is the safe correction / void target
- `tanks.latestLogId` must point to the latest active lifecycle log
- non-tank logs such as procurement / supply order should not be corrected through tank lifecycle assumptions
- if new current snapshot fields are added to `tanks`, snapshots must restore those fields too

Future design questions:

- keep correction / void limited to latest active log, or support deeper historical corrections
- whether dashboard correction should be able to alter customer identity fields
- whether transaction completion should be reversible with linked lifecycle logs
- whether `edit_history` / `delete_history` should record non-tank admin changes separately from `logs`

## Procurement / Operation / Portal Boundaries

### Procurement

Procurement / tank registration creates:

- `tanks/{canonicalTankId}`
- `tankProcurements/{id}`
- `logs/{id}` with `logKind="procurement"`

`tankProcurements` is the procurement event source. The procurement log is a human-facing audit summary, not a tank lifecycle event for a single tank when multiple tank IDs are summarized.

Because PR #89 connected procurement to `src/lib/tank-id.ts`, helper changes can affect accepted registration input. PR #92 intentionally made `A-OK` valid for procurement input.

### Operation

Tank lifecycle operations should continue to use `tank-operation.ts` as the write boundary.

It is responsible for:

- transition validation
- log creation
- tank snapshot update
- revision / void
- prev / next snapshots
- latest log consistency

Do not move lifecycle writes into page, hook, or generic repository helpers without a separate design.

### Portal

Portal actions create `transactions`, not direct lifecycle logs.

| Portal action | Source of truth |
|---|---|
| order request | `transactions.type="order"` |
| return request | `transactions.type="return"` |
| unfilled report | `transactions.type="uncharged_report"` |

Staff processing later turns some transactions into lifecycle operations. The future link should be explicit, preferably with `logs.transactionId`.

### Supply Order

Supply order writes `orders` and a non-tank `logs` summary. It should not be treated as a tank lifecycle event. It needs `logKind="order"` boundaries in any logs query.

## Known Risks

| Risk | Current cause | Preferred direction |
|---|---|---|
| Loan date ambiguity | UI uses `tanks.updatedAt` as lend date approximation | add current loan projection or derive from lifecycle logs |
| Customer identity ambiguity | `location` doubles as customer name | use `customerId` for identity |
| Staff identity ambiguity | `tanks.staff` is a string | use `logs.staffId` / staff master |
| Billing drift | `action` and `location` drive billing | use `transitionAction`, `customerId`, optional `billable` |
| Return condition drift | tag / note / transaction condition are split | use typed `returnCondition` / `finalCondition` |
| Trace split | `A01` / `A-01` / `A-OK` data shape unknown | complete PR #91 read-only audit |
| Log overload | summary logs and lifecycle logs share collection | enforce `logKind` boundaries |
| `logExtra` growth | metadata can become untyped | promote durable fields to top-level typed fields |
| Correction gap | new tank snapshot fields may not restore | update snapshot model with any new current projection |
| Mirror confusion | `staffByEmail` / `staffByUid` look like master data | keep them auth mirrors only |

## Migration Candidates

No migration is performed in this PR. Candidate areas only:

1. tank ID data shape
   - detect `A01`, `A-01`, `A-100`, `A-OK`, and arbitrary suffix forms through PR #91 read-only audit.
   - decide fallback reads vs data migration before operation-side helper connection.

2. current customer snapshot
   - add `currentCustomerId` / `currentCustomerName` to `tanks` only after correction / void restoration is designed.

3. current loan timing
   - add `currentLentAt` / `currentLentLogId` or build a read model from active lifecycle logs.

4. transaction-log link
   - add `logs.transactionId` for order fulfillment / return tag processing / unfilled flows.

5. return condition
   - add `logs.returnCondition` and align it with `transactions.condition` / `transactions.finalCondition`.

6. billing source
   - decide whether `logs.billable` is persisted or derived from versioned rules.

7. location identity cleanup
   - move portal and billing query logic away from `location == customerName`.

8. log kind separation
   - either keep one `logs` collection with strict `logKind` filtering, or separate lifecycle / business audit logs later.

## Recommended Implementation Order

Recommended order after this docs PR:

1. Finish PR #91 data audit
   - rebase/merge main after PR #92.
   - classify `A-OK` as valid OK exception.
   - obtain read-only Firestore credential and record counts.

2. Decide tank ID compatibility strategy
   - if production IDs are canonical, proceed with operation helper connection.
   - if legacy IDs exist, design fallback read or migration.

3. Define lifecycle log typed fields
   - `transactionId`
   - `returnCondition`
   - `source`
   - `workflow`
   - optional `billable`

4. Define current loan projection
   - `currentLentAt`
   - `currentLentLogId`
   - `currentCustomerId`
   - `currentCustomerName`
   - update correction / void snapshots before writing these fields.

5. Connect operation boundary carefully
   - update `tank-operation.ts` only after compatibility is settled.
   - avoid page/hook direct lifecycle writes.

6. Move portal / billing identity queries toward customerId
   - keep location as display snapshot.
   - use read models or new tank current customer projection where needed.

7. Add stats / billing read model
   - separate monthly archives from raw logs.
   - do not make billing depend on mutable display strings.

8. Harden rules and write boundaries
   - only after data shape and service boundaries are stable.
   - keep Security Rules deploy as a separate reviewed task.

## Explicit Non-goals

This document does not:

- change implementation code
- create, update, delete, or migrate Firestore data
- deploy Hosting, Firestore, or Security Rules
- change `firestore.rules`, `firebase.json`, or package files
- connect operation / UI / repository code to new data fields
- resolve PR #91 credentials or run the Firestore audit
- add `tanks.currentCustomerId`, `logs.transactionId`, `logs.returnCondition`, or any schema field
- change billing, sales, reward, portal, or staff operation behavior
