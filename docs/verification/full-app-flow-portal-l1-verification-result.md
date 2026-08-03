# Full App Flow Portal / Tank Verification Result

実施日時: 2026-05-08 21:09-21:36 JST

対象 commit: `48e47869a6f3a348e35957611d8c226fa1a99d1a`

対象 project: `okmarine-tankrental`

検証環境:

- Local app: `http://127.0.0.1:3000`
- Next.js dev server: `npm run dev`
- Browser: Codex in-app browser
- Security Rules deploy: PR #61 で実行済み。この検証では未実行
- Hosting deploy: 未実行
- `firebase deploy`: 未実行
- Firestore Console / script による本番 data 直接 edit: 未実行

検証用 marker: `VERIFY-20260508`

この document は、Security Rules deploy 後の全機能回帰検証のうち、portal setup / protected route / order flow / staff tank operation flow の結果を記録する。

---

## 1. Summary

Overall result: `pass with follow-up observations`

Full-app regression coverage: `partial`

| category | result | memo |
|---|---|---|
| portal setup complete | pass | アプリ通常フローで setup 完了 |
| portal protected route read | pass | `/portal` / `/portal/order` / `/portal/return` / `/portal/unfilled` に到達 |
| portal order create | pass | marker 付き order を 1 件作成 |
| customer linking | pass | admin のポータル利用者画面で `SH` に紐付け |
| staff order visibility | pass | customer linking 後、staff 受注一覧に marker 付き order が表示 |
| order fulfillment | pass | `F-32` を scan し、対象 order を完了 |
| portal dashboard after fulfillment | pass | `F-32` が貸出中として portal に表示 |
| portal unfilled report | pass | `F-32` の未充填報告を送信 |
| portal return request | partial | 返却申請完了画面は表示。portal dashboard では staff 返却タグ処理前まで貸出中表示 |
| staff return tag processing | pass | `F-32` を `未充填` として処理 |
| staff fill | pass | `F-32` を空から充填済みに戻した |
| staff damage report | pass | `F-32` の破損報告を実行 |
| staff repair completion | pass | `F-32` を破損から空へ戻した |
| final fill restore | pass | `F-32` を再度充填済みに戻した |
| staff inspection completion | pass | `A-04` を 1 件だけ耐圧検査完了処理 |
| delete / void / direct edit | skipped | 今回対象外 |
| permissions / settings / billing | skipped | 今回対象外 |

Fail: なし。

Visible `permission-denied` / 404 / runtime error: なし。

Browser console error logs: app flow 中の該当確認では 0。

---

## 2. App-Flow Writes Executed

Firestore Console / script direct edit は実行していない。

アプリ通常フロー経由で発生した write:

| flow | expected write scope | result | memo |
|---|---|---|---|
| portal setup complete | `customerUsers/{uid}` profile / setup fields | pass | 検証用 marker `VERIFY-20260508` を会社名・LINE名に設定 |
| portal order create | `transactions` order create | pass | 引き取り / スチール 10L / 1 本 / marker 付き memo |
| customer linking | `customerUsers/{uid}` customer link update、対象 `pending_link` transaction の `pending` 化 | pass | admin `/admin/customers/users` で `SH` に紐付け |
| order fulfillment | `transactions` order completion、`tanks` status/location update、`logs` create | pass | `F-32` を `SH` へ受注貸出 |
| portal unfilled report | `transactions` unfilled / uncharged report create | pass | portal から `F-32` を未充填報告 |
| portal return request | return transaction / return tag request create/update | partial | 完了画面は表示。staff 側の返却タグ処理が必要 |
| staff return tag processing | return transaction completion、`tanks` status/location update、`logs` create | pass | `F-32` を `未充填` として処理 |
| staff fill | `tanks` status update、`logs` create | pass | `F-32` を空から充填済みに戻した |
| staff damage report | `tanks` status update、`logs` create | pass | `F-32` を破損に変更。note marker `VERIFY-20260508 damage check` |
| staff repair completion | `tanks` status update、`logs` create | pass | `F-32` を破損から空へ戻した |
| final fill restore | `tanks` status update、`logs` create | pass | `F-32` を再度充填済みに戻した |
| staff inspection completion | `tanks` maintenance date/status update、`logs` create | pass | `A-04` を 1 本だけ耐圧検査完了処理 |

