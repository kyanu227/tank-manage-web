# 貸出 cycle binding — 実装前 design gate

- 作成日: 2026-07-29
- 対象commit: `ddb2e8fc81e92c0c0ef2c3ab591562c18ad5d0ce`
- 位置づけ: **実装前 gate。これを満たさない限り F4 / F6 系の production 実装に入らない**
- 入力: [bulk-return-candidate-snapshot-design.md](./bulk-return-candidate-snapshot-design.md)（PR #166）、
  [portal-return-write-safety-design.md](./portal-return-write-safety-design.md)（PR #168）
- 改訂: 初版を独立 Codex reviewer が `NEEDS_CORRECTION` と判定。
  指摘10件をすべて反映して全面改訂した（この版が正本）


## 0B. 第2回反証レビューの未解決事項（2026-07-29）— **gate 未達**

4判断を反映した版を独立 reviewer が再検証し、**`REQUEST_CHANGES`** と判定した。
**次の7件が解決するまで PR-A の実装に入らない。**

### B-1. 検証位置が §6.1 #13 と両立しない（最重要）

§3.4 は「全 `prepared` 完成後 〜 `:584` の前」に検証すると書いたが、
`prepared` の構築中に `planTankTransition` が走り（`tank-operation.ts:474,486`）、
**失敗すると汎用 error が先に throw される**。

→ 「status と cycle が両方変わった場合も stale error」（§3.5 / §6.1 #13）を保証できない。

**修正**: 検証位置を **「全 tank snapshot の read 完了後、transition planning より前」**の
二段階処理にする。これで writer call 0件も維持できる。

### B-2. portal 作成時の一致検査に authoritative な実装境界が無い

§7.1 は**検査内容**を決めたが、**どこが検査するか**が未定。現状:

- portal page の `TankItem` は `customerId` も `latestLogId` も保持していない（`page.tsx:64,66`）
- legacy fallback は `location == customerName` の結果を統合し、
  fallback 側の `customerId` が欠落・別顧客でも除外しない（`customer-reads.ts:60,68`）
- Rules は request owner との一致だけを見る（`firestore.rules:1165`）。tank との一致は見ない
- B-1 も「field の型検証」のみ（§5）

**`request.customerId` の再利用自体に semantic conflict は無い**が、次が成立する場合に限る:

1. page DTO が観測時の `customerId` と `latestLogId` を保持する
2. application service が owner と観測 `customerId` の一致・両値の非空を検査する
3. **B-1 Rules が marker 存在時に、current tank の両値と request payload の一致を検査する**
4. B-3 Rules が同じ検査を必須化する

legacy fallback は**表示互換にだけ**使い、identity / cycle binding には使わない。
対象は明示的に拒否または disabled にする。§4.3 の pipeline を `customerId` 検査経路まで含めて書き直す。

### B-3. Rules 3段階でも legacy 増加は止まらない

staff は `isStaff() || isOwnTransactionCreate()` で**任意の transaction を作成できる**
（`firestore.rules:1854`）。§5.1 はこの bypass を認識しているが解決策が無い。

**修正**: B-3 は staff による `return / pending_return` create にも有効な marker 契約を要求するか、
その create 自体を禁止する。

加えて **空文字・空白 marker を許す余地**がある（B-1 は型のみ、B-3 は `hasAll` のみ）。
§6.5 の監査も「field を持たないもの」しか数えない。
→ 監査対象を **missing / null / 非 string / 空 / 空白**へ広げ、Rules test にも追加する。

**PR-B' と B-3 の順序も未確定。** B-3 が先で B' が後だと、その間は
marker 付き request でも confirmation guard が使われず ABA が残る。

### B-4. bulk 欠落候補の扱いが未決（§7 の「4件すべて確定」と矛盾）

§7.1 は「対象外 or disabled は PR-A brief で決める」と先送りしている。
現状の UI は group 全件をそのまま submit する
（`useBulkReturnByLocation.ts:79,100`）ため、候補 query で単純除外すると
**operator から静かに消え、silent bypass を防げない**。

**本 gate で固定すべきこと**:

- 表示上 disabled にして理由を示す、または**除外本数と修復導線を明示**する
- submit payload に欠落候補が混入した場合も **fail-closed**
- 欠落候補の eligibility / disabled behavior を専用 test で固定
- それに伴う PR-A の変更ファイルを確定

### B-5. §6.1 の18 test のうち2件は PR-A の対象外

- **#17**（log top-level customer と rental boundary customer の一致）は
  **bulk の実経路では top-level customer が存在しない**
  （`bulk-return-workflow.ts:32` は customer を渡さない）。portal B' の happy-path test と思われる
- **#18**（legacy pending policy）は PR-B' の test

