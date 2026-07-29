# 貸出 cycle binding — 実装前 design gate

- 作成日: 2026-07-29
- 対象commit: `ddb2e8fc81e92c0c0ef2c3ab591562c18ad5d0ce`
- 位置づけ: **実装前 gate。これを満たさない限り F4 / F6 系の production 実装に入らない**
- 入力: [bulk-return-candidate-snapshot-design.md](./bulk-return-candidate-snapshot-design.md)（PR #166）、
  [portal-return-write-safety-design.md](./portal-return-write-safety-design.md)（PR #168）
- 改訂: 初版を独立 Codex reviewer が `NEEDS_CORRECTION` と判定。
  指摘10件をすべて反映して全面改訂した（この版が正本）

## 1. 守るべき不変条件（normative）

> **ある貸出 cycle に対して作られた返却操作は、その cycle が閉じられた後に実行されてはならない。**

「cycle」= あるタンクが、ある顧客へ貸し出されてから返却されるまでの一回分。

**業務判断ではない。** 満たされない場合、
「顧客 X 向けに作られた返却操作が、現在 Y へ貸し出されている cycle を閉じる」ことが起きる。

**同一顧客への再貸出（X → 返却 → 再び X）も違反である。** cycle が別だから。

## 2. 現状 — なぜ破れるか

### 2.1 返却系は status しか見ない

`tank-rules.ts:169` 付近の返却系 action は `allowedPrev: ["lent","unreturned","in_house"]` で、
**誰に貸し出されているかは条件に入らない。**

貸出側については **単純に「状態機械が守る」とは言えない**:

| 経路 | 保護 |
|---|---|
| `order_lend` | 現在状態が `filled` でなければ recovery せず拒否（`tank-transition-policy.ts:272`）→ **現在 cycle を閉じない** |
| manual lend（**advisory 有効時**） | recovery により**現在 holder を system return で閉じてから**別顧客へ貸せる（`tank-transition-policy.ts:539,566`） |

→ 本 gate が対象とするのは**返却（rental_close）経路**。
   advisory recovery による lend 側の cycle close は **§7.4 の別 gate 送り**。

### 2.2 portal 返却確定の経路

| step | 根拠 |
|---|---|
| 確定 context に request の customer A が入る | `return-tag-processing-service.ts:97` |
| preflight は現在 tank を read するが `customerId` を A と比較しない | `:122-153` |
| `rental_close` の step customer は **現在 holder B** | `tank-transition-policy.ts:621` |
| log top-level の `customerId` は **request の A** | `tank-operation.ts:1347` |
| 古い A の transaction を `completed` へ更新 | `return-tag-processing-service.ts:182` |
| Rules も `pending_return → completed` と field 形しか検査しない | `firestore.rules:1475` |

### 2.3 log 内の A/B 不一致は「条件付き」で発生する（初版の記述を訂正）

**不一致が現れるのは次の場合だけ**:

> portal の通常 / 未使用 / 未充填返却で、現在 holder が**別の** customerId のとき

不一致が現れないが**違反はしている**ケース:

| ケース | 理由 |
|---|---|
| **同一顧客への再貸出（ABA）** | A と B が同じ customerId。identity mismatch は起きないが**誤った新 cycle を閉じる** |
| `carry_over` | `state_only` で step に customerId が無い（`tank-transition-policy.ts:718`） |
| 現在 `in_house` からの返却 | 同上 |
| 現在 customer projection が欠落 | planner が `missing_previous_customer` で拒否する |

### 2.4 請求は customerId 照合では閉じていない（初版の記述を訂正）

`projectRentalCycleEvents` を時系列に並べ、**tankId ごとの open cycle を次の close event で閉じる**
（`tank-transition-projections.ts:83`、`billing/source-logs.ts:61,73`）。

→ **customerId が一致していても（同一顧客 ABA でも）現在の cycle が誤って閉じられる。**
   これが「customerId だけでは不十分」の直接の根拠。

### 2.5 既存の部分的 guard は初版の評価より弱い（訂正）

`resolveCarryOverCustomerProjection`（`tank-operation.ts:1247-1275`）には
customerId 照合があるが、**実際に発火する条件は限定的**:

| 状況 | 挙動 |
|---|---|
| previous が完全な B、context が A | `:1266` で throw → `:1270` の catch → `:1287` で**別メッセージ**を throw（原因が隠れる） |
| **bulk return** | `context.customer` を渡していない（`bulk-return-workflow.ts:32`）→ `customerProjection` が無く**比較されない** |
| previous の customerId/customerName が両方 `undefined` | context customer を採用して throw しない（`:1255`） |
| 両方 `null` | null projection を返して throw しない（`:1263`） |
| partial projection が context と一致 | 補完されて throw しない |

