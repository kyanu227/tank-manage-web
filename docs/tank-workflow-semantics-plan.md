# tank workflow semantics 設計

作成日: 2026-05-03

タンク管理アプリにおける業務用語・状態・遷移・記録の意味を固定するための設計書。
本書は AI / Codex が既存コード名だけから業務意味を推測しないための作業正本であり、人間の管理者が読んで業務として正しいかを確認できる文章にする。

## 1. 目的

今回の目的は、すぐに `tank-rules.ts` や画面処理を直すことではない。
まず、タンク管理業務で使う言葉と状態の意味を固定し、今後の実装判断が分散しないようにする。

特に、以下を明確にする。

- `Customer` / `CustomerUser` / 配達先 / 現在場所の違い。
- `location` / `deliveryTargetName` / `customerName` の意味の違い。
- 発注・返却・未充填報告・破損報告・未返却の業務上の役割。
- `pending_approval` や `不良` など、現行コード名と業務意味がずれている箇所。
- 状態遷移で「どの状態からでも可能」にしてはいけない操作。
- 後続で `tank-rules.ts`、return request、damage report、read/write 境界を直すときの判断基準。

本書では、既存コードに存在する名前より業務上正しい意味を優先する。
まだ本格実装前・本格運用前の部分については、旧互換性を過剰に守らない。
ただし、現行コードとの差分は明記し、後続 PR で安全に修正できるようにする。

## 2. 読み方

AI / Codex は、以下のルールを守る。

- 既存コード名を業務用語の正本として扱わない。
- `pending_approval`、`DEFECTIVE`、`RETURN_DEFECT`、`location` などの名前から勝手に意味を補完しない。
- 本書で「廃止候補」「名称変更候補」「後続 PR」と書いたものを、同じ PR で実装しない。
- UI 文言だけを直して業務設計を変えたことにしない。
- 状態遷移を変える場合は、`tank-rules.ts` だけでなく、`tank-operation.ts`、報酬、請求、返却承認、ポータル transaction への影響を確認する。

人間の管理者は、以下を確認する。

- 用語定義が実際の業務と合っているか。
- 未返却、未充填、破損、不良の分け方が運用と合っているか。
- 返却リクエストを「承認申請」ではなく「返却予定タンクへのタグ付け」として扱ってよいか。
- `不良` は新規設計では廃止方針とし、破損報告タグへ寄せてよいか。
- `耐圧検査中` は正式な tank status 追加候補として後続設計に回す。

## 3. 関連文書

| 文書 | 役割 |
|---|---|
| `AGENTS.md` | 作業ルール、customers / customerId 方針、deploy / commit 分離ルール |
| `docs/portal-identity-and-transaction-plan.md` | CustomerUser と Customer、`pending_link`、portal transaction 作成経路 |
| `docs/identity-and-operation-logging-design.md` | staffId / customerId 正本化、operation context、logs / transactions の責務 |
| `docs/database-schema.md` | 現行 Firestore schema の説明 |
| `docs/tank-state-diagram.html` | 現行または過去の状態遷移図。業務正本ではなく、差分確認用 |
| `src/lib/tank-rules.ts` | 現行の status / action / transition 定義。後続で修正対象 |
| `src/lib/tank-operation.ts` | tank / logs の一貫更新と revision chain の実装 |

本書は `docs/portal-identity-and-transaction-plan.md` を置き換えない。
portal identity と `pending_link` の詳細は portal 設計書を正本とし、本書ではタンク業務全体の語彙と状態遷移を扱う。

## 4. 基本方針

タンク管理の正本は、以下のように分ける。

| 対象 | 正本 | 補足 |
|---|---|---|
| 貸出先・請求先 | `customers` / `customerId` | Customer が会社・店舗・請求・貸出先の正本 |
| ポータル利用者 | Firebase Auth uid + `customerUsers/{uid}` | CustomerUser はログイン利用者であり、請求先正本ではない |
| タンク現在状態 | `tanks.status` | 最新状態のみを持つ |
| タンク現在場所 | `tanks.location` | 現行では現在保持者名・現在場所名の表示用文字列 |
| タンク履歴 | `logs` | 追記型 revision chain |
| 顧客申請・受注・返却タグ・未充填報告 | `transactions` | 顧客起点の request / record |

重要な分離:

