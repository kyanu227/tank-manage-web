# pending return status migration design

作成日: 2026-05-04

この文書は、`transactions.type = "return"` の処理待ち status を、現行互換の `pending_approval` から業務意味に合う `pending_return` へ移行するための docs-only 設計書である。

PR #13 / PR #14 で、顧客ポータルの return transaction は「返却申請」ではなく「顧客返却タグ transaction」、スタッフ側は「承認」ではなく「返却タグ処理」と整理済みである。PR #14 では screen / hook / function 名も `ReturnTagProcessing` 系へ rename 済みである。

今回固定するのは status migration の設計だけであり、コード変更、Firestore data 更新、migration script 作成、deploy は行わない。

## 1. 目的

- return transaction の処理待ち status 名を業務意味に合わせる。
- `pending_approval` を order と return で同じ意味として扱わない。
- 既存未処理 return data を壊さず、新規作成を `pending_return` へ寄せる移行順を固定する。
- 後続 PR で repository / service / UI を小さく変更できるよう、読み取り互換と rollback 方針を先に決める。

## 2. 現状

現行コードでは、顧客ポータルが `transactions.type = "return"` を作成する時、処理待ち status として `pending_approval` を保存している。

ただし、return transaction の業務意味は承認待ちではない。顧客が現在貸出中のタンクに `normal` / `unused` / `uncharged` / `keep` の返却時タグを付け、スタッフが現場でそのタグを参照して実際の返却処理または持ち越し処理を行うための補助情報である。

そのため、`pending_approval` という名前は次の問題を持つ。

- return を「返却申請」「承認申請」と誤読させる。
- order 側の `pending_approval` と同じ意味に見える。
- `ReturnTagProcessing` 系へ rename 済みの screen / hook / function 名と意味がずれる。

## 3. 新 status

return transaction の新しい処理待ち status は、`pending_return` を第一候補として採用する。

`pending_return_tag_processing` は意味としては明確だが、Firestore の status 値としては長い。画面名、hook 名、service 名、docs 内の説明では `ReturnTagProcessing` を使い、Firestore status 値は短く `pending_return` とする。

採用理由:

- 短く、query 条件や enum として扱いやすい。
- return 専用の処理待ち status だと分かる。
- `pending_approval` のように order と混同しない。
- `pending`, `pending_link`, `pending_return` の関係を読み分けやすい。

## 4. 移行方針

後続実装では、段階的に進める。

### Phase 1: 読み取り互換を先に入れる

スタッフ側の返却タグ処理一覧は、移行期間中 `pending_approval` と `pending_return` の両方を読む。

この段階では、新規作成 status はまだ `pending_approval` のままでもよい。先に読み取り側を両対応にすることで、次の新規作成 status 変更を安全に受けられる。

実施状況: PR #16 で `transactionsRepository.getPendingReturnTags()` を追加し、スタッフ側の `useReturnTagProcessing.fetchPendingReturnTags()` が `pending_approval` と `pending_return` の両方を読めるようにした。新規作成 status はまだ変更していない。

### Phase 2: 新規作成を `pending_return` に変更する

`portal-transaction-service.ts` の return transaction 作成 status を `pending_return` へ変更する。

この時点でもスタッフ側は `pending_approval` と `pending_return` の両方を読むため、既存未処理 data と新規 data が混在しても処理できる。

### Phase 3: 完了処理は両 status から `completed` へ進める

スタッフが返却タグ処理を実行した場合、元の status が `pending_approval` でも `pending_return` でも、完了時は `completed` にする。

完了時に `finalCondition`, `fulfilledAt`, `fulfilledBy*` を保存する方針は維持する。

### Phase 4: 旧 status 読み取りを削るか検討する

運用上、未処理の `pending_approval` return が自然消化された後、旧 status 読み取りを削るか検討する。

削る前に、Firestore 上で `type = "return"` かつ `status = "pending_approval"` の残件数を確認する。残件がある状態で旧 status 読み取りを削らない。

## 5. 既存データの扱い

運用中に未処理の `pending_approval` return がある可能性がある。

選択肢は2つある。

