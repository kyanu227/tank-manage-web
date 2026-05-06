# Security Rules Manual Verification

作成日: 2026-05-05

対象:

- `customerUsers`
- `transactions`
- portal order create
- portal return create
- portal uncharged report create
- staff operation writes
- staffJoinRequests owner create / update
- staffJoinRequests admin review update
- staffByUid own get / admin list / admin write

---

## 1. 目的

PR #31 で Security Rules readiness audit を作成し、PR #32 で未deploy の `firestore.rules` draft を現行 portal create payload に追従した。

この document は、Security Rules を本番 deploy する前に、どの write が許可されるべきか、どの write が拒否されるべきかを手動で確認するための検証台本である。

この document は docs-only であり、実装コード、`firestore.rules`、`firebase.json`、Firestore data、deploy は変更しない。

---

## 2. 前提条件

- 検証対象の branch / commit を記録する。
- 検証対象の `firestore.rules` がどの commit のものかを記録する。
- `firestore.rules` は本番未deploy の draft として扱う。
- `firebase.json` は Firestore Rules に接続しない。
- Security Rules deploy はこの検証手順には含めない。
- Hosting deploy と Security Rules deploy を混ぜない。
- Firestore console で本番 data を直接編集して検証状態を作らない。
- 可能なら本番 data ではなく検証用 project / emulator / Rules Playground 相当で payload を確認する。

---

## 3. 検証前の禁止事項

- `firebase deploy --only firestore:rules` を実行しない。
- `firebase deploy` や Hosting deploy を実行しない。
- `firebase.json` を変更しない。
- `src/**` を変更しない。
- Firestore data を直接書き換えない。
- package files を変更しない。
- passcode localStorage session を Security Rules 上の staff identity として扱わない。

---

## 4. 検証対象の collection / field

| collection | operation | 主な確認 field |
|---|---|---|
| `customerUsers/{uid}` | first login create | `uid`, `email`, `displayName`, `selfCompanyName`, `selfName`, `customerId`, `customerName`, `setupCompleted`, `disabled`, `createdAt`, `lastLoginAt`, `updatedAt` |
| `customerUsers/{uid}` | login update | `email`, `displayName`, `lastLoginAt`, `updatedAt` |
| `customerUsers/{uid}` | setup complete | `selfCompanyName`, `selfName`, `lineName`, `setupCompleted`, `updatedAt` |
| `transactions/{id}` | linked portal order create | `type`, `status`, `items`, `customerId`, `customerName`, `createdByUid`, requested snapshot fields, `createdAt`, `updatedAt`, `source` |
| `transactions/{id}` | unlinked portal order create | `type`, `status`, `items`, `customerId`, `customerName`, `createdByUid`, requested snapshot fields, `createdAt`, `updatedAt`, `source` |
| `transactions/{id}` | portal return create | `type`, `status`, `tankId`, `condition`, `customerId`, `customerName`, `createdByUid`, `createdAt`, `updatedAt`, `source` |
| `transactions/{id}` | portal uncharged report create | `type`, `status`, `tankId`, `customerId`, `customerName`, `createdByUid`, `createdAt`, `updatedAt`, `source` |
| `transactions` / `tanks` / `logs` | staff operation writes | 詳細は `docs/verification/staff-operation-manual-verification.md` を参照 |
| `staffJoinRequests/{uid}` | owner create | `uid`, `authEmail`, `authEmailLower`, `authDisplayName`, `requestedName`, `message`, `status`, `createdAt`, `updatedAt` |
| `staffJoinRequests/{uid}` | owner update | `authEmail`, `authEmailLower`, `authDisplayName`, `requestedName`, `message`, `status`, `updatedAt` |
| `staffJoinRequests/{uid}` | admin review update | `status`, `reviewedAt`, `reviewedByStaffId`, `reviewedByStaffName`, `linkedStaffId`, `rejectionReason`, `updatedAt` |
| `staffByUid/{uid}` | own get / admin list / admin write | `uid`, `staffId`, `name`, `email`, `role`, `rank`, `isActive`, `updatedAt` |
| `staff/{staffId}` | admin approval transaction | `authUid`, `authEmail`, `uidLinkedAt`, `updatedAt` |

---

## 5. 許可されるべき payload

### 5.1 customerUsers first login create

前提:

- Firebase Auth user として login 済み。
- document id は `request.auth.uid`。
- `request.auth.token.email` が存在する。

期待:

- `customerUsers/{uid}` create が許可される。
- `status` field は保存しない。