- `Customer` は請求・貸出先・履歴集計の正本。
- `CustomerUser` はポータルにログインする人。
- `deliveryTargetName` は発注ごとの配達先であり、Customer や tank の正本ではない。
- `location` は配達先ではなく、現行コード上の「タンクの現在保持者名・現在場所名」の表示用文字列。
- `customerName` は表示用 snapshot であり、正本 ID ではない。

## 5. 用語定義

| 用語 | 意味 |
|---|---|
| Customer | 請求・貸出先・履歴集計の正本。`customers/{customerId}` |
| CustomerUser | ポータルログイン利用者。Firebase Auth uid と `customerUsers/{uid}` で管理する |
| customerId | どの会社・店舗・請求先・貸出先の業務かを示す正本 ID |
| customerUserUid | どのポータル利用者が操作・申込をしたかを示す Firebase Auth uid |
| createdByUid | transaction を作成した CustomerUser uid。業務の請求先ではない |
| selfCompanyName | CustomerUser が登録時に自己申告した会社名。Customer 紐付けの参考情報 |
| selfName | CustomerUser が登録時に自己申告した氏名。Customer 紐付けの参考情報 |
| lineName | CustomerUser が登録時に自己申告した LINE 名。Customer 紐付けの参考情報 |
| requestedCompanyName | 申込時点の自己申告会社名 snapshot |
| requestedByName | 申込時点の自己申告氏名 snapshot |
| requestedLineName | 申込時点の LINE 名 snapshot |
| customerName | Customer 紐付け後の表示用 snapshot。現時点では `tanks.location` 互換名 |
| deliveryTargetName | 発注ごとの配達先名。毎回変わり得るため、Customer や tank の正本にしない |
| location | 現行コード上のタンク現在場所・現在保持者名の表示用文字列。配達先とは別物 |

## 6. Customer / CustomerUser / 配達先の関係

`Customer` は請求・貸出先・履歴集計の正本である。
同じ Customer に複数の CustomerUser が紐付くことがある。
CustomerUser が登録時に入力する `selfCompanyName` / `selfName` / `lineName` は、管理者が Customer に紐付けるための参考情報であり、請求先正本ではない。

発注時の `deliveryTargetName` は、毎回変わる可能性がある配達先である。
たとえば同じ Customer でも、日によって港、店舗、現場、受け渡し担当者が変わることがある。
そのため、`deliveryTargetName` を Customer 名や `tanks.location` の正本として扱わない。

`location` は現行コードで長く使われてきた表示用文字列であり、意味が広すぎる。
現時点では、タンクが倉庫にあるか、自社が保持しているか、顧客が保持しているかを表示するための「現在の貸出先・現在保持者の表示 snapshot」として扱う。
`location` は発注時の配達先 `deliveryTargetName` ではない。
将来的には `currentHolderNameSnapshot`、`currentLocationNameSnapshot`、`customerId` などへ分離する候補である。

## 7. transaction status の意味

### order

`type = "order"` は、顧客からのタンク発注を表す。

推奨する新規 flow:

```text
pending_link -> pending -> approved -> completed
```

| status | 意味 |
|---|---|
| `pending_link` | Customer 未確定の仮受注。通常受注処理には流さない |
| `pending` | Customer 確定後の通常受注。スタッフが確認・承認できる |
| `approved` | スタッフが貸出準備を承認した状態。タンク割当・貸出処理待ち |
| `completed` | 実際にタンク貸出が完了した状態 |
| `pending_approval` | 新規 order では使わない方針。旧コード互換・移行対象 |

`pending_link` は「未完成の通常受注」ではない。
Customer 正本が未確定の仮受注であり、通常 badge や通常受注一覧に混ぜない。
CustomerUser が Customer に紐付いたタイミングで `pending` に昇格してから、通常受注として扱う。

### return

`type = "return"` は、業務上は「返却承認申請」ではなく、顧客が現在貸出中のタンクへ返却予定タグを付ける補助情報である。

主目的:

- 顧客が返却予定のタンクを事前に示す。
- タンクごとに `normal` / `unused` / 持ち越しなどのタグを付ける。
- スタッフが現場で回収・処理する時の確認材料にする。

現行コードでは `status: "pending_approval"` を使い、`useReturnApprovals` が「承認」UIとして扱っている。
ただし業務名としては強すぎる。
後続では `return request` / `return tag` / `pending_return` のように、承認ではなくタグ付けであることが分かる名前へ見直す。
新しい status 名を固定するなら `pending_return` を推奨する。
理由は、「返却処理待ち」と読め、`pending` や `pending_link` と混同しにくいためである。
`tagged` は何のタグか分かりにくく、`open` は汎用すぎる。
`pending_processing` は業務意味が曖昧である。