| 方針 | 内容 | 利点 | 注意 |
|---|---|---|---|
| 読み取り互換で自然消化 | 既存 data は更新せず、スタッフ処理時に `completed` へ進める | data 更新リスクが低い。rollback しやすい | しばらく両 status 読み取りが必要 |
| 一括更新 | 既存 `pending_approval` return を `pending_return` へ更新する | data が早く揃う | cloud data 変更の失敗時 rollback が重い。対象確認と承認が必要 |

推奨は、最初は読み取り互換で自然消化することである。

一括更新が必要な場合は、別タスクとして扱う。実行前に次を必須にする。

- 対象件数確認。
- 対象 transaction id 一覧の記録。
- 更新前 backup または rollback 手順の明記。
- ユーザーの明示承認。
- 実行後の残件確認。

## 6. order 側との分離

この設計は return transaction だけを対象にする。

order の `pending_approval` は今回対象外である。`transactionsRepository.getOrders`, `useOrderFulfillment`, 受注 badge, admin dashboard の order 系処理へ影響させない。

後続実装で `OrderStatus` 型や `transactions.status` 型を触る場合も、return 側の `pending_return` 追加と order 側の `pending_approval` 整理を混ぜない。

## 7. 影響範囲

後続実装で確認する範囲:

- `src/lib/firebase/portal-transaction-service.ts`
  - return transaction 新規作成 status。
- `src/lib/firebase/repositories/transactions.ts`
  - `getReturns` または return 専用 helper の status query。
- `src/features/staff-operations/hooks/useReturnTagProcessing.ts`
  - `fetchPendingReturnTags()` の読み取り status。
- staff dashboard / admin dashboard
  - return の処理待ち件数を表示している場合の status 条件。
- docs
  - `docs/database-schema.md`
  - `docs/return-tag-processing-naming-design.md`
  - verification docs。

## 8. 禁止事項

後続実装で守ること:

- order の `pending_approval` を同じ PR で変更しない。
- screen / hook rename を再度混ぜない。
- `ReturnTagProcessing` 系の名前を approval 系へ戻さない。
- `type = "return"` を返却申請・承認申請と解釈しない。
- 顧客がタグを付けた時点で tank status を変えない。
- `keep` を返却済み扱いしない。
- `uncharged` を破損・不良扱いしない。
- migration script を docs-only PR に混ぜない。
- Firestore data 更新を明示承認なしに行わない。

## 9. 後続 PR 案

### PR A: repository / query 互換追加

return status を `pending_approval | pending_return` の両方で読める helper を追加する。

既存の `getReturns({ status })` を拡張するか、return 専用に `getPendingReturnTags()` のような helper を作るかは実装時に判断する。目的は、スタッフ側の返却タグ処理一覧が両 status を漏れなく表示することである。

実施状況: PR #16 で実施済み。

### PR B: portal return 新規作成 status 変更

`createPortalReturnRequests()` が作成する return transaction の status を `pending_return` に変更する。

この PR では、読み取り互換が先に入っていることを前提にする。

### PR C: dashboard / count 表示の互換確認

admin / staff dashboard で return 処理待ち件数を表示している場合、`pending_return` が漏れないことを確認する。

order 件数と return 件数を同じ `pending_approval` として数えている箇所があれば分離する。

### PR D: 旧 status 読み取り削除検討

自然消化後、`type = "return"`, `status = "pending_approval"` の残件がないことを確認してから、旧 status 読み取りを削るか検討する。

削除は必須ではない。互換読み取りを残す方が運用上安全なら、その判断を docs に残す。

## 10. rollback 方針

新規作成 status を `pending_return` に変えた後に問題が出た場合、最小 rollback は新規作成 status を `pending_approval` に戻すことである。

読み取り互換を先に入れておけば、`pending_approval` と `pending_return` の両方を表示できるため rollback しやすい。

既存 data を一括更新しない限り、rollback 時に cloud data の戻しは不要である。

## 11. 今回やらないこと

- `src/**` の変更。
- `transactions.status` の実装変更。
- `pending_approval` のコード変更。
- 既存 Firestore data 更新。
- migration script 作成。
- `firestore.rules` の変更。
- `firebase.json` の変更。
- package files の変更。
- Hosting deploy。
- Security Rules deploy。
