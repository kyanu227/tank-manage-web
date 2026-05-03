# status / transition purpose audit

作成日: 2026-05-03

タンク管理アプリ内に存在する `status` / `action` / `type` / `tag` / `condition` の業務目的を棚卸しする監査台帳。
コードに `purpose` コメントや metadata を追加する前に、人間が確認できる docs として意味を固定する。

## 1. 目的

この台帳の目的は、同じ `status` という名前で呼ばれている別レイヤーの概念を混ぜないことにある。

- `tanks.status` は物理タンクの現在状態。
- `transactions.status` は顧客申請・受注・報告の処理状態。
- `logs.logStatus` は操作履歴 revision の状態。
- `customerUsers` の status はポータル利用者の setup / 紐付け / 無効状態。
- `staff.isActive` や `role` はアカウント・権限状態。

これらを混ぜると、AI / Codex が既存コード名から勝手に業務意味を推測し、返却、未充填、破損、不良、未返却の扱いを誤る。
本書は、その誤解を防ぐための目的台帳である。

## 2. 監査対象

| レイヤー | 主なファイル | 主な用途 |
|---|---|---|
| Tank lifecycle status | `src/lib/tank-rules.ts`, `src/lib/tank-operation.ts` | 物理タンクの現在状態 |
| Tank action / transition | `src/lib/tank-rules.ts`, `src/features/staff-operations/**` | タンク状態を変える業務操作 |
| Return tag / condition | `src/lib/tank-rules.ts`, `src/features/staff-operations/types.ts`, `src/app/portal/return/page.tsx` | 返却時の扱いを示すタグ |
| Transaction type | `src/lib/firebase/repositories/types.ts`, `src/lib/firebase/portal-transaction-service.ts` | 顧客起点 transaction の種類 |
| Transaction status | `src/lib/order-types.ts`, `src/lib/firebase/portal-transaction-service.ts`, `src/features/staff-operations/hooks/*` | transaction の処理状態 |
| Log revision status | `src/lib/tank-operation.ts`, `src/lib/firebase/repositories/types.ts` | 操作ログ revision chain の状態 |
| CustomerUser derived status | `src/lib/firebase/customer-user.ts` | ポータル利用者の派生状態 |
| Staff / admin status | `src/lib/firebase/staff-auth.ts`, `src/app/admin/staff/page.tsx`, `src/app/admin/permissions/page.tsx` | スタッフ有効無効・権限 |

## 3. 判定基準

| 判定 | 意味 |
|---|---|
| 正しい | 業務意味と現行名がおおむね一致している。後続で目的 metadata を入れてもよい候補 |
| 名称変更候補 | 業務概念は必要だが、現行名が誤解を招く |
| 廃止候補 | 業務概念として残す必要が薄い、または別概念へ統合した方がよい |
| 要確認 | 業務判断が未確定、または現行コードと業務意味のズレが大きい |

集計:

| 判定 | 件数 |
|---|---:|
| 正しい | 41 |
| 名称変更候補 | 5 |
| 廃止候補 | 1 |
| 要確認 | 0 |

合計 47 件。
この件数は 4 章から 11 章の台帳項目のみを数え、後半の現行コードとの差分表は含めない。

## 4. Tank lifecycle status

`tanks.status` は物理タンクの現在状態である。
transaction の処理状態や log revision 状態と混ぜない。

