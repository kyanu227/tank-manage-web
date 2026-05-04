# return tag processing naming design

作成日: 2026-05-04

この文書は、顧客ポータルの `return` transaction とスタッフ側の処理について、現行コード名に残っている `approval` 系の名前と、業務上の正しい意味を分けて固定するための docs-only 設計書である。

## 1. 目的

PR #13 時点の現行コードには、以下のような旧命名が残っていた。

- `pending_approval`
- `ReturnApprovalScreen`
- `useReturnApprovals`
- `fetchApprovals`
- `fulfillReturns`

これらの名前だけを見ると、顧客が「返却申請」を出し、スタッフがそれを「承認」する業務に見える。
しかし、現在の業務設計ではその解釈は正しくない。

顧客ポータルの `type = "return"` transaction は、承認申請ではない。
正しくは、顧客が現在貸出中のタンクに、返却時の扱いを示すタグを付ける補助情報である。
スタッフ側も申請を承認するのではなく、顧客が付けた返却タグを参照して、実際の返却処理または持ち越し処理を完了する。

この文書の目的は、後続 PR で screen / hook / function / status 名を整理するときに、何をどの意味へ rename するのかを先に固定することである。
今回は docs-only であり、status migration やコード rename は行わない。

## 2. 正しい業務意味

### 顧客 return transaction

`transactions.type = "return"` は、顧客返却タグ transaction として扱う。

これは以下を記録する。

- どの Customer / CustomerUser がタグを付けたか。
- どの貸出中 tankId に対するタグか。
- 返却時の扱い `condition` が何か。
- いつ顧客がタグを付けたか。

作成時点では、tank status を変更しない。
タンクはまだ顧客が保持している可能性があり、現物確認や回収も完了していないためである。

### スタッフ側の処理

スタッフ側の処理は、返却タグ処理である。

スタッフは、顧客が付けた `condition` を参照して、実際の tank operation を実行する。

| condition | 業務意味 | 実行する操作 |
|---|---|---|
| `normal` | 通常返却。使用済みとして戻す | `ACTION.RETURN` |
| `unused` | 未使用返却。使われなかったタンクを充填済みに戻す | `ACTION.RETURN_UNUSED` |
| `uncharged` | 未充填返却。未充填として戻すが、破損・不良ではない | `ACTION.RETURN_UNCHARGED` |
| `keep` | 持ち越し。顧客が未使用タンクを翌日以降も保持する | `ACTION.CARRY_OVER` |

スタッフ処理が完了した時点で、該当 transaction を `completed` にし、`finalCondition` と `fulfilledBy*` を残す。
この時点で初めて `tanks` と `logs` が更新される。

## 3. 現行コード名の読み替え表

PR #14 で screen / hook / function 名は `ReturnTagProcessing` 系へ rename 済み。
ただし、履歴や古い docs / PR 説明に旧名が出る場合は、以下の読み替えを前提に読む。

| 旧コード名 | 現在の名前 | 業務意味 | 補足 |
|---|---|---|---|
| `ReturnApprovalScreen` | `ReturnTagProcessingScreen` | 顧客返却タグを処理する画面 | PR #14 で rename 済み |
| `useReturnApprovals` | `useReturnTagProcessing` | pending return tags の取得と処理 | PR #14 で rename 済み |
| `fetchApprovals` | `fetchPendingReturnTags` | 処理待ちの顧客返却タグを取得する | PR #14 で rename 済み |
| `fulfillReturns` | `processReturnTags` | 選択した返却タグに基づき tank operation を実行する | PR #14 で rename 済み |
| `pending_approval` | return 側では使わない | 旧 status 名 | order 側の別概念として残る場合がある |
| `pending_return` | `pending_return` | return 側の正 status | 顧客返却タグの処理待ち |

`approval` という名前が履歴上または status 値として残る場合でも、業務意味として「顧客申請の承認」と解釈しない。

## 4. transaction status 方針

旧実装では return transaction の処理待ち status として `pending_approval` を使っていた。

