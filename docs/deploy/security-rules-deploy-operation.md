# Security Rules Deploy Operation

作成日: 2026-05-08

対象:

- Firestore Security Rules deploy operation
- rollback procedure
- post-deploy smoke test

この document は、Security Rules deploy を安全に実行するための operation 手順である。この PR では deploy は実行しない。

---

## 1. Purpose

Firestore Security Rules を本番 project に反映する前に、事前確認、deploy コマンド、deploy 後 smoke test、rollback 手順、停止条件を明文化する。

Security Rules deploy は Hosting deploy と分離する。

---

## 2. Scope

対象 project:

- `okmarine-tankrental`

対象 commit:

- `9d9ac16c68b6adf2401e6b78184580ec709380fb`

deploy 対象:

- Firestore Security Rules のみ
- `firebase.json` の `firestore.rules` 参照先: `firestore.rules`

deploy しないもの:

- Hosting
- Functions
- Firestore indexes
- Firestore data
- Storage Rules
- Auth / user data

この operation docs PR では、Security Rules deploy、Hosting deploy、Firestore data create / update / delete は行わない。

---

## 3. Absolute Prohibited Commands

以下は実行しない。

```bash
firebase deploy
firebase deploy --only hosting,firestore
firebase deploy --only hosting
```

無指定 `firebase deploy` は禁止。Hosting と Security Rules を同じ operation に混ぜない。

---

## 4. Planned Deploy Command

実行予定 command:

```bash
firebase deploy --only firestore:rules
```

この docs PR では実行しない。実行は専用 deploy operation で行う。

推奨:

```bash
firebase --project okmarine-tankrental deploy --only firestore:rules
```

project 指定を command に明示し、対象 project の取り違えを避ける。

---

## 5. Pre-Deploy Checklist

deploy 直前にすべて確認する。

- `git status --short` が clean。
- local `main` と `origin/main` が一致している。
- `HEAD` が deploy 対象 commit と一致している。
- `firebase.json` が `firestore.rules` を参照している。
- `firestore.rules` の非deploy syntax check が pass 済み。
- staff UID rules manual verification が pass 済み。
- portal / `customerUsers` / `transactions` / `tanks` / `logs` static comparison が pass 済み。
- portal / `customerUsers` / `transactions` / `tanks` / `logs` executable allow / deny verification が pass 済み。
- active staff UID mirror readiness が ready。
- `customerUsers.status` existing field policy が ready。
- `staffByEmail` casing policy が ready。
- self-link rule decision が ready。現時点では self-link rule を導入しない。
- Security Rules deploy と Hosting deploy を混ぜないことを確認した。

確認 command 例:

```bash
git status --short
git rev-parse HEAD
git rev-parse origin/main
cat firebase.json
```

---

## 6. Stop Conditions

以下のいずれかに該当する場合は deploy しない。

- `git status --short` が clean ではない。
- local `main` と `origin/main` が一致しない。
- `HEAD` が deploy 対象 commit と違う。
- `firebase.json` が `firestore.rules` を参照していない。
- `firestore.rules` syntax check が再現できない。
- emulator / rules-unit-test verification が再現できない。
- active staff `authUid` / `staffByUid` aggregate が expected と違う。
- `staffByEmail` casing mismatch がある。
- `customerUsers.status` field が再混入している。
- `firebase deploy --only firestore:rules` 以外を実行しそうな状態。
- smoke test を実施できる担当者 / 時間がない。
- rollback 手順を実行できる担当者 / 時間がない。

---

## 7. Deploy Steps

1. local `main` を最新にする。
2. pre-deploy checklist を確認する。
3. deploy command を実行する。
4. exit code と Firebase CLI output を保存する。
5. deploy 後 smoke test を実施する。
6. smoke test result を deploy 結果記録に残す。

deploy command:

```bash
firebase --project okmarine-tankrental deploy --only firestore:rules
```

---

## 8. Post-Deploy Smoke Test

deploy 後、以下を確認する。

staff / admin:

- Firebase Auth staff account で staff login できる。
- `/staff` または `/staff/lend` が表示できる。
- `/staff/dashboard` が表示できる。
- admin account で `/admin/staff` が表示できる。
- staff transactions / tanks / logs 操作の主要画面で `permission-denied` が出ない。

portal:

- portal login ができる。
- `customerUsers` owner login update が `permission-denied` にならない。
- `/portal` が表示できる。
- `/portal/order` が表示できる。
- `/portal/return` が表示できる。
- `/portal/unfilled` が表示できる。

注意:

- smoke test は必要最小限の表示 / read / login 確認を優先する。
- 本番 Firestore data の不要な create / update / delete は行わない。
- portal order / return / unfilled の実データ作成が必要な場合は、別途検証手順として明示する。

---

## 9. Rollback Policy

rollback は Firestore Security Rules のみに限定する。Hosting deploy と混ぜない。

rollback 前に確認すること:

- rollback が必要な症状。
- rollback 対象 project: `okmarine-tankrental`。
- rollback する rules file / commit。
- rollback command が `firestore:rules` のみであること。

rollback 用 rules:

- 直前本番 rules を deploy 前に取得または保存しておく。
- deploy 前 rules の commit / file path を deploy 結果記録に記載する。

rollback command:

```bash
firebase --project okmarine-tankrental deploy --only firestore:rules
```

rollback でも `firebase deploy` 無指定は禁止。

---

## 10. Deploy Result Template

| item | value |
|---|---|
| 実行日時 |  |
| 実行者 |  |
| 対象 project | `okmarine-tankrental` |
| 対象 commit | `4e709a7af394ff95458d9272f99a0b52c20041eb` |
| deploy command | `firebase --project okmarine-tankrental deploy --only firestore:rules` |
| exit code |  |
| Firebase CLI output summary |  |
| smoke test result | pass / fail / partial |
| rollback 要否 | yes / no |
| rollback 実行日時 |  |
| rollback command |  |
| rollback exit code |  |
| notes |  |

Smoke test result:

| scenario | result | memo |
|---|---|---|
| staff login |  |  |
| `/staff` or `/staff/lend` display |  |  |
| `/staff/dashboard` display |  |  |
| `/admin/staff` display |  |  |
| portal login |  |  |
| `customerUsers` owner login update |  |  |
| `/portal` display |  |  |
| `/portal/order` display |  |  |
| `/portal/return` display |  |  |
| `/portal/unfilled` display |  |  |
| staff transactions / tanks / logs main screens |  |  |

---

## 11. Separate Phases

以下はこの deploy operation の範囲外とする。

- AuthGuard staffByUid-first migration
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` 本番有効化判断
- `tanks` / `logs` field-level hardening
- general staff self-link rule
- Hosting deploy
- Firestore data cleanup / migration

---

## 12. Current Status

- Security Rules deploy operation / rollback procedure: documented
- Security Rules deploy: executed on 2026-05-08
- Hosting deploy: not run
- Firestore Console / script direct data edit: not run

deploy result は [Security Rules Deploy Result](./security-rules-deploy-result.md) を参照する。