| 現在のコード上の名前 | 業務上の意味 | 何を守るために存在するか | いつ入るか / 誰の操作か | 次に進む先 | logs に残すべき情報 | transactions に残すべき情報 | billing / incentive | やってはいけない遷移 | 判定 / 理由 |
|---|---|---|---|---|---|---|---|---|---|
| `STATUS.FILLED` / `充填済み` | 貸出可能なタンク | 貸出できる在庫だけを選べるようにする | 充填完了、未使用返却、自社返却(未使用) / staff | `貸出中`, `自社利用中`, `破棄` | 充填者、操作日時、前後 status | 受注貸出時は order 完了に関係 | 貸出・充填報酬、請求の起点 | 空や破損から貸出済み扱いにしない | 正しい。物理状態として必要 |
| `STATUS.EMPTY` / `空` | 充填待ち | 未充填のタンクを貸出対象から外す | 通常返却、未充填返却、修理済み、耐圧検査完了 / staff | `充填済み`, `破棄` | 返却種別、回収者、顧客 snapshot | return 完了時に finalCondition を残す | 通常返却は請求対象、未使用・未充填は請求除外候補 | `空` から直接貸出しない | 正しい。貸出可否を守る |
| `STATUS.LENT` / `貸出中` | 顧客が保持している使用予定中または使用中の状態 | 顧客保持中のタンクを在庫から外し、返却・未充填対象にする | 貸出、受注貸出 / staff | `空`, `充填済み`, `未返却` | customerId, customerName, location, 貸出担当 | order completed と紐付ける | 請求対象の起点、貸出報酬 | 直接 `破損` / `破棄` にしない | 正しい。物理タンクの中核状態 |
| `STATUS.UNRETURNED` / `未返却` | 顧客が持ち越し、または返却予定を過ぎても戻っていない状態 | 顧客保持の継続を在庫・回収対象として見えるようにする | `持ち越し` action 追加候補 / staff または自動判定 | `空`, `充填済み` | 元貸出、持ち越し理由、期限、担当 | return tag があるなら reference を残す | 請求・督促・在庫集計に関係 | `未返却` を在庫扱いしない | 正しい。action 名は `持ち越し`、status 名は `未返却` |
| `STATUS.IN_HOUSE` / `自社利用中` | 自社が保持・使用している状態 | 顧客請求・顧客在庫と分離する | 自社利用 / staff | `空`, `充填済み` | 利用者、目的、返却種別 | 原則なし | 報酬・請求対象外 | 顧客貸出と混同しない | 正しい。顧客業務から分離するため必要 |
| `STATUS.DAMAGED` / `破損` | タンク自体の不具合報告がある状態 | 修理・点検対象を通常在庫から外す | 破損報告 / staff。貸出中は報告記録だけ先に残す方針 | `空` または `破棄` | 不具合タグ、報告者、回収時状態 | 顧客報告が transaction 化される場合は reference | 修理・責任追跡に関係。通常請求とは分離 | 未充填報告を破損にしない | 正しい。ただしタグ設計が必要 |
| `STATUS.DEFECTIVE` / `不良` | 名前が曖昧。タンク不具合、未充填、準備不備のどれにも読める | 現状では守る対象が不明確 | 現行では修理済みの元 status に含まれる | `空` | 不具合詳細がないと意味が残らない | 原則なし | 未充填・破損・請求除外を混同する恐れ | 未充填と同一視しない | 廃止候補。新規設計では廃止方針。`破損` + 不具合タグへ寄せる |
| `STATUS.DISPOSED` / `破棄` | 廃棄済みで業務サイクルに戻らない状態 | 存在するが使えないタンクを通常操作から外す | 破棄 / staff or admin | 原則なし | 破棄理由、操作者、前 status | 原則なし | 在庫・資産管理に関係 | `貸出中` / `未返却` から直接破棄しない | 正しい。ただし allowedPrev 制限が必要 |

## 5. Tank action / transition

`ACTION` はタンク状態を変える業務操作である。
`RETURN_TAG` や transaction status とは別レイヤーとして扱う。