Rules 側にも carry_over の照合条件はあるが、top-level customer が無い bulk では bypass される
（`firestore.rules:389`）。

`latestLogId` はどの経路でも見ていない。

## 3. 必須要件

### 3.1 検証内容 — 両方が必須

```
現在の tank.customerId   ==  作成時に観測した expectedCustomerId
現在の tank.latestLogId  ==  作成時に観測した expectedLatestLogId
```

| 片方だけの場合 | 通過してしまう |
|---|---|
| `customerId` のみ | **同一顧客への再貸出 ABA**（§2.4 のとおり請求上も誤って閉じる） |
| `latestLogId` のみ | どの顧客向け申請だったかを検出できない |

### 3.2 3値（`undefined` / `null` / `string`）の扱い — **実装者が決めてはいけない**

`TankSnapshot.customerId` は `string | null | undefined` の3値
（`tank-operation.ts:74`）。bulk 候補にも legacy（customerId 無し）が存在し、
既存 test が明示的にサポートしている（`bulk-return-candidates.test.ts:282`）。
portal 側も `location == customerName` の legacy fallback を返す（`customer-reads.ts:54`）。

**本 gate は次を要求する**:

- `undefined` を `null` へ**無言で潰さない**
- 空文字・空白のみの値を**無言で skip しない**（trim 後に空なら「値なし」として扱うか、
  エラーにするかを明示的に決める）
- **片方が欠落しているときに guard を skip しない**

具体的な扱いは **§7.1 の人間判断**。

### 3.3 検証場所

`commitPlannedOperations`（`tank-operation.ts:435-513`）に置く。
transaction 内で tank を read し、現在 `customerId` と `latestLogId` の両方を持つ
（`:442`, `:453`）。

**「ここが唯一の transaction read」ではない**（初版の記述を訂正）:

| 関数 | 状況 |
|---|---|
| `applyLogCorrection`（`:858`） | 既に target log ID と `latestLogId` を照合済み（`:864`） |
| `voidLog`（`:1058`） | 同上（`:1064`） |

→ **`expectedCycle` をこの2つへ追加する必要はない。**
  ただし `applyLogCorrection` の cross-tank correction（`:901,1022`）は
  別 tank の現在 snapshot で書き換えるため、**system 全体の cycle safety を宣言するなら別途監査対象**（§7.4）。

**transaction 外の照合を禁止するのではない**（初版の「ここ以外で検証しない」を訂正）。
preflight の fast-fail や Rules による作成時検証は有用。
**禁止するのは「transaction 外だけで済ませること」**。authoritative な判定は transaction 内に置く。

### 3.4 失敗時 — writer call を1件も行わない

**2つの意味を区別する**:

| 意味 | 保証 |
|---|---|
| Firestore に永続化されない | transaction callback が throw すれば自動的に保証される |
| **`tx.set` / `tx.update` を一度も呼ばない** | **検証を `tank-operation.ts:584` の `tx.set(aggregationRevisionRef, ...)` より前に置く必要がある** |

`extraOps` は `commitPlannedOperations` の正常 return 後（`:411`）なので、
throw 時には呼ばれない。

→ **検証は「全 `prepared` 完成後 〜 `:584` の前」に置くこと。**
  `prepared.map` の中である必要はない（初版の記述を緩和）。
  test 契約は「writer call 0件」とする。

### 3.5 専用の error 型

**`StaleTankCycleError` のような専用型 / code を定義する。**
文言だけの区別にしない。

- 汎用の「タンク状態が不正です」に混ぜない
- `asRecoveryConfirmationRequiredError`（`:677`）は
  専用 name / fingerprint / requirements のみを拾うため、別名なら retry loop に入らない
- 「status も cycle も変わった」場合に generic transition error ではなく
  **stale error になる**こと

### 3.6 検証は opt-in

`TankOperationInput` に optional な `expectedCycle` を足し、**指定時のみ**検証する。
未指定 caller（maintenance / inhouse / 手動 / 受注貸出）の実行結果は維持される。

**ただし完全な挙動不変ではない**（初版の記述を訂正）:
PR-A で carry_over の error message を直すため、**portal KEEP の observable error は変わる**。
安全性は後退しないが、PR 本文に明記すること。

## 4. データ側の状況

