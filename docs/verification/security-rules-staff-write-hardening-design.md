# Security Rules Staff Write Hardening Design

作成日: 2026-05-06

対象:

- `tanks`
- `logs`
- `transactions`
- staff operation writes
- Security Rules deploy 前の hardening 方針

---

## 1. 現在の結論

前回の Security Rules 静的照合では、order approval、order fulfillment、return tag processing の正常 payload は、現行 `firestore.rules` draft で allow されると判断した。

一方で、`tanks`、`logs`、`transactions` の staff write は基本的に `isStaff()` だけで許可されている。つまり、active staff と判定された client であれば、現行 workflow が出す正常 payload だけでなく、malformed log、missing required log field、invalid transaction status、unauthorized tank field update も Rules 側では拒否できない。

この document は、Security Rules deploy 前に broad staff write を blocker と扱うか、caution として許容するかを判断するための設計資料である。今回の作業は docs-only であり、`firestore.rules` の実装、`firebase.json` 接続、deploy、Firestore data 変更は行わない。

---

## 2. Threat Model

UI / service 層の実装が正しくても、Firebase Auth を持つ staff client は Firestore SDK を直接叩ける。したがって「service が正しい payload しか出さない」だけでは Security Rules の防御としては不十分である。

ただし、Security Rules に業務ロジックを入れすぎると、現行 workflow、revision chain、void / superseded、`applyBulkTankOperations` の `extraOps`、procurement workflow を壊すリスクがある。

方針としては、Security Rules では最低限の schema / field / transition guard を担い、複雑な業務手順、actor snapshot 組み立て、transition action 解決、revision chain の詳細な整合性は service / domain operation 側に残すことを検討する。

---

## 3. 対象 Collection と現状

| collection | current rule | current risk | main workflows | hardening priority |
|---|---|---|---|---|
| `tanks` | `allow create, update, delete: if isStaff()` | unauthorized field update、想定外 create/delete | order fulfill、return tag processing、log correction、void、manual operation、bulk return、inhouse、damage、repair、inspection、procurement | high |
| `logs` | `allow create, update, delete: if isStaff()` | malformed log、missing required field、invalid revision、logStatus 改ざん | tank operation、log correction、void、procurement、supply order summary logs | high |
| `transactions` | `allow create: if isStaff() || isOwnTransactionCreate()`、`allow update, delete: if isStaff()` | invalid status transition、missing actor fields、unexpected delete | order approve、order fulfill、return tag processing、customer linking、portal transaction reads | high |
| `tankProcurements` | `allow create, update: if isStaff()`、`allow delete: if isAdmin()` | procurement workflow の field 制限不足 | tank procurement / initial registration | future |
| `orders` | `allow create, update, delete: if isStaff()` | supply order の schema 制限不足 | supply order | future |

今回の主対象は `tanks`、`logs`、`transactions` である。`orders`、`tankProcurements`、settings / master 系は future scope として扱う。

---

## 4. Workflow Payload Inventory

### 4.1 Summary Table

| workflow | writes | required allow | likely field allowlist | unknowns |
|---|---|---|---|---|
| order approve | `transactions/{orderId}` update | order-side approval update | `status`, `approvedAt`, `approvedBy`, `approvedByStaffId`, `approvedByStaffName`, `approvedByStaffEmail`, `updatedAt` | 旧 `approvedBy` 互換を残すか |
| order fulfill | `tanks/{tankId}` update + `logs/{autoId}` create + `transactions/{orderId}` update | order completion と tank/log 更新を同じ transaction で許可 | tanks/logs/transactions 各 field | `applyBulkTankOperations` の `tankExtra` / `logExtra` をどこまで許可するか |
| return tag processing | `tanks/{tankId}` update + `logs/{autoId}` create + `transactions/{returnId}` update | `pending_return` の completion と tank/log 更新を同じ transaction で許可 | `finalCondition`, `fulfilledAt`, `fulfilledByStaff*`, tanks/logs 各 field | return completion payload は現状 `updatedAt` を明示しない |
| log correction | `logs/{targetLogId}` update + `logs/{autoId}` create + `tanks/{tankId}` update | revision / superseded と tank latest state 差し替え | revision 系 field、editor audit fields、tank snapshot fields | 既存 dashboard 仕様、revert 時の inherited timestamp |
| void log | `logs/{logId}` update + `tanks/{tankId}` update | active log を voided にし、tank を prev snapshot へ rollback | `voidReason`, `voidedAt`, `voidedByStaff*`, tank rollback fields | delete を許可する必要があるか |

