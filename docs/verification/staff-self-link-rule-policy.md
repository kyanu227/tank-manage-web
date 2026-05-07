# Staff Self-Link Rule Policy

作成日: 2026-05-08

対象:

- `staff.authUid`
- `staffByUid`
- `staffJoinRequests`
- existing `staffByEmail` bootstrap
- Security Rules deploy readiness

この document は、Security Rules deploy 前に一般 staff の self-link rule を今導入するかを判断し、その方針を記録する。

---

## 1. Decision

self-link rule は現時点では導入しない。

Security Rules deploy 前 blocker として self-link rule を追加する必要はない。

---

## 2. Reasoning

Firebase Auth UID は Firebase が自動生成する。

ただし、その UID をどの `staff` document に紐付けるかは、アプリ側・管理者側で判断する必要がある。一般 staff が自分で `staff.authUid` や `staffByUid/{uid}` を直接 create / update できる rules を追加すると、staff identity の紐付け面が広がる。

そのため、現時点では以下を正規ルートとする。

1. staff applicant が Firebase Auth で login する。
2. `staffJoinRequests/{uid}` に `uid` / `authEmail` / requested profile を作成する。
3. 管理者が既存 `staff` と照合する。
4. 管理者承認 service transaction が `staff.authUid` / `staffByUid/{uid}` / `staffJoinRequests.status` をまとめて更新する。

`staffByUid` は staff 正本ではなく AuthGuard / Rules 用 mirror として扱う。

---

## 3. Existing Staff Bootstrap

PR #54 の email-auth UID link は、既存 `staffByEmail` 登録済み active staff 1 件を移行するための bootstrap 経路として扱う。

この bootstrap では、既存 staff の本人 Firebase Auth account で login し、`staffByEmail` と staff email が一致することを確認したうえで `staff.authUid` / `staffByUid` mirror を作成した。

2026-05-07 時点で、current active staff は以下の readiness を満たしている。

| item | result |
|---|---:|
| active staff | 1 |
| active staff with `authUid` | 1 |
| `staffByUid` docs | 1 |
| `staffByEmail` docs | 1 |
| `staffJoinRequests` docs | 0 |

そのため、Security Rules deploy 前に一般 staff self-link rule を追加しなくても、現在の active staff は Rules deploy 後の staff identity として readiness を満たす。

---

## 4. Rules Scope

現行 draft `firestore.rules` の方針を維持する。

- `staffByUid` own get: allow
- `staffByUid` adminStaff list: allow
- `staffByUid` create / update / delete: admin only
- `staff` create / update / delete: admin only
- `staffJoinRequests` owner create / pending update: allow
- `staffJoinRequests` admin review update: admin only
- `staffJoinRequests` sub-admin review update: deny

この PR では `firestore.rules` を変更しない。

---

## 5. Security Tradeoff

self-link rule を入れない利点:

- UID と staff document の紐付けを管理者承認に限定できる。
- `staff.authUid` / `staffByUid` の create / update surface を一般 staff に広げない。
- `staffJoinRequests` の review service transaction に整合性を集約できる。
- Security Rules deploy 前の検証範囲を増やさない。

self-link rule を入れない制約:

- 既存 `staffByEmail` に登録済みだが `authUid` 未設定の staff が増えた場合、管理者承認経路または bootstrap 経路を別途用意する必要がある。
- Security Rules deploy 後に一般 staff の初回 login だけで自動的に `staff.authUid` / `staffByUid` を作る運用は行わない。

この制約は、現時点の active staff readiness が ready であるため deploy blocker とは扱わない。

---

## 6. Deployment Judgment

判定:

- self-link rule decision: ready
- Security Rules deploy readiness: ready for deploy operation planning

理由:

- current active staff は `authUid` / `staffByUid` mirror ready。
- `staffJoinRequests` / `staffByUid` manual verification は pass 済み。
- 一般 staff の self-link rule は攻撃面を広げるため今は入れない。
- 新規 staff の UID link は `staffJoinRequests` + 管理者承認を正規ルートとする。
- `firestore.rules` 変更は不要。

残る作業は Security Rules deploy operation / rollback 手順の作成であり、Security Rules deploy はまだ実行しない。

---

## 7. Non-Goals

- Security Rules deploy はしない。
- Hosting deploy はしない。
- `firebase deploy` は実行しない。
- `firestore.rules` は変更しない。
- `firebase.json` は変更しない。
- `src/**` は変更しない。
- package files は変更しない。
- Firestore data create / update / delete は行わない。
- AuthGuard staffByUid-first migration には進まない。

---

## 8. Next Steps

1. Security Rules deploy operation / rollback 手順を docs-only で作成する。
2. deploy operation では対象 commit、project、deploy command、rollback command、pre/post verification を明記する。
3. AuthGuard staffByUid-first migration は Rules deploy 後の別フェーズで検討する。