### 4.1 `BulkTankDoc` — 型だけの問題（初版の記述を訂正）

`types.ts:49` の `BulkTankDoc` に `latestLogId` は無い。
**しかし runtime object には既に存在する**:
候補 query は `TankDoc` を写し替えず cast し（`bulk-return-candidates.ts:175`）、
grouping でも spread している（`:208`）。

→ 必要なのは主に**型への追加と workflow での参照**。
  「候補 query が値を捨てている」は誤り。`bulk-return-candidates.ts` の変更は
  必須ではない可能性がある（実装時に確認する）。

### 4.2 `expectedCustomerId` の意味 — **実装前に確定が必要**

既存 pending request は**既に `customerId` を必須で持っている**
（`portal-transaction-service.ts:148`、`firestore.rules:1356`）。

| 選択肢 | 帰結 |
|---|---|
| **(i) request の既存 `customerId` を expectedCustomerId として使う** | 追加 field は `expectedLatestLogId` のみ。「legacy request は expectedCustomerId を持たない」は**誤り**になる |
| **(ii) 観測した tank.customerId を新 field に保存する** | Rules / payload / 型 / test が**もう1 field 分必要** |

portal の legacy fallback では
**request owner の customerId と観測した `tank.customerId === undefined` が異なり得る**ため、
(i) と (ii) は同じにならない。

→ **§7.1 の人間判断。**

### 4.3 portal marker の型パイプライン（全経路を通す必要がある）

```
portal/return/page.tsx        （latestLogId を捨てている: :64）
  → createPortalReturnRequests / createPendingPortalReturnRequest
  → firestore.rules isPortalReturnCreate（keys().hasOnly / hasAll）
  → TransactionDoc（repositories/types.ts）
  → PendingReturn（useReturnTagProcessing.ts:35 で unchecked cast）
  → useReturnTagProcessing の grouping
  → PendingReturnRequestItem（return-tag-processing-service.ts:22）
  → buildReturnConfirmationOperations（:163）
  → TankOperationInput.expectedCycle
```

**初版の「return-tag-processing-service が使う」だけでは変更境界が不十分。**

### 4.4 Rules の key set

`isPortalReturnCreate`（`firestore.rules:1336-1368`）は
`keys().hasOnly([...])` と `keys().hasAll([...])` の**両方**で10キーを固定している。

## 5. 実装 PR の順序

```
PR-A   cycle guard を tank-operation に入れ、bulk return へ適用する
       ├ StaleTankCycleError を定義
       ├ TankOperationInput.expectedCycle（optional）
       ├ commitPlannedOperations の :584 より前で照合
       ├ carry_over の既存 guard を統合し、message 隠蔽（:1270 の catch）を直す
       ├ BulkTankDoc に latestLogId を追加
       └ bulk-return-workflow が expectedCycle を渡す
       behavior change: stale 候補が拒否される + carry_over の error message
       Rules 変更: なし     deploy: Hosting のみ

PR-B-1 Rules: 新 field を「存在する場合は型検証して許可」（optional）
       hasOnly にのみ追加。hasAll には追加しない
       deploy: Rules のみ

PR-B-2 app: portal が marker を書く（§4.3 の型パイプライン全体）
       deploy: Hosting のみ。**必ず B-1 の後**

PR-B-3 旧 client の排出と監査の後、Rules: 新 field を hasAll で必須化
       → これをやらない限り legacy 集合の増加は止まらない

PR-B'  返却確定側が expectedCycle を渡す
       legacy request の扱いは §7.2 の判断に従う

PR-C   cross-device idempotency（cycle-bound occurrence ID）
PR-D   multi-document atomicity（writeBatch）
PR-E   time authority
```

### 5.1 Rules rollout が3段階必要な理由（初版の2段階を訂正）

| やり方 | 起きること |
|---|---|
| app-first | `hasOnly` に無い field は拒否 → **portal 返却が全件失敗** |
| B-1 で `hasAll` にも追加（必須化） | Rules deploy の瞬間から**旧 app が全件失敗** |
| `hasOnly` だけに追加（optional） | 旧 app・開いたままのタブ・手製 client が marker なし request を作り続ける |

→ **optional 許可 → app deploy → 排出確認 → 必須化**の3段階。

**注意**: staff は Rules 上 `transactions` を任意に create できる（`firestore.rules:1852`）。
source code に portal 経路しかないことだけでは legacy 増加停止を保証できない。

### 5.2 atomicity（PR-D）が後である理由

lifecycle binding が無いまま atomic 化すると、
**誤った cycle 向けの申請を「確実にまとめて」作るだけ**になる。