payload:

```json
{
  "uid": "<auth uid>",
  "email": "<auth email>",
  "displayName": "<auth display name>",
  "selfCompanyName": "",
  "selfName": "<display name or input name>",
  "customerId": null,
  "customerName": "",
  "setupCompleted": false,
  "disabled": false,
  "createdAt": "<server timestamp>",
  "lastLoginAt": "<server timestamp>",
  "updatedAt": "<server timestamp>"
}
```

確認:

- `uid == request.auth.uid`。
- `email == request.auth.token.email`。
- `customerId == null`。
- `customerName == ""`。
- `setupCompleted == false`。
- `disabled == false`。
- `status` が含まれていない。

### 5.2 customerUsers login update

前提:

- 既存 `customerUsers/{uid}` がある。
- document id は `request.auth.uid`。

期待:

- login 時の merge update が許可される。
- `customerId`, `customerName`, `disabled`, `createdAt` は変わらない。
- `status` field は保存しない。

payload:

```json
{
  "email": "<auth email>",
  "displayName": "<auth display name>",
  "lastLoginAt": "<server timestamp>",
  "updatedAt": "<server timestamp>"
}
```

確認:

- 変更 field が `email`, `displayName`, `lastLoginAt`, `updatedAt` に収まる。
- `email` を変更する場合は `request.auth.token.email` と一致する。
- `status` が含まれていない。

### 5.3 customerUsers setup complete

前提:

- 既存 `customerUsers/{uid}` がある。
- document id は `request.auth.uid`。

期待:

- setup complete update が許可される。
- `selfCompanyName` と `selfName` は空ではない。
- `customerId`, `customerName`, `disabled`, `createdAt` は変わらない。
- `status` field は保存しない。

payload:

```json
{
  "selfCompanyName": "検証会社",
  "selfName": "検証 太郎",
  "lineName": "line-name",
  "setupCompleted": true,
  "updatedAt": "<server timestamp>"
}
```

確認:

- `selfCompanyName` が non-empty string。
- `selfName` が non-empty string。
- `setupCompleted == true`。
- `status` が含まれていない。

### 5.4 linked portal order create

前提:

- `customerUsers/{uid}` が active。
- `customerUsers/{uid}.customerId` と `customerUsers/{uid}.customerName` が存在する。
- `createdByUid == request.auth.uid`。

期待:

- linked portal order create が許可される。
- `status` は `pending`。
- `customerId` / `customerName` は linked customer と一致する。
- requested snapshot fields と `updatedAt` が許可される。

payload:

```json
{
  "type": "order",
  "status": "pending",
  "items": [
    { "tankType": "10L", "quantity": 2 }
  ],
  "customerId": "<linked customer id>",
  "customerName": "<linked customer name>",
  "createdByUid": "<auth uid>",
  "requestedCompanyName": "<self company name>",
  "requestedByName": "<self name>",
  "requestedLineName": "<line name or empty>",
  "deliveryType": "pickup",
  "deliveryTargetName": "",
  "note": "",
  "orderNote": "",
  "deliveryNote": "",
  "createdAt": "<server timestamp>",
  "updatedAt": "<server timestamp>",
  "source": "customer_portal"
}
```

確認:

- `status == "pending"`。
- `source == "customer_portal"`。
- `customerId == linkedCustomerId()`。
- `customerName == linkedCustomerName()`。
- `items` が list。
- `createdAt` と `updatedAt` が含まれる。

### 5.5 unlinked portal order create

前提:

- `customerUsers/{uid}` が active。
- `customerUsers/{uid}.customerId` が未設定。
- `createdByUid == request.auth.uid`。

期待:

- unlinked portal order create が許可される。
- `status` は `pending_link`。
- `customerId` は `null`。
- `customerName` は `""`。
- requested snapshot fields が含まれる。
- `updatedAt` が許可される。

payload:

```json
{
  "type": "order",
  "status": "pending_link",
  "items": [
    { "tankType": "10L", "quantity": 2 }
  ],
  "customerId": null,
  "customerName": "",
  "createdByUid": "<auth uid>",
  "requestedCompanyName": "検証会社",
  "requestedByName": "検証 太郎",
  "requestedLineName": "line-name",
  "deliveryType": "delivery",
  "deliveryTargetName": "現地",
  "note": "検証メモ",
  "orderNote": "検証メモ",
  "deliveryNote": "検証メモ",
  "createdAt": "<server timestamp>",
  "updatedAt": "<server timestamp>",
  "source": "customer_portal"
}
```

