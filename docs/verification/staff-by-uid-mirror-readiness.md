# Staff By UID Mirror Readiness

作成日: 2026-05-07

対象:

- active `staff`
- `staff.authUid`
- `staffByUid`
- `staffByEmail`

この document は Security Rules deploy 前の `staffByUid` mirror readiness を記録する。Firestore data は read-only で確認し、Security Rules deploy、Hosting deploy、本番 Firestore data の作成・更新・削除は行っていない。

---

## 1. Summary

- deploy judgment: not ready
- active staff は 1 件。
- active staff の `authUid` 設定済みは 0 件。
- `staffByUid` mirror は 0 件。
- `staffByEmail` mirror は既存互換として確認済み。
- active staff の UID 紐付けが未完了のため、Security Rules deploy / AuthGuard staffByUid-first migration 前の blocker として残す。

---

## 2. Verification Metadata

| item | value |
|---|---|
| 検証日 | 2026-05-07 |
| 対象 commit | `1b198f3b23fadf81fc6d2de6bc0a88b90e88aa31` |
| 検証方法 | Firebase CLI OAuth credential + Firestore REST API `GET` read-only aggregate check |
| 対象 project | `okmarine-tankrental` |
| Security Rules deploy | 未実行 |
| Hosting deploy | この readiness check 作業では未実行 |
| Firestore data | read-only 確認のみ。本番 data の作成・更新・削除は未実行 |
| `firebase.json` | 未変更 |
| `firestore.rules` | 未変更 |
| `src/**` | 未変更 |
| package files | 未変更 |
| `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` | 未変更 |

---

## 3. Verification Method

repo 外の一時 script で Firestore REST API の `GET` のみを実行し、`staff` / `staffByUid` / `staffByEmail` を集計した。

実行コマンド:

```bash
node /private/tmp/staff-by-uid-oauth-readiness-check.mjs
```

確認内容:

- `staff` の active staff 件数。
- active staff の `authUid` 有無。
- `authUid` がある active staff の `staffByUid/{authUid}` 存在確認。
- `staffByUid.staffId` と staff document id の一致確認。
- `staffByUid.isActive` と `staff.isActive` の一致確認。
- `staffByUid.email` / `role` / `rank` と staff 側 field の大きなズレ確認。
- `staffByEmail` mirror が既存互換として存在するかの確認。

出力は aggregate count のみとし、staff name、email、UID、document id は docs に記録しない。

---

## 4. Result

| item | result |
|---|---:|
| staff total | 1 |
| active staff count | 1 |
| active staff with `authUid` | 0 |
| active staff without `authUid` | 1 |
| `staffByUid` docs count | 0 |
| `staffByEmail` docs count | 1 |
| `staffByUid` mirror confirmed count | 0 |
| `staffByEmail` lower-case mirror confirmed count | 1 |
| `staffByEmail` exact-key mirror confirmed count | 1 |
| mismatch count | 0 |

Mismatch detail:

| check | count |
|---|---:|
| missing `staffByUid` mirror for linked active staff | 0 |
| `staffByUid.staffId` mismatch | 0 |
| `staffByUid.isActive` mismatch | 0 |
| `staffByUid.email` mismatch | 0 |
| `staffByUid.role` mismatch | 0 |
| `staffByUid.rank` mismatch | 0 |
| missing lower-case `staffByEmail` mirror | 0 |
| missing exact-key `staffByEmail` mirror | 0 |
| duplicate `authUid` among active staff | 0 |

---

## 5. Deploy Judgment

判定: not ready

理由:

- active staff 1 件のうち `authUid` 設定済みは 0 件。
- `staffByUid` mirror は 0 件。
- `staffByEmail` mirror は確認できているが、`staffByUid` mirror readiness の代替にはしない。
- Security Rules deploy 前に、active staff の UID 紐付けと `staffByUid` mirror 作成方針を別作業で確認する必要がある。

---

## 6. Blockers

- active staff の `authUid` が未設定。
- active staff に対応する `staffByUid` mirror が未作成。
- `staffByUid` mirror は staff 正本ではないため、Firestore console で直接手作業作成しない。
- `staffByUid` mirror は admin 承認 service 経由で作る方針を維持する。
- 本番で `staffJoinRequests` 承認 UI を使う前に、検証用 account で申請から承認までの流れを確認する必要がある。
- AuthGuard staffByUid-first migration は未実施。
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` は本番有効化していない。

Security Rules deploy はまだ不可。deploy 前に上記 blocker を別 PR / 別 operation で解消または明示的に受容する必要がある。

---

## 7. Non-goals

- 本番 Firestore data を作成・更新・削除しない。
- `staffByUid` を手作業作成しない。
- `staff.authUid` を手作業更新しない。
- Security Rules deploy しない。
- Hosting deploy しない。
- `firebase deploy` は実行しない。
- `firebase deploy --only firestore:rules` は実行しない。
- `firebase.json` を変更しない。
- `firestore.rules` を変更しない。
- `src/**` を変更しない。
- package files を変更しない。
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` を変更しない。
- AuthGuard staffByUid-first migration に進まない。
