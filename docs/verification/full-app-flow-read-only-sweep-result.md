# Full App Flow Read-Only Sweep Result

実施日時: 2026-05-08 19:46 JST

対象 commit: `b0cfb060abc2701cea47cde60cee7c7b44d2b2ef`

対象 project: `okmarine-tankrental`

検証環境:

- Local app: `http://127.0.0.1:3000`
- Next.js dev server: `npm run dev`
- Browser: Codex in-app browser
- Security Rules deploy: 実行済み
- Hosting deploy: この検証では未実行
- `firebase deploy`: 未実行
- Firestore Console / script による本番 data 直接 edit: 未実行

この document は、Security Rules deploy 後の全機能回帰検証のうち、read-only access sweep の結果を記録する。

この検証では、form submit / save / approve / fulfill / return / delete / void は実行していない。

---

## 1. Summary

| category | count | result |
|---|---:|---|
| total routes checked | 37 | - |
| pass | 32 | visible permission-denied / 404 / runtime error なし |
| partial | 5 | expected redirect または setup 完了済み portal account 未使用 |
| fail | 0 | なし |
| skipped writes | all app-flow writes | 検証用 data 未指定のため実行せず |

Overall result: `partial`

理由:

- staff / admin の主要画面は read-only 表示確認が `pass`。
- portal public route は `pass`。
- portal protected route は setup 未完了 session により `/portal/setup` へ redirect したため `partial`。
- setup 完了済み portal account での protected route 到達確認は未実行。
- 本番 app-flow write は未実行。

---

## 2. Scope

実行したこと:

- staff / admin / portal の主要 route を browser で直接開いた。
- visible な `permission-denied`、404、runtime error がないことを確認した。
- redirect が発生した route は final path を記録した。
- browser error logs を確認した。

実行しなかったこと:

- portal setup 完了
- portal order / return / unfilled report create
- staff order approve / fulfill
- staff lend / return / fill / damage / repair / inspection / inhouse
- admin master / permissions / settings / billing write
- delete / void / edit
- Firestore Console / script による本番 data 直接 edit
- Security Rules deploy / Hosting deploy / `firebase deploy`

---

## 3. Route Matrix

| area | requested route | final route | result | memo |
|---|---|---|---|---|
| staff | `/staff` | `/staff/lend` | pass | staff root は `/staff/lend` に遷移。表示到達。 |
| staff | `/staff/lend` | `/staff/lend` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/return` | `/staff/return` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/fill` | `/staff/fill` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/inhouse` | `/staff/inhouse` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/damage` | `/staff/damage` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/repair` | `/staff/repair` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/inspection` | `/staff/inspection` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/dashboard` | `/staff/dashboard` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/mypage` | `/staff/mypage` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/supply-order` | `/staff/supply-order` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/tank-purchase` | `/staff/tank-purchase` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/tank-register` | `/staff/tank-register` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| staff | `/staff/order` | `/staff/supply-order` | pass | legacy route は `/staff/supply-order` に互換 redirect。表示到達。 |
| admin | `/admin` | `/admin` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/sales` | `/admin/sales` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/staff-analytics` | `/admin/staff-analytics` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/customers` | `/admin/customers` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/customers/users` | `/admin/customers/users` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/billing` | `/admin/billing` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/staff` | `/admin/staff` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/permissions` | `/admin/permissions` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/money` | `/admin/money` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/order-master` | `/admin/order-master` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/settings` | `/admin/settings/portal` | partial | redirect: `/admin/settings` -> `/admin/settings/portal`。permission-denied はなし。 |
| admin | `/admin/settings/portal` | `/admin/settings/portal` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/settings/inspection` | `/admin/settings/inspection` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/notifications` | `/admin/notifications` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/state-diagram` | `/admin/state-diagram` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| admin | `/admin/security-rules` | `/admin/security-rules` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| portal | `/portal/login` | `/portal/login` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| portal | `/portal/register` | `/portal/register` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| portal | `/portal/setup` | `/portal/setup` | pass | 表示到達。visible permission-denied / 404 / runtime error なし。 |
| portal | `/portal` | `/portal/setup` | partial | portal session は setup 未完了のため `/portal/setup` に redirect。permission-denied はなし。 |
| portal | `/portal/order` | `/portal/setup` | partial | setup 完了済み portal account 不在 / 未使用のため `/portal/setup` に redirect。permission-denied はなし。 |
| portal | `/portal/return` | `/portal/setup` | partial | setup 完了済み portal account 不在 / 未使用のため `/portal/setup` に redirect。permission-denied はなし。 |
| portal | `/portal/unfilled` | `/portal/setup` | partial | setup 完了済み portal account 不在 / 未使用のため `/portal/setup` に redirect。permission-denied はなし。 |

---

## 4. App-Flow Writes

実行した app-flow write: なし。

理由:

- 検証用 customer / portal account / tank / note marker が未指定。
- setup、order create、return create、unfilled report create、tank state change は本番 data に残るため実行しなかった。
- delete / void / permissions / settings / billing は今回の方針どおり skip。

Skipped write categories:

| flow | result | reason |
|---|---|---|
| portal setup complete | skipped | setup 完了済み検証 account 未指定 |
| portal order create | skipped | 検証用 customer / note marker 未指定 |
| portal return create | skipped | 検証用 lent tank 未指定 |
| portal unfilled report create | skipped | 検証用 tank / note marker 未指定 |
| staff order approve / fulfill | skipped | 検証用 order / tank 未指定 |
| staff lend / return / fill / damage / repair / inspection / inhouse | skipped | 検証用 tank 未指定 |
| admin customer / staff / permission / setting / billing writes | skipped | high-risk write のため今回対象外 |
| delete / void / edit | skipped | destructive / irreversible 扱いのため今回対象外 |

---

## 5. Rollback / Cleanup

Rollback: 不要。

Cleanup: 不要。

理由:

- 本番 app-flow write を実行していない。
- Firestore Console / script による直接 data edit を実行していない。
- deploy を実行していない。

---

## 6. Remaining Verification

残る確認:

- setup 完了済み portal account による `/portal` / `/portal/order` / `/portal/return` / `/portal/unfilled` 到達確認。
- 検証用 customer / portal account / tank / note marker を決めたうえでの L1 safe write。
- 検証用 tank を明確にしたうえでの L2 tank / logs / transactions flow。
- delete / void / permissions / settings / billing は専用手順で別途確認。

次の推奨:

1. setup 完了済み portal account を用意する。
2. `VERIFY-YYYYMMDD` marker を決める。
3. portal order create から staff order visibility までの最小 L1 flow を実行する。
4. tank state change を伴う L2 flow は、検証用 tank が決まるまで実行しない。