確認:

- `status == "pending_link"`。
- `customerId == null`。
- `customerName == ""`。
- `requestedCompanyName`, `requestedByName`, `requestedLineName` が string。
- `createdByUid == request.auth.uid`。
- `createdAt` と `updatedAt` が含まれる。

### 5.6 portal return create

前提:

- `customerUsers/{uid}` が active。
- linked customer user である。
- `createdByUid == request.auth.uid`。

期待:

- portal return create が許可される。
- `status` は `pending_return`。
- `condition` は `normal`, `unused`, `uncharged`, `keep` のいずれか。
- `updatedAt` が許可される。

payload:

```json
{
  "type": "return",
  "status": "pending_return",
  "tankId": "<tank id>",
  "condition": "normal",
  "customerId": "<linked customer id>",
  "customerName": "<linked customer name>",
  "createdByUid": "<auth uid>",
  "createdAt": "<server timestamp>",
  "updatedAt": "<server timestamp>",
  "source": "customer_portal"
}
```

condition 別に確認する値:

- `normal`
- `unused`
- `uncharged`
- `keep`

確認:

- `pending_approval` ではなく `pending_return`。
- `condition` が許可値に収まる。
- `customerId` / `customerName` が linked customer と一致する。
- `source` は `customer_portal` または `auto_schedule`。
- `createdAt` と `updatedAt` が含まれる。

### 5.7 portal uncharged report create

前提:

- `customerUsers/{uid}` が active。
- linked customer user である。
- `createdByUid == request.auth.uid`。

期待:

- portal uncharged report create が許可される。
- `status` は `completed`。
- `updatedAt` が許可される。

payload:

```json
{
  "type": "uncharged_report",
  "status": "completed",
  "tankId": "<tank id>",
  "customerId": "<linked customer id>",
  "customerName": "<linked customer name>",
  "createdByUid": "<auth uid>",
  "createdAt": "<server timestamp>",
  "updatedAt": "<server timestamp>",
  "source": "customer_app"
}
```

確認:

- `status == "completed"`。
- `source == "customer_app"`。
- `customerId` / `customerName` が linked customer と一致する。
- `createdAt` と `updatedAt` が含まれる。

### 5.8 staff operation writes by staff

対象:

- order approve
- order fulfill
- return tag processing

期待:

- Firebase Auth user が active staff として `staffByEmail/{email}` で確認できる場合、staff operation write が許可される。
- 詳細な `transactions` / `tanks` / `logs` の期待結果は `docs/verification/staff-operation-manual-verification.md` を参照する。

確認:

- `staffByEmail/{request.auth.token.email}` が存在する。
- `staffByEmail/{email}.isActive == true`。
- passcode localStorage session だけでは staff write を許可しない。

### 5.9 staffJoinRequests owner pending create

前提:

- Firebase Auth user として login 済み。
- document id は `request.auth.uid`。
- `request.auth.token.email` が存在する。
- user はまだ staff 権限を得ていない。

期待:

- `staffJoinRequests/{uid}` create が許可される。
- `status` は `pending` のみ。
- `uid` / `authEmail` は `request.auth` と一致する。
- `role`, `rank`, `isActive`, `linkedStaffId`, `reviewedBy*`, `rejectionReason` は本人 create で書けない。

payload:

```json
{
  "uid": "<auth uid>",
  "authEmail": "<auth email>",
  "authEmailLower": "<lowercase auth email>",
  "authDisplayName": "<auth display name or empty>",
  "requestedName": "申請 太郎",
  "message": "スタッフ利用申請です",
  "status": "pending",
  "createdAt": "<server timestamp>",
  "updatedAt": "<server timestamp>"
}
```

確認:

- `uid == request.auth.uid`。
- `authEmail == request.auth.token.email`。
- `requestedName` が non-empty string。
- allowed keys 外の review / role field が含まれていない。

### 5.10 staffJoinRequests owner get / pending update

前提:

- `staffJoinRequests/{uid}` が存在する。
- document id は `request.auth.uid`。
- 既存 request の `status` は `pending`。

期待:

- 申請者本人が自分の request を get できる。
- pending 中の `requestedName`, `message`, auth snapshot, `updatedAt` 更新が許可される。
- `approved` / `rejected` への変更は許可されない。
- `linkedStaffId`, `reviewedByStaffId`, `reviewedByStaffName`, `rejectionReason` は本人 update で書けない。

payload:

```json
{
  "uid": "<auth uid>",
  "authEmail": "<auth email>",
  "authEmailLower": "<lowercase auth email>",
  "authDisplayName": "<auth display name or empty>",
  "requestedName": "申請 太郎",
  "message": "補足メッセージを更新します",
  "status": "pending",
  "createdAt": "<existing createdAt>",
  "updatedAt": "<server timestamp>"
}
```

確認:

- `resource.data.status == "pending"`。
- `request.resource.data.status == "pending"`。
- `request.resource.data.uid == resource.data.uid == request.auth.uid`。
- `authEmail == request.auth.token.email`。

### 5.11 staffJoinRequests admin review update

前提:

- `staffJoinRequests/{uid}` が存在する。
- 既存 request の `status` は `pending`。
- reviewer は `isAdmin()`。

期待:

- admin が `approved` へ review update できる。
- admin が `rejected` へ review update できる。
- sub-admin は list できるが review update は拒否される。
- `staff.authUid` / `staffByUid` / request status の複数 document 整合性は service transaction で担保する。

approved payload:

```json
{
  "status": "approved",
  "reviewedAt": "<server timestamp>",
  "reviewedByStaffId": "<reviewer staff id>",
  "reviewedByStaffName": "<reviewer staff name>",
  "linkedStaffId": "<linked staff id>",
  "updatedAt": "<server timestamp>"
}
```

rejected payload:

```json
{
  "status": "rejected",
  "reviewedAt": "<server timestamp>",
  "reviewedByStaffId": "<reviewer staff id>",
  "reviewedByStaffName": "<reviewer staff name>",
  "rejectionReason": "今回は承認しません",
  "updatedAt": "<server timestamp>"
}
```

確認:

- review update は `isAdmin()` のみ。
- approved では `linkedStaffId` が non-empty string。
- rejected では `rejectionReason` が string。
- approved と rejected の payload field が混ざらない。

### 5.12 staffByUid own get / admin list / admin write

前提:

- `staffByUid/{uid}` は staff 正本ではなく AuthGuard / Rules 用 mirror。
- 本番 deploy 前に active staff 分の mirror 作成状況を確認する。

期待:

- signed-in user は自分の `staffByUid/{uid}` を get できる。
- adminStaff は `staffByUid` を list できる。
- admin は `staffByUid/{uid}` を create / update / delete できる。
- non-admin は staffByUid write できない。
- 他人の `staffByUid/{uid}` get は拒否される。

確認:

- own get は `request.auth.uid == uid`。
- list は `isAdminStaff()`。
- create / update / delete は `isAdmin()`。

---

## 6. 拒否されるべき payload

| scenario | 拒否理由 |
|---|---|
| 未ログイン user による `customerUsers` / `transactions` create | `request.auth == null` |
| disabled customer user による transaction create | `isActiveCustomerUser()` が false |
| customer本人が `customerUsers.status` を保存する | 顧客本人 write では `status` を保存しない |
| customer本人が `customerId` / `customerName` / `disabled` を変更する | setup / login update の自己更新範囲外 |
| unlinked portal order なのに `status: "pending"` を使う | unlinked order は `pending_link` のみ |
| unlinked portal order なのに `customerId` が `null` ではない | unlinked identity と矛盾 |
| unlinked portal order なのに `customerName` が空ではない | unlinked identity と矛盾 |
| unlinked portal order に requested snapshot fields がない | unlinked order の owner snapshot 不足 |
| linked portal order なのに `customerId` が linked customer と一致しない | owner identity 不一致 |
| linked portal order なのに `customerName` が linked customer と一致しない | owner identity 不一致 |
| linked portal order なのに `status: "pending_link"` を使う | linked order は `pending` |
| portal return が `pending_approval` を使う | return 側は `pending_return` |
| portal return の `condition` が `normal / unused / uncharged / keep` 以外 | condition 許可値外 |
| portal return で `customerId` / `customerName` が linked customer と一致しない | owner identity 不一致 |
| portal order / return / uncharged_report で `updatedAt` が欠ける | repository が付与する required field と不一致 |
| portal order / return / uncharged_report に allowed keys 外の field を混ぜる | key validation 違反 |
| uncharged report が `status: "pending"` を使う | uncharged report は `completed` |
| uncharged report の `source` が `customer_app` ではない | 現行 rules draft の許可 source と不一致 |
| passcode localStorage session だけで Firestore write しようとする | Rules は localStorage session を検証できない |
| `staffByEmail` mirror がない Firebase Auth user が staff write しようとする | `isStaff()` が false |
| inactive staff が staff write しようとする | `staffByEmail/{email}.isActive != true` |
| 未ログイン user が `staffJoinRequests` を create する | `request.auth == null` |
| `uid` が `request.auth.uid` と違う `staffJoinRequests` create | owner identity 不一致 |
| `authEmail` が `request.auth.token.email` と違う `staffJoinRequests` create | Auth email snapshot 不一致 |
| owner が `staffJoinRequests.status` に `approved` / `rejected` を書く | 本人は pending のみ |
| owner が `linkedStaffId` / `reviewedByStaffId` / `reviewedByStaffName` / `rejectionReason` を書く | review field は本人 write 範囲外 |
| owner が approved / rejected request を update する | owner update は pending 中のみ |
| non-admin が `staffJoinRequests` を list する | list は adminStaff のみ |
| sub-admin が staffJoinRequests review update する | 現行 draft は list 可、review update は admin のみ |
| non-admin が `staffByUid` を create / update / delete する | write は admin のみ |
| unrelated signed-in user が他人の `staffByUid/{uid}` を get する | own uid ではない |
| passcode localStorage session だけで staffJoinRequests admin review / staffByUid write を行う | Rules は localStorage session を staff identity として扱えない |