| 現在のコード上の名前 | 業務上の意味 | 何を守るために存在するか | いつ入るか / 誰の操作か | 次に進む先 | logs に残すべき情報 | transactions に残すべき情報 | billing / incentive | やってはいけない遷移 | 判定 / 理由 |
|---|---|---|---|---|---|---|---|---|---|
| `ACTION.LEND` / `貸出` | 充填済みタンクを顧客へ貸し出す | 貸出可能在庫だけを顧客保持へ移す | 手動貸出または受注貸出 / staff | `充填済み -> 貸出中` | staff, customerId, customerName, location, transactionId | order fulfilled fields | 貸出報酬・請求起点 | `空`, `破損`, `破棄` から貸出しない | 正しい |
| `ACTION.RETURN` / `返却` | 使用済みとして回収する | 顧客保持を解消し、充填待ちに戻す | 返却処理 / staff | `貸出中`, `未返却`, `自社利用中 -> 空` | 返却者、回収元、condition | return completed / finalCondition | 通常請求・返却報酬 | 未貸出タンクを返却しない | 正しい |
| `ACTION.RETURN_UNUSED` / `未使用返却` | 使用されなかったタンクを充填済みへ戻す | 不要な充填作業・請求を避ける | 返却処理 / staff | `貸出中`, `未返却`, `自社利用中 -> 充填済み` | unused tag, 回収元 | finalCondition `unused` | 請求除外、返却報酬は要設計 | 使用済みを未使用扱いしない | 正しい |
| `ACTION.RETURN_DEFECT` / `返却(未充填)` | 未充填として戻ったタンクを空へ戻す | 未充填を破損ではなく業務不備として記録する | 返却処理 / staff | `貸出中`, `未返却`, `自社利用中 -> 空` | unfilled / uncharged tag, 直前充填者追跡用情報 | uncharged_report とは別に finalCondition | 充填報酬取消、請求除外 | `破損` status にしない | 名称変更候補。内部名 `DEFECT` が誤解を招く |
| `ACTION.FILL` / `充填` | 空タンクを貸出可能にする | 貸出可能在庫を増やす | 充填作業 / staff | `空 -> 充填済み` | 充填者、時刻 | 原則なし | 充填報酬、未充填時の責任追跡 | `貸出中` を直接充填しない | 正しい |
| `ACTION.IN_HOUSE_USE` / `自社利用` | 自社で使うために持ち出す | 顧客貸出・請求と分離する | staff | `充填済み -> 自社利用中` | staff, purpose | 原則なし | 請求対象外 | 顧客貸出と混同しない | 正しい |
| `ACTION.IN_HOUSE_USE_RETRO` / `自社利用(事後)` | 事後入力で自社利用を記録する | 入力漏れ救済をしつつ、状態を壊さない | staff | `充填済み -> 自社利用中` | 事後入力理由、staff | 原則なし | 請求対象外 | 制限なしにしない | 正しい。現行 allowedPrev 無制限は後続 PR で制限する |
| `ACTION.IN_HOUSE_RETURN` / `自社返却` | 自社使用済みを空に戻す | 自社利用中を在庫サイクルへ戻す | staff | `自社利用中 -> 空` | staff, note | 原則なし | 請求対象外 | 顧客貸出から自社返却しない | 正しい |
| `ACTION.IN_HOUSE_RETURN_UNUSED` / `自社返却(未使用)` | 自社未使用分を充填済みに戻す | 充填済み在庫へ戻す | staff | `自社利用中 -> 充填済み` | unused tag | 原則なし | 請求対象外 | 使用済みを未使用扱いしない | 正しい |
| `ACTION.IN_HOUSE_RETURN_DEFECT` / `自社返却(不備)` | 自社利用で未充填・不備扱いとして戻す | 自社分の不備記録を残す | staff | `自社利用中 -> 空` | unfilled / defect tag | 原則なし | 報酬取消など要確認 | 破損と混同しない | 名称変更候補。`不備` の意味が広い |
| `ACTION.DAMAGE_REPORT` / `破損報告` | タンク自体の不具合を報告する | 修理・点検対象を通常在庫から外す | 現物回収後・スタッフ確認後 / staff | 手元状態 -> `破損` | 不具合タグ、報告者、前 status | 顧客ポータルからの破損 transaction は作らない前提 | 責任追跡に関係 | `貸出中` / `未返却` から直接破損にしない | 正しい。顧客からの破損報告は受けず、回収後に staff が記録する |
| `ACTION.REPAIRED` / `修理済み` | 修理後に通常サイクルへ戻す | 修理済みタンクを充填待ちへ戻す | staff | `破損 -> 空` | 修理内容、staff | 原則なし | 修理管理に関係 | 未修理のまま戻さない | 正しい |
| `ACTION.INSPECTION` / `耐圧検査完了` | 検査完了後に空へ戻す | 検査対象を通常サイクルへ戻す | staff | `耐圧検査中` または検査対象一覧 -> `空` | 検査日、次回期限 | 原則なし | 法定管理に関係 | どの状態からでも完了扱いにしない | 正しい。`耐圧検査中` は追加候補 / 後続設計対象 |
| `ACTION.DISPOSE` / `破棄` | タンクを業務サイクルから外す | 廃棄済みを通常操作から除外する | staff / admin | `空`, `充填済み`, `破損 -> 破棄` | 破棄理由、staff | 原則なし | 資産・在庫管理 | `貸出中` / `未返却` から直接破棄しない | 正しい。ただし現行 allowedPrev 無制限は後続 PR で制限する |
| 追加候補 `持ち越し` | 顧客が未使用タンクを翌日以降も保持することを記録する | 未返却・持ち越しを在庫と返却対象に残す | staff または日次確認 | `貸出中 -> 未返却` | 元貸出、理由、期限 | return tag と紐付けるなら reference | 請求・督促・在庫集計 | 返却済みを未返却にしない | 正しい。action 名は `持ち越し`、status 名は `未返却` |

