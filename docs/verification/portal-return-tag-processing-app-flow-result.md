# Portal Return Tag Processing App Flow Result

実施日時: 2026-05-12 10:37 JST

対象 commit: `9e7f05d9adeb710ec9d8b034f2c1545e851b7bd8`

対象 project: `okmarine-tankrental`

推奨 marker: `VERIFY-PORTAL-RETURN-20260512`

対象 tank: `F-12`

検証環境:

- Local app: `http://127.0.0.1:3000`
- Next.js dev server: `npm run dev`
- Browser: Codex in-app browser
- Security Rules deploy: この検証では未実行
- Hosting deploy: 未実行
- `firebase deploy`: 未実行
- Firestore Console / script による本番 data 直接 edit: 未実行

この document は、Security Rules deploy 後の本番アプリ通常フロー検証として、portal return create から staff return tag processing までを確認した結果を記録する。

---

## 1. Summary

Overall result: `pass`

確認したこと:

- 初回確認時、portal return 画面に貸出中 tank はなかった。
- 検証前準備として、F12 をアプリ通常フローで充填し、SH へ貸出した。
- `/portal/return` で F12 が返却申請対象として表示された。
- portal から F12 の返却申請を作成できた。
- `/staff/return` に `SH` の返却タグ処理待ち 1 本として F12 が表示された。
- staff 側で F12 の返却タグ処理を実行できた。
- 処理後、`返却タグ処理待ち` は空になり、`全貸出タンク` も `貸出中のタンクはありません` になった。
- visible permission-denied / 404 / runtime error は発生していない。

---

## 2. Initial Portal Return Check

| item | result |
|---|---|
| route | `/portal/return` |
| portal customer | `SH` |
| visible lent tanks | なし |
| displayed message | `貸出中のタンクがありません` |
| result | blocked for return verification until a lent test tank exists |

Memo:

- 返却申請には貸出中 tank が必要なため、F12 をアプリ通常フローで貸出状態にしてから検証を続行した。
- Firestore Console / script による直接 edit は行っていない。

---

## 3. Test Tank Setup By App Flow

### 3.1 Fill F12

| item | result |
|---|---|
| route | `/staff/fill` |
| target tank | `F-12` |
| before state shown in UI | `空` |
| action | `1件の充填を実行` |
| result | pass |

Expected app-flow write:

- `tanks/F-12` update for fill operation
- `logs` create for fill operation

### 3.2 Lend F12 To SH

| item | result |
|---|---|
| route | `/staff/lend` |
| target tank | `F-12` |
| state before lend shown in UI | `充填済み` |
| customer selected | `SH` |
| action | `1件の貸出を実行` |
| result | pass |

Expected app-flow write:

- `tanks/F-12` update for lend operation
- `logs` create for lend operation

---

## 4. Portal Return Create

| item | result |
|---|---|
| route | `/portal/return` |
| visible target tank | `F-12` |
| visible lend date | `5/12 貸出` |
| submit button | `1本を返却申請する` |
| result after submit | `返却申請完了` |
| result | pass |

Expected app-flow write:

- `transactions` create for portal return request

Marker note:

- `/portal/return` の現行 UI には free-form memo field がないため、推奨 marker 文字列は transaction field として入力していない。
- この検証では `F-12`, `SH`, 実施日時, app-flow sequence を trace marker として扱う。

---

## 5. Staff Return Tag Processing

| item | result |
|---|---|
| route | `/staff/return` |
| pending return group | `SH 1本 タグ処理待ち 1本` |
| target tank | `F-12` |
| tag processing panel | `返却タグ処理 - 0/1` |
| selected count after selecting F12 | `1/1` |
| action | `1件の返却タグを処理する` |
| result | pass |

Expected app-flow write:

- `transactions` update for return tag processing completion
- `tanks/F-12` update for normal return
- `logs` create for normal return

After processing:

| item | result |
|---|---|
| pending return tags | `処理待ちの返却タグはありません` |
| all lent tanks | `貸出中のタンクはありません` |
| F12 still shown as lent | no |

---

## 6. Not Executed

実行していない操作:

- Firestore Console / script による直接 create/update/delete
- tank / logs / transactions の delete
- logs void
- logs edit
- Security Rules deploy
- Hosting deploy
- `firebase deploy`
- 実装コード変更

---

## 7. Runtime Notes

Visible permission-denied / 404 / runtime error:

- なし

Browser console:

- Firestore SDK の `BloomFilterError` warning が出た。
- 画面上の返却申請作成と返却タグ処理は完了し、visible failure / permission-denied は発生していない。

---

## 8. Rollback / Cleanup

Rollback: 不要。

Cleanup: 不要。

理由:

- F12 は通常アプリフローで貸出状態にし、通常返却タグ処理で貸出中状態から戻した。
- delete / void / direct edit は行っていない。
- 今回の充填、貸出、返却申請、返却タグ処理の履歴は本番アプリ通常フローの検証履歴として残す。
