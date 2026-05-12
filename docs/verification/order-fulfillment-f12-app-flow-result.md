# Order Fulfillment F12 App Flow Result

実施日時: 2026-05-12 10:14 JST

対象 commit: `c586617585d7b8070a2cb9ac928ec159518c72b2`

対象 project: `okmarine-tankrental`

使用 marker: `VERIFY-ORDER-APPROVAL-20260511`

対象 tank: `F-12`

検証環境:

- Local app: `http://127.0.0.1:3000`
- Next.js dev server: `npm run dev`
- Browser: Codex in-app browser
- Security Rules deploy: この検証では未実行
- Hosting deploy: 未実行
- `firebase deploy`: 未実行
- Firestore Console / script による本番 data 直接 edit: 未実行

この document は、PR #66 で記録した order approval app-flow verification の続きとして、`タンク入力へ` 以降の F12 scan / fulfillment / lend completion を本番アプリ通常フローで確認した結果を記録する。

---

## 1. Summary

Overall result: `pass`

確認したこと:

- 承認済み marker 付き受注の `タンク入力へ` を開けた。
- F12 は最初の scan では `空` のため貸出不可として弾かれた。
- `/staff/fill` の通常フローで F12 を充填処理できた。
- 充填後、同じ受注の `タンク入力へ` で F12 scan が `OK` になった。
- `受注を完了する（SH）` を実行できた。
- 完了後、marker 付き受注は `/staff/lend` の受注一覧から消えた。

---

## 2. Pre-Fill Fulfillment Attempt

| item | result |
|---|---|
| route | `/staff/lend` |
| flow | approved order -> `タンク入力へ` |
| target order marker | `VERIFY-ORDER-APPROVAL-20260511` |
| target tank | `F-12` |
| scan result | blocked as expected |
| displayed reason | `「空」のタンクに「貸出」はできません（許容: 充填済み）` |
| lend completion | not executed |

App-flow write:

- なし

---

## 3. Fill F12

| item | result |
|---|---|
| route | `/staff/fill` |
| target tank | `F-12` |
| before state shown in UI | `空` |
| action | `1件の充填を実行` |
| result | pass |

Expected app-flow write:

- `tanks/F-12` update from `空` to filled / lendable state
- `logs` create for fill operation

Direct data edit:

- Firestore Console / script direct edit: 未実行

---

## 4. Fulfillment / Lend Completion

| item | result |
|---|---|
| route | `/staff/lend` |
| flow | approved order -> `タンク入力へ` |
| target order marker | `VERIFY-ORDER-APPROVAL-20260511` |
| target tank | `F-12` |
| scan result after fill | `OK` |
| scanned count | `1 / 1` |
| completion button | `受注を完了する（SH）` |
| completion result | pass |
| after completion | marker order no longer shown in order list |

Expected app-flow write:

- `transactions` update for order fulfillment / completion
- `tanks/F-12` update for lend operation
- `logs` create for lend operation

Direct data edit:

- Firestore Console / script direct edit: 未実行

---

## 5. Not Executed

実行していない操作:

- tank / logs / transactions の delete
- logs void
- Firestore Console / script による直接 create/update/delete
- Security Rules deploy
- Hosting deploy
- `firebase deploy`

---

## 6. Runtime Notes

Visible permission-denied / 404 / runtime error:

- なし

Browser console:

- Fulfillment completion 後に Firestore SDK の `BloomFilterError` warning が 1 件出た。
- 画面上の処理は完了し、marker 付き受注は一覧から消えた。
- この warning は今回の visible failure / permission-denied とは扱わない。

---

## 7. Rollback / Cleanup

Rollback: 未実施。

Cleanup: 未実施。

理由:

- 今回は本番アプリ通常フローによる検証として、F12 の充填履歴と貸出履歴を残す。
- Firestore Console / script direct edit は行っていない。
- delete / void は行っていない。

次に戻す場合の通常フロー候補:

- F12 を通常の返却フローで返却する。
- 必要に応じて通常の充填 / 未充填タグ運用に従う。
