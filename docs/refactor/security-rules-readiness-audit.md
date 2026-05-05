# Security Rules readiness audit

作成日: 2026-05-05

対象:

- `firestore.rules`
- `firebase.json`
- portal transaction write path
- `customerUsers` setup / login write path
- staff / admin auth helper
- staff operation service write path

---

## 1. 目的

この document は、未deploy の `firestore.rules` 下書きが現行 main の実装と一致しているかを確認し、Security Rules 本番化前に必要な修正と検証を棚卸しするための audit である。

今回の audit は docs-only であり、`firestore.rules`、`firebase.json`、実装コード、Firestore data、deploy は変更しない。

---

## 2. 現在の前提

- `firestore.rules` は下書き扱いで未deploy。
- `firebase.json` は Hosting 設定のみを持ち、Firestore Rules を接続していない。
- 通常 deploy は `firebase deploy --only hosting` のみ。
- Security Rules deploy は Hosting deploy と混ぜない。
- PR #21 から PR #30 で write boundary 整理と docs 追従は完了済み。

---

## 3. 現在の rules draft の前提

`firestore.rules` の draft は、概ね次の前提で書かれている。

| area | rules draft の前提 |
|---|---|
| staff / admin | Firebase Auth の email と `staffByEmail/{email}` mirror で staff 判定する |
| staff passcode | passcode localStorage session は Firestore Rules では表現しない |
| customerUsers | 顧客本人は `customerUsers/{uid}` を create / update できる。`status` は保存しない |
| admin customerUsers | admin staff は `customerId`, `customerName`, `disabled`, 暫定 `status`, `updatedAt` を更新できる |
| portal order | `type: "order"`、`status: "pending"`、owner identity 一致を要求する |
| portal return | `type: "return"`、`status: "pending_approval"` を要求する |
| portal uncharged_report | `type: "uncharged_report"`、`status: "completed"` を要求する |
| staff operation | `isStaff()` なら `tanks`, `logs`, `transactions` を更新できる |

---

## 4. 現行コードの write payload

### 4.1 portal order

現行コード:

- `src/lib/firebase/portal-transaction-service.ts`
- `transactionsRepository.createTransaction(...)`

payload:

| field | linked user | unlinked user |
|---|---|---|
| `type` | `"order"` | `"order"` |
| `status` | `"pending"` | `"pending_link"` |
| `customerId` | linked customer id | `null` |
| `customerName` | linked customer name | `""` |
| `createdByUid` | customer user uid | customer user uid |
| `requestedCompanyName` | saved | saved |
| `requestedByName` | saved | saved |
| `requestedLineName` | saved | saved |
| `deliveryType` | saved | saved |
| `deliveryTargetName` | saved | saved |
| `note` / `orderNote` / `deliveryNote` | saved | saved |
| `source` | `"customer_portal"` | `"customer_portal"` |
| `createdAt` / `updatedAt` | repository adds both | repository adds both |

### 4.2 portal return

現行コード:

- `src/lib/firebase/portal-transaction-service.ts`
- `createPortalReturnRequests(...)`

payload:

| field | value |
|---|---|
| `type` | `"return"` |
| `status` | `"pending_return"` |
| `tankId` | selected tank id |
| `condition` | `"normal"` / `"unused"` / `"uncharged"` / `"keep"` |
| `customerId` | linked customer id |
| `customerName` | linked customer name |
| `createdByUid` | customer user uid |
| `source` | `"customer_portal"` or `"auto_schedule"` |
| `createdAt` / `updatedAt` | repository adds both |

### 4.3 portal uncharged report

現行コード:

- `src/lib/firebase/portal-transaction-service.ts`
- `createPortalUnfilledReports(...)`

payload:

| field | value |
|---|---|
| `type` | `"uncharged_report"` |
| `status` | `"completed"` |
| `tankId` | selected tank id |
| `customerId` | linked customer id |
| `customerName` | linked customer name |
| `createdByUid` | customer user uid |
| `source` | `"customer_app"` by default |
| `createdAt` / `updatedAt` | repository adds both |

### 4.4 customerUsers

現行コード:

- `src/lib/firebase/customer-user.ts`
- `src/lib/firebase/portal-profile-service.ts`
- `src/lib/firebase/customer-linking-service.ts`

payload:

| operation | fields |
|---|---|
| first login create | `uid`, `email`, `displayName`, `selfCompanyName`, `selfName`, `customerId: null`, `customerName: ""`, `setupCompleted: false`, `disabled: false`, `createdAt`, `lastLoginAt`, `updatedAt` |
| login update | `email`, `displayName`, `lastLoginAt`, `updatedAt` |
| setup complete | `selfCompanyName`, `selfName`, `lineName`, `setupCompleted: true`, `updatedAt` |
| admin linking | `customerId`, `customerName`, `updatedAt` |

`status` は code 上の derived value であり、顧客本人の create / update では保存しない。

### 4.5 staff auth / staffByEmail

現行コード:

- `src/lib/firebase/staff-auth.ts`
- `src/lib/firebase/staff-sync-service.ts`

現状:

- `findActiveStaffByEmail()` は `staffByEmail/{emailKey}` を優先して読む。
- mirror が存在しない場合は `staff` query fallback で読む。
- PR #24 以降、fallback 経路で `staffByEmail` へ auto-repair write しない。
- `staff-sync-service.saveStaffMembers()` は `staff` と `staffByEmail` mirror を batch で同期する。

### 4.6 staff operation services

現行コード:

- `src/lib/firebase/order-fulfillment-service.ts`
- `src/lib/firebase/return-tag-processing-service.ts`
- `src/lib/tank-operation.ts`

現状:

- order approval は `transactions/{orderId}` を `approved` に更新する。
- order fulfillment は `applyBulkTankOperations()` の `extraOps` 内で `transactions/{orderId}` を `completed` に更新する。
- return tag processing は `applyBulkTankOperations()` の `extraOps` 内で `transactions/{returnId}` を `completed` に更新する。
- `tanks` / `logs` / `transactions` の atomicity は `runTransaction` に参加する形で維持している。

---

## 5. rules と現行コードの不一致

| priority | area | rules draft | 現行コード | deploy した場合の影響 | 最小修正候補 |
|---|---|---|---|---|---|
| 高 | unlinked portal order | `status == "pending"` を要求 | `status: "pending_link"` で作成 | 未紐付け portal order が拒否される | order create rule で linked/unlinked を分岐し、unlinked は `pending_link` を許可する |
| 高 | unlinked portal order identity | unlinked は `customerId == request.auth.uid` / `customerName == selfCompanyName` を要求 | `customerId: null`, `customerName: ""`, `requestedCompanyName` 等を保存 | 未紐付け portal order が拒否される | `pending_link` order では `customerId == null`, `customerName == ""`, `createdByUid == request.auth.uid`, requested snapshot を検証する |
| 高 | portal order requested snapshot | allowed keys に `requestedCompanyName`, `requestedByName`, `requestedLineName` がない | linked / unlinked とも requested snapshot を保存 | linked order も key validation で拒否される可能性 | order allowed keys に requested snapshot fields を追加する |
| 高 | portal return status | `status == "pending_approval"` を要求 | `status: "pending_return"` で作成 | portal return が拒否される | return create rule を `pending_return` に更新する |
| 高 | portal return `updatedAt` | allowed keys に `updatedAt` がない | repository が `updatedAt` を自動付与 | portal return が拒否される | return allowed keys / required keys に `updatedAt` を含める |
| 中 | portal uncharged_report `updatedAt` | allowed keys に `updatedAt` がない | repository が `updatedAt` を自動付与 | uncharged report が拒否される | uncharged allowed keys / required keys に `updatedAt` を含める |
| 中 | staffByEmail email casing | `request.auth.token.email` を doc id として参照 | code は `staffEmailKey(email)` で lowercase mirror を作る | Auth email が mixed case の場合 staff 判定が失敗する | Auth email lowercase 運用を明記するか、mirror / login policy を再設計する |
| 中 | passcode login | Rules では表現しない | feature flag が true の場合 localStorage session で staff login 可能 | Rules 本番化後、passcode flow は Firestore write/read で permission-denied になる | passcode login は原則 disabled 維持。復活するなら別認証設計 |
| 低 | admin customerUsers `status` | admin update で暫定 `status` 保存を許可 | 方針は derived value。現行 service は主に `customerId`, `customerName`, `updatedAt` | 直ちに壊れないが schema 方針とズレる | admin UI の `status` write 実態を再確認し、不要なら rules draft から外す |