現時点での整理:

| status | 意味 |
|---|---|
| `pending_approval` | 現行互換の返却処理待ち。業務名としては見直し候補 |
| `completed` | スタッフが現場で回収・処理を完了した状態 |

注意:

- return request は tank の状態を直接変えない。
- tank の状態を変えるのはスタッフが `applyBulkTankOperations()` などの operation を実行した時。
- 未紐付け CustomerUser は対象タンクを安全に特定できないため、return は利用不可。

### uncharged_report

`type = "uncharged_report"` は、顧客からの未充填報告である。
これは単なる記録であり、対応待ちタスクではない。

記録すべきこと:

- どの Customer から報告されたか。
- どの CustomerUser が報告したか。
- どの tankId について報告されたか。
- いつ報告されたか。

業務上の意味:

- 未充填は、こちら側の充填ミスまたは準備不備を示す。
- タンク自体が破損しているとは限らない。
- 未充填報告を `破損` status にしない。
- 対応は別途、新しい貸出、個別連絡、請求除外、報酬取消などで行う。

`status` は `completed` のままでよい。
`pending_approval` や対応待ち status へ変えると、報告記録と対応タスクが混ざる。

## 8. tank status の意味

| status | 業務上の意味 | 今後の扱い |
|---|---|---|
| `充填済み` | 貸出可能な状態 | 維持 |
| `空` | 充填待ち。通常返却後の状態 | 維持 |
| `貸出中` | 顧客が保持している使用予定中または使用中の状態 | 維持 |
| `未返却` | 顧客がタンクを持ち越している、または返却予定日を過ぎても戻っていない状態 | 維持。明示 action を追加候補 |
| `自社利用中` | 自社で利用中の状態 | 維持 |
| `破損` | タンク自体の不具合報告がある状態 | 維持。ただしタグ設計を追加候補 |
| `破棄` | 廃棄済み。通常業務に戻らない状態 | 維持 |
| `不良` | 名前が曖昧。未充填や準備不備と混同しやすい | 新規設計では廃止方針。破損報告タグへ寄せる |

`不良` は「未充填」と混同しやすい。
未充填はタンクの状態異常ではなく、充填されていない状態で貸し出されたという業務上の不備である。
一方、バルブが固い、空気漏れ、外傷があるなどはタンク自体の不具合であり、`破損` status + 不具合タグで扱う。
今回コードから `DEFECTIVE` / `不良` は削除しないが、docs 上は廃止方針として固定する。

## 9. 未返却の業務意味

未返却は重要な状態であり、廃止しない。

業務前提:

- タンクは基本的に翌日分を前日に配布する。
- 翌日に使用済みタンクを回収する。
- 顧客が使わなかったタンクをそのまま持ち越すことがある。
- 返却予定日を過ぎても戻っていないタンクもある。

この状態を表すために `未返却` が必要である。

現行 `tank-rules.ts` には `STATUS.UNRETURNED` が存在するが、`貸出中 -> 未返却` へ遷移する明示 action が見えにくい。
後続で、`持ち越し` action を追加する候補とする。
業務上・UI 上の action 名は `持ち越し` を正とし、tank status は `未返却` を正とする。

理由:

- `未返却` は短く、状態名として自然。
- 操作名まで `未返却化` にすると、他の「未〜」系と見間違える可能性がある。
- 顧客が未使用タンクを翌日以降も保持する行為としては `持ち越し` が自然。

遷移:

```text
貸出中 -> 未返却
未返却 -> 空
未返却 -> 充填済み
```

## 10. 破損 / 不良 / 未充填の違い

| 用語 | 意味 | tank status にするか |
|---|---|---|
| 破損 | タンク自体の不具合報告。バルブが固い、空気漏れ、外傷、異音、部品不良など | `破損` status または damage report タグで扱う |
| 不良 | 名前が曖昧。タンク不具合、未充填、準備不備のどれにも読める | 新規設計では廃止方針 |
| 未充填 | 充填されていないタンクが貸し出された報告。こちら側の業務不備 | `uncharged_report` transaction として記録し、破損 status にしない |

