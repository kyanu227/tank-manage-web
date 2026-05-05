# Staff Operation Manual Verification

作成日: 2026-05-05

対象:

- order approve
- order fulfill
- return tag normal
- return tag unused
- return tag uncharged
- return tag keep

---

## 1. 目的

PR #26 から PR #28 で service 境界へ移した staff operation が、現場業務として壊れていないことを手動確認するための検証台本を固定する。

この document は実装を止めるためのものではなく、今後 staff operation を変更したときに、毎回同じ観点で短く確認するための checklist である。

---

## 2. 前提条件

- 検証対象環境は明示された環境だけにする。
- 検証前に対象 branch / commit / deploy URL を記録する。
- 検証に使う order / return transaction / tank は、業務上問題のないテスト対象を選ぶ。
- 検証中に Firestore console で直接 data を編集しない。
- Security Rules deploy はしない。
- Hosting deploy は検証手順そのものには含めない。deploy が必要な場合は別手順で実施済みであることを前提にする。

---

## 3. 検証前の注意

- 本番 data を使う場合は、検証対象の order / return / tank が実業務に影響しないことを確認する。
- Firestore data を直接編集して状態を作らない。
- `firestore.rules` / `firebase.json` / package files を変更しない。
- 失敗した場合は、再実行前に `transactions` / `tanks` / `logs` のどこまで更新されたかを記録する。
- partial update が疑われる場合は追加操作を止め、対象 document id と発生時刻を控える。

---

## 4. 見る collection / field

| collection | 確認 field |
|---|---|
| `transactions` | `type`, `status`, `approvedAt`, `approvedBy`, `approvedByStaffId`, `approvedByStaffName`, `approvedByStaffEmail`, `fulfilledAt`, `fulfilledBy`, `fulfilledByStaffId`, `fulfilledByStaffName`, `fulfilledByStaffEmail`, `finalCondition`, `updatedAt` |
| `tanks` | `status`, `location`, `latestLogId`, `logNote` |
| `logs` | `tankId`, `action`, `transitionAction`, `location`, `staffId`, `staffName`, `staffEmail`, `customerId`, `customerName`, `note`, `logNote`, `timestamp`, `logStatus`, `rootLogId`, `revision` |

---

## 5. Service 境界確認

| flow | hook に残す責務 | service にある責務 |
|---|---|---|
| order approve | customer guard, confirm, approving state, alert, `fetchOrders()` | `transactions/{orderId}` を `approved` に更新、actor snapshot 保存 |
| order fulfill | scan UI state, 数量/種別 check, submitting state, alert, modal close, refetch | `applyBulkTankOperations`, `extraOps` 内の order transaction completion |
| return tag processing | selection state, submitting state, alert, selected group clear, refetch | selected item 抽出、tank preflight, `resolveReturnAction`, `applyBulkTankOperations`, `extraOps` 内の return transaction completion |

---

## 6. Order Approve

### 手順

1. `type: "order"` かつ承認待ちの transaction を用意する。
2. staff 画面で対象 order を表示する。
3. 承認操作を実行する。
4. UI の受注一覧が再取得されることを確認する。
5. Firestore で対象 transaction / tanks / logs を確認する。

### 期待結果

対象 transaction:

- `type: "order"` のまま。
- `status: "approved"` になる。
- `approvedAt` が入る。
- `approvedBy` が入る。
- `approvedByStaffId` が入る。
- `approvedByStaffName` が入る。
- `approvedByStaffEmail` は staff email がある場合だけ入る。
- `updatedAt` が入る。

対象 tanks:

- 変わらない。

logs:

- 増えない。

UI:

- 受注一覧が再取得され、対象 order が承認済みとして扱われる。

---

## 7. Order Fulfill

### 手順

1. `type: "order"` かつ `status: "approved"` の order transaction を用意する。
2. order items に一致する tank type / quantity を確認する。
3. 倉庫にある対象 tank を scan する。
4. 必要数が揃った状態で貸出完了操作を実行する。
5. UI の成功 alert、modal close、受注一覧 / tank 一覧の再取得を確認する。
6. Firestore で transaction / tanks / logs を確認する。

### 期待結果

対象 order transaction:

- `status: "completed"` になる。
- `fulfilledAt` が入る。
- `fulfilledBy` が入る。
- `fulfilledByStaffId` が入る。
- `fulfilledByStaffName` が入る。
- `fulfilledByStaffEmail` は staff email がある場合だけ入る。
- `updatedAt` が入る。

対象 tanks:

- 貸出状態になる。
- `location` が対象 `customerName` になる。
- `latestLogId` など既存挙動どおり更新される。

logs:

- 対象 tank ごとに `受注貸出` log が作成される。
- staff snapshot が入る。
- customer snapshot が入る。
- `logNote` / tank 側の note に `受注ID: ...` が入る。

atomicity:

- tanks / logs / transaction completion が同じ `applyBulkTankOperations` / `extraOps` 内で処理される。
- transaction だけ `completed`、または tanks/logs だけ更新、という片方だけ完了した状態になっていない。

