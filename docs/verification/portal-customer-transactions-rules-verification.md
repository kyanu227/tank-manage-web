# Portal Customer Transactions Rules Verification

作成日: 2026-05-07

対象:

- `customerUsers`
- portal order / return / uncharged report create
- `transactions`
- `tanks`
- `logs`
- admin / staff 側の `transactions` / `tanks` / `logs` 操作

この document は、Security Rules deploy 前に staff UID 以外の主要 flow を `firestore.rules` draft と静的照合した結果を記録する。

---

## 1. Verification Summary

| item | value |
|---|---|
| 検証日 | 2026-05-07 |
| 対象 commit | `586cc2b6e6bdd1274e3a2c3d10abbdc16e837dca` |
| 対象 `firestore.rules` commit | `c7e58f6952a60dd2ea71590626fe6ead1b191584` |
| 検証方法 | `firestore.rules` と実装 payload / repository / service の静的照合 |
| 検証環境 | local repository |
| Result | partial: static comparison pass, executable allow / deny verification not run |
| Security Rules deploy | 未実行 |
| Hosting deploy | この verification 作業では未実行 |
| `firebase deploy` | 未実行 |
| Firestore data edit | この verification 作業では未実行 |

Firestore Console / script による本番 Firestore data の create / update / delete は実行していない。

---

## 2. Verification Method

以下を読み合わせた。

- `firestore.rules`
- `src/lib/firebase/customer-user.ts`
- `src/lib/firebase/portal-profile-service.ts`
- `src/lib/firebase/portal-transaction-service.ts`
- `src/lib/firebase/repositories/transactions.ts`
- `src/lib/firebase/repositories/tanks.ts`
- `src/lib/firebase/repositories/logs.ts`
- `src/lib/firebase/order-fulfillment-service.ts`
- `src/lib/firebase/return-tag-processing-service.ts`
- `src/lib/firebase/customer-linking-service.ts`
- `src/lib/tank-operation.ts`
- `src/app/portal/page.tsx`
- `src/app/portal/order/page.tsx`
- `src/app/portal/return/page.tsx`
- `src/app/portal/unfilled/page.tsx`

今回は docs-only / static comparison であり、emulator / Rules Playground / production app flow による allow / deny 実行検証は行っていない。

---

## 3. Scenario Results

| scenario | expected | static actual | result | memo |
|---|---|---|---|---|
| `customerUsers` first login create | allow | `ensureCustomerUser()` は required keys を作成し、`status` は Firestore に保存しない | pass | `uid`, `email`, initial setup fields, timestamps が rules と一致 |
| `customerUsers` login update | allow | `ensureCustomerUser()` の既存 user merge update は `email`, `displayName`, `lastLoginAt`, `updatedAt` のみ | pass | `customerId`, `customerName`, `disabled`, `createdAt` は変更しない |
| `customerUsers` setup complete | allow | `completeCustomerUserSetup()` は `selfCompanyName`, `selfName`, `lineName`, `setupCompleted`, `updatedAt` のみ更新 | pass | `setupCompleted: true` には non-empty name fields が必要 |
| customer self-write `status` | deny | portal user code は `status` を Firestore に保存しない | pass | 既存 `status` field がある data は別 blocker |
| linked portal order create | allow | `createPortalOrder()` は linked identity で `status: "pending"` / `source: "customer_portal"` を作る | pass | repository が `createdAt` / `updatedAt` を付与 |
| unlinked portal order create | allow | `createPortalOrder()` は unlinked identity で `status: "pending_link"` / `customerId: null` / `customerName: ""` を作る | pass | requested snapshot fields を含む |
| portal return create | allow | `createPortalReturnRequests()` は `status: "pending_return"` と `condition` allowlist 値を作る | pass | `source` は `customer_portal` または `auto_schedule` |
| portal uncharged report create | allow | `createPortalUnfilledReports()` は `type: "uncharged_report"` / `status: "completed"` / `source: "customer_app"` を作る | pass | linked customer identity が前提 |
| portal `settings/portal` get | allow | `/portal/return` は `settings/portal` を read する | pass | rules は signed-in user の `settings/portal` get を許可 |
| linked portal `tanks` read | allow | portal pages は `location == linked customerName` と `status == 貸出中` で read する | pass | rules は `customerId` または `location` が linked customer と一致すれば read 可 |
| linked portal `logs` read | allow | `/portal` は `logStatus == active` と `location == linked customerName` で read する | pass | rules は linked customer resource read を許可 |
| unlinked portal `tanks` / `logs` read | deny / not attempted | UI は unlinked identity では read せず empty 表示にする | pass | rules 側も `hasLinkedCustomer()` が必要 |
| `transactions` own get / list | allow | rules は `createdByUid == request.auth.uid` の active customer に限り read 可 | partial | 現行 portal checked files は主に create flow。read query の executable 検証は未実行 |
| staff order approve update | allow | `approveOrder()` payload は `isStaffOrderApproveUpdate()` の allowed keys と required actor fields に一致 | pass | Firebase Auth staff + `staffByEmail` が前提 |
| staff order fulfill update | allow | `fulfillOrder()` の transaction update は allowed keys と required actor fields に一致 | pass | 同 batch の `tanks` / `logs` write は broad staff allow |
| staff return tag completion update | allow | `processReturnTags()` は `pending_return -> completed` と `finalCondition` を書く | pass | `updatedAt` は rules 上 optional affected key |
| pending_link order customer linking update | allow | `linkCustomerUsersToCustomers()` は `pending_link -> pending` と linked actor fields を書く | pass | `customerUsers` assignment update は adminStaff rule 側の範囲 |
| staff `tanks` create / update / delete | allow | `applyBulkTankOperations()` は staff session 前提で tank update を行う | pass | 現行 draft は staff write を広く許可。future hardening 対象 |
| staff `logs` create / update / delete | allow | `applyBulkTankOperations()` / log edit flows は staff session 前提で logs write を行う | pass | 現行 draft は staff write を広く許可。future hardening 対象 |
| passcode-only staff write | deny | rules は Firebase Auth + `staffByEmail` を要求する | pass | localStorage passcode session は Rules 上 staff ではない |
| missing `staffByEmail` staff write | deny | `isStaff()` が false になる | pass | `staffByUid` は既存 `isStaff()` の正本ではない |