---

## 7. 既知の別論点

### 7.1 staffByEmail casing

現行 rules draft は `staffByEmail/{request.auth.token.email}` を参照する。

一方、実装側の `staff-sync-service` は email key を lowercase で作る。Firebase Auth email に mixed case が入る場合、Rules 側で lowercase 正規化できないため staff 判定が失敗する可能性がある。

この document では casing を検証観点として記録するが、rules / data / auth 方針の変更は別 PR で扱う。

### 7.2 passcode localStorage sessions

staff passcode login は localStorage session であり、Firestore Rules からは検証できない。

Security Rules 本番化時は、passcode session だけの staff operation は Firestore write に使えない前提で確認する。passcode flow を復活または維持する場合は、Firebase Auth ベースの staff identity 設計を別途行う。

### 7.3 staffByUid / staffJoinRequests deploy readiness

PR #47 で `staffByUid` / `staffJoinRequests` rules draft は追加済みだが、本番 Security Rules には未反映である。

deploy 前には、少なくとも以下を確認する。

- 全 active staff の `staffByUid/{uid}` mirror が作成済みか。
- 既存 `isStaff()` は staffByEmail ベースのままで、staffByUid への全面切替は未実施である。
- `staffJoinRequests` review update は admin のみであり、sub-admin は list までに留まる。
- `staff.authUid` / `staffByUid` / `staffJoinRequests.status` の整合性は service transaction で担保される。

---

## 8. 異常時に確認すること

許可されるべき payload が拒否された場合:

- `request.auth.uid` と document / payload の uid が一致しているか。
- `createdByUid` が `request.auth.uid` と一致しているか。
- `customerUsers/{uid}` が存在するか。
- `customerUsers/{uid}.disabled` が true になっていないか。
- linked customer user の `customerId` / `customerName` が payload と一致しているか。
- unlinked order で `customerId: null` / `customerName: ""` になっているか。
- `createdAt` / `updatedAt` が両方あるか。
- allowed keys 外の field が混ざっていないか。
- staff operation の場合、`staffByEmail/{email}` の doc id と Auth email casing が一致しているか。
- staff applicant の場合、`staffJoinRequests/{uid}` の document id と `request.auth.uid` が一致しているか。
- `authEmail` が `request.auth.token.email` と一致しているか。
- admin review update を sub-admin session で実行していないか。
- `staffByUid/{uid}` の own get で他人の uid を読もうとしていないか。

拒否されるべき payload が許可された場合:

- `isPortalOrderCreate()` の linked / unlinked 分岐が緩すぎないか。
- `requestCustomerIdentityMatchesOwner()` が linked 専用になっているか。
- `requestUnlinkedOrderIdentityMatchesOwner()` が `customerId: null` / `customerName: ""` を要求しているか。
- `isPortalReturnCreate()` に `pending_approval` が残っていないか。
- `condition` の許可値が広すぎないか。
- `keys().hasOnly(...)` の allowed keys が広すぎないか。
- `isOwnStaffJoinRequestCreate(uid)` / `isOwnStaffJoinRequestUpdate(uid)` が review field を許可していないか。
- `isAdminStaffJoinRequestReviewUpdate()` が `approved` / `rejected` 以外を許可していないか。
- `staffByUid` write が admin 以外に許可されていないか。