---

## 8. Return Tag Normal

### 手順

1. `type: "return"` かつ `status: "pending_return"` の return transaction を用意する。
2. return tag processing UI で対象 group を開く。
3. 対象 item を選択し、condition を `normal` にする。
4. 処理を実行する。
5. Firestore で transaction / tank / log を確認する。

### 期待結果

対象 return transaction:

- `status: "completed"` になる。
- `finalCondition: "normal"` になる。
- `fulfilledAt` が入る。
- `fulfilledBy` / `fulfilledByStaffId` / `fulfilledByStaffName` が入る。
- `fulfilledByStaffEmail` は staff email がある場合だけ入る。

対象 tank:

- 通常返却として倉庫側へ戻る。

logs:

- 返却処理の log が作成される。
- note / logNote が `[返却タグ処理] 顧客: ... (タグ:normal)` になる。

---

## 9. Return Tag Unused

### 手順

1. `type: "return"` かつ `status: "pending_return"` の return transaction を用意する。
2. return tag processing UI で対象 group を開く。
3. 対象 item を選択し、condition を `unused` にする。
4. 処理を実行する。
5. Firestore で transaction / tank / log を確認する。

### 期待結果

対象 return transaction:

- `status: "completed"` になる。
- `finalCondition: "unused"` になる。
- `fulfilledAt` が入る。
- `fulfilledBy*` が入る。

対象 tank:

- 未使用返却として期待される状態遷移になる。

logs:

- note / logNote が `[返却タグ処理] 顧客: ... (タグ:unused)` になる。

---

## 10. Return Tag Uncharged

### 手順

1. `type: "return"` かつ `status: "pending_return"` の return transaction を用意する。
2. return tag processing UI で対象 group を開く。
3. 対象 item を選択し、condition を `uncharged` にする。
4. 処理を実行する。
5. Firestore で transaction / tank / log を確認する。

### 期待結果

対象 return transaction:

- `status: "completed"` になる。
- `finalCondition: "uncharged"` になる。
- `fulfilledAt` が入る。
- `fulfilledBy*` が入る。

対象 tank:

- 未充填返却として期待される状態遷移になる。

logs:

- note / logNote が `[返却タグ処理] 顧客: ... (タグ:uncharged)` になる。

---

## 11. Return Tag Keep

### 手順

1. `type: "return"` かつ `status: "pending_return"` の return transaction を用意する。
2. return tag processing UI で対象 group を開く。
3. 対象 item を選択し、condition を `keep` にする。
4. 処理を実行する。
5. Firestore で transaction / tank / log を確認する。

### 期待結果

対象 return transaction:

- `status: "completed"` になる。
- `finalCondition: "keep"` になる。
- `fulfilledAt` が入る。
- `fulfilledBy*` が入る。

対象 tank:

- `ACTION.CARRY_OVER` 相当の処理になる。
- `location` は `tank.location || customerName` の方針どおりになる。

logs:

- note / logNote が `[返却タグ処理] 顧客: ... (タグ:keep)` になる。

---

## 12. 異常系・失敗時の観点

### Order Fulfill

- 数量が一致しない場合:
  - UI で `数量が一致しません` が表示される。
  - `transactions` / `tanks` / `logs` は更新されない。
- 対象外 tank type を選んだ場合:
  - scan item が invalid になる。
  - 完了操作時に必要数を満たさず、write されない。
- 倉庫にない tank を選んだ場合:
  - scan item が invalid になる。
  - write されない。

### Return Tag Processing

- 選択 0 件の場合:
  - UI で `処理するタンクを選択してください` が表示される。
  - `transactions` / `tanks` / `logs` は更新されない。
- tank が存在しない場合:
  - error alert が表示される。
  - 対象 return transaction だけ `completed` になっていない。
  - 他の selected tank だけ更新されていない。
- 処理中に tank status が変わっていた場合:
  - service が処理直前に `tanksRepository.getTank()` で現在 status を読む。
  - 最終的な transition validation は `applyBulkTankOperations` / `tank-operation.ts` 側で行われる。
  - 失敗時に partial update がないことを確認する。

### 共通

- 途中失敗時に、`transactions` だけ更新、または `tanks` / `logs` だけ更新、という片方だけの状態になっていないか確認する。
- 発生時刻、対象 transaction id、tank id、直近 log id を記録する。

---

## 13. 検証結果記録テンプレート

```text
検証日:
検証者:
環境 / URL:
commit:

対象 flow:
対象 transaction id:
対象 tank id:
対象 customer:
対象 staff:

手順結果:
- UI:
- transactions:
- tanks:
- logs:
- atomicity:

異常:
- なし / あり
- 内容:

判定:
- pass / fail / 保留

メモ:
```

---

## 14. この document で変更しない範囲

- 実装コード。
- Firestore data。
- `firestore.rules`。
- `firebase.json`。
- package files。
- Security Rules deploy。
- Hosting deploy。
