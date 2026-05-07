# Security Rules Deploy Result

実施日: 2026-05-08

対象:

- Firestore Security Rules deploy result
- post-deploy smoke test result
- rollback decision

---

## 1. Summary

Security Rules deploy operation を実行した。

結果:

- Security Rules deploy: pass
- Firebase CLI exit code: 0
- Firestore Rules release: completed
- smoke test result: partial
- rollback: 不要

この operation では Hosting deploy、無指定 `firebase deploy`、Firestore data の直接 create / update / delete は行っていない。

---

## 2. Deploy Context

対象 project:

- `okmarine-tankrental`

対象 commit:

- `9d9ac16c68b6adf2401e6b78184580ec709380fb`

Rules file:

- `firestore.rules`

`firestore.rules` last changed commit:

- `c7e58f6952a60dd2ea71590626fe6ead1b191584`

deploy 対象:

- Firestore Security Rules のみ

deploy していないもの:

- Hosting
- Functions
- Firestore indexes
- Firestore data
- Storage Rules

---

## 3. Pre-Deploy Checks

確認結果:

| check | result | memo |
|---|---|---|
| `git status --short` | pass | clean |
| local `main` / `origin/main` | pass | both `9d9ac16c68b6adf2401e6b78184580ec709380fb` |
| `HEAD` | pass | `9d9ac16c68b6adf2401e6b78184580ec709380fb` |
| `firebase.json` rules reference | pass | `"firestore": { "rules": "firestore.rules" }` |
| target project metadata | pass | `(default)` database exists for `okmarine-tankrental` |
| non-deploy syntax check | pass | Firestore emulator rules load exit code 0 |
| staff UID readiness docs | pass | ready |
| customerUsers.status policy docs | pass | ready |
| staffByEmail casing policy docs | pass | ready |
| self-link rule decision docs | pass | ready, self-link rule not introduced |

Note:

- The operation guide was created before PR #60 merge and still listed `4e709a7af394ff95458d9272f99a0b52c20041eb` as the docs target commit.
- PR #60 changed docs only; `firestore.rules` and `firebase.json` did not change between `4e709a7af394ff95458d9272f99a0b52c20041eb` and `9d9ac16c68b6adf2401e6b78184580ec709380fb`.
- This deploy operation used current `main` commit `9d9ac16c68b6adf2401e6b78184580ec709380fb`.
- A direct read-only aggregate attempt with the local service account failed with `PERMISSION_DENIED`; no data write was attempted. The deploy decision used the merged readiness docs, Firebase CLI project metadata, non-deploy syntax check, and post-deploy app smoke tests.

---

## 4. Deploy Command

実行 command:

```bash
firebase --project okmarine-tankrental deploy --only firestore:rules
```

禁止 command は実行していない:

```bash
firebase deploy
firebase deploy --only hosting
firebase deploy --only hosting,firestore
firebase deploy --only firestore
firebase deploy --only functions
```

---

## 5. Deploy Output Summary

Firebase CLI:

- `15.9.1`

exit code:

- `0`

output summary:

- Deploying to `okmarine-tankrental`.
- Deploy target: `firestore`.
- Firestore API enabled check completed.
- `firestore.rules` compilation check completed.
- `firestore.rules` compiled successfully.
- `firestore.rules` uploaded.
- Rules released to `cloud.firestore`.
- `Deploy complete!`

Compiler warnings:

- The CLI reported warnings for existing helper names / unused helper functions.
- The rules file still compiled successfully.
- These warnings were not treated as deploy failure because Firebase CLI released the rules and exited with code 0.

---

## 6. Smoke Test Result

環境:

- local Next.js dev server
- `http://127.0.0.1:3000`
- production Firebase project: `okmarine-tankrental`

result:

- partial

| scenario | result | memo |
|---|---|---|
| staff login/session | pass | Existing Firebase Auth staff session was valid. |
| `/staff/lend` display | pass | Displayed without `permission-denied`. |
| `/staff/dashboard` display | pass | Tank/log dashboard displayed without `permission-denied`. |
| `/admin/staff` display | pass | Admin staff screen displayed without `permission-denied`. |
| `/admin` display | pass | Admin dashboard displayed without `permission-denied`. |
| `/staff/inhouse` display | pass | Tanks screen displayed without `permission-denied`. |
| `/staff/return` display | pass | Return screen displayed without `permission-denied`. |
| `/staff/fill` display | pass | Fill screen displayed without `permission-denied`. |
| `/staff/damage` display | pass | Logs/write UI screen displayed without `permission-denied`. No write was submitted. |
| `/staff/supply-order` display | pass | Screen displayed without `permission-denied`. |
| portal login/session | partial | Existing portal auth session redirected to `/portal/setup`. No `permission-denied` was shown. |
| `customerUsers` owner login update | partial | No visible `permission-denied`; direct data verification was not available. |
| `/portal` display | partial | Redirected to `/portal/setup` because the current portal user is not setup-complete. |
| `/portal/order` display | partial | Redirected to `/portal/setup`; order form not reached. |
| `/portal/return` display | partial | Redirected to `/portal/setup`; return form not reached. |
| `/portal/unfilled` display | partial | Redirected to `/portal/setup`; unfilled form not reached. |

Notes:

- No manual Firestore Console edit was performed.
- No Firestore script create / update / delete was performed.
- No app form submission was performed during smoke test.
- Portal order / return / unfilled executable allow / deny behavior was already verified in emulator / rules-unit-test before deploy; the post-deploy browser smoke was limited by the available portal account state.

---

## 7. Rollback Decision

rollback 要否:

- no

理由:

- Security Rules deploy completed with exit code 0.
- Staff / admin smoke test passed.
- Portal smoke test did not show `permission-denied`; it was partial because the available portal session was setup-incomplete.
- No immediate production-blocking permission failure was observed.

Rollback command was not executed.

If rollback is needed later, use Firestore Rules-only deploy. Do not mix Hosting deploy:

```bash
firebase --project okmarine-tankrental deploy --only firestore:rules
```

---

## 8. Follow-Up

- Run a portal smoke test with a setup-complete customer account.
- Record any additional post-deploy smoke result if a setup-complete account is available.
- Keep AuthGuard staffByUid-first migration as a separate phase.
- Keep feature flag enablement decision as a separate phase.
- Keep `tanks` / `logs` field-level hardening as a separate phase.
