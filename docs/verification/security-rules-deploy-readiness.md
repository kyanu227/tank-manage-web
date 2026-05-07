# Security Rules Deploy Readiness

作成日: 2026-05-07

対象:

- `firestore.rules` deploy 前の readiness 記録
- `staffByUid`
- `staffJoinRequests`
- Security Rules manual verification
- deploy 手順の分離方針

---

## 1. Current state

- `firestore.rules` は repo draft として管理している。
- Security Rules deploy は未実行。
- `firebase.json` は Firestore Rules deploy 用には未接続。
- Hosting deploy は済みだが、Security Rules deploy とは分離して扱う。
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` は変更していない。
- Firestore data は未操作。

この document は docs-only の readiness 記録であり、Security Rules deploy、Hosting deploy、Firestore data 操作は行わない。

---

## 2. What is already implemented

- staff UID join request app flow は feature flag behind で実装済み。
- admin staff join request read / approve / reject UI は feature flag behind で実装済み。
- approve service は `staff.authUid` / `staffByUid` / `staffJoinRequests.status` を transaction で更新する。
- `firestore.rules` draft には `staffByUid` / `staffJoinRequests` rules が追加済み。
- `/admin/security-rules` overview と manual verification docs は更新済み。

---

## 3. Deploy blockers

- `firebase.json` に Firestore Rules 接続がない。
- Firestore Rules 構文チェックが未実行。
- `staffJoinRequests` / `staffByUid` の manual verification が未実行。
- active staff の `staffByUid` mirror 作成状況が未確認。
- `staffByEmail` casing policy が未解決。
- passcode localStorage session は Rules 上 staff ではない。
- 既存 `isStaff()` は `staffByEmail` ベースのまま。
- AuthGuard staffByUid-first migration は未実施。
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` は本番有効化していない。

---

## 4. Syntax check plan

構文確認は deploy されないことが明確な方法だけを使う。

- `firebase.json` を変更しない範囲で Firestore Rules 構文確認が可能か調査する。
- deploy 系コマンドは使わない。
- `firebase deploy` は実行しない。
- `firebase deploy --only firestore:rules` は実行しない。
- `firebase.json` 接続が必要な場合は、今回の PR では実行せず、次の専用 PR に回す。
- 構文確認ができなかった場合は「未実行」と理由を記録する。

今回の readiness docs-only PR では、Rules 構文確認コマンドは実行しない。理由は、現行 `firebase.json` が Firestore Rules deploy 用に未接続であり、deploy と構文確認の境界を専用 PR で明確化するため。

---

## 5. Manual verification plan

詳細な検証台本は [Security Rules Manual Verification](./security-rules-manual-verification.md) を参照する。

deploy 前に、少なくとも以下のカテゴリを検証する。

- `customerUsers` first login / update / setup
- portal order / return / uncharged report create
- staff transaction update
- `staffJoinRequests` owner create / get / pending update
- `staffJoinRequests` admin review update
- `staffJoinRequests` sub-admin review deny
- `staffByUid` own get / admin list / admin write / non-admin deny
- passcode-only deny
- missing `staffByEmail` deny
- `staffByEmail` casing check

検証は本番 data を直接編集して作らず、検証用 project / emulator / Rules Playground 相当で payload を確認する方針とする。

---

## 6. Data readiness plan

- active staff の UID 紐付け状況を確認する必要がある。
- `staffByUid` mirror は staff 正本ではない。
- `staffByUid` mirror は admin 承認 service 経由で作る。
- Firestore console で直接 `staffByUid` を手作業作成しない方針。
- 本番で `staffJoinRequests` 承認 UI を使う前に、検証用 account で流れを確認する必要がある。
- この PR では Firestore data を触らない。

---

## 7. Deployment separation plan

- Hosting deploy と Security Rules deploy は分離する。
- `firebase deploy` 無指定は禁止。
- `firebase.json` 接続 PR、構文確認 PR、manual verification 結果 PR、Security Rules deploy 実行は分ける。
- Security Rules deploy を実行する場合は、専用手順で `firebase deploy --only firestore:rules` 相当のみを実行する。
- rollback 手順も deploy 前に用意する。

Security Rules deploy を行う PR / operation では、実行前に対象 commit、対象 Firebase project、deploy command、rollback command、manual verification 結果を明記する。

---

## 8. Next PR split

A. docs-only deploy readiness

B. `firebase.json` Firestore Rules 接続 draft PR

C. Rules syntax check / emulator or Rules Playground verification PR

D. `staffByUid` mirror readiness check docs

E. manual verification result docs

F. Security Rules deploy PR / operation

G. AuthGuard staffByUid-first migration

H. feature flag enablement decision

---

## 9. Non-goals

- Security Rules deploy しない。
- Hosting deploy しない。
- `firebase.json` を変更しない。
- `firestore.rules` を変更しない。
- Firestore data を触らない。
- `StaffAuthGuard` / `AdminAuthGuard` を変更しない。
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` を変更しない。
- `staffByEmail` を削除しない。
- AuthGuard UID-first migration に進まない。