破損報告は、タンク自体を業務サイクルから外すための報告である。
未充填報告は、タンク自体を故障扱いするものではない。
この 2 つを混ぜると、修理対象、請求対象、報酬取消、再貸出判断が崩れる。

破損報告タグの候補:

```text
バルブ固い
空気漏れ
外傷
Oリング
圧力計
その他
```

`不良` は新規設計では使わず、`破損` + 不具合タグへ寄せる。
未充填は `破損` でも `不良` でもなく、こちら側の充填ミスの記録として扱う。

## 11. return tag の意味

現行 `tank-rules.ts` には次の tag がある。

```ts
RETURN_TAG.NORMAL
RETURN_TAG.UNUSED
RETURN_TAG.DEFECT
```

現行コード上の `DEFECT` は、実質的に未充填返却を意味している。
しかし `defect` という名前は「タンク自体の不良・破損」と誤解されやすい。

業務意味としては、返却タグは次のように分ける。

| タグ | 意味 | 遷移先 |
|---|---|---|
| 通常返却 | 使用済みとして戻る | `空` |
| 未使用返却 | 使用されずに戻る | `充填済み` |
| 未充填返却 | 充填不備として戻る。タンク故障ではない | `空` |
| 持ち越し | 顧客が使わずに保持し続ける | `未返却` |

後続では、`RETURN_TAG.DEFECT` / `RETURN_DEFECT` の名称を `UNCHARGED` または `UNFILLED` 系へ見直す。
既存の `uncharged_report` と揃えるなら `RETURN_UNCHARGED` が有力である。
ただし最終命名は後続実装時に決める。
名称変更は、報酬・請求・trace・UI 文言への影響があるため単独 PR にする。

## 12. transition ルール案

推奨する基本遷移:

| 操作 | 許可する元 status | 遷移先 status | 備考 |
|---|---|---|---|
| 貸出 | `充填済み` | `貸出中` | 顧客貸出・受注貸出 |
| 通常返却 | `貸出中`, `未返却`, `自社利用中` | `空` | 使用済み |
| 未使用返却 | `貸出中`, `未返却`, `自社利用中` | `充填済み` | 未使用のまま戻る |
| 未充填返却 | `貸出中`, `未返却`, `自社利用中` | `空` | 未充填報告の結果として回収。破損にはしない |
| 持ち越し | `貸出中` | `未返却` | 顧客が未使用タンクを翌日以降も保持する |
| 充填 | `空` | `充填済み` | 通常の充填 |
| 自社利用 | `充填済み` | `自社利用中` | 自社で使うために持ち出す |
| 自社利用(事後) | `充填済み` | `自社利用中` | 制限なしにはしない方針 |
| 自社返却 | `自社利用中` | `空` | 使用済み |
| 自社返却(未使用) | `自社利用中` | `充填済み` | 未使用 |
| 自社返却(不備) | `自社利用中` | `空` | 名前は見直し候補。未充填・不備の意味を明確化する |
| 破損報告 | 原則、手元にある状態のみ | `破損` | `貸出中` / `未返却` から直接破損にしない |
| 修理済み | `破損` | `空` | 旧互換で `不良` を読む必要があるかは後続判断 |
| 耐圧検査完了 | `耐圧検査中` または検査対象一覧で制御 | `空` | `耐圧検査中` は追加候補 / 後続設計対象 |
| 破棄 | `空`, `充填済み`, `破損` | `破棄` | `貸出中` / `未返却` から直接破棄しない |

「どの状態からでも可能」は原則として避ける。
特に、`貸出中` や `未返却` から直接 `破損` / `破棄` にすると、返却記録や顧客保持の事実が飛ぶ。
破損報告や破棄は、いったん現物が手元に戻っていることを確認できる状態から実行する。

## 13. 現行コードとの差分

### `src/lib/tank-rules.ts`

現行との差分:

- `ACTION.IN_HOUSE_USE_RETRO` が `allowedPrev: []` で制限なし。
- `ACTION.DAMAGE_REPORT` が `allowedPrev: []` で制限なし。
- `ACTION.INSPECTION` が `allowedPrev: []` で制限なし。
- `ACTION.DISPOSE` が `allowedPrev: []` で制限なし。
- `STATUS.DEFECTIVE` / `不良` があるが、新規設計では廃止方針。
- `STATUS.UNRETURNED` / `未返却` はあるが、`持ち越し` action がない。
- `RETURN_TAG.DEFECT` / `ACTION.RETURN_DEFECT` が未充填を表しており、破損・不良と誤解されやすい。