---

## 4. Static Comparison Notes

- portal `customerUsers` create / update payload は現行 rules の allowed keys と一致している。
- portal transaction create payload は `transactionsRepository.createTransaction()` が `createdAt` / `updatedAt` を付与する前提で rules と一致している。
- linked portal read は `customerId` または `location` が linked customer と一致する resource のみに制限されている。
- 現行 portal UI は `tanks` / `logs` を `location == customerName` で読んでいるため、`customerId` が未整備の既存 data でも rules 上の互換条件に合う。
- staff transaction update は order approve / order fulfill / return tag completion / pending_link customer linking の payload が rules の allowed keys と一致している。
- `tanks` / `logs` write は現行 draft rules では staff write を広く許可しており、field-level hardening は別フェーズとして残る。

---

## 5. Not Executed

今回実行していないこと:

- emulator / Rules Playground / rules unit test による allow / deny 実行検証。
- 本番 Firestore data の create / update / delete。
- production app flow による portal order / return / uncharged report 作成。
- Security Rules deploy。
- Hosting deploy。
- `firebase deploy`。

---

## 6. Deploy Blockers

この static comparison で field mismatch は見つからなかったが、Security Rules deploy 前には以下が残る。

- portal / `customerUsers` / `transactions` / `tanks` / `logs` の executable allow / deny verification は未実行。
- `customerUsers.status` 既存 field が残る data では、owner update が rules の `status` 禁止に抵触する可能性がある。
- `staffByEmail` casing policy が未解決。
- passcode localStorage session は Rules 上 staff ではない。
- Security Rules deploy 後に一般 staff self-link を許可するかは未決定。
- AuthGuard staffByUid-first migration は未実施。
- `tanks` / `logs` write の field-level hardening は未実施。

---

## 7. Deployment Judgment

判定:

- staff UID mirror readiness: ready
- staff UID rules manual verification: pass
- portal / customer / transactions / tanks / logs static comparison: pass
- portal / customer / transactions / tanks / logs executable allow / deny verification: not run
- Security Rules deploy readiness: not ready

Security Rules deploy はまだ実行しない。

---

## 8. Next Steps

1. portal / customer / transactions / tanks / logs の executable allow / deny verification を emulator / Rules Playground 相当で行う。
2. `customerUsers.status` 既存 field の read-only aggregate と方針を確認する。
3. `staffByEmail` casing policy を決める。
4. self-link rule が必要かを決める。
5. Security Rules deploy 専用 operation / rollback 手順を別 PR で用意する。