## 6. Return tag / condition

返却タグは、返却時の扱いを示す補助情報である。
tank status そのものではなく、返却 operation を選ぶための入力である。

| 現在のコード上の名前 | 業務上の意味 | 何を守るために存在するか | いつ入るか / 誰の操作か | 次に進む先 | logs に残すべき情報 | transactions に残すべき情報 | billing / incentive | やってはいけない遷移 | 判定 / 理由 |
|---|---|---|---|---|---|---|---|---|---|
| `normal` | 通常返却 | 使用済みとして空へ戻す | portal return, staff return / customer or staff | `ACTION.RETURN` | condition normal | return finalCondition normal | 通常請求対象 | 未使用・未充填と混同しない | 正しい |
| `unused` | 未使用返却 | 未使用分を充填済みに戻し、請求を避ける | portal return, staff return / customer or staff | `ACTION.RETURN_UNUSED` | `[TAG:unused]` | condition / finalCondition unused | 請求除外 | 使用済みを unused にしない | 正しい |
| `defect` | 現行では未充填返却を表す | 未充填を回収時に区別する | staff return tag / staff | `ACTION.RETURN_DEFECT` | `[TAG:defect]` だが名称見直し候補 | finalCondition uncharged へ寄せたい | 充填報酬取消、請求除外 | 破損・不良と混同しない | 名称変更候補。`defect` は破損に見える |
| `keep` | 持ち越し。返却申請から除外する | 使わないが顧客が保持するタンクを返却対象から外す | portal return / customer | 将来 `貸出中 -> 未返却` 候補 | 持ち越し理由や期限を残す候補 | 現行では transaction を作らない | 在庫・督促・請求要確認 | 返却済み扱いにしない | 正しい。ただし明示 action 追加候補 |
| `uncharged` | 未充填。staff return approval 側の condition | 未充填を finalCondition として明確化する | staff processing UI / staff | `ACTION.RETURN_DEFECT` 相当。後続で `RETURN_UNCHARGED` 候補 | uncharged tag | finalCondition uncharged | 充填報酬取消、請求除外 | 破損 status にしない | 正しい。`defect` との混在は名称変更 PR で整理する |

## 7. Transaction type

`transactions.type` は顧客起点の申請・受注・報告の種類である。
tank lifecycle status ではない。

| 現在のコード上の名前 | 業務上の意味 | 何を守るために存在するか | いつ入るか / 誰の操作か | 次に進む先 | logs に残すべき情報 | transactions に残すべき情報 | billing / incentive | やってはいけない遷移 | 判定 / 理由 |
|---|---|---|---|---|---|---|---|---|---|
| `order` | 顧客からのタンク発注 | 受注と貸出処理を紐付ける | portal order / CustomerUser | status flow で進む | 貸出時に transactionId | items, customerId, createdByUid, requested* | 貸出・請求に関係 | 未紐付けを通常受注へ混ぜない | 正しい |
| `return` | 顧客の返却予定タグ | 回収処理の補助情報を残す | portal return / CustomerUser | status flow で進む | staff 処理時に finalCondition | tankId, condition, customerId, createdByUid | 請求・返却処理に関係 | tank status を作成時に変えない | 正しい |
| `uncharged_report` | 顧客からの未充填報告 | 未充填の事実を記録する | portal unfilled / CustomerUser | 原則 completed で完了 | 必要なら追跡 log と紐付け | tankId, customerId, createdByUid | 請求除外・報酬取消に関係 | 対応待ち task と混ぜない | 正しい |