ただし、return における `pending_approval` は承認待ちではない。
業務意味としては、顧客返却タグの処理待ちである。

現在の正 status は `pending_return` とする。

理由:

- 短く、status として扱いやすい。
- 「返却処理待ち」と読める。
- `pending` や `pending_link` と意味が重なりにくい。
- `pending_return_tag_processing` より field 値として扱いやすい。

`pending_return_tag_processing` は画面名・service 名・docs 内の説明としては明確だが、Firestore の status 値としては長い。
そのため、status は `pending_return`、画面・hook・関数名は `ReturnTagProcessing` 系に分ける。

## 5. 禁止事項

後続実装で守ること:

- 顧客 return を「返却申請」や「承認申請」と解釈しない。
- `pending_approval` を order と return で同じ意味として扱わない。
- 顧客がタグを付けた時点で tank status を変えない。
- `keep` を返却済み扱いしない。
- `keep` 処理で `location: "倉庫"` に戻さない。
- `uncharged` を破損・不良扱いしない。
- `uncharged_report` と return の `condition: "uncharged"` を同じ UI flow として混ぜない。
- status migration を screen / hook rename と同じ PR に混ぜない。

## 6. 後続 PR 方針

後続は以下の順に小さく分ける。

### PR A: screen / hook / function rename

目的は、コード名を業務意味へ近づけること。
Firestore の status 値や schema は変更しない。

候補:

- `ReturnApprovalScreen` -> `ReturnTagProcessingScreen`
- `useReturnApprovals` -> `useReturnTagProcessing`
- `fetchApprovals` -> `fetchPendingReturnTags`
- `fulfillReturns` -> `processReturnTags`

この PR では `pending_approval` はまだ維持した。
import / export / component 名の rename と、画面内の表示文言整理だけに絞った。

実施状況: PR #14 で実施済み。
`pending_approval` status migration は PR #17 で return 側だけ `pending_return` に一本化済み。

### PR B: return status migration design

目的は、return transaction 側だけ `pending_approval` を `pending_return` へ移行する設計を固めること。
ここでは query、admin dashboard、staff dashboard、repository 型への影響を確認する。

候補:

- 新規 return transaction は `pending_return` で作る。
- return の処理待ち読み取りは `pending_return` だけを見る。
- 本運用前・未実装扱いのため、return 側に旧 status 互換を残さない。
- order 側の `pending_approval` 互換をどう扱うかは別に確認する。

実施状況: PR #15 で `docs/pending-return-status-migration-design.md` を追加し、移行設計を固定済み。
PR #16 では一時的に両 status 読み取りを入れたが、PR #17 で不要として整理し、return 側は `pending_return` に一本化済み。

### PR C: UI 文言整理

目的は、スタッフ画面や docs の表示文言から「承認」を減らし、「返却タグ処理」「返却処理」へ寄せること。

ただし、文言だけを先に変えて業務処理が変わったように見せない。
画面名・hook 名・status 名との整合を見ながら小さく進める。

## 7. status migration で混ぜないこと

PR #14 で screen / hook / function rename は完了済みである。
後続の `pending_return` status migration では、次を同じ PR に混ぜない。

- screen / hook / function rename の再実施。
- `ReturnTagProcessing` 系の名前を approval 系へ戻すこと。
- `transactions` の既存データ更新。
- `firestore.rules` の変更。
- `firebase.json` の変更。
- package files の変更。
- Hosting deploy。
- Security Rules deploy。

## 8. 関連 docs との関係

本書は、以下の既存 docs の return 部分を補足する。

- `docs/tank-workflow-semantics-plan.md`
- `docs/status-and-transition-purpose-audit.md`
- `docs/database-schema.md`

既存 docs に `返却申請`、`返却承認`、`approval` 系の旧名が残っている場合でも、それは履歴上の旧実装名または現行 status 値を指す名前である。
業務意味としては、本書の「顧客返却タグ transaction」と「スタッフによる返却タグ処理」を正とする。