### 4.2 Order Approve

現行 service:

- `src/lib/firebase/order-fulfillment-service.ts`
- `approveOrder(orderId, actor)`

書き込み:

- `transactions/{orderId}` update

fields:

- `status: "approved"`
- `approvedAt: serverTimestamp()`
- `approvedBy: actor.staffName`
- `approvedByStaffId: actor.staffId`
- `approvedByStaffName: actor.staffName`
- `approvedByStaffEmail` は `actor.staffEmail` がある場合のみ
- `updatedAt: serverTimestamp()`

Rules hardening candidate:

- `diff().affectedKeys()` を上記 field に限定する。
- `resource.data.type == "order"` を要求する。
- `request.resource.data.status == "approved"` を要求する。
- `resource.data.status` は `pending` / `pending_approval` のどちらまで許可するか要確認。現行 UI は `pending`, `pending_approval`, `approved` を一覧取得しているが、承認ボタンの対象 status は画面仕様を確認する必要がある。

### 4.3 Order Fulfill

現行 service:

- `src/lib/firebase/order-fulfillment-service.ts`
- `fulfillOrder(input)`
- `applyBulkTankOperations(inputs, extraOps)`

書き込み:

- `tanks/{tankId}` update
- `logs/{autoId}` create
- `transactions/{orderId}` update in `extraOps`

`transactions/{orderId}` fields:

- `status: "completed"`
- `fulfilledAt: serverTimestamp()`
- `fulfilledBy: actor.staffName`
- `fulfilledByStaffId: actor.staffId`
- `fulfilledByStaffName: actor.staffName`
- `fulfilledByStaffEmail` は `actor.staffEmail` がある場合のみ
- `updatedAt: serverTimestamp()`

`tanks/{tankId}` fields from `tankUpdateFromSnapshot(...)`:

- `status`
- `location`
- `staff`
- `logNote`
- `latestLogId`
- `updatedAt`

`logs/{autoId}` fields from `commitPlannedOperations(...)`:

- `tankId`
- `action`
- `transitionAction`
- `prevStatus`
- `newStatus`
- `location`
- `staffId`
- `staffName`
- `staffEmail` optional
- `customerId` optional
- `customerName` optional
- `note`
- `logNote`
- `timestamp`
- `originalAt`
- `revisionCreatedAt`
- `logStatus: "active"`
- `logKind: "tank"`
- `rootLogId`
- `revision: 1`
- `prevTankSnapshot`
- `nextTankSnapshot`
- `previousLogIdOnSameTank`
- sanitized `logExtra` fields if caller supplied them

Rules hardening candidate:

- `transactions` completion updateの affected keys を completion fields に限定する。
- `tanks` update の affected keys を operation fields に限定する。
- `logs` create の required keys を定義する。
- `logs` create の `logStatus == "active"`、`logKind == "tank"`、`revision == 1` を確認する。
- `rootLogId == request.resource.id` は create 時に検証できる可能性がある。

Unknown:

- `logExtra` / `tankExtra` を使う既存 workflow があり、allowlist を狭めると壊れる可能性がある。field inventory を workflow 全体で確認する必要がある。

### 4.4 Return Tag Processing

現行 service:

- `src/lib/firebase/return-tag-processing-service.ts`
- `processReturnTags(input)`
- `applyBulkTankOperations(inputs, extraOps)`

書き込み:

- `tanks/{tankId}` update
- `logs/{autoId}` create
- `transactions/{returnId}` update in `extraOps`

`transactions/{returnId}` fields:

