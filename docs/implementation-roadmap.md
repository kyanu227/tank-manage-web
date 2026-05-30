# Implementation Roadmap

## Purpose

この文書は、今後の実装順序を固定する。

順序の基準は、業務上の正本を安定させてから表層機能を増やすこと。返却フロー、identity context、action / status code が不安定なまま多言語対応や報酬分割へ進むと、表示名や日本語ラベル依存が固定化される。

実運用前のため、不要な legacy backfill は前提にしない。ただし、既存コード依存を無視した一括変更は避ける。

## Phase 0: Direction Docs

今回のタスクはここまで。

- `AGENTS.md` を整備する
- project direction を docs に固定する
- Firestore collection 責務を固定する
- return flow policy を固定する
- 実装コード、schema、rules、migration は変更しない

完了条件:

- `docs/project-direction.md`
- `docs/firestore-data-model-policy.md`
- `docs/return-flow-policy.md`
- `docs/implementation-roadmap.md`

## Phase 1: Return Tag / Condition Helper

- `[TAG:*]` と `condition` の変換を純粋関数に集約する
- Firestore 保存形式はまだ変えない
- 重複ロジックだけを減らす
- `normal` / `unused` / `uncharged` / `keep` の意味を1か所で説明できるようにする

この段階では `tanks.logNote` を削除しない。現行 UI が依存しているため、まず変換境界を作る。

## Phase 2: Return Flow Stabilization

- portal 返却申請と staff 返却確定を明確に分ける
- return processing service の責務を整理する
- `applyBulkTankOperations` と transaction `completed` 更新の境界を明確にする
- `transactions` / `tanks` / `logs` の atomicity を維持する

この段階で `pending_return` の意味を固定する。返却申請時点で `tanks` / `logs` を動かさない。

## Phase 3: Identity Context

- `OperationActor` を定義・維持する
- `CustomerSnapshot` を定義・維持する
- `OperationContext` を定義・維持する
- `getStaffIdentity` / `requireStaffIdentity` / `useStaffIdentity` の責務を整理する
- まだ大きな Firestore write schema 変更はしない

現行コードでは `OperationActor` / `CustomerSnapshot` / `OperationContext` は一部定義済み。今後はこれを崩さず、未接続箇所を段階的に寄せる。

## Phase 4: Operation Logging Schema

- `tank-operation.ts` を `OperationContext` に寄せる
- `logs` に `staffId` / `staffName` / `customerId` / `customerName` を安定保存する
- `logs.staff` の新規依存を減らす
- `logExtra` に正本 ID を詰め込む設計を避ける

edit / void / revision chain は壊さない。履歴表示用 snapshot と identity field を分ける。

## Phase 5: Transaction Actor Fields

- `approvedByStaffId` / `approvedByStaffName` を追加・維持する
- `fulfilledByStaffId` / `fulfilledByStaffName` を追加・維持する
- `approvedBy` / `fulfilledBy` など名前だけの field を新規設計では使わない
- order と return の status 意味を混同しない

transaction は workflow の正本であり、tank state の正本ではない。

## Phase 6: Action / Status Code

- 内部ロジックを日本語文字列から action code / status code へ移行する
- `lend` / `return` / `fill` / `inhouse_use` などを使う
- UI 表示は翻訳辞書を通す
- `action === "貸出"` や `action.includes("返却")` のような判定を増やさない

この段階までは、既存の日本語値を一括で変えない。まず新規追加を禁止し、依存箇所を棚卸ししてから移行する。

## Phase 7: Basic English Support

- 最低限、英語で貸出、返却、充填、自社使用を操作できるようにする
- 内部ロジックは action / status code を正本にする
- 日本語 UI と英語 UI は同じ domain code を参照する

多言語対応は画面ラベル置換ではない。業務ロジックから表示言語依存を外した後に進める。

### I18n UI Display Sub-Roadmap

詳細方針は `docs/i18n-ui-display-policy.md` を正本とする。

- Phase 12: i18n UI display policy docs
- Phase 13: label dictionary helper only
- Phase 14: locale selection design
- Phase 15: one low-risk UI label application
- Phase 16: minimum English operation UI

このサブロードマップでは、Firestore 保存値、Firestore query、`OP_RULES`、`tank-operation.ts` は変更しない。まず UI label と legacy 日本語保存値を分離する。

## Phase 8: Collaborators and Payout Split

- collaborators を設計する
- payout rules を設計する
- payout allocations を設計する
- `tanks` に報酬分割情報を直接混ぜない
- `logs` / `transactions` / `staffId` / `customerId` / action code が安定してから実装する

報酬分割は操作主体と業務 event の安定が前提。`staffName` や `tanks.staff` だけを根拠にしない。

## Phase 9: Cleanup

- 旧 field 依存を削除する
- 日本語文字列判定を削除する
- 重複 Firestore 書き込みを整理する
- 不要な fallback や helper を削除する
- docs と実装の差分を再確認する

cleanup は最後に行う。途中で互換削除を急ぐと、返却・顧客画面・請求系の依存を見落としやすい。

## Why This Order

最初に docs を固定するのは、何を正本とするかが曖昧なまま実装へ入ると、`tanks`, `logs`, `transactions` の責務が再び混ざるため。

返却タグの純粋関数化を先に行うのは、保存形式を変えずにリスクを下げられるため。`tanks.logNote` の削除や `tanks.location` の正規化は、その後の依存整理が終わってから判断する。

identity context と action / status code 化を多言語対応より先に置くのは、英語対応を表示ラベル置換で終わらせないため。

共同作業者・報酬分割を後半に置くのは、actor / customer / action / status が不安定な状態では正しい報酬根拠を作れないため。