→ **PR-A 用の18件へ差し替えるか、PR 別に test 表を分割する。**
L2 5件も実施時期と承認者が未定。

### B-6. §7A remediation の案1・案2 は不適切

| 案 | 問題 |
|---|---|
| 1. Token Creator 付与 | **impersonation を可能にするだけで、target SA に Firestore read 権限を与えない。** cutover SA の direct binding は剥奪済み（`transition-cutover-summary-2026-07-18.md:153`）。旧 custom role を戻すと create/update/delete も戻り read-only 条件に反する（`runbook:92`）。**Token Creator に加えて target SA への一時的な read-only role が必要** |
| 2. service account key | 「read-only key」ではなく「key が表す SA の権限が read-only」。repo 直下の `firebase-service-account.json` は gitignore されていても安全な保管場所ではなく、**runbook:145 は repository 外へ移すよう要求している** |
| 3. ADC 再ログイン | **概ね正しい。** `roles/datastore.viewer` は get/list を持ち create/update/delete を持たない。ただし既存 `GOOGLE_APPLICATION_CREDENTIALS` の unset と、quota project 使用時の `serviceusage.services.use` または `--disable-quota-project` の扱いを記載すべき |

→ **案3 を第一候補**とし、案1は「Token Creator + target SA への一時 read-only role」に書き直す。
案2は保管場所を repository 外に限定する。

### B-7. 「判断済み」と「人間判断」の表現が併存している

§3.2 / §4.2 / §4.3 付近に未決のままの表現が残っている。
§7.1 の確定事項への参照に直す。

---

**この §0B が解消されるまで、§9 の gate は通過していない。**


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

### 6.6 active returnable tank の marker readiness 監査（read-only、L0）

対象 status: `lent` / `unreturned` / `in_house`

集計:

- 総件数
- `customerId` が `undefined` の件数
- `customerId` が `null` の件数
- `customerId` が空白の件数
- `latestLogId` が `undefined` / `null` / 空白の件数
- **両方が有効な件数**
- status 別内訳

→ **PR-A で bulk return の何件が cycle guard を通せるか**が分かる。
   欠落が多い場合、§7.1 の「対象外」か「disabled」かの UI 判断に直接影響する。

### 6.7 baseline 比較（監査の前後で実施）

read-only であることを確認するため、監査の前後で次を比較する。

- tanks 総数
- active logs 件数
- `pending_return` 件数
- aggregation revision
- transactions 件数

**並行する業務操作で変化した場合、その監査結果を確定値として扱わず停止する。**

## 7. 確定した判断（2026-07-29 ユーザー決定）

初版で「人間判断が必要」としていた4件は**すべて確定した**。以下は決定事項であり、
実装者はこれに従う。**再検討や独自解釈をしない。**

### 7.1 `expectedCustomerId` は既存の `request.customerId` を使う

**新しい `expectedCustomerId` field は追加しない。**

```
expectedCustomerId  = request.customerId       （既存 field を正本とする）
expectedLatestLogId = 新規 field として保存
```

理由: request の `customerId` と新しい `expectedCustomerId` を二重保持すると、
**両者が不一致になり得るという新たな不変条件が生まれる**。
既存 field を正本にし、作成時の tank との一致を検証するほうが単純。

#### portal request 作成時の必須検査（fail-closed）

request 作成時に、観測した tank について次を**すべて**満たすこと。

```
tank.customerId が非空 string
tank.customerId == request.customerId      （完全一致）
tank.latestLogId が非空 string
```

不成立時:

- **request を作成しない**
- `undefined` を `null` へ変換しない
- `customerName` / `location` fallback で cycle-bound request を作らない
- 現在値で自動補完しない
- **明示的な legacy identity / missing cycle marker error** として停止させる

#### bulk return

```
expectedCustomerId  = 候補取得時の tank.customerId
expectedLatestLogId = 候補取得時の tank.latestLogId
```

**両方とも非空 string を必須**とする。

欠落候補は **cycle guard を skip しない**。
「一括返却対象外にする」か「明示的に disabled にする」かのどちらかとし、
**どちらを採るかは PR-A brief で現在 UI との整合を確認して決める**。
個別の identity 修復へ回す。

`undefined` / `null` / 空白を**同値にしない**。

#### `expectedCycle` の契約

```ts
type ExpectedTankCycle = Readonly<{
  customerId: string;
  latestLogId: string;
}>;
```

- 命名は既存規約に合わせて調整してよいが、**両 field を required にする**
- runtime で片方が欠落した object を渡された場合も **silent skip せず error** にする

### 7.2 legacy `pending_return` は監査結果で分岐（policy は確定）