後続 PR では、`allowedPrev: []` を「本当に制限なしでよいか」ではなく、業務上の安全条件から再定義する。

### `src/features/staff-operations/hooks/useReturnApprovals.ts`

現行では `transactionsRepository.getReturns({ status: "pending_approval" })` を読み、スタッフが「承認」する UI になっている。
業務上は返却申請の承認というより、顧客が付けた返却タグを現場回収時に処理する画面である。

後続では、status 名・UI 名・service 境界を整理する候補とする。
status 名を固定するなら `pending_return` を推奨する。
ただし、現行挙動を変える PR では `tank` 状態遷移と `transactions` 完了更新を同時に確認する。

### `src/features/staff-operations/hooks/useOrderFulfillment.ts`

現行では order の status として `pending`, `pending_approval`, `approved` を並列取得している。
PR #5 で `pending_link` は通常 badge から外れているが、order status の意味はまだ整理途中である。

新規 order では `pending_approval` を使わず、`pending -> approved -> completed` を基本にする。
旧互換として読む必要があるかは、運用データを確認してから決める。

### `src/lib/firebase/portal-transaction-service.ts`

現行では:

- order は linked なら `pending`、unlinked なら `pending_link`。
- return は `pending_approval`。
- uncharged_report は `completed`。

このうち、uncharged_report の `completed` は本書の方針と一致する。
return の `pending_approval` は現行互換であり、業務名としては見直し候補である。
後続で return 用 status を整理する場合は、`pending_return` を第一候補とする。

### `src/lib/order-types.ts`

`OrderStatus` に `pending_approval` が含まれている。
これは現行読み取り互換としては残っているが、新規 order の推奨 flow では使わない。
後続で実データと UI 影響を確認し、互換読み取りとして残すか削るかを決める。

### `location` 名称

現行の `tanks.location` / `logs.location` は、配達先にも現在場所にも見える名前であり、AI が誤解しやすい。
現時点では「現在の貸出先・現在保持者の表示 snapshot」と定義し、配達先 `deliveryTargetName` とは分ける。
将来は `customerId`、`currentHolderNameSnapshot`、`currentLocationNameSnapshot` への分離を検討する。
現状の意味に近いのは、倉庫 / 自社 / 顧客などを含む「現在の貸出先・現在保持者の表示 snapshot」である。
CustomerId 正本化後は、表示 snapshot と正本 ID を分離する。

### `CustomerUserStatus.pending`

現行の `CustomerUserStatus.pending` は、setup 済みだが Customer 未紐付けの CustomerUser を表す。
これは transaction の `pending` と混同しやすいため、名称変更候補である。

推奨する将来名:

```text
pending_setup: 初期設定未完了
unlinked: setup 済み・Customer 未紐付け
active: Customer 紐付け済み
disabled: 停止中
```

CustomerUser 側の名称は `pending_link` には寄せない。
`pending_link` は transaction 側の「Customer 未確定の仮受注」であり、CustomerUser 側まで同じ名前にすると再び混同するためである。

## 14. 今後の実装順序案

実装は、次の順序で小さく分ける。

1. docs-only で本設計を確定する。
2. `tank-rules.ts` の status / action / transition 差分を最小 PR で修正する。
3. `return request` の status 名と service 境界を整理する。
4. `uncharged_report` を「記録」として明確化し、対応待ち status にしない方針を守る。
5. damage report にタグ設計を追加する。
6. `RETURN_DEFECT` / `RETURN_TAG.DEFECT` の名称を未充填系へ見直す。
7. `location` / current holder / `customerId` の read/write 境界を整理する。
8. 報酬・請求・trace への影響を、状態遷移変更とは別 PR で確認する。

最初の実装 PR は `tank-rules.ts` だけに見えるかもしれないが、実際には業務ルール変更である。
そのため、`tank-operation.ts` を大きく触らず、まず `ACTION` / `STATUS` / `OP_RULES` の差分とテスト観点を固定するのが安全である。

## 15. やらないこと

この docs-only では、次を行わない。

- `firestore.rules` の変更。
- `firebase.json` の変更。
- Cloud Functions 化。
- 既存 `logs` の一括書き換え。
- 既存 `transactions` の一括書き換え。
- `tank-operation.ts` の大規模変更。
- UI 表示だけの細かい修正。
- `pending_approval` を一気に削除すること。
- `不良` を一気に削除すること。
- `location` field を一気に rename すること。
- 報酬・請求・trace の挙動変更を同じ PR に混ぜること。