---

## 6. live regression ではない理由

- `firestore.rules` は未deploy。
- `firebase.json` に Firestore Rules 設定は接続されていない。
- 現行 Hosting deploy は static app の deploy であり、Rules deploy ではない。

したがって、上記の不一致は現時点の本番障害ではない。

ただし、現在の draft をそのまま本番 deploy すると、portal order / return / uncharged report の正しい現行 write が拒否される可能性が高い。

---

## 7. Security Rules deploy 前に必要な検証

### 7.1 payload fixture

Rules 修正 PR の前に、少なくとも次の payload を固定する。

- linked portal order
- unlinked portal order
- portal return normal
- portal return unused
- portal return uncharged
- portal return keep
- portal uncharged report
- customerUsers first login create
- customerUsers login update
- customerUsers setup complete
- admin customer linking
- order approval by staff
- order fulfillment by staff
- return tag processing by staff

### 7.2 Rules validation

Rules draft 修正後に確認する。

- Firebase Auth あり / なし。
- linked customer user / unlinked customer user / disabled customer user。
- staff / sub admin / admin。
- staffByEmail mirror あり / なし。
- passcode localStorage session だけの状態。

### 7.3 Manual verification

Rules deploy 前に、既存 docs と合わせて確認する。

- `docs/verification/staff-operation-manual-verification.md`
- portal order / return / uncharged report の手動検証手順。
- customerUsers setup / admin linking の手動検証手順。

---

## 8. 次に切るべき最小 PR

### PR A: rules draft 修正

目的:

- `firestore.rules` 下書きを現行 portal transaction semantics に追従する。

対象:

- `firestore.rules`
- 必要なら rules 関連 docs。

含める修正候補:

- order create rule を linked / unlinked で分岐。
- unlinked order の `pending_link` を許可。
- order allowed keys に requested snapshot fields を追加。
- return create rule を `pending_return` に変更。
- return / uncharged allowed keys に `updatedAt` を追加。
- `pending_approval` は order-side の既存互換としてのみ扱い、return create rule には使わない。

含めない:

- deploy。
- `firebase.json` 接続。
- Firestore data migration。
- staffByEmail mirror 完全撤去。

### PR B: portal Security Rules manual verification docs

目的:

- Rules 修正後、deploy 前に実施する手動検証手順を固定する。

対象:

- `docs/verification/*`。

### PR C: staffByEmail mirror policy design

目的:

- mirror を維持する場合と廃止する場合の Rules / auth / data 影響を比較し、方針を決める。

対象:

- docs-only。

### PR D: Security Rules deploy preparation

目的:

- `firebase.json` に Rules を接続するか、deploy 手順をどう固定するかを決める。

注意:

- Hosting deploy と混ぜない。
- deploy 実行は専用手順として別途レビューする。

---

## 9. `firebase.json` の論点

現状の `firebase.json` は Hosting のみを定義している。

Rules 本番化を行うには、最終的に Firestore Rules の deploy 手順を決める必要がある。

論点:

- `firebase.json` に Firestore Rules を接続するか。
- 接続する場合、通常 Hosting deploy と混ざらない運用をどう担保するか。
- 接続しない場合、Rules deploy の明示コマンドとレビュー手順をどこに固定するか。

現時点では `firebase.json` を変更しない。

---

## 10. 結論

現行実装の write boundary は PR #21 から PR #30 で整理が進んでいる。一方、`firestore.rules` draft は portal transaction semantics の変更に追従しておらず、特に `pending_link` / `pending_return` / repository 自動 `updatedAt` と不一致がある。

これは未deploy のため live regression ではないが、Rules 本番化前の blocker である。

次は `firestore.rules` をいきなり deploy するのではなく、rules draft 修正 PR、portal / staff の手動検証、deploy 手順レビューを分けて進める。