- `status: "completed"`
- `finalCondition`
- `fulfilledAt: serverTimestamp()`
- `fulfilledBy: actor.staffName`
- `fulfilledByStaffId: actor.staffId`
- `fulfilledByStaffName: actor.staffName`
- `fulfilledByStaffEmail` は `actor.staffEmail` がある場合のみ

注意:

- 現行 payload は `updatedAt` を明示していない。Rules の staff update は broad のため現状では拒否されない。
- return 側の処理待ちは `pending_return` であり、`pending_approval` は使わない。

`tanks` / `logs` fields:

- `applyBulkTankOperations` と同じ。
- `condition === "keep"` の場合は `ACTION.CARRY_OVER` 相当で、location は `tank.location || customerName`。
- それ以外は location `"倉庫"`。
- note / logNote は `[返却タグ処理] 顧客: ... (タグ:...)`。

Rules hardening candidate:

- `transactions` return completion update は `resource.data.type == "return"` と `resource.data.status == "pending_return"` を要求する。
- `request.resource.data.status == "completed"` と `finalCondition in ["normal", "unused", "uncharged", "keep"]` を要求する。
- `fulfilledBy*` fields を要求するかは、staffEmail optional との兼ね合いで検討する。

### 4.5 Log Correction

現行 function:

- `src/lib/tank-operation.ts`
- `applyLogCorrection(input)`

書き込み:

- `logs/{targetLogId}` update
- `logs/{autoId}` create
- `tanks/{oldTankId}` update if tank changed
- `tanks/{newTankId}` update

target log update fields:

- `logStatus: "superseded"`
- `supersededByLogId`

new revision log fields:

- inherited content fields from old/source log
- `tankId`
- `action`
- `transitionAction`
- `location`
- `staffId`
- `staffName`
- `staffEmail` optional
- `customerId` / `customerName` optional
- `note`
- `logNote`
- `prevStatus`
- `newStatus`
- `logStatus: "active"`
- `logKind: "tank"`
- `rootLogId`
- `revision`
- `supersedesLogId`
- `originalAt`
- `timestamp`
- `revisionCreatedAt`
- `editedByStaffId`
- `editedByStaffName`
- `editedByStaffEmail` optional
- `editReason`
- `prevTankSnapshot`
- `nextTankSnapshot`
- `previousLogIdOnSameTank`
- copied body extra fields from old/source log

tank update fields:

- `status`
- `location`
- `staff`
- `logNote`
- `latestLogId`
- `updatedAt`

Rules hardening candidate:

- `logs` update for supersede should be a small affected key allowlist.
- `logs` create for revision should require `supersedesLogId`, editor audit fields, `revision > 1` if feasible.
- Full revision chain validation in Rules is likely too complex and should stay in `tank-operation.ts`.

### 4.6 Void Log

現行 function:

- `src/lib/tank-operation.ts`
- `voidLog(input)`

書き込み:

- `logs/{logId}` update
- `tanks/{tankId}` update

log update fields:

- `logStatus: "voided"`
- `voidReason`
- `voidedAt: serverTimestamp()`
- `voidedByStaffId`
- `voidedByStaffName`
- `voidedByStaffEmail` optional

tank rollback fields:

- `status`
- `location`
- `staff`
- `logNote`
- `latestLogId`
- `updatedAt`

Rules hardening candidate:

- `logs` void update should require `resource.data.logStatus == "active"` and `request.resource.data.logStatus == "voided"`.
- affected keys should be limited to void fields.
- Full latest-log rollback validation is likely too complex for Rules and should stay in `tank-operation.ts`.

---

## 5. Rules Hardening Strategy

### 5.1 Option A: broad staff write を維持する

内容:

- `tanks`, `logs`, `transactions` の staff write を引き続き `isStaff()` のみで許可する。

メリット:

- 現行 workflow を壊しにくい。
- `applyBulkTankOperations`、revision、void、procurement、legacy data への影響が少ない。
- Rules deploy までの作業量が小さい。

デメリット:

- malformed payload を Rules 側で拒否できない。
- active staff client が Firestore SDK を直接叩くリスクを防げない。
- Security Rules を本番化しても、write schema 保護としては弱い。

deploy 前評価:

- caution として許容することは可能だが、「Rules で業務不変条件を守る」前提なら blocker。
- 少なくともこの弱さを release note / deploy checklist に明記する必要がある。

### 5.2 Option B: field allowlist だけ先に入れる

内容:

- `transactions` update の affected keys を workflow 別に制限する。
- `logs` create / update の keys を operation / correction / void の代表 field に制限する。
- `tanks` update の affected keys を `status`, `location`, `staff`, `logNote`, `latestLogId`, `updatedAt` と既知 `tankExtra` fields に制限する。
- status transition はまだ強く縛らない。

メリット:

- malformed payload や unauthorized field update をかなり減らせる。
- Option C より現行 workflow を壊しにくい。
- rules-only PR として段階的に切りやすい。

デメリット:

- transition の妥当性までは守れない。
- `logExtra` / `tankExtra` の既存使用を洗い切らないと、正しい workflow を拒否する可能性がある。
- log correction / void / procurement を一度に allowlist 化すると差分が大きくなる。

deploy 前評価:

- 推奨。Security Rules deploy 前の最小 hardening として現実的。
- ただし最初の rules-only PR は `transactions` staff update allowlist から始めるのが安全。

### 5.3 Option C: field allowlist + transition guard を入れる

内容:

- `transactions` は `resource.data.status` と `request.resource.data.status` の transition を検証する。
- `logs` は `logStatus`, `revision`, `supersedesLogId`, `voidedAt`, `rootLogId` などを検証する。
- `tanks` は `status`, `location`, `latestLogId` の関係を検証する。

メリット:

- Security Rules 側の防御力が高い。
- direct SDK write による不正 transition を拒否しやすい。

デメリット:

- Rules に業務ロジックが入りすぎる。
- `tank-operation.ts` の revision / void / correction と二重実装になりやすい。
- `applyBulkTankOperations` の transaction 内で作られる new log id と tank `latestLogId` の整合を Rules だけで保つのは難しい。
- 既存 workflow / legacy data / future workflow を壊すリスクが高い。

deploy 前評価:

- 後回し推奨。
- Option B の field allowlist と manual verification が通った後、狭い workflow 単位で検討する。

---

## 6. 推奨する段階的 PR 分割

| PR | scope | 目的 | deploy |
|---|---|---|---|
| PR A | docs-only staff write hardening design | 本 document。broad staff write をどう扱うか設計する | しない |
| PR B | rules-only transactions staff update allowlist | order approve / fulfill / return tag processing / customer linking の transaction update field を絞る | しない |
| PR C | rules-only logs create/update allowlist | tank operation / correction / void の log field を絞る | しない |
| PR D | rules-only tanks update allowlist | operation / correction / void / tag update / procurement に必要な tank field を絞る | しない |
| PR E | staffByEmail casing policy | Auth email と lowercase mirror の運用方針を決める | しない |
| PR F | passcode session policy | passcode session を本番 Rules で無効前提にするか、別 auth 設計にするか決める | しない |
| PR G | customerUsers.status existing field policy | 既存 `status` field が自己更新を阻害する問題の方針を決める | しない |
| PR H | firebase.json / Security Rules deploy procedure | `firebase.json` 接続と deploy 手順を専用手順化する | 専用レビュー後のみ |

`firebase.json` 接続や Security Rules deploy 手順は最後に回す。Hosting deploy と Rules deploy は絶対に混ぜない。

---

## 7. Proposed Minimum Before Security Rules Deploy

Security Rules deploy 前に最低限やるべきこと:

1. `transactions` staff update allowlist の最小導入。
   - order approve、order fulfill、return tag processing、customer linking を壊さない範囲に限定する。
2. `logs` / `tanks` staff write を broad のまま deploy するか、最低限 field allowlist を先に入れるか判断する。
3. `staffByEmail` casing 方針を確定する。
   - Auth email が lowercase 運用であることを前提にするのか、mirror / login policy を変えるのか決める。
4. passcode sessions を本番で無効前提にすることを明文化する。
5. `customerUsers.status` 既存 field 問題の解消方針を決める。
6. customer linking batch update の静的照合を行う。
7. `firebase.json` をいつ、どの PR で rules に接続するかを決める。
8. Security Rules deploy は専用 PR / 専用手順で行い、Hosting deploy と混ぜない。

