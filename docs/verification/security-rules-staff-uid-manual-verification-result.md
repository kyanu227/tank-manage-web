# Security Rules Staff UID Manual Verification Result

作成日: 2026-05-07

対象:

- `staffJoinRequests`
- `staffByUid`
- passcode-only staff session deny

この document は staff UID join request 関連の Security Rules manual verification 結果を記録する。Security Rules deploy、Hosting deploy、本番 Firestore data 操作は行っていない。

---

## 1. Summary

- result: pass
- staff UID join request 関連の 14 scenario はすべて expected 通り。
- `staffJoinRequests` owner create / get / pending update は allow。
- `staffJoinRequests` owner review field / approved update は deny。
- `staffJoinRequests` admin review update は allow。
- `staffJoinRequests` sub-admin review update は deny。
- `staffByUid` own get / admin list は allow。
- `staffByUid` other user get / non-admin write は deny。
- passcode-only session は Firestore Rules 上の staff identity ではないため admin review / `staffByUid` write は deny。

---

## 2. Verification Metadata

| item | value |
|---|---|
| 検証日 | 2026-05-07 |
| 対象 commit | `3768082fa7e4930a229fd954c021ea75d873d100` |
| 対象 `firestore.rules` commit | `c7e58f6952a60dd2ea71590626fe6ead1b191584` |
| 検証環境 | Firestore Emulator + `@firebase/rules-unit-testing` |
| Firebase CLI | `15.9.1` |
| Firebase JS SDK | `12.10.0` |
| Java Runtime | OpenJDK `21.0.11` |
| emulator project | `demo-tank-manage-web-staff-uid` |
| Security Rules deploy | 未実行 |
| Hosting deploy | この manual verification 作業では未実行 |
| Firestore data | 本番未操作 |
| `firebase.json` | 未変更 |
| `firestore.rules` | 未変更 |
| `src/**` | 未変更 |
| package files | 未変更 |

Java Runtime:

```text
openjdk version "21.0.11" 2026-04-21
OpenJDK Runtime Environment Homebrew (build 21.0.11)
OpenJDK 64-Bit Server VM Homebrew (build 21.0.11, mixed mode, sharing)
```

---

## 3. Verification Method

repo 外の一時 directory に `@firebase/rules-unit-testing` を入れ、Firestore Emulator 上で mock auth context を使って allow / deny を確認した。

一時依存 install:

```bash
npm install --prefix /private/tmp/tank-manage-rules-test @firebase/rules-unit-testing firebase@12.10.0 firebase-admin@13.7.0
```

実行コマンド:

```bash
env XDG_CONFIG_HOME=/private/tmp/firebase-cli-config XDG_CACHE_HOME=/private/tmp/firebase-cli-cache PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" firebase --config "/Users/yuki/Library/Mobile Documents/com~apple~CloudDocs/Project/タンク管理NEW/web/firebase.json" --project demo-tank-manage-web-staff-uid emulators:exec --only firestore --log-verbosity QUIET "node /private/tmp/tank-manage-rules-test/staff-uid-rules-test.mjs"
```

結果:

- exit code 0。
- `Script exited successfully (code 0)`。
- deny scenario では expected 通り `PERMISSION_DENIED` が出る。
- `assertFails` で確認した deny の `PERMISSION_DENIED` は expected result として扱う。
- 一時 test script / 一時 npm package は repo に commit しない。

検証用 seed:

- `staffByEmail/admin@example.com`: `role == "管理者"`, `isActive == true`
- `staffByEmail/subadmin@example.com`: `role == "準管理者"`, `isActive == true`
- `staffByUid/{applicantUid}` / `staffByUid/{otherUid}`
- `staffJoinRequests/{applicantUid}`: `status == "pending"`

---

## 4. Scenario Results

| scenario | expected | actual | result | memo |
|---|---|---|---|---|
| staffJoinRequests owner pending create | allow | allow | pass | signed-in applicant creates own `{uid}` request with `status == "pending"` |
| staffJoinRequests owner get | allow | allow | pass | signed-in applicant reads own request |
| staffJoinRequests owner pending update | allow | allow | pass | pending request updates allowed owner fields only |
| staffJoinRequests owner approved update | deny | deny | pass | owner cannot move request to `approved` |
| staffJoinRequests owner linkedStaffId write | deny | deny | pass | owner cannot write review/link field |
| staffJoinRequests admin list | allow | allow | pass | active `管理者` via `staffByEmail` can list |
| staffJoinRequests admin approve review | allow | allow | pass | active `管理者` can review pending request to `approved` with `linkedStaffId` |
| staffJoinRequests admin reject review | allow | allow | pass | active `管理者` can review pending request to `rejected` with `rejectionReason` |
| staffJoinRequests sub-admin review | deny | deny | pass | `準管理者` is admin staff for list, but cannot perform review update |
| staffByUid own get | allow | allow | pass | signed-in user can read own `staffByUid/{uid}` |
| staffByUid other user get | deny | deny | pass | non-admin user cannot read another uid mirror |
| staffByUid admin list | allow | allow | pass | active `管理者` can list `staffByUid` |
| staffByUid non-admin write | deny | deny | pass | `準管理者` cannot create/write `staffByUid` |
| passcode-only staffJoinRequests admin review / staffByUid write | deny | deny | pass | unauthenticated context represents localStorage passcode-only session in Rules |

---

## 5. Failures / Not Executed

- 失敗 scenario: なし。
- 未実行 scenario: なし。
- この result は staff UID join request 関連に限定している。
- portal / `customerUsers` / `transactions` / `tanks` / `logs` の manual verification は今回実行していない。

---

## 6. Remaining Blockers

- portal / `customerUsers` / `transactions` / `tanks` / `logs` の manual verification が未実行。
- active staff の `staffByUid` mirror readiness が未確認。
- `staffByEmail` casing policy が未解決。
- passcode localStorage session は Firestore Rules 上 staff ではない。
- 既存 `isStaff()` は `staffByEmail` ベースのまま。
- AuthGuard staffByUid-first migration は未実施。
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` は本番有効化していない。
- Security Rules deploy operation / rollback 手順は未実施。

Security Rules deploy はまだ不可。deploy 前に残 blocker を別 PR / 別 operation で解消または明示的に受容する必要がある。

---

## 7. Non-goals

- Security Rules deploy しない。
- Hosting deploy しない。
- `firebase deploy` は実行しない。
- `firebase deploy --only firestore:rules` は実行しない。
- 本番 Firestore data を触らない。
- `firebase.json` を変更しない。
- `firestore.rules` を変更しない。
- `src/**` を変更しない。
- package files を変更しない。
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` を変更しない。
- portal / `transactions` / `tanks` / `logs` の hardening には進まない。