## 16. smoke test / review 観点

後続実装 PR では、最低限以下を確認する。

### tank-rules 修正

- `貸出` は `充填済み` からのみ可能。
- `通常返却` は `貸出中` / `未返却` / `自社利用中` から可能。
- `未使用返却` は `充填済み` に戻る。
- `持ち越し` は `貸出中 -> 未返却` になる。
- `破損報告` は `貸出中` / `未返却` から直接できない。
- `破棄` は `貸出中` / `未返却` から直接できない。
- `自社利用(事後)` が制限なしになっていない。

### portal / transaction

- linked CustomerUser の order は `pending`。
- unlinked CustomerUser の order は `pending_link`。
- `pending_link` は通常受注 badge / 通常受注一覧に混ざらない。
- return は未紐付け CustomerUser から作成できない。
- uncharged_report は未紐付け CustomerUser から作成できない。
- uncharged_report は `completed` のまま記録される。

### return request

- return request 作成だけでは tank status が変わらない。
- staff が現場処理した時だけ `applyBulkTankOperations()` で tank status が変わる。
- `unused` は `充填済み` に戻る。
- 未充填返却は `空` に戻り、`破損` にはならない。

## 17. 判断済み事項と後続設計対象

人間レビューで以下を判断済みとする。

1. `持ち越し action / 未返却 status` を正とする。
   - `持ち越し`: 顧客が未使用タンクを翌日以降も保持する操作。
   - `未返却`: その結果としての tank status。
2. `不良` status は新規設計では廃止方針とする。
   - バルブが固い、空気漏れ、外傷などは `破損` status + 不具合タグへ寄せる。
   - 未充填は `破損` でも `不良` でもなく、こちら側の充填ミスの記録。
3. return request は承認申請ではなく、顧客が貸出中タンクへタグを付ける補助システムとして扱う。
   - 新しい status 名を固定するなら `pending_return` を推奨する。
4. `RETURN_DEFECT` / `RETURN_TAG.DEFECT` は名称変更候補とする。
   - 既存の `uncharged_report` と揃えるなら `RETURN_UNCHARGED` が有力。
   - 最終命名は後続実装時に決める。
5. `location` は `deliveryTargetName` ではなく、現在の貸出先・現在保持者の表示 snapshot として扱う。
   - 将来名候補は `currentHolderNameSnapshot` / `currentLocationNameSnapshot`。
6. 顧客ポータルからの破損報告は受けない前提にする。
   - 貸出中 / 未返却中に直接 tank status を `破損` へ変更しない。
   - 破損はスタッフが回収後・現物確認後に記録する。
7. `CustomerUserStatus.pending` は名称変更候補とする。
   - 推奨名は `unlinked`。
   - `pending_link` は transaction 側の用語なので CustomerUser 側には使わない。

後続設計対象:

1. `耐圧検査中` を正式な tank status として追加するか。
   - 人間判断としては追加してもよい。
   - 通常業務から除外する必要があるなら tank status 化が自然。
   - 単なる期限管理・対象抽出なら、検査対象一覧やメンテナンス画面側の gate でも制御できる。
   - 今回の実装対象にはしない。
2. `自社利用(事後)` の遷移制限実装。
   - `充填済み -> 自社利用中` に制限する。
   - 旧データ救済や入力漏れ救済のために無制限遷移を残す設計は採用しない。

## 18. 次に実装すべき最小 PR

本書確定後の最小 PR は、`tank-rules.ts` の遷移ルールを一部だけ直すものがよい。

候補:

- `ACTION.IN_HOUSE_USE_RETRO` の `allowedPrev` を `充填済み` に制限する。
- `ACTION.DAMAGE_REPORT` を `空` / `充填済み` / `自社利用中` など手元にある状態へ制限する。
- `ACTION.DISPOSE` を `空` / `充填済み` / `破損` へ制限する。
- `貸出中 -> 未返却` の action を追加するかどうかは、名称確定後に実装する。

この PR では、`pending_approval` の削除、`不良` のコード削除、`location` rename、return service 再設計を混ぜない。
まだ未実装のため旧互換性を過剰に守る必要はないが、コード変更は必ず別 PR に分ける。
