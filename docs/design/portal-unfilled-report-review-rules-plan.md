# Portal Unfilled Report Review Rules Plan

作成日: 2026-05-12

対象 commit: `f71c29fb79587a30421e1d6588efd2472fb87561`

対象 project: `okmarine-tankrental`

この document は、顧客ポータルの未充填報告 `transactions.type == "uncharged_report"` に対する Phase 2 admin review metadata の Security Rules 方針と rules-unit-test 方針を固定する。

今回の範囲:

- docs-only
- 実装変更なし
- `firestore.rules` 変更なし
- `firebase.json` 変更なし
- package files 変更なし
- Firestore data write なし
- Security Rules deploy なし
- Hosting deploy なし
- `firebase deploy` なし
- Firestore Console / script direct edit なし
- delete / void / logs edit なし

---

## 1. Current State

完了済み:

- [portal-unfilled-report-review-metadata.md](./portal-unfilled-report-review-metadata.md) で Phase 2 admin review metadata の schema 方針を整理済み。
- `transactions.status: "completed"` は「顧客報告 record 作成完了」として維持する方針。
- `reviewStatus` は admin review state として `transactions.status` から分離する方針。
- 既存 document の `reviewStatus` 欠落は UI / read helper 側で `unreviewed` とみなす方針。
- staff は Phase 2 でも read-only。
- Phase 2 では tank update / logs create / billing / reward は行わない。

現行 Security Rules の確認結果:

- `isStaff()` は Firebase Auth email と `staffByEmail/{email}` を使う。
- `isAdmin()` は `isStaff() && staffRole() == "管理者"`。
- `isAdminStaff()` は `isAdmin() || isSubAdmin()`。
- customer は `isPortalUnchargedReportCreate()` により `uncharged_report` を create できる。
- staff/admin は `transactions` を read できる。
- `transactions` update は order approve / order fulfill / return completion / pending_link order update に限定されている。
- `uncharged_report` の review metadata update は現行 Rules では未許可。

現行 persisted payload:

```text
type: "uncharged_report"
status: "completed"
tankId
customerId
customerName
createdByUid
createdAt
updatedAt
source: "customer_app"
```

未完了 blocker:

- 本番ログイン後の `/staff/dashboard` protected UI smoke check。
- 本番ログイン後の `/admin` protected UI smoke check。
- current `uncharged_report` payload の実データ確認。
- Phase 2 review update 用の `firestore.rules` draft。
- rules-unit-test / emulator verification。

---

## 2. Review Update Permission Contract

Phase 2 の review update は `transactions/{transactionId}` の既存 `uncharged_report` document に限定する。

許可条件:

- operation は update のみ。
- create では許可しない。
- delete では許可しない。
- actor は admin-only。
- `resource.data.type == "uncharged_report"`。
- `request.resource.data.type == resource.data.type`。
- `request.resource.data.status == resource.data.status`。
- review metadata 以外の field を変更しない。

初回方針:

- `isAdmin()` を使う。
- `isAdminStaff()` は使わない。
- 準管理者・一般 staff には review update を許可しない。
- staff dashboard は read-only のまま維持する。

理由:

- 未充填報告は品質報告 / 顧客クレーム記録であり、請求・報酬・顧客対応に波及する可能性がある。
- return tag processing と混ぜると tank/logs を誤って動かすリスクがある。
- Phase 2 の最小 write path は admin review metadata update だけに絞る。

---

## 3. Mutable Review Fields

review update で変更可能にする候補 field:

```text
reviewStatus
reviewedAt
reviewedByStaffId
reviewedByStaffName
reviewedByStaffEmail
reviewNote
duplicateOfTransactionId
updatedAt
```

Rules draft では `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])` を使い、この field set 以外の変更を拒否する。

field 方針:

| field | policy |
|---|---|
| `reviewStatus` | 必須。`unreviewed` / `confirmed` / `dismissed` / `duplicate` のみ |
| `reviewedAt` | review action 時に更新。timestamp 想定 |
| `reviewedByStaffId` | admin actor の staff id |
| `reviewedByStaffName` | admin actor の display name |
| `reviewedByStaffEmail` | optional。保存する場合は string |
| `reviewNote` | optional。文字数などの詳細 validation は service 側で扱う |
| `duplicateOfTransactionId` | duplicate 扱いの参照先 |
| `updatedAt` | review update 時に更新 |

---

## 4. Immutable Fields

review update で変更不可にする field:

```text
type
status
tankId
customerId
customerName
createdByUid
createdAt
source
items
condition
deliveryType
deliveryTargetName
note
orderNote
deliveryNote
requestedCompanyName
requestedByName
requestedLineName
approvedAt
approvedBy
approvedByStaffId
approvedByStaffName
fulfilledAt
fulfilledBy
fulfilledByStaffId
fulfilledByStaffName
finalCondition
linkedAt
linkedByStaffId
linkedByStaffName
billingStatus
rewardStatus
salesStatus
```

方針:

- `type` は `uncharged_report` のまま固定する。
- `status` は `completed` のまま固定する。
- `tankId`, `customerId`, `customerName`, `createdByUid`, `createdAt`, `source` は顧客報告 record の原本として固定する。
- order / return / billing / reward に関わる field は Phase 2 review update では触らない。

---

## 5. `reviewStatus` Validation

許可値:

```text
unreviewed
confirmed
dismissed
duplicate
```

方針:

- existing document の field missing は read/UI 側で `unreviewed` とみなす。
- update 後は `reviewStatus` を明示的に持つ想定。
- `confirmed` は billing / reward 自動反映を意味しない。
- `dismissed` は delete / void ではなく、監査可能な review state として残す。
- `duplicate` は元 report への参照を残すための review state。

`duplicateOfTransactionId` の扱い:

| option | summary | tradeoff |
|---|---|---|
| Rules strict | `reviewStatus == "duplicate"` の時だけ `duplicateOfTransactionId` を許可 / 要求する | Rules が複雑になるが tamper を早期に拒否できる |
| Service validation | Rules は mutable fields と `reviewStatus` 値だけを見る。duplicate の詳細整合性は service で見る | Rules は単純だが service 実装と rules-unit-test の責務分離が必要 |

推奨:

- 初回 Rules draft では、可能な範囲で `reviewStatus == "duplicate"` の時に `duplicateOfTransactionId` が string であることを確認する。
- `duplicateOfTransactionId` の参照先が同じ `type == "uncharged_report"` かどうかは service validation に寄せる。
- `reviewStatus != "duplicate"` の時に `duplicateOfTransactionId` を残すか削除するかは service/UI の仕様として固定し、rules-unit-test で確認する。

---

## 6. Admin-Only Decision

現行 Rules の admin 判定:

```text
isAdmin()      = isStaff() && staffRole() == "管理者"
isSubAdmin()   = isStaff() && staffRole() == "準管理者"
isAdminStaff() = isAdmin() || isSubAdmin()
```

Phase 2 review update の推奨:

- 初回は `isAdmin()` のみに限定する。
- `isAdminStaff()` は使わない。
- `settings/adminPermissions` とは初回では接続しない。
- 準管理者に review update を許可する場合は、専用 PR で admin permission / UI / Rules を整理する。

理由:

- review metadata は品質報告の業務判断を含む。
- 準管理者権限の範囲は page access と data update permission が一致しない可能性がある。
- 最小安全な Phase 2 として、管理者のみ update 可能にする。

---

## 7. Rules Draft Shape

この PR では `firestore.rules` を変更しない。次の dedicated Rules PR で、以下のような helper を検討する。

```text
function isValidUnchargedReportReviewStatus(status) {
  return status in ["unreviewed", "confirmed", "dismissed", "duplicate"];
}

function isAdminUnchargedReportReviewUpdate() {
  return isAdmin()
    && resource.data.type == "uncharged_report"
    && request.resource.data.type == resource.data.type
    && request.resource.data.status == resource.data.status
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
      "reviewStatus",
      "reviewedAt",
      "reviewedByStaffId",
      "reviewedByStaffName",
      "reviewedByStaffEmail",
      "reviewNote",
      "duplicateOfTransactionId",
      "updatedAt"
    ])
    && isValidUnchargedReportReviewStatus(request.resource.data.reviewStatus);
}
```

追加検討:

- `reviewStatus` / reviewer fields / `updatedAt` を `keys().hasAll([...])` で必須にするか。
- `reviewNote` だけ更新する場合も `reviewStatus` を維持させるか。
- `reviewedByStaffEmail` を optional にするか必須にするか。
- `duplicateOfTransactionId` の presence rule を Rules に入れるか service に寄せるか。

`match /transactions/{transactionId}` への接続案:

```text
allow update: if isStaffTransactionUpdate()
  || isAdminUnchargedReportReviewUpdate();
```

注意:

- `isStaffTransactionUpdate()` と review update の責務を混ぜない。
- order / return lifecycle update と `uncharged_report` review update は別 helper にする。
- delete は引き続き専用方針が必要。Phase 2 review update では delete を扱わない。

---

## 8. Rules-Unit-Test Plan

