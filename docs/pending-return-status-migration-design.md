# pending return status migration design

作成日: 2026-05-04

この文書は、`transactions.type = "return"` の処理待ち status を `pending_return` に固定するための設計書である。

PR #13 / PR #14 で、顧客ポータルの return transaction は「返却申請」ではなく「顧客返却タグ transaction」、スタッフ側は「承認」ではなく「返却タグ処理」と整理済みである。PR #14 では screen / hook / function 名も `ReturnTagProcessing` 系へ rename 済みである。

PR #16 では運用中 data を前提にした両 status 読み取りを一時的に入れたが、この領域は本運用前・未実装扱いであるため、その互換層は不要である。PR #17 で return 側は `pending_return` を正とし、return 側の `pending_approval` 互換は削除する。

## 1. 目的

- return transaction の処理待ち status を業務意味に合わせて `pending_return` に固定する。
- `pending_approval` を order と return で同じ意味として扱わない。
- 未実装領域に古い互換層を残さず、return 側の概念を短く明確にする。
- 後続 PR で dashboard / count 表示を確認する時の基準を固定する。

## 2. 現状と判断

現行の旧実装では、顧客ポータルが `transactions.type = "return"` を作成する時、処理待ち status として `pending_approval` を保存していた。

ただし、return transaction の業務意味は承認待ちではない。顧客が現在貸出中のタンクに `normal` / `unused` / `uncharged` / `keep` の返却時タグを付け、スタッフが現場でそのタグを参照して実際の返却処理または持ち越し処理を行うための補助情報である。

そのため、return 側で `pending_approval` を残すと次の問題がある。

- return を「返却申請」「承認申請」と誤読させる。
- order 側の `pending_approval` と同じ意味に見える。
- `ReturnTagProcessing` 系へ rename 済みの screen / hook / function 名と意味がずれる。
- 未実装領域なのに不要な互換概念が残る。

判断:

- return 側の処理待ち status は `pending_return` を正とする。
- return 側では `pending_approval` を作成しない。
- return 側では `pending_approval` を処理待ち一覧の互換対象として読まない。
- order 側の `pending_approval` は今回対象外であり、別概念として残す。

## 3. status 方針

return transaction の処理待ち status は `pending_return` とする。

`pending_return_tag_processing` は意味としては明確だが、Firestore の status 値としては長い。画面名、hook 名、service 名、docs 内の説明では `ReturnTagProcessing` を使い、Firestore status 値は短く `pending_return` とする。

採用理由:

- 短く、query 条件や enum として扱いやすい。
- return 専用の処理待ち status だと分かる。
- `pending_approval` のように order と混同しない。
- `pending`, `pending_link`, `pending_return` の関係を読み分けやすい。

## 4. 実装方針

### 新規作成

`createPortalReturnRequests()` が作成する return transaction は `status: "pending_return"` にする。

この変更では、`type`, `tankId`, `condition`, `customerId`, `customerName`, `createdByUid`, `source` は変更しない。

### 読み取り

スタッフ側の返却タグ処理一覧は `status: "pending_return"` の return transaction だけを読む。

`transactionsRepository.getPendingReturnTags()` は `getReturns({ status: "pending_return" })` の薄い helper とする。PR #16 で一時的に入れた `pending_approval` も読む処理は、PR #17 で削除する。

### 完了処理

スタッフが返却タグ処理を実行した場合、対象 return transaction は `completed` にする。

完了時に `finalCondition`, `fulfilledAt`, `fulfilledBy*` を保存する方針は維持する。

## 5. 既存 data の扱い

この領域は本運用前・未実装扱いのため、既存 `pending_approval` return を保護するための data migration は行わない。

Firestore data の一括更新も行わない。

もし検証環境に旧 `pending_approval` return が残っている場合は、実装の互換対象として扱わず、必要に応じて個別に削除または作り直す。実運用 data として扱う必要が出た場合だけ、別タスクで件数確認と明示承認を行う。

## 6. order 側との分離

この設計は return transaction だけを対象にする。

order の `pending_approval` は今回対象外である。`transactionsRepository.getOrders`, `useOrderFulfillment`, 受注 badge, admin dashboard の order 系処理へ影響させない。

後続実装で `OrderStatus` 型や `transactions.status` 型を触る場合も、return 側の `pending_return` と order 側の `pending_approval` 整理を混ぜない。

## 7. 影響範囲

PR #17 で触る範囲:

- `src/lib/firebase/portal-transaction-service.ts`
  - return transaction 新規作成 status。
- `src/lib/firebase/repositories/transactions.ts`
  - `getPendingReturnTags()` の status query。
- docs
  - `docs/database-schema.md`
  - `docs/return-tag-processing-naming-design.md`
  - `docs/status-and-transition-purpose-audit.md`
  - `docs/tank-workflow-semantics-plan.md`

PR #17 で触らない範囲:

- order 系処理。
- admin / staff dashboard の大きな整理。
- Firestore data。
- migration script。

## 8. 禁止事項

後続実装で守ること:

- order の `pending_approval` を同じ PR で変更しない。
- screen / hook rename を再度混ぜない。
- `ReturnTagProcessing` 系の名前を approval 系へ戻さない。
- `type = "return"` を返却申請・承認申請と解釈しない。
- 顧客がタグを付けた時点で tank status を変えない。
- `keep` を返却済み扱いしない。
- `uncharged` を破損・不良扱いしない。
- Firestore data 更新を明示承認なしに行わない。

## 9. 後続 PR 案

### PR A: dashboard / count 表示の確認

admin / staff dashboard で return 処理待ち件数を表示している場合、`pending_return` が漏れないことを確認する。

order 件数と return 件数を同じ `pending_approval` として数えている箇所があれば、return と order の集計を分離する。

### PR B: 旧 return status 検出と整理方針

必要になった場合だけ、Firestore 上の `type = "return"`, `status = "pending_approval"` の件数を確認する。

本運用前の検証 data であれば、互換実装ではなく検証 data の削除または作り直しで対応する。

## 10. rollback 方針

問題が出た場合の最小 rollback は、`createPortalReturnRequests()` の新規作成 status を `pending_approval` に戻し、`getPendingReturnTags()` の読み取り status も `pending_approval` に戻すことである。

ただし、設計上の正は `pending_return` であり、rollback は一時対応として扱う。

## 11. 今回やらないこと

- order 側の `pending_approval` 変更。
- Firestore data 更新。
- migration script 作成。
- `tank-rules.ts` の変更。
- portal return の `condition` や UI 変更。
- `firestore.rules` の変更。
- `firebase.json` の変更。
- package files の変更。
- Hosting deploy。
- Security Rules deploy。