## 8. Transaction status

`transactions.status` は transaction の処理状態であり、物理タンク状態ではない。

| 現在のコード上の名前 | 業務上の意味 | 何を守るために存在するか | いつ入るか / 誰の操作か | 次に進む先 | logs に残すべき情報 | transactions に残すべき情報 | billing / incentive | やってはいけない遷移 | 判定 / 理由 |
|---|---|---|---|---|---|---|---|---|---|
| `pending_link` | Customer 未確定の仮受注 | 未紐付け注文を失わず、通常処理から隔離する | unlinked order / CustomerUser | `pending` | まだ tank log は作らない | requested*, createdByUid, customerId null | 通常請求・貸出対象外 | 通常 badge / 通常受注一覧に混ぜない | 正しい |
| `pending` | Customer 確定後の通常受注 | staff が確認できる通常受注として扱う | linked order or linking promotion | `approved` | まだ tank log は作らない | customerId, customerName, requested* | 貸出準備対象 | Customer 未確定のまま pending にしない | 正しい |
| `pending_approval` | 現行では order / return の承認待ちに混在 | 処理待ちを表すが名前が広すぎる | 旧 order / return request | order は `approved`, return は `completed` | 処理完了時に logs | type ごとの意味を分けて残す | type により異なる | order と return を同じ意味で扱わない | 名称変更候補。新規 order では使わない。return は `pending_return` 推奨 |
| `approved` | order が貸出処理待ち | 承認済み受注と未承認受注を分ける | staff order approval | `completed` | 貸出時に tank logs | approvedByStaff* | 貸出準備に関係 | customerId なしで approved にしない | 正しい |
| `completed` | transaction の業務処理が完了 | 完了済みを pending から外す | order fulfilment, return fulfilment, uncharged_report record | 原則終端 | order / return は operation logs と紐付く | fulfilledByStaff* or record fields | 請求・報酬・集計に関係 | 未処理のまま completed にしない | 正しい |

## 9. Log revision status

`logs.logStatus` は操作履歴 revision chain の状態である。
tank status や transaction status と混ぜない。

| 現在のコード上の名前 | 業務上の意味 | 何を守るために存在するか | いつ入るか / 誰の操作か | 次に進む先 | logs に残すべき情報 | transactions に残すべき情報 | billing / incentive | やってはいけない遷移 | 判定 / 理由 |
|---|---|---|---|---|---|---|---|---|---|
| `active` | 現在有効な履歴 revision | 表示・集計対象の正本を一つにする | 新規 operation または修正後 revision | `superseded` / `voided` | rootLogId, revision, snapshots | 原則なし | 集計対象 | active を複数残さない | 正しい |
| `superseded` | 新 revision に置き換えられた履歴 | 過去修正の監査証跡を残す | log correction / staff with権限 | 終端 | supersededByLogId, editedByStaff* | 原則なし | 集計対象外 | 物理状態に使わない | 正しい |
| `voided` | 無効化された履歴 | 誤操作を消さずに無効化する | void operation / staff with権限 | 終端 | voidedByStaff*, voidReason | 原則なし | 集計対象外 | delete で消さない | 正しい |

## 10. CustomerUser derived status

CustomerUser status は `computeCustomerUserStatus()` で派生する。
Firestore に `status` を正本として保存しない方針を維持する。