既存 repository には rules-unit-test harness が見当たらない。追加が必要な場合は package files 変更を伴う可能性があるため、専用 PR に分ける。

### Test Seed

seed candidate:

- `staffByEmail/{adminEmail}`
  - `isActive: true`
  - `role: "管理者"`
- `staffByEmail/{workerEmail}`
  - `isActive: true`
  - `role: "worker"` or non-admin role
- `staffByEmail/{subAdminEmail}`
  - `isActive: true`
  - `role: "準管理者"`
- `customerUsers/{customerUid}`
  - linked active customer user
- `transactions/{unchargedReportId}`
  - `type: "uncharged_report"`
  - `status: "completed"`
  - `tankId`
  - `customerId`
  - `customerName`
  - `createdByUid`
  - `createdAt`
  - `updatedAt`
  - `source: "customer_app"`
- `transactions/{orderId}`
  - `type: "order"`
  - order lifecycle document
- `transactions/{returnId}`
  - `type: "return"`
  - return lifecycle document

auth contexts:

- admin auth with matching email
- staff auth with matching email
- sub-admin auth with matching email
- customer auth with linked `customerUsers`
- unauthenticated

### Allow Cases

| case | actor | mutation | expected |
|---|---|---|---|
| admin confirmed | admin | `reviewStatus: "confirmed"` + reviewer fields + `updatedAt` | allow |
| admin dismissed | admin | `reviewStatus: "dismissed"` + reviewer fields + `reviewNote` + `updatedAt` | allow |
| admin duplicate | admin | `reviewStatus: "duplicate"` + `duplicateOfTransactionId` + reviewer fields + `updatedAt` | allow |
| admin note only | admin | `reviewNote` + `updatedAt` while preserving valid `reviewStatus` | allow |

### Deny Cases

| case | actor | mutation | expected |
|---|---|---|---|
| customer review update | customer | any review field update | deny |
| staff review update | staff | any review field update | deny |
| sub-admin review update | sub-admin | any review field update | deny |
| unauthenticated update | none | any update | deny |
| type change | admin | `type` changed | deny |
| status change | admin | `status` changed | deny |
| tankId change | admin | `tankId` changed | deny |
| customerId change | admin | `customerId` changed | deny |
| customerName change | admin | `customerName` changed | deny |
| createdByUid change | admin | `createdByUid` changed | deny |
| createdAt change | admin | `createdAt` changed | deny |
| source change | admin | `source` changed | deny |
| invalid reviewStatus | admin | `reviewStatus: "approved"` | deny |
| non-report transaction | admin | add review fields to `type != "uncharged_report"` | deny |
| delete report | admin | delete `uncharged_report` | deny for this Phase 2 path |
| create with review fields | admin | create transaction with review fields | deny |
| tank side effect | admin | write `tanks/{tankId}` as part of review action | deny / not part of service |
| logs side effect | admin | create `logs` as part of review action | deny / not part of service |
| billing side effect | admin | write billing/sales/reward data | deny / not part of service |

### Verification Notes

- Deny cases that target other collections should be verified as separate attempted writes, not as implicit side effects.
- App-flow verification should confirm the Phase 2 service writes only `transactions/{id}` review metadata.
- `PERMISSION_DENIED` is expected for deny cases.
- Security Rules deploy must remain separated from tests and require explicit approval.

---

## 9. Implementation PR Split

推奨順:

A. Rules plan docs-only

- この PR。
- `firestore.rules` 変更なし。
- 実装変更なし。

B. Review metadata service / admin UI implementation

- types / service / admin read-action UI。
- staff dashboard は read-only 継続。
- Rules 未変更の場合、本番 write verification はしない。
- tank/logs/billing/reward 変更なし。

C. `firestore.rules` + rules-unit-test

- admin-only review metadata update rule。
- allow/deny tests。
- deploy はしない。

D. App-flow verification docs

- admin confirmed / dismissed / duplicate。
- non-admin deny。
- immutable field deny。

E. Hosting deploy if UI changed

- Hosting only。
- Security Rules deploy と混ぜない。

F. Security Rules deploy operation

- tests / review / explicit approval 後のみ。
- `firebase deploy --only firestore:rules` 相当のみ。
- Hosting deploy と混ぜない。

---

## 10. Non-Goals

この docs PR では以下を行わない。

- implementation changes
- `firestore.rules` changes
- `firebase.json` changes
- package files changes
- Firestore data create/update/delete
- tank update
- logs create/edit/void/delete
- billing / sales / reward changes
- Security Rules deploy
- Hosting deploy
- `firebase deploy`
- Firestore Console / script direct edit
- delete / void operations