### 5.3 bulk return と portal の非対称性

| | cycle 情報の入手元 | PR-A だけで厳格化できるか |
|---|---|---|
| bulk return | 候補 query が tanks から毎回 read | **できる** |
| portal 返却確定 | 永続化された request document | できない（PR-B-2 / B' が必要） |

## 6. 検証要件

### 6.1 unit test（PR-A）— 最低18件

| # | 内容 |
|---|---|
| 1 | `expectedCycle` 未指定 → 現行どおり実行（既存 caller 不変） |
| 2 | 両方一致 → 実行される |
| 3 | customerId のみ不一致 → stale error / **writer call 0件** |
| 4 | latestLogId のみ不一致（**同一顧客 ABA**） → stale error |
| 5 | 両方不一致 → stale error |
| 6 | current customerId が `null`、expected が string → stale error |
| 7 | expected が `null`、current が string → stale error |
| 8 | **current customerId が `undefined` の legacy tank** → §7.1 の決定どおり |
| 9 | latestLogId の `null ↔ string` **両方向** |
| 10 | `expectedCycle` object はあるが片方の property が runtime で `undefined` |
| 11 | 空文字・空白の customerId / latestLogId を**silent skip しない** |
| 12 | **bulk 内1件だけ不一致 → logs / tanks / aggregationRevision / `extraOps` writer call がすべて0** |
| 13 | status も cycle も変わった場合、generic transition error ではなく **stale error** |
| 14 | stale error が recovery retry loop に入らない |
| 15 | **recovery confirmation の1回目から再 transaction までに cycle が変わった場合、再確認 dialog に入らず stale** |
| 16 | **carry_over の既存 catch 経路**（`expectedCycle` 未指定・previous は完全な B・context は A）で**正しい message** が出る |
| 17 | happy path で log top-level customer と rental boundary customer が一致する |
| 18 | legacy policy（§7.2 の決定）を専用 test で固定 |

**#12 と #16 は必須。** #16 は「新 guard が先に throw して catch 経路を踏まない」形では
検証にならないため、**`expectedCycle` 未指定**で踏むこと。

### 6.2 Rules test

- B-1: 新 field を含む create が許可される / 未知キーは拒否 / 型不正は拒否
- **B-3: marker 欠落を拒否する**
- staff の完了更新が marker を書き換えられない

### 6.3 L2 検証

**bulk シナリオだけでは不足。** 次を別シナリオで実施する（A-99 使用・ユーザー承認下）:

1. bulk: 候補表示 → 別画面で返却 → 別顧客へ再貸出 → 候補から実行 → stale 拒否・無変化
2. **portal request の stale 確定**: request 作成 → 返却 → 再貸出 → 確定 → stale 拒否
3. **同一顧客への再貸出**（ABA）で stale になること
4. stale 時に **transaction が pending のまま**であること
5. stale 時に **aggregationRevision が不変**であること

### 6.4 既存データの監査（read-only、L0）— **完全監査ではない**

初版のクエリは実行不能かつ誤検出する。訂正:

- Firestore server query では document 内2 field の比較も `steps[last]` の動的参照も**できない**
- 候補を絞って client / admin 側で全件走査が必要
- **正常な log も不一致になる**: bulk / manual return は top-level `log.customerId` が無く、
  step customer は現在 holder
- `carry_over` / `state_only` は step customer が無い
- **同一顧客 ABA は customerId が一致するため検出できない**
- bulk stale は expected customer が保存されていないため**事後判定不能**

→ **client 側 heuristic として次に限定する**:

```
logs のうち
  source == "return_tag_processing" かつ workflow == "return" かつ transactionId あり
に絞り、client 側で rental_close step を抽出して
  log.customerId != step.customerId
を数える
```

**これで得られるのは「異なる customerId の portal return」の下限件数だけ**である旨を明記する。

### 6.5 legacy pending 監査（§6.4 とは別クエリ）

```
transactions のうち type == "return" かつ status == "pending_return" で
marker（expectedLatestLogId）を持たないものの件数
```

**§7.2 の判断材料はこちら。** §6.4 では分からない。

## 7. 🔴 人間判断が必要な事項（4件）

### 7.1 `expectedCustomerId` の意味と3値の扱い

- request の既存 `customerId` を使う（§4.2 (i)）か、観測値を新 field に保存する（(ii)）か
- `tank.customerId === undefined` の legacy tank を bulk / portal それぞれどう扱うか
  （**`null` への無言変換は禁止**）

