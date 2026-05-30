# Return Flow Policy

## Purpose

この文書は、返却フローの設計方針を固定する。

最重要方針は、返却申請と返却確定を分けること。

顧客または portal が返却したいと申請しただけでは、在庫は戻っていない。スタッフが現物確認し、返却タグまたは condition を確定して初めて `tanks` と `logs` を更新する。

## Return Request

返却申請とは、顧客または portal 側が「返却したい」と申請する段階。

この段階で行うこと:

- `transactions(type="return", status="pending_return")` を作る
- `condition` を保存する
- `customerId` / `customerName` / `createdByUid` を保存する

この段階で行わないこと:

- `tanks` を動かさない
- `logs` を作らない
- 在庫が戻った扱いにしない
- 返却済みとして請求・売上・集計に反映しない

理由は、顧客の入力は現物確認ではないため。返却申請は workflow の開始であり、タンク状態遷移ではない。

## Return Confirmation

返却確定とは、スタッフが確認し、実際にタンク状態を更新する段階。

この段階で行うこと:

- pending return transaction を確認する
- return tag / `condition` を確定する
- `tanks` を更新する
- `logs` を作成する
- transaction を `completed` にする
- `fulfilledByStaffId` / `fulfilledByStaffName` などのスタッフ snapshot を残す

`tanks` / `logs` / `transactions` を同時に更新する場合は、atomicity を維持する。`applyBulkTankOperations` の `extraOps` に transaction 更新を参加させる既存設計は、この目的に沿っている。

## Entry Points

### 1. portal return request

顧客ポータルからの返却申請。

期待状態遷移:

1. portal が現在貸出中タンクを表示する
2. 顧客が `normal` / `unused` / `uncharged` / `keep` を選ぶ
3. `transactions(type="return", status="pending_return")` を作る
4. `tanks` / `logs` は更新しない

### 2. manual return

スタッフが手動でタンク ID を入力して返却する入口。

期待状態遷移:

1. 現在の `tanks.status` を検証する
2. 選択された return tag から実行 action を決める
3. `applyBulkTankOperations` で `tanks` と `logs` を更新する
4. portal return transaction がない場合は `transactions` を作らない

### 3. bulk return by location

貸出先別に貸出中・未返却タンクをまとめて返却する入口。

期待状態遷移:

1. `tanks.status in ["貸出中", "未返却"]` を取得する
2. `location` ごとにグルーピングする
3. return tag を選ぶ
4. `applyBulkTankOperations` で `tanks` と `logs` を更新する

現状では `[TAG:*]` が `tanks.logNote` に一時保存される。これはすぐ削除しない。次フェーズで保存形式を変えずに変換ロジックを純粋関数へ集約する。

### 4. return request processing

portal return request をスタッフが処理する入口。

期待状態遷移:

1. `transactions(type="return", status="pending_return")` を読む
2. 処理直前に対象 `tank` の現在状態を確認する
3. `condition` から実行 action と返却後 location を決める
4. `applyBulkTankOperations` で `tanks` と `logs` を更新する
5. 同一 transaction 内で return transaction を `completed` にする
6. `finalCondition` と `fulfilledBy*` を保存する

### 5. inhouse return

自社利用中タンクを返却する入口。

期待状態遷移:

1. `tanks.status == "自社利用中"` のタンクを対象にする
2. return tag に応じて自社返却系 action を決める
3. `applyBulkTankOperations` で `tanks` と `logs` を更新する
4. `transactions` は使わない

## Return Tag / Condition

| value | 意味 | 返却確定時の扱い |
|---|---|---|
| `normal` | 通常返却。使用済みとして戻す | 空状態へ戻す |
| `unused` | 未使用返却。使われなかったタンクを戻す | 充填済みへ戻す |
| `uncharged` | 未充填返却。充填ミスとして戻す | 空状態へ戻す。破損・不良扱いではない |
| `keep` | 持ち越し。顧客が翌日以降も保持する | 未返却へ移す。倉庫へ戻さない |
| inhouse return | 自社利用中から戻す | 通常 / 未使用 / 未充填に応じた自社返却 action を使う |

`condition` は portal / transaction 側の業務入力、return tag は staff UI 側の操作選択として現れている。両者の意味は近いが、保存場所と責務が違う。

次のコード変更フェーズでは、`[TAG:*]` と `condition` の変換を純粋関数に集約する。ただし、この docs-only タスクでは実装しない。

## Forbidden Patterns

- 返却申請の時点で `tanks` / `logs` を更新しない
- `pending_return` を返却済みとして扱わない
- `keep` を倉庫返却として扱わない
- `uncharged` を破損・不良と混同しない
- return 側の `pending_return` と order 側の `pending_approval` を混同しない
- 顧客名・`location` 文字列だけを返却 workflow の正本 identity として新規設計しない

## Related Docs

- `docs/return-tag-processing-naming-design.md`
- `docs/refactor/staff-operation-service-boundary-design.md`
- `docs/refactor/firestore-write-boundary-audit.md`
