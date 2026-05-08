# Full App Flow Portal L1 Verification Result

実施日時: 2026-05-08 21:09 JST

追加実施日時: 2026-05-08 21:15 JST

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
| customer linking | pass | admin のポータル利用者画面で `SH` に紐付け |
| staff order visibility | pass | customer linking 後、staff 受注一覧に marker 付き order が表示 |
| order approve | skipped | 現行 UI では承認ボタンが見当たらず、order 詳細は tank scan / fulfillment 画面に入る |
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
| customer linking | `customerUsers/{uid}` customer link update、対象 `pending_link` transaction の `pending` 化 | pass | admin `/admin/customers/users` で `SH` に紐付け |

作成された order:

- UI 表示番号: `#O6LB7Q`
- note marker: `VERIFY-20260508 portal order read/write check`
- delivery type: 引き取り
- item: スチール 10L x 1
- initial customer state: 未紐付け customerUser のため仮受付扱い
- linked customer for verification: `SH`

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

## 5. Customer Linking / Staff Visibility

### Observed Initial Behavior

`/portal/setup` の氏名欄は Firebase Auth の `displayName` を初期値として表示した。

この検証では、氏名欄に既存 displayName 由来の値が入っていた。これは `ensureCustomerUser()` / setup page の現行挙動であり、今回の検証では変更していない。

仮受付 order は `pending_link` として作成され、customer linking 前は staff 受注一覧には表示されなかった。

この挙動は、現行 staff 受注一覧が `pending` / `pending_approval` / `approved` を取得し、`pending_link` を直接表示しないためと整理する。

### Admin Linking

`/admin/customers/users` で marker `VERIFY-20260508` の portal user を `SH` に紐付けた。

Result: `pass`

Memo:

- visible permission-denied / 404 / runtime error はなし。
- Firestore Console / script direct edit は未実行。
- app normal flow の保存のみ実行した。
- 保存後、portal user は `紐付け済` / `SH` として表示された。
- 紐付けにより、対象 `pending_link` order は `pending` に移った。

### Staff

`/staff/lend` の受注 tab を確認した。

Result: `pass`

Memo:

- visible permission-denied / 404 / runtime error はなし。
- customer linking 前、作成した `#O6LB7Q` / `VERIFY-20260508` order は staff 受注一覧には表示されなかった。
- customer linking 後、staff 受注一覧に `SH` / `VERIFY-20260508 portal order read/write check` / スチール 10L x 1 が表示された。
- header の受注 count は `2` から `3` に増えた。

### Order Detail / Approve

staff 受注一覧から marker 付き order を開いた。

Result: `partial`

Memo:

- visible permission-denied / 404 / runtime error はなし。
- order detail は tank scan / fulfillment 画面に入った。
- 現行 UI 上、明示的な `approve` button は見当たらなかった。
- tank scan / fulfillment は tank state change を伴うため実行していない。

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
- app-flow write として、検証用 portal setup、portal order、customer linking が本番 data に残っている。

Cleanup が必要な場合は、別途専用手順で対象 data と方法を決める。この検証では削除や direct edit は実行しない。

---

## 8. Remaining Verification

残る確認:

- order approve の画面導線 / UI 方針確認。
- 検証用 tank を明確にした上での order fulfill。
- 検証用 tank を明確にした上での return / fill / damage / repair / inspection / inhouse。
- delete / void / permissions / settings / billing は専用手順で別途確認。

次の推奨:

1. setup 氏名欄に Firebase Auth `displayName` を初期値として入れる UX を維持するか決める。
2. `pending_link` order を staff 受注一覧にも出すべきか、admin linking 後だけ出すべきか決める。
3. order approve の UI 方針を確認する。
4. tank state change を伴う検証は、検証用 tank が決まるまで実行しない。
