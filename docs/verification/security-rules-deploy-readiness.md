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
- `firebase.json` は PR #50 で `firestore.rules` に接続済み。
- Firestore Rules の非deploy構文確認は 2026-05-07 に pass 済み。
- Security Rules deploy は未実行。
- Hosting deploy は PR #48 の overview 反映時に実施済みだが、Security Rules deploy とは分離して扱う。
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
- `firebase.json` は `firestore.rules` を参照する設定に更新済み。
- Firestore emulator による `firestore.rules` の非deploy構文確認は pass 済み。

---

## 3. Deploy blockers

解消済み:

- `firebase.json` には PR #50 で Firestore Rules 接続を追加済み。
- Firestore Rules 構文チェックは 2026-05-07 に非deploy emulator 起動で pass 済み。

残る blocker:

- `staffJoinRequests` / `staffByUid` の manual verification が未実行。
- active staff の `staffByUid` mirror 作成状況が未確認。
- `staffByEmail` casing policy が未解決。
- passcode localStorage session は Rules 上 staff ではない。
- 既存 `isStaff()` は `staffByEmail` ベースのまま。
- AuthGuard staffByUid-first migration は未実施。
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` は本番有効化していない。

---

## 4. Syntax check result

構文確認は deploy されないことが明確な方法だけを使う。Security Rules deploy は実行しない。

実行日:

- 2026-05-07

Java Runtime:

```text
openjdk version "21.0.11" 2026-04-21
OpenJDK Runtime Environment Homebrew (build 21.0.11)
OpenJDK 64-Bit Server VM Homebrew (build 21.0.11, mixed mode, sharing)
```

Firebase CLI:

- `15.9.1`

実行した非deployコマンド:

```bash
env XDG_CONFIG_HOME=/private/tmp/firebase-cli-config XDG_CACHE_HOME=/private/tmp/firebase-cli-cache PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" firebase --config "/Users/yuki/Library/Mobile Documents/com~apple~CloudDocs/Project/タンク管理NEW/web/firebase.json" --project demo-tank-manage-web emulators:exec --only firestore --log-verbosity QUIET "true"
```

結果:

- exit code 0。
- `Running script: true`。
- `Script exited successfully (code 0)`。
- Firestore emulator 起動まで到達した。
- `firestore.rules` の読み込みは pass と扱う。
- 構文エラーは出ていない。
- Security Rules deploy は未実行。
- Hosting deploy は未実行。
- Firestore data は未操作。

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
- `firebase.json` 接続 PR、構文確認結果 PR、manual verification 結果 PR、Security Rules deploy 実行は分ける。
- Security Rules deploy を実行する場合は、専用手順で `firebase deploy --only firestore:rules` 相当のみを実行する。
- rollback 手順も deploy 前に用意する。

Security Rules deploy を行う PR / operation では、実行前に対象 commit、対象 Firebase project、deploy command、rollback command、manual verification 結果を明記する。

---

## 8. Next PR split

A. docs-only deploy readiness: 完了済み

B. `firebase.json` Firestore Rules 接続 draft PR: 完了済み

C. Rules syntax check / emulator verification result docs: 完了済み

D. manual verification result docs

E. `staffByUid` mirror readiness check docs

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