---

## 9. 検証結果記録テンプレート

| item | value |
|---|---|
| 検証日 |  |
| 検証者 |  |
| 対象 branch / commit |  |
| 対象 `firestore.rules` commit |  |
| 検証環境 |  |
| Security Rules deploy | 未実行 / 実行済み |
| Hosting deploy | 未実行 / 実行済み |

| scenario | expected | actual | result | memo |
|---|---|---|---|---|
| customerUsers first login create | allow |  |  |  |
| customerUsers login update | allow |  |  |  |
| customerUsers setup complete | allow |  |  |  |
| linked portal order create | allow |  |  |  |
| unlinked portal order create | allow |  |  |  |
| portal return normal | allow |  |  |  |
| portal return unused | allow |  |  |  |
| portal return uncharged | allow |  |  |  |
| portal return keep | allow |  |  |  |
| portal uncharged report create | allow |  |  |  |
| staff order approve | allow |  |  | staff verification doc 参照 |
| staff order fulfill | allow |  |  | staff verification doc 参照 |
| staff return tag processing | allow |  |  | staff verification doc 参照 |
| anonymous create | deny |  |  |  |
| disabled customer create | deny |  |  |  |
| unlinked order with `pending` | deny |  |  |  |
| unlinked order with non-null `customerId` | deny |  |  |  |
| linked order with mismatched customer | deny |  |  |  |
| return with `pending_approval` | deny |  |  |  |
| return with invalid condition | deny |  |  |  |
| missing `updatedAt` | deny |  |  |  |
| extra field mixed in | deny |  |  |  |
| customer self-write `status` | deny |  |  |  |
| passcode-only staff write | deny |  |  |  |
| missing `staffByEmail` staff write | deny |  |  |  |
| staffJoinRequests owner pending create | allow |  |  |  |
| staffJoinRequests owner get | allow |  |  |  |
| staffJoinRequests owner pending update | allow |  |  |  |
| staffJoinRequests owner approved update | deny |  |  |  |
| staffJoinRequests owner linkedStaffId write | deny |  |  |  |
| staffJoinRequests admin list | allow |  |  |  |
| staffJoinRequests admin approve review | allow |  |  |  |
| staffJoinRequests admin reject review | allow |  |  |  |
| staffJoinRequests sub-admin review | deny |  |  | list は allow、review update は deny |
| staffByUid own get | allow |  |  |  |
| staffByUid other user get | deny |  |  |  |
| staffByUid admin list | allow |  |  |  |
| staffByUid non-admin write | deny |  |  |  |

---

## 10. Security Rules deploy 前 checklist

- [ ] `firestore.rules` draft の対象 commit を確認した。
- [ ] `firebase.json` を変更していない。
- [ ] Hosting deploy と Security Rules deploy を同じ作業に混ぜていない。
- [ ] `customerUsers` first login / login update / setup complete の allow を確認した。
- [ ] linked portal order create の allow を確認した。
- [ ] unlinked portal order create の allow を確認した。
- [ ] portal return `normal / unused / uncharged / keep` の allow を確認した。
- [ ] portal uncharged report create の allow を確認した。
- [ ] staff operation writes の allow を staff verification doc と照合した。
- [ ] 未ログイン user の deny を確認した。
- [ ] disabled customer user の deny を確認した。
- [ ] unlinked order の不正 status / identity の deny を確認した。
- [ ] linked order の不正 customer identity の deny を確認した。
- [ ] return の `pending_approval` deny を確認した。
- [ ] return の invalid condition deny を確認した。
- [ ] `updatedAt` 欠落の deny を確認した。
- [ ] allowed keys 外 field の deny を確認した。
- [ ] customer self-write `status` deny を確認した。
- [ ] passcode localStorage session は Rules で表現できないことを確認した。
- [ ] `staffByEmail` casing を別論点として記録した。
- [ ] active staff の `staffByUid` mirror 作成状況を確認した。
- [ ] `staffJoinRequests` create / update / review の allow / deny を確認した。
- [ ] `staffByUid` own get / admin list / admin write / non-admin deny を確認した。
- [ ] 既存 staffByEmail ベースの `isStaff()` を削除していないことを確認した。
- [ ] Security Rules deploy と Hosting deploy を混ぜていないことを確認した。
- [ ] Security Rules deploy を行う専用手順 / 専用 PR を別途用意した。