---

## 8. Non-goals

今回やらないこと:

- `firestore.rules` の実装変更。
- Security Rules deploy。
- Hosting deploy。
- Firestore data migration。
- `firebase.json` 接続。
- `staffByEmail` 修正。
- passcode auth 修正。
- `customerUsers.status` 修正。
- `tank-operation.ts` 分割。
- service / hook / repository の再設計。
- Cloud Functions 化。

---

## 9. Manual Verification Matrix

### 9.1 Allow

| scenario | expected | verification point |
|---|---|---|
| authenticated active staff approves order | allow | `transactions/{orderId}` approval fields only |
| authenticated active staff fulfills order | allow | `tanks` update + `logs` create + `transactions` completion in same transaction |
| authenticated active staff processes return tags | allow | `pending_return` transaction completion + tank/log update |
| authenticated active staff corrects log | allow | target log superseded, new revision log created, tank latest state updated |
| authenticated active staff voids log | allow | active log voided, tank rolled back to previous snapshot |

### 9.2 Deny

| scenario | expected | verification point |
|---|---|---|
| anonymous write | deny | `isStaff()` false |
| passcode-only localStorage session write | deny | Rules cannot see localStorage session |
| missing `staffByEmail` | deny | `exists(staffByEmail/{email})` false |
| Auth email casing mismatch | deny / caution | Rules exact path lookup cannot lowercase email |
| logs extra field | deny after hardening | current broad rule allows; field allowlist needed |
| missing required log field | deny after hardening | current broad rule allows; required key check needed |
| invalid transaction status transition | deny after hardening | current broad rule allows; transition guard needed |
| tanks unauthorized field update | deny after hardening | current broad rule allows; affected key allowlist needed |
| transaction delete by non-admin | deny after hardening | current rule allows active staff delete; delete policy needed |

---

## 10. Open Questions

- staff write の delete をどこまで許可するか。
  - 現行 rules draft は `tanks`, `logs`, `transactions` の delete を active staff に許可している。
  - 実運用で通常 staff delete が必要か、admin 限定または全拒否にできるか確認が必要。
- logs の revision / void / superseded を Rules でどこまで検証するか。
  - `tank-operation.ts` の正本不変条件を Rules に重複実装しすぎない方針が必要。
- tanks の create は procurement / initial registration と通常 operation で分けるべきか。
  - `applyBulkTankOperations` は既存 tank update が中心で、tank create は procurement workflow 側。
- transactions の customer linking batch update を同じ hardening に含めるか。
  - `pending_link` order の `pending` 昇格、`linkedByStaff*` fields、customer snapshot を別 workflow として整理する必要がある。
- `staffByEmail` doc id は lowercase 固定でよいか。
  - Rules は lowercase 変換できないため、Auth email casing policy が必要。
- passcode sessions を本番で完全に無効とみなすか。
  - `StaffAuthGuard` は localStorage staffSession だけでは認証済みにしない設計だが、feature flag で passcode login は存在する。
- return tag processing の transaction completion に `updatedAt` を入れるべきか。
  - 現行 broad rule では問題にならないが、field allowlist / timestamp policy の設計時に確認する。
- `logExtra` / `tankExtra` の既存使用範囲をどう棚卸しするか。
  - field allowlist の前提として、operation workflow 全体で追加 field を洗う必要がある。

---

## 11. 推奨方針

Security Rules deploy 前に、少なくとも `transactions` の staff update allowlist を rules-only PR として検討する。

`logs` と `tanks` は `tank-operation.ts` の payload が広く、revision / void / correction / procurement / future operation と絡むため、最初から strict transition guard まで入れない。まず field allowlist の feasibility を確認し、manual verification を追加したうえで段階的に絞る。

staff operation の正常 payload を通すことだけを目的にするなら現行 broad rule でも deploy は可能だが、Security Rules を業務 write の防御層として期待するなら、broad staff write のまま本番化するのは blocker と扱う。
