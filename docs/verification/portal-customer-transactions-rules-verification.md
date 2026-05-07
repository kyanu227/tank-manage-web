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
| 対象 commit | `672142d0f9751e5a6a6ed5a0102bcbd20e81138f` |
| 対象 `firestore.rules` commit | `c7e58f6952a60dd2ea71590626fe6ead1b191584` |
| 検証方法 | `firestore.rules` と実装 payload / repository / service の静的照合、Firestore emulator / rules-unit-test 実行検証 |
| 検証環境 | local repository + Firestore emulator |
| Result | pass: static comparison pass, executable allow / deny verification pass |
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

実行検証は Firestore emulator と repo 外の一時 rules-unit-test script で行った。

一時依存:

- `@firebase/rules-unit-testing`: `5.0.1`
- `firebase`: `12.10.0`

実行環境:

```text
Firebase CLI: 15.9.1
openjdk version "21.0.11" 2026-04-21
OpenJDK Runtime Environment Homebrew (build 21.0.11)
OpenJDK 64-Bit Server VM Homebrew (build 21.0.11, mixed mode, sharing)
```

実行コマンド:

```bash
env XDG_CONFIG_HOME=/private/tmp/firebase-cli-config XDG_CACHE_HOME=/private/tmp/firebase-cli-cache PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" firebase --config "/Users/yuki/Library/Mobile Documents/com~apple~CloudDocs/Project/タンク管理NEW/web/firebase.json" --project demo-tank-rules-exec emulators:exec --only firestore --log-verbosity QUIET "node /private/tmp/tank-rules-exec-verify/portal-rules-exec-test.mjs"
```

結果:

- exit code 0。
- `Running script: node /private/tmp/tank-rules-exec-verify/portal-rules-exec-test.mjs`。
- `Script exited successfully (code 0)`。
- 19 / 19 scenario pass。
- deny scenario の `PERMISSION_DENIED` log は `assertFails` の期待結果として扱う。

一時 script / 一時 npm package は repo 外の `/private/tmp/tank-rules-exec-verify` に作成し、検証後に削除した。repo の package files は変更していない。

---

## 3. Scenario Results

| scenario | expected | actual | result | memo |
|---|---|---|---|---|
| `customerUsers` first login create | allow | allow | pass | required keys を作成し、`status` は Firestore に保存しない |
| `customerUsers` login update | allow | allow | pass | `email`, `displayName`, `lastLoginAt`, `updatedAt` のみ |
| `customerUsers` setup complete | allow | allow | pass | `selfCompanyName`, `selfName`, `lineName`, `setupCompleted`, `updatedAt` のみ |
| customer self-write `status` | deny | deny | pass | `assertFails` の期待結果 |
| linked portal order create | allow | allow | pass | `status: "pending"` / `source: "customer_portal"` |
| unlinked portal order create | allow | allow | pass | `status: "pending_link"` / `customerId: null` / `customerName: ""` |
| portal return create | allow | allow | pass | `status: "pending_return"` / `condition: "normal"` |
| portal uncharged report create | allow | allow | pass | `type: "uncharged_report"` / `status: "completed"` / `source: "customer_app"` |
| linked portal `tanks` read | allow | allow | pass | linked customer resource read |
| linked portal `logs` read | allow | allow | pass | linked customer resource read |
| unlinked portal `tanks` / `logs` read | deny | deny | pass | `assertFails` の期待結果 |
| own transactions read | allow | allow | pass | `createdByUid == request.auth.uid` |
| other customer transactions read | deny | deny | pass | `assertFails` の期待結果 |
| staff order approve update | allow | allow | pass | Firebase Auth staff + `staffByEmail` 前提 |
| staff order fulfill update | allow | allow | pass | required actor fields を含む |
| staff return completion update | allow | allow | pass | `pending_return -> completed` |
| pending_link order customer linking update | allow | allow | pass | `pending_link -> pending` |
| passcode-only staff write | deny | deny | pass | unauthenticated context で検証 |
| missing `staffByEmail` staff write | deny | deny | pass | `assertFails` の期待結果 |

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

- 本番 Firestore data の create / update / delete。
- production app flow による portal order / return / uncharged report 作成。
- Security Rules deploy。
- Hosting deploy。
- `firebase deploy`。

---

## 6. Deploy Blockers

static comparison と executable allow / deny verification は pass したが、Security Rules deploy 前には以下が残る。

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
- portal / customer / transactions / tanks / logs executable allow / deny verification: pass
- Security Rules deploy readiness: not ready

Security Rules deploy はまだ実行しない。

---

## 8. Next Steps

1. `customerUsers.status` 既存 field の read-only aggregate と方針を確認する。
2. `staffByEmail` casing policy を決める。
3. self-link rule が必要かを決める。
4. Security Rules deploy 専用 operation / rollback 手順を別 PR で用意する。