作成された order:

- UI 表示番号: `#O6LB7Q`
- note marker: `VERIFY-20260508 portal order read/write check`
- delivery type: 引き取り
- item: スチール 10L x 1
- initial customer state: 未紐付け customerUser のため仮受付扱い
- linked customer for verification: `SH`

使用した tank:

- Main app-flow tank: `F-32`
- Inspection-only tank: `A-04`

個人情報は docs には記録しない。

---

## 3. Protected Route Matrix

| route | result | memo |
|---|---|---|
| `/portal` | pass | dashboard に到達。visible permission-denied / 404 / runtime error なし。 |
| `/portal/order` | pass | order 画面に到達。visible permission-denied / 404 / runtime error なし。 |
| `/portal/return` | pass | 返却画面に到達。貸出中の `F-32` が表示された。 |
| `/portal/unfilled` | pass | 未充填報告画面に到達。貸出中の `F-32` が表示された。 |
| `/staff/lend` | pass | 手動貸出 / 受注 detail / tank scan が表示・動作。 |
| `/staff/return` | pass | 返却タグ処理待ちと全貸出タンクが表示・動作。 |
| `/staff/fill` | pass | tank scan と充填実行が表示・動作。 |
| `/staff/damage` | pass | 破損報告が表示・動作。 |
| `/staff/repair` | pass | 修理完了が表示・動作。 |
| `/staff/inspection` | pass | 耐圧検査完了が表示・動作。 |
| `/admin/customers/users` | pass | portal user と customer の紐付けが表示・動作。 |

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

### Staff Visibility

`/staff/lend` の受注 tab を確認した。

Result: `pass`

Memo:

- visible permission-denied / 404 / runtime error はなし。
- customer linking 前、作成した `#O6LB7Q` / `VERIFY-20260508` order は staff 受注一覧には表示されなかった。
- customer linking 後、staff 受注一覧に `SH` / `VERIFY-20260508 portal order read/write check` / スチール 10L x 1 が表示された。
- header の受注 count は `2` から `3` に増えた。

### Order Detail / Fulfillment

staff 受注一覧から marker 付き order を開いた。

Result: `pass`

Memo:

- visible permission-denied / 404 / runtime error はなし。
- order detail は tank scan / fulfillment 画面に入った。
- 現行 UI 上、明示的な `approve` button は見当たらなかった。
- `F-32` を scan すると `1/1` / `F-32 OK` になり、`受注を完了する（SH）` が表示された。
- `受注を完了する（SH）` を実行後、対象 order は staff 受注一覧から消え、header の受注 count は `3` から `2` に戻った。

---

## 6. Portal Return / Unfilled Flow

### Portal Dashboard After Fulfillment

`/portal` dashboard に `SH 様`、現在の貸出 `1本`、`F-32` が表示された。

Recent history には `受注貸出 F-32` が表示された。

Result: `pass`

### Portal Unfilled Report

`/portal/unfilled` で `F-32` を選択し、報告を送信した。

Result: `pass`

Memo:

- `報告完了` 画面が表示された。
- visible permission-denied / 404 / runtime error はなし。

### Portal Return Request

`/portal/return` で `F-32` の返却申請を実行した。

Result: `partial`

Memo:

- `返却申請完了` 画面が表示された。
- 完了画面には `自動返却を実行しました。` と表示された。
- 直後の portal dashboard では `F-32` が貸出中のままだった。
- staff `/staff/return` には `返却タグ処理待ち` として `SH 1本` が表示された。
- したがって、portal 完了画面の文言と実際の staff return tag processing の関係は、今後 UX として確認した方がよい。

### Staff Return Tag Processing

`/staff/return` で `SH 1本 タグ処理待ち` を開き、`F-32` を `未充填` として処理した。

Result: `pass`

Memo:

- 処理後、`処理待ちの返却タグはありません` と表示された。
- `全貸出タンク` には `貸出中のタンクはありません` と表示された。
- visible permission-denied / 404 / runtime error はなし。

---

## 7. Tank Operation Flow

### Fill

`/staff/fill` で `F-32` を scan した。