| 現在のコード上の名前 | 業務上の意味 | 何を守るために存在するか | いつ入るか / 誰の操作か | 次に進む先 | logs に残すべき情報 | transactions に残すべき情報 | billing / incentive | やってはいけない遷移 | 判定 / 理由 |
|---|---|---|---|---|---|---|---|---|---|
| `pending_setup` | 初期設定未完了 | 自己申告情報がない状態で portal 利用を進めない | Auth 登録直後 / CustomerUser | `pending` or `disabled` | 原則なし | 原則なし | なし | setup 未完了で return/unfilled を使わせない | 正しい |
| `pending` | setup 済みだが Customer 未紐付け | 発注は仮受付、返却・未充填は止める | setup 完了後 / CustomerUser | `active` or `disabled` | 原則なし | order は `pending_link` | 通常請求対象外 | 通常顧客として扱わない | 名称変更候補。推奨名は `unlinked`。transaction `pending` / `pending_link` と混ぜない |
| `active` | Customer に紐付いた利用可能ユーザー | portal の通常機能を許可する | admin linking / staff-admin | `disabled` or `pending` if unlink | linking actor を記録候補 | pending_link promotion | 請求・履歴に関係 | customerId なしで active にしない | 正しい |
| `disabled` | 利用停止 | 無効ユーザーの portal 利用を止める | admin operation | `pending_setup`, `pending`, `active` への復帰は要確認 | disabled actor を記録候補 | 原則なし | なし | disabled を無視してログインさせない | 正しい |

## 11. Staff / admin status

staff / admin 系は業務状態ではなく、アカウント・権限状態である。

| 現在のコード上の名前 | 業務上の意味 | 何を守るために存在するか | いつ入るか / 誰の操作か | 次に進む先 | logs に残すべき情報 | transactions に残すべき情報 | billing / incentive | やってはいけない遷移 | 判定 / 理由 |
|---|---|---|---|---|---|---|---|---|---|
| `staff.isActive` / `staffByEmail.isActive` | スタッフがログイン・操作可能か | 無効スタッフの操作を止める | admin staff 管理 | true / false | 操作するなら edit_history 候補 | 操作者として使う場合は staffId snapshot | 報酬集計対象の確認に関係 | inactive staff に操作させない | 正しい |
| `staff.role` | 管理者・準管理者・一般などの権限 | 管理画面・修正権限を制御する | admin staff 管理 | role change | role 変更履歴候補 | 操作時 snapshot は任意 | 権限、修正可否 | role を業務状態として使わない | 正しい |
| `staff.rank` | 報酬・ランク計算用の分類 | incentive 計算の前提を持つ | admin staff 管理 | rank change | rank 変更履歴候補 | 原則なし | 報酬に関係 | 権限判定に使わない | 正しい |
| `customers.isActive` | 顧客マスタの利用可否 | 停止顧客を新規貸出先から外す | admin customer 管理 | true / false | customer edit_history 候補 | 既存 transaction は当時 snapshot 維持 | 請求・新規貸出に関係 | 過去 logs を一括変更しない | 正しい |

## 12. 特に明記する分離

- `貸出中` は tank lifecycle status。
- `pending` は transaction workflow status または CustomerUser derived status であり、レイヤーを見ないと意味が違う。
- `active` / `superseded` / `voided` は log revision status。顧客やスタッフの有効無効ではない。
- `pending_approval` は order と return に混在しており、名称変更または廃止候補。return 側は `pending_return` 推奨。
- `不良` は名称が悪く、新規設計では廃止方針。タンク不具合は `破損` + 不具合タグへ寄せる。
- 未充填は破損ではなく、こちら側の充填ミス・準備不備の記録。
- `location` は発注時の配達先ではなく、現行コードではタンクの現在の貸出先・現在保持者の表示 snapshot。
- `deliveryTargetName` は発注ごとの配達先であり、毎回変わるため Customer や tank の正本にしない。

## 13. 現行コードとの差分

