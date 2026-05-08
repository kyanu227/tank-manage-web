# Full App Flow Portal L1 Verification Result

実施日時: 2026-05-08 21:09 JST

対象 commit: `48e47869a6f3a348e35957611d8c226fa1a99d1a`

対象 project: `okmarine-tankrental`

検証環境:

- Local app: `http://127.0.0.1:3000`
- Next.js dev server: `npm run dev`
- Browser: Codex in-app browser
- Security Rules deploy: この検証では未実行
- Hosting deploy: 未実行
- `firebase deploy`: 未実行
- Firestore Console / script による本番 data 直接 edit: 未実行

検証用 marker: `VERIFY-20260508`

この document は、Security Rules deploy 後の全機能回帰検証のうち、portal protected route と最小 L1 portal order flow の結果を記録する。

---

## 1. Summary

Overall result: `partial`

| category | result | memo |
|---|---|---|
| portal setup complete | pass | アプリ通常フローで setup 完了 |
| portal protected route read | pass | `/portal` / `/portal/order` / `/portal/return` / `/portal/unfilled` に到達 |
| portal order create | pass | marker 付き order を 1 件作成 |
| staff order visibility | partial | unlinked customer の仮受付 order のため staff 受注一覧には未表示 |
| admin portal user visibility | pass | admin のポータル利用者画面で marker 付き未紐付け user を確認 |
| tank state change | skipped | 検証用 tank 未指定のため実行せず |
| delete / void / direct edit | skipped | 今回対象外 |

Fail: なし。

Visible `permission-denied` / 404 / runtime error: なし。

---

## 2. App-Flow Writes Executed

Firestore Console / script direct edit は実行していない。

アプリ通常フロー経由で発生した write:

| flow | expected write scope | result | memo |
|---|---|---|---|
| portal setup complete | `customerUsers/{uid}` profile / setup fields | pass | 検証用 marker `VERIFY-20260508` を会社名・LINE名に設定 |
| portal order create | `transactions` order create | pass | 引き取り / スチール 10L / 1 本 / marker 付き memo |

作成された order:

- UI 表示番号: `#O6LB7Q`
- note marker: `VERIFY-20260508 portal order read/write check`
- delivery type: 引き取り
- item: スチール 10L x 1
- customer state: 未紐付け customerUser のため仮受付扱い

個人情報は docs には記録しない。

---

## 3. Protected Route Matrix

| route | result | memo |
|---|---|---|
| `/portal` | pass | dashboard に到達。visible permission-denied / 404 / runtime error なし。 |
| `/portal/order` | pass | order 画面に到達。visible permission-denied / 404 / runtime error なし。 |
| `/portal/return` | pass | 返却画面に到達。customer 未紐付けのため利用不可メッセージ表示。permission-denied なし。 |
| `/portal/unfilled` | pass | 未充填報告画面に到達。customer 未紐付けのため利用不可メッセージ表示。permission-denied なし。 |

---

## 4. Portal Order Flow

実行内容:

1. `/portal/setup` で `VERIFY-20260508` marker を含む setup を完了した。
2. `/portal` dashboard に到達した。
3. `/portal/order` で受け取り方法を `引き取り` にした。
4. `スチール 10L` を 1 本選択した。
5. memo に `VERIFY-20260508 portal order read/write check` を入力した。
6. `1本 (1種) を発注する` を実行した。
7. `発注完了` 画面と `#O6LB7Q` 表示を確認した。

Result: `pass`

---

## 5. Staff / Admin Visibility

### Staff

`/staff/lend` の受注 tab を確認した。

Result: `partial`

Memo:

- visible permission-denied / 404 / runtime error はなし。
- 作成した `#O6LB7Q` / `VERIFY-20260508` order は staff 受注一覧には表示されなかった。
- portal account が customer 未紐付けのため、作成 order は仮受付 / pending link 扱いと判断した。
- 本番 customer への紐付けは影響範囲があるため実行していない。

### Admin

`/admin/customers/users` を確認した。

Result: `pass`

Memo:

- visible permission-denied / 404 / runtime error はなし。
- marker `VERIFY-20260508` の未紐付け portal user が表示された。
- customer 紐付け保存は実行していない。

---

## 6. Tank Data Safety

タンク情報の削除、void、履歴改変、直接上書きは実行していない。

実行していない操作:

- `tanks` delete / direct update
- `logs` delete / void / direct update
- `transactions` delete / void / direct update
- Firestore Console / script による直接 data edit
- tank lend / return / fill / damage / repair / inspection / inhouse
- order approve / fulfill
- customer linking
- permissions / settings / billing writes

Tank state change: なし。

---

## 7. Rollback / Cleanup

Rollback: 不要。

Cleanup: `optional`

理由:

- deploy は実行していない。
- Firestore Console / script による直接 edit は実行していない。
- tank state change は実行していない。
- app-flow write として、検証用 portal setup と portal order が本番 data に残っている。

Cleanup が必要な場合は、別途専用手順で対象 data と方法を決める。この検証では削除や direct edit は実行しない。

---

## 8. Remaining Verification

残る確認:

- 検証用 customer を明確にした上での portal user linking。
- customer linking 後の staff order visibility。
- 検証用 tank を明確にした上での order approve / fulfill。
- 検証用 tank を明確にした上での return / fill / damage / repair / inspection / inhouse。
- delete / void / permissions / settings / billing は専用手順で別途確認。

次の推奨:

1. `VERIFY-20260508` の portal user をどの検証用 customer に紐付けるか決める。
2. 紐付け後、`#O6LB7Q` が staff 受注一覧に出るか確認する。
3. tank state change を伴う検証は、検証用 tank が決まるまで実行しない。