### 7.2 cycle 情報を持たない既存 `pending_return` request の扱い

| 選択肢 | 内容 |
|---|---|
| (a) customerId のみで照合 | **reviewer が反対** |
| (b) 一律拒否 | 正当な未処理申請を巻き込む |
| (c) スタッフの明示確認を要求 | 一時運用にできる（legacy 0件で削除） |
| (d) 期限を切る | 期限値の決定が必要 |
| **(e)** | **cutover 前に legacy pending を全件処理・取消し、0件を確認してから missing marker を一律拒否** |
| **(f)** | legacy を自動処理せず、現物確認＋顧客確認のうえ cycle-bound request を再作成し、旧 request を監査付きで閉じる |
| **(g)** | 一時的な legacy 専用 override（staff 確認・理由・actor を監査記録）、0件後に削除 |

**初版の推奨 (a) は撤回する。** reviewer の反対理由:

1. **同一顧客への再貸出を通すため、§1 の不変条件とユーザー指定の「両方必須」に正面から反する**
2. finite でも自動的に減る保証はなく、未処理 request は何年でも残り得る
3. marker を Rules で必須化しない限り、legacy 集合は**増加停止すら保証されない**（§5.1）

**現在 tank の latestLogId を legacy request へ自動 backfill するのは禁止**
（元 request がどの cycle に対して作られたか証明できない）。

**推奨**: まず §6.5 で marker 欠落 pending の実数を確認し、
**0件なら一律拒否 (b)**、存在するなら **(e)**、それが困難なら一時的な **(f) / (g)**。

### 7.3 §6.4 の監査を実施してよいか

本番 Firestore への read 接続を伴う。

### 7.4 今回保護しない ABA 経路をどう扱うか

`expectedCycle` が optional であるため、次には cycle ABA が残る:

| 経路 | 内容 |
|---|---|
| manual return / keep | snapshot status を保持したまま後で submit（`manual-operation-workflow.ts:43`） |
| inhouse return | 古い `in_house` cycle と新しい `in_house` cycle を区別できない（`inhouse-return-workflow.ts:31`） |
| advisory manual lend / fill | recovery により現在顧客 cycle を閉じ得る（§2.1） |
| inspection | 全 status から直接実行可能で、lent tank の customer projection を消せる（`tank-rules.ts:227`、`inspection-workflow.ts:36`） |
| `applyLogCorrection` の cross-tank correction | 別 tank の現在 snapshot で書き換える（`tank-operation.ts:901,1022`） |

**今回の PR に混ぜてはいけない。** ただし
「今回防ぐ経路」と「残る ABA 経路」を PR 本文と本 gate に明記し、
別 gate へ送るか受容するかを決めること。

## 8. 変更してはいけないもの / してはいけないこと

- `src/lib/tank-operation.ts` の**分割・移動**（`feature-boundaries.md` §2.4）。足すだけ
- atomicity 境界の分割（`write-ownership.md` §7）
- 状態遷移の意味（`allowedPrev` / `nextStatus`）
- `transitionPlan` / recovery / revision / void の semantics
- 請求額・税・丸め・顧客 grouping
- cycle guard と F4 の single-snapshot 化を**同一 PR にしない**
- cycle guard と F6-C/D/E を**同一 PR にしない**
- **片方（customerId / latestLogId）が欠落しているときに guard を skip しない**
- **現在値から expected を捏造しない**（backfill・自動補完を含む）
- **bulk の一部だけ継続しない**（1件 stale なら全件停止）
- **stale 時に transaction を completed にしない**
- **`undefined` を `null` へ無言変換しない**

## 9. gate 通過条件

- [ ] §7.1（expectedCustomerId の意味と3値の扱い）が決まっている
- [ ] §7.2（legacy pending の扱い）が決まっている。**(a) は選択肢から外れている**
- [ ] §6.5 の legacy pending 件数監査が実施されている
- [ ] §6.4 の heuristic 監査を実施するか決まっている（§7.3）
- [ ] §7.4 の残存 ABA 経路が「別 gate 送り」か「受容」に分類されている
- [ ] PR-A の変更対象ファイルが確定している
      （`bulk-return-candidates.ts` は §4.1 のとおり必須でない可能性がある）
- [ ] **Rules rollout 3段階**（B-1 optional → B-2 app → B-3 必須化）が運用手順に落ちている
- [ ] §6.1 の18 test（特に #12 / #16）が計画に入っている
- [ ] §6.3 の L2 シナリオ5件の実施タイミングと承認者が決まっている