Result: `pass`

Memo:

- 送信リストに `F-32` / `現在: 空` が表示された。
- `1件の充填を実行` を実行後、画面が初期状態に戻った。
- visible permission-denied / 404 / runtime error はなし。

### Damage

`/staff/damage` で `F-32` を scan し、note marker `VERIFY-20260508 damage check` を入力して破損報告を実行した。

Result: `pass`

Memo:

- 入力中に誤って `F-OK` が送信リストに入ったが、submit 前に削除した。
- submit 前の送信リストは `F-32` のみであることを確認した。
- `1本の破損報告を完了しました` と表示された。
- visible permission-denied / 404 / runtime error はなし。

### Repair

`/staff/repair` で `F-32` を選択し、修理完了を実行した。

Result: `pass`

Memo:

- 実行前、`修理待ち 1本` / `F-32` が表示された。
- 実行後、`修理待ち 0本` / `1本の修理完了を処理しました` が表示された。
- visible permission-denied / 404 / runtime error はなし。

### Final Fill Restore

修理完了後、`/staff/fill` で `F-32` を scan し、再度充填を実行した。

Result: `pass`

Memo:

- 送信リストに `F-32` / `現在: 空` が表示された。
- 充填実行後、`/staff/lend` の手動貸出フォームで `F-32` を scan すると `現在: 充填済み` と表示された。
- `1件の貸出を実行` は押していない。
- F-32 は最終的に充填済みとして読める状態へ戻した。

### Inspection

`/staff/inspection` で `A-04` を 1 本だけ選択し、耐圧検査完了を実行した。

Result: `pass`

Memo:

- 実行前、対象は `56本` と表示された。
- 実行後、対象は `55本` になり、`1本の耐圧検査完了を処理しました` と表示された。
- visible permission-denied / 404 / runtime error はなし。

---

## 8. Tank Data Safety

タンク情報の削除、void、履歴改変、直接上書きは実行していない。

実行していない操作:

- `tanks` delete / direct update
- `logs` delete / void / direct update
- `transactions` delete / void / direct update
- Firestore Console / script による直接 data edit
- permissions / settings / billing writes

通常フローで動かした tank state:

- `F-32`: `充填済み` -> `貸出中` -> `空` -> `充填済み` -> `破損` -> `空` -> `充填済み`
- `A-04`: 耐圧検査完了を 1 件実行

`F-32` は最終確認で `現在: 充填済み` と表示された。

---

## 9. Rollback / Cleanup

Rollback: 不要。

Cleanup: `optional`

理由:

- deploy は実行していない。
- Firestore Console / script による直接 edit は実行していない。
- delete / void は実行していない。
- app-flow write として、検証用 portal setup、portal order、customer linking、order fulfillment、return/unfilled/fill/damage/repair/inspection の履歴が本番 data に残っている。
- `F-32` は最終的に充填済みへ戻した。

Cleanup が必要な場合は、別途専用手順で対象 data と方法を決める。この検証では削除や direct edit は実行しない。

---

## 10. Follow-Up Observations

今回の検証で見えた確認事項:

1. `/portal/setup` の氏名欄は Firebase Auth `displayName` 由来の値を初期表示する。意図した UX か確認する。
2. `pending_link` order は customer linking 前に staff 受注一覧へ表示されない。仮受付 order を現場アプリに見せるべきか、admin linking 後だけ見せるべきか決める。
3. staff order detail では明示的な `approve` button が見当たらず、tank scan / fulfillment に進む。受注承認という概念を UI に残すか確認する。
4. portal return request 完了画面に `自動返却を実行しました。` と表示される一方、staff return tag processing が必要だった。文言と実処理の関係を確認する。

---

## 11. Remaining Verification

残る確認:

- delete / void は専用手順で別途確認。
- permissions / settings / billing は専用手順で別途確認。
- supply-order / tank registration 系 write は別途確認。
- inhouse flow は別途確認。
- 請求・売上・単価・権限変更など、業務影響が大きい admin write は別途確認。

次の推奨:

1. 上記 follow-up observations を issue / docs / 次 PR のいずれかで扱う。
2. 残る admin high-risk write は、画面ごとに検証用データと rollback 方針を決めてから実行する。