| 差分 | 現行 | 台帳上の判断 |
|---|---|---|
| `pending_approval` | order / return に混在 | 新規 order では使わない。return は `pending_return` 推奨 |
| `RETURN_TAG.DEFECT` | 未充填返却として使われる | `defect` は破損に見えるため名称変更候補。`RETURN_UNCHARGED` が有力 |
| `STATUS.DEFECTIVE` | `不良` として存在 | 新規設計では廃止方針。`破損` + 不具合タグへ寄せる |
| `DAMAGE_REPORT.allowedPrev` | 制限なし | 貸出中 / 未返却から直接変更しない方針 |
| `DISPOSE.allowedPrev` | 制限なし | 空 / 充填済み / 破損などに制限する方針 |
| `IN_HOUSE_USE_RETRO.allowedPrev` | 制限なし | `充填済み -> 自社利用中` に制限する方針 |
| `INSPECTION.allowedPrev` | 制限なし | `耐圧検査中` status は追加候補 / 後続設計対象 |
| `UNRETURNED` | status はあるが明示 action がない | `持ち越し` action 追加候補。status は `未返却` |
| `customerUsers.status` | 型にはあるが Firestore 保存しない方針 | 派生状態として扱う。`pending` は将来 `unlinked` 推奨 |
| `location` | 現在場所・貸出先・保持者を表す文字列 | `deliveryTargetName` とは別。将来 `currentHolderNameSnapshot` / `currentLocationNameSnapshot` 候補 |

## 14. 判断済み事項と後続設計対象

人間レビューで以下を判断済みとする。

1. `不良` は新規設計では廃止方針。
   - バルブが固い、空気漏れ、外傷などは `破損` + 不具合タグへ寄せる。
   - 未充填は `破損` でも `不良` でもない。
2. `RETURN_DEFECT` / `RETURN_TAG.DEFECT` は未充填系の名前へ変える候補。
   - 既存 `uncharged_report` と揃えるなら `RETURN_UNCHARGED` が有力。
   - 最終命名は後続実装時に決める。
3. UI / 業務上の action 名は `持ち越し`、tank status は `未返却`。
4. 貸出中の破損連絡で直接 `破損` status へ変更する設計は採用しない。
   - 顧客ポータルからの破損報告は受けない前提。
   - 破損はスタッフが回収後・現物確認後に記録する。
5. `耐圧検査中` は正式な tank status 追加候補として残す。
   - 通常業務から除外する必要があるなら tank status 化が自然。
   - 単なる期限管理・対象抽出なら、検査対象一覧や画面側 gate でも制御できる。
6. `CustomerUserStatus.pending` は名称変更候補。
   - 推奨名は `unlinked`。
   - `pending_link` は transaction 側の仮受注 status なので CustomerUser 側には使わない。
7. `location` は現在の貸出先・現在保持者の表示 snapshot として扱う。
   - `deliveryTargetName` とは別概念。
   - 将来名候補は `currentHolderNameSnapshot` / `currentLocationNameSnapshot`。
8. `自社利用(事後)` は `充填済み -> 自社利用中` に制限する。
   - 旧データ救済や入力漏れ救済のために無制限遷移を残す設計は採用しない。

後続設計対象:

1. `耐圧検査中` を正式な tank status に追加するか。
   - 通常業務から除外する必要があるなら tank status 化が自然。
   - 単なる期限管理・対象抽出なら、検査対象一覧や画面側 gate でも制御できる。

## 15. 次に実装すべき最小 PR

次の実装は、まだ `purpose` metadata 追加ではなく、業務安全上の transition 制限を小さく直す PR がよい。

推奨最小範囲:

- `ACTION.IN_HOUSE_USE_RETRO` の `allowedPrev: []` をやめる。
- `ACTION.DAMAGE_REPORT` の `allowedPrev: []` をやめる。
- `ACTION.DISPOSE` の `allowedPrev: []` をやめる。

この PR では、次を混ぜない。

- `pending_approval` の削除。
- `不良` のコード削除。
- `RETURN_DEFECT` の rename。
- `location` rename。
- `tank-operation.ts` の大規模変更。
- 報酬・請求・trace の変更。

`tank-rules.ts` に `purpose` や `businessMeaning` を持たせるのは、判断済み事項を後続実装へ反映した後に行う。
まだ未実装のため旧互換性を過剰に守る必要はないが、コード変更は必ず別 PR に分ける。