```
marker 欠落 0件:
  欠落 request を一律拒否

marker 欠落 1件以上:
  cutover 前に全件を正規処理または取消し
  0件を確認してから一律拒否
```

**原則は選択肢 (e)。**

- **(f)** は「現物確認・顧客確認・元 cycle の特定が必要で通常処理できない request」だけに使う。
  cycle-bound request を再作成し、旧 request を監査付きで閉じる
- **(g) の override は採用しない**
- **現在 tank の `latestLogId` を legacy request へ自動 backfill しない**

### 7.3 本番 read-only 監査は許可済み（write は一切禁止）

出力してはならないもの: 秘密値、顧客名、メール、メモ、電話番号。
**件数と匿名化 ID のみ**を記録する。document ID は先頭・末尾をマスクする。

監査内容は §6.5 / §6.6 / §6.4 を参照。

### 7.4 残る ABA 経路はすべて別 gate へ送る（受容しない）

| 優先度 | 経路 |
|---|---|
| 1 | manual return / keep |
| 2 | inhouse return |
| 3 | inspection |
| 4 | cross-tank correction |
| 5 | advisory manual lend / fill recovery（現在 strict 運用のため最後） |

**PR-A へ混ぜてはいけない。**
PR-A merge 後に docs-only で **`remaining tank-cycle safety gate`** を作成する。

## 7A. 監査の実施状況（2026-07-29 時点）

**状態: BLOCKED（IAM）。実施できていない。**

| 項目 | 結果 |
|---|---|
| local gcloud ADC | 存在する。type = `impersonated_service_account` |
| impersonation target | `transi***@okmarine-tankrental.iam.gserviceaccount.com`（cutover 用 SA） |
| 実行結果 | `403 PERMISSION_DENIED: unable to impersonate: Permission 'iam.serviceAccounts.getAccessToken' denied` |
| 原因 | cutover 完了後に production credential が再閉鎖されている（`transition-plan-v1-runbook.md:11`）。<br>production IAM 付与は運用時の別承認事項（同`:65`） |

**これは設計どおりの安全側の状態であり、異常ではない。**

### 必要な remediation（人間作業）

次のいずれか。

1. 現在の principal に、対象 SA への `roles/iam.serviceAccountTokenCreator` を付与する
2. read 専用の service account key を発行し、
   `GOOGLE_APPLICATION_CREDENTIALS` または `./firebase-service-account.json`（gitignore 済み）で渡す
3. `gcloud auth application-default login` で impersonation なしの ADC に切り替え、
   その principal に Firestore の read 権限（`roles/datastore.viewer` 等）を付与する

runbook `:120-129` の手順（IAM 変更後は最低10分待ち、反復確認が一致するまで進まない）に従うこと。

**監査が完了するまで、§7.2 の分岐（0件か1件以上か）は確定しない。**
policy 自体は確定しているため、実装（PR-A）は監査を待たずに進められる。
監査結果が必要になるのは **PR-B'（返却確定側）** の legacy 扱いを実装する時点。

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

- [x] §7.1（`expectedCustomerId` の意味と3値の扱い）が決まっている — **確定**
- [x] §7.2（legacy pending の扱い）が決まっている。(a) と (g) は選択肢から外れている — **確定**
- [x] §7.3（監査実施可否）が決まっている — **許可済み**
- [x] §7.4（残存 ABA 経路の分類）が決まっている — **全件を別 gate へ送る**
- [ ] §6.5 の legacy pending 件数監査が実施されている — **BLOCKED（§7A）**
- [ ] §6.6 の active returnable tank readiness 監査が実施されている — **BLOCKED（§7A）**
- [ ] §6.4 の heuristic 監査が実施されている — **BLOCKED（§7A）**
- [ ] PR-A の変更対象ファイルが確定している
      （`bulk-return-candidates.ts` は §4.1 のとおり必須でない可能性がある）
- [ ] **Rules rollout 3段階**（B-1 optional → B-2 app → B-3 必須化）が運用手順に落ちている
- [ ] §6.1 の18 test（特に #12 / #16）が計画に入っている
- [ ] §6.3 の L2 シナリオ5件の実施タイミングと承認者が決まっている

### 監査 BLOCKED が各 PR に与える影響

| PR | 監査が必要か |
|---|---|
| **PR-A** | **不要。** §7.1 の契約は確定しており、bulk 候補の marker は毎回 read するため実装できる。<br>ただし §6.6 の結果は「対象外 / disabled」の UI 判断材料になるため、**brief 作成時に未確定である旨を明記する** |
| PR-B-1 / B-2 | 不要 |
| **PR-B'** | **必要。** §7.2 の分岐（0件 → 一律拒否 / 1件以上 → (e)）が決まらない |
| PR-B-3（必須化） | **必要。** legacy 0件の確認が前提 |
