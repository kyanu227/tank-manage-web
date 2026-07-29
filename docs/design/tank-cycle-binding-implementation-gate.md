# 貸出 cycle binding — 実装前 design gate

- 作成日: 2026-07-29（第4改訂）
- 対象commit: `3e438129b2394cbba173d6d47c20b351f493440f`
- 位置づけ: **PR-A1 / PR-A2 の実装前 gate。** PR #166（F4）と PR #168（F6-B/C/D）の共通正本
- 改訂履歴: 初版 → 独立 reviewer `NEEDS_CORRECTION`（10件）→ 全面改訂
  → 4判断反映 → reviewer `REQUEST_CHANGES`（7件）→ 第3改訂 → reviewer `REQUEST_CHANGES`（3件）→ **本版で全件を解決**

## 0. reviewer 指摘7件への対応表

| # | 指摘 | 本版での対応 |
|---|---|---|
| B-1 | cycle 検査位置が「`prepared` 完成後」だと `planTankTransition` の汎用 error が先に throw され、#13 を保証できない | **§3.3 で「全 snapshot read → 正規化 → 全 expectedCycle 検証 → その後 planning」の順序を authoritative に固定** |
| B-2 | portal 作成時の一致検査に実装境界が無い | **§4.2 で page DTO / application service / B-1 Rules / B-3 Rules の4層を固定。Rules が最終 authoritative** |
| B-3 | staff が任意の transaction を作れるため Rules 3段階でも legacy 増加が止まらない | **§5.2 で B-3 を「全 `pending_return` creator 対象」に変更。staff 経路も inventory する** |
| B-4 | bulk 欠落候補の扱いが未決。単純除外は silent bypass | **§7.4 で「表示は維持・選択不可・group 全体 disabled・部分実行禁止」に確定** |
| B-5 | 旧 test #17 / #18 は PR-A 対象外 | **旧 #17 / #18 を PR-B' へ移動（§6.2）。第3改訂の R3 指摘で happy-path marker pass-through と planner 順序を追加し、core は19件** |
| B-6 | §7A remediation の案1・案2 が不適切 | **§8 を「一時 audit SA」方式に書き直し。cutover SA の再利用と key 発行を禁止** |
| B-7 | 「判断済み」と「人間判断」の表現が併存 | 本版で全面書き直し。未決は §10 の3件（brief 段階で確定）だけ |

---

## 1. 守るべき不変条件（normative）

> **ある貸出 cycle に対して作られた返却操作は、その cycle が閉じられた後に実行されてはならない。**

「cycle」= あるタンクが、ある顧客へ貸し出されてから返却されるまでの一回分。

**業務判断ではない。** **同一顧客への再貸出（X → 返却 → 再び X）も違反**である。

---

## 2. 現状 — なぜ破れるか

### 2.1 返却系は status しか見ない

`tank-rules.ts:169` 付近の返却系 action は `allowedPrev: ["lent","unreturned","in_house"]` で、
**誰に貸し出されているかは条件に入らない。**

貸出側は経路で異なる:

| 経路 | 保護 |
|---|---|
| `order_lend` | 現在状態が `filled` でなければ recovery せず拒否（`tank-transition-policy.ts:272`） |
| manual lend（**advisory 有効時**） | recovery で**現在 holder を system return で閉じてから**別顧客へ貸せる（同`:539,566`）→ **§7.5 の別 gate** |

### 2.2 portal 返却確定の経路

| step | 根拠 |
|---|---|
| 確定 context に request の customer A が入る | `return-tag-processing-service.ts:97` |
| preflight は現在 tank を read するが `customerId` を A と比較しない | `:122-153` |
| `rental_close` の step customer は **現在 holder B** | `tank-transition-policy.ts:621` |
| log top-level の `customerId` は **request の A** | `tank-operation.ts:1347` |
| 古い A の transaction を `completed` へ更新 | `return-tag-processing-service.ts:182` |
| Rules も `pending_return → completed` と field 形しか検査しない | `firestore.rules:1475` |

### 2.3 log 内の A/B 不一致は「条件付き」

不一致が現れるのは **portal の通常 / 未使用 / 未充填返却で、現在 holder が別 customerId のとき**だけ。

不一致が現れないが**違反はしている**ケース:

| ケース | 理由 |
|---|---|
| **同一顧客への再貸出（ABA）** | A と B が同じ customerId。**誤った新 cycle を閉じる** |
| `carry_over` | `state_only` で step に customerId が無い（`tank-transition-policy.ts:718`） |
| 現在 `in_house` からの返却 | 同上 |

### 2.4 請求は customerId 照合では閉じていない

`projectRentalCycleEvents` を時系列に並べ、**tankId ごとの open cycle を次の close event で閉じる**
（`tank-transition-projections.ts:83`、`billing/source-logs.ts:61,73`）。

→ **同一顧客 ABA でも現在の cycle が誤って閉じられる。**
   これが「`customerId` だけでは不十分」の直接の根拠。

### 2.5 既存の部分的 guard は弱い

`resolveCarryOverCustomerProjection`（`tank-operation.ts:1247-1275`）に customerId 照合はあるが:

| 状況 | 挙動 |
|---|---|
| previous が完全な B、context が A | `:1266` で throw → `:1270` の catch → `:1287` で**別メッセージ**（原因が隠れる） |
| **bulk return** | `context.customer` を渡していない（`bulk-return-workflow.ts:32`）→ **比較されない** |
| previous の customerId/customerName が両方 `undefined` / 両方 `null` | throw しない（`:1255,1263`） |

Rules 側の carry_over 照合も top-level customer が無い bulk では bypass される（`firestore.rules:389`）。
`latestLogId` はどの経路でも見ていない。

---

## 3. 必須要件

### 3.1 検証内容 — 両方が必須

```
現在の tank.customerId   ==  作成時に観測した expectedCustomerId
現在の tank.latestLogId  ==  作成時に観測した expectedLatestLogId
```

| 片方だけ | 通過してしまう |
|---|---|
| `customerId` のみ | **同一顧客 ABA**（§2.4） |
| `latestLogId` のみ | どの顧客向け申請だったかを検出できない |

### 3.2 契約

```ts
type ExpectedTankCycle = Readonly<{
  customerId: string;
  latestLogId: string;
}>;
```

- **両 field required、非空 string。**
- runtime で片方が欠落した object を渡されても **silent skip せず error**
- **`undefined` / `null` / 空白を同値にしない**
- **現在値から expected を捏造しない**（自動補完・backfill を含む）

### 3.3 検証位置と順序（authoritative・B-1 の訂正）

`commitPlannedOperations`（`tank-operation.ts:435-513`）内で、**次の順序を厳守する**。

```
1. transaction 内で全対象 tank を read
2. snapshot を正規化
3. 全 expectedCycle を検証
4. customerId / latestLogId の欠落・不一致を判定
5. 1件でも不一致なら StaleTankCycleError
6. その後に transition planning
7. planning 全件成功後に writer call
```

**`planTankTransition` より前に検証すること。** `prepared` 構築中に planning が走ると、
status も cycle も変わっている場合に**汎用 transition error が先に throw され**、
§6.1 #11 の「stale 優先」を満たせない（reviewer B-1）。

`applyLogCorrection`（`:858`）と `voidLog`（`:1058`）は既に target log ID と
`latestLogId` を照合済み（`:864,1064`）。**`expectedCycle` を追加しない。**
`applyLogCorrection` の cross-tank correction（`:901,1022`）は **§7.5 の別 gate**。

transaction 外の照合（preflight fast-fail / Rules）は**併用してよい**。
禁止するのは「transaction 外だけで済ませること」。

### 3.4 失敗時 — writer call 0件

検証失敗時に次をすべて満たす。

- **planner call 0件（必須）**。§3.3 の順序から必然的に導かれるため「可能なら」ではない
- `tx.set` / `tx.update` **0件**
- aggregationRevision write **0件**（`tank-operation.ts:584` の `tx.set` より前で失敗する）
- log write 0件 / tank write 0件
- `extraOps` **0件**（`:411` の正常 return 後に呼ばれるため自動的に満たされる）
- **bulk 全件停止**（部分継続しない）

### 3.5 専用 error 型

**`StaleTankCycleError`** を定義する。文言だけの区別にしない。

- 汎用の「タンク状態が不正です」に混ぜない
- `asRecoveryConfirmationRequiredError`（`:677`）は専用 name / fingerprint / requirements のみを
  拾うため、別名なら retry loop に入らない
- **status と cycle が両方変化している場合も generic transition error より stale を優先**

### 3.6 opt-in

`TankOperationInput.expectedCycle` は optional。未指定 caller
（maintenance / inhouse / 手動 / 受注貸出）の実行結果は維持される。

**ただし完全な挙動不変ではない**: PR-A1 で carry_over の error message を直すため、
portal KEEP の observable error は変わる。安全性は後退しない。

---

## 4. データ側の状況と実装境界

### 4.1 `BulkTankDoc` — 型だけの問題

`types.ts:49` に `latestLogId` は無いが、**runtime object には既に存在する**
（`bulk-return-candidates.ts:175` が cast、`:208` が spread）。
必要なのは**型への追加と workflow での参照**。

### 4.2 portal marker の4層境界（B-2 の訂正）

`expectedCustomerId` は**既存の `request.customerId` を使う**（新 field を作らない）。
`expectedLatestLogId` のみ新規。

**次の4層すべてが成立して初めて、この再利用が安全になる。**

| 層 | 責務 |
|---|---|
| **Page DTO** | `tankId` / `customerId` / `latestLogId` / `condition` を**落とさない**。<br>現状 `portal/return/page.tsx:64,66` の `TankItem` は customerId も latestLogId も保持していない |
| **Application service** | `customerId` が非空 string / `latestLogId` が非空 string /<br>`item.customerId == identity.customerId`。<br>**欠落・不一致時は repository create を呼ばない** |
| **B-1 Rules** | marker が存在する場合: 非空 string / `request.customerId == current tank.customerId` /<br>`request.expectedLatestLogId == current tank.latestLogId` / tankId 参照が有効 |
| **B-3 Rules** | **すべての `type=return` / `status=pending_return` 作成**について marker を必須化 |

**Rules が最終的な authoritative 境界である。** page や service だけでは改変 client を防げない。

legacy fallback（`customer-reads.ts:60,68` の `location == customerName` 統合）は
**表示互換にだけ使い、identity / cycle binding には使わない。**

### 4.3 marker の型パイプライン（全経路）

```
portal/return/page.tsx（TankItem に customerId / latestLogId を保持）
  → createPortalReturnRequests / createPendingPortalReturnRequest（4層の service 検査）
  → firestore.rules isPortalReturnCreate（keys().hasOnly / hasAll）
  → TransactionDoc（repositories/types.ts）
  → PendingReturn（useReturnTagProcessing.ts:35 で unchecked cast）
  → useReturnTagProcessing の grouping
  → PendingReturnRequestItem（return-tag-processing-service.ts:22）
  → buildReturnConfirmationOperations（:163）
  → TankOperationInput.expectedCycle
```

### 4.4 Rules の key set

`isPortalReturnCreate`（`firestore.rules:1336-1368`）は `keys().hasOnly` と `hasAll` の
**両方**で10キーを固定している。

---

## 5. rollout 順序

```
PR-A1   domain cycle guard + bulk workflow marker 必須化
PR-A2   bulk readiness UI（欠落候補の表示と group disabled）
B-1     Rules: marker を optional 許可 + 存在時に current tank 値と照合
B-2     portal app が marker を書き始める
B'      staff 確定側が marker を消費する
監査    legacy pending を 0件化
B-3     全 pending_return creator に marker 必須化
C       cross-device idempotency
D       multi-document atomicity
E       time authority
```

### 5.1 順序の制約

- **B-3 を B' より前に行わない。** B' が無いまま marker を必須化しても、
  marker 付き request の confirmation guard が使われず ABA が残る
- **B-2 の後も旧 tab / 旧 client が marker なしを作り得る**ため、
  **B-3 の直前に排出確認が必要**
- **D（atomicity）を先にしない。** lifecycle binding が無いまま atomic 化すると、
  誤った cycle 向け申請を確実にまとめて作るだけになる

### 5.2 B-3 は portal 限定ではない（B-3 の訂正）

staff は `isStaff() || isOwnTransactionCreate()` により**任意の transaction を作成できる**
（`firestore.rules:1854`）。

→ B-3 は **すべての `type=return` / `status=pending_return` 作成**を対象にする。
   **marker を書けない creator が残っていないことを inventory して確認する。**

加えて **空文字・空白 marker を許す余地**がある（B-1 は型のみ、B-3 は `hasAll` のみ）。
Rules test に **missing / null / 非 string / 空 / 空白**を含める。

### 5.3 bulk と portal の非対称性

| | cycle 情報の入手元 | PR-A1 だけで厳格化できるか |
|---|---|---|
| bulk return | 候補 query が tanks から毎回 read | **できる** |
| portal 返却確定 | 永続化された request document | できない（B-2 / B' が必要） |

---

## 6. 検証要件

### 6.1 PR-A1 の core unit test — **19件**

| # | 内容 |
|---|---|
| 1 | `expectedCycle` 未指定 caller の挙動不変 |
| 2 | 両 field 一致 → 実行される |
| 3 | `customerId` のみ不一致 → stale error / writer call 0件 |
| 4 | `latestLogId` のみ不一致（**同一顧客 ABA**） → stale error |
| 5 | 両方不一致 → stale error |
| 6 | `null ↔ string` **両方向** |
| 7 | current が `undefined` の legacy tank |
| 8 | 空文字 / 空白を silent skip しない |
| 9 | runtime で片 field 欠落 |
| 10 | **bulk 1件 stale で全 writer call 0**（logs / tanks / aggregationRevision / extraOps） |
| 11 | **status と cycle が同時変化 → stale を優先**（generic transition error にしない） |
| 12 | stale error が recovery retry loop に入らない |
| 13 | recovery confirmation の間に cycle が変化 → 再確認 dialog に入らず stale |
| 14 | **carry_over の既存 catch 経路で正しい message**（`expectedCycle` 未指定で踏むこと） |
| 15 | **marker 欠落で bulk workflow が domain writer を呼ばない** |
| 16 | **複数 bulk のうち1件欠落で部分継続しない** |
| 17 | **valid な bulk 候補の観測値2件が、exact な `expectedCycle` として domain writer に渡る**<br>（これが無いと「欠落は拒否するが valid 時に `expectedCycle` を付け忘れる」実装でも通過する） |
| 18 | **複数件すべてについて #17 の契約を満たす** |
| 19 | **valid item が先・stale item が後の bulk で、全 cycle 検査完了前に planner が一度も呼ばれない**<br>（#10 は writer call しか見ないため、この順序違反を検出できない） |

**#10 / #11 / #14 / #15 / #16 / #17 / #19 は必須。**

### 6.2 PR-B' へ移した test（旧 #17 / #18）

- happy path で log top-level customer と rental boundary customer が一致する
- legacy pending policy の固定

理由: bulk の実経路では top-level customer が存在せず（`bulk-return-workflow.ts:32`）、
legacy pending policy は B' の担当。

### 6.3 Rules test（B-1 / B-3）

- B-1: marker 存在時の型検証 + **current tank 値との一致** / 未知キー拒否
- B-3: **missing / null / 非 string / 空 / 空白**をすべて拒否
- staff の完了更新が marker を書き換えられない

### 6.4 L2 検証（PR-A1 + A2 が揃った後）

検証用タンク **A-99** 使用・ユーザー個別承認下。

1. bulk: 候補表示 → 別画面で返却 → 別顧客へ再貸出 → 実行 → stale 拒否・無変化
2. portal request の stale 確定（B' 後）
3. **同一顧客への再貸出（ABA）で stale になる**
4. stale 時に transaction が pending のまま
5. stale 時に aggregationRevision が不変
6. **marker 欠落候補を含む group が disabled になり、部分実行できない**（A2）

**実施時期と承認者は PR-A2 の Draft PR 本文で確定する。**

### 6.5 監査（実施は §8 の制約に従う）

| 監査 | 内容 | 必要になる時点 |
|---|---|---|
| **marker readiness** | active returnable tank（`lent`/`unreturned`/`in_house`）の<br>`customerId` / `latestLogId` の missing / null / 空白 / 両方有効の件数、status 別内訳 | **PR-A merge / production 適用** |
| **legacy pending** | `type=return` / `status=pending_return` のうち marker が<br>missing / null / 非 string / 空 / 空白のもの。件数・最古/最新 createdAt・匿名化 ID | **PR-B'** |
| **legacy 0件確認** | 上記が 0件であること | **PR-B-3（必須）** |
| **portal heuristic** | `source == "return_tag_processing"` かつ `workflow == "return"` かつ transactionId あり<br>に絞り、client 側で `rental_close` step を抽出して `log.customerId != step.customerId` を数える | 任意 |

**heuristic は「異なる customerId の portal return」の下限件数しか得られない。**
同一顧客 ABA と bulk stale は検出できない。**完全監査ではない。**

出力してよいのは**件数と匿名化 ID のみ**。顧客名・メール・メモ・電話番号は出力しない。
document ID は先頭・末尾をマスクする。監査の前後で baseline（tanks 総数 / active logs /
pending_return / aggregation revision / transactions 総数）を比較し、
並行操作で変化した場合は確定値として扱わず停止する。

---

## 7. 確定した判断

### 7.1 `expectedCustomerId` は既存の `request.customerId` を使う

新 field を追加しない。`expectedLatestLogId` のみ新規。
理由: 二重保持すると**両者が不一致になり得るという新たな不変条件**が生まれる。

**安全性は §4.2 の4層すべてが成立することに依存する。**

### 7.2 bulk return の marker

```
expectedCustomerId  = 候補取得時の tank.customerId
expectedLatestLogId = 候補取得時の tank.latestLogId
```

両方とも**非空 string 必須**。

### 7.3 legacy `pending_return`

```
marker 欠落 0件   → 欠落 request を一律拒否
marker 欠落 1件〜 → cutover 前に全件を正規処理または取消し、0件確認後に一律拒否
```

override は採用しない。**`latestLogId` の自動 backfill は禁止。**

### 7.4 bulk 欠落候補の扱い — **group 全体 disabled**（B-4 の確定）

```
表示: 維持（一覧から除外しない）
選択: 不可
確定: 不可
理由: tank ごとに表示
修復: 自動補完しない
```

**group 内に1本でも欠落候補があれば、group 全体の一括返却を disabled にする。**
**valid なタンクだけを内部で抽出して部分実行してはいけない。**

理由: 現行 UI は group 全件をまとめて submit する
（`useBulkReturnByLocation.ts:79,100`）。欠落タンクだけを内部で除外すると、
作業者には全件処理したように見えながら一部だけ残る **silent bypass** になる。

表示例（copy は既存 UI の文体に合わせて調整可）:

```
cycle情報が不足しているタンクが含まれるため、
このグループは一括返却できません。

対象: A-01、A-05
理由: 顧客IDまたは最新操作IDがありません
```

**PR-A で修復画面は作らない。** 管理者による確認が必要である旨と tank ID を表示する。

**UI を迂回して workflow を直接呼んだ場合も、marker 欠落を検出して
`applyBulkTankOperations` を呼ばずに失敗させる**（§6.1 #15）。

### 7.5 残る ABA 経路はすべて別 gate へ（受容しない）

| 優先度 | 経路 |
|---|---|
| 1 | manual return / keep（`manual-operation-workflow.ts:43`） |
| 2 | inhouse return（`inhouse-return-workflow.ts:31`） |
| 3 | inspection（`tank-rules.ts:227`、`inspection-workflow.ts:36`） |
| 4 | cross-tank correction（`tank-operation.ts:901,1022`） |
| 5 | advisory manual lend / fill recovery（現在 strict 運用のため最後） |
| 5 | **advisory inhouse use / `inhouse_use_retro` recovery**。`inhouse-use-workflow.ts:15,21` は `source:"manual"` / `workflow:"tank_operation"` で実行するため<br>**advisory 対象になり得**、planner は `inhouse_use_retro` の前に `closeCurrentHolder()` で現在 cycle を閉じる（`tank-transition-policy.ts:170,539,586`） |

**PR-A1 / A2 に混ぜない。** PR-A merge 後に docs-only で
**`remaining tank-cycle safety gate`** を作成する。

---

## 8. 監査 IAM の状態と方針

### 8.1 現状 — BLOCKED（正常）

| 項目 | 結果 |
|---|---|
| local gcloud ADC | 存在。type = `impersonated_service_account` |
| impersonation target | `transi***@okmarine-tankrental.iam.gserviceaccount.com`（cutover 用 SA） |
| 実行結果 | `403 PERMISSION_DENIED: unable to impersonate: Permission 'iam.serviceAccounts.getAccessToken' denied` |
| 原因 | cutover 後に production credential が再閉鎖済み（`runbook:11`）。IAM 付与は別承認事項（同`:65`） |

**設計どおりの安全側の状態であり、異常ではない。**

### 8.2 今は IAM を開けない（方針）

本番 read 監査のためだけに閉鎖済み cutover SA の権限を戻さない。次を**行わない**:

- cutover SA への権限復旧 / Token Creator 付与 / Datastore Viewer 付与
- SA key 発行 / ADC 切替 / credential file 作成

### 8.3 後日監査する場合の方式（cutover SA を再利用しない・鍵を発行しない）

```
専用 audit SA : roles/datastore.viewer のみ
実行者        : その SA への Token Creator のみ
終了後        : IAM binding を削除し、audit SA を無効化または削除
```

代替案: 個人 ADC へ一時的に Datastore Viewer を付与する。

**注意（reviewer B-6）**: Token Creator の付与は impersonation を可能にするだけで、
**target SA に Firestore read 権限を与えない**。cutover SA の direct binding は剥奪済み
（`cutover summary:153`）で、旧 custom role を戻すと create/update/delete も戻り
read-only 条件に反する（`runbook:92`）。
key 方式は `runbook:145`（repository 外へ）に反するため採らない。

### 8.4 監査は #171 の merge 条件ではない — downstream gate

| 対象 | 監査 |
|---|---|
| **#171 merge** | **不要**（docs-only。production 変更を開始しない） |
| **PR-A1 / A2 Draft 作成** | **不要** |
| **PR-A1 単独 merge** | **不要。ただし production deploy しない場合に限る**（§8.5） |
| **最初の production 適用** | **marker readiness 確認が必要**（§8.5） |
| **PR-B'** | **legacy pending 監査が必要** |
| **PR-B-3** | **legacy pending 0件確認が必須** |

### 8.5 A1 / A2 の production 境界（R3 指摘3の確定）

**A1 だけを production へ出してはいけない。**

A1 のみ適用すると、現行 UI は一括返却ボタンとタグ選択を**有効表示したまま**
workflow error になる（`useBulkReturnByLocation.ts:79`、`BulkReturnByLocationPanel.tsx:419`）。
データ安全性は fail-closed で保たれるが、作業者体験としては不良。

```
A1 単独 merge          : 可。ただし production deploy しない場合に限る
最初の production 適用 : A1 + A2 + marker readiness 確認 + 必要な L2 が揃った後
代替                   : A1 と A2 を同一 production release に束ねる
```

---

## 9. 変更してはいけないもの / してはいけないこと

- `src/lib/tank-operation.ts` の**分割・移動**（`feature-boundaries.md` §2.4）。足すだけ
- atomicity 境界の分割（`write-ownership.md` §7）
- 状態遷移の意味（`allowedPrev` / `nextStatus`）
- `transitionPlan` / recovery / revision / void の semantics
- 請求額・税・丸め・顧客 grouping
- cycle guard と F4 の single-snapshot 化を**同一 PR にしない**
- cycle guard と C / D / E を**同一 PR にしない**
- **片方（customerId / latestLogId）が欠落しているときに guard を skip しない**
- **現在値から expected を捏造しない**（backfill・自動補完を含む）
- **bulk の一部だけ継続しない**（1件 stale / 欠落なら全件停止）
- **stale 時に transaction を completed にしない**
- **`undefined` を `null` へ無言変換しない**
- **cycle 検査を transition planning より後に置かない**（§3.3）
- **B-3 を B' より前に行わない**（§5.1）

---

## 10. gate 通過条件

- [x] §7.1 `expectedCustomerId` は既存 `request.customerId` を使う — **確定**
- [x] §7.2 bulk marker は両方とも非空 string 必須 — **確定**
- [x] §7.3 legacy pending は 0件なら一律拒否、存在時は正規処理後に一律拒否 — **確定**
- [x] §7.4 bulk 欠落候補は **表示維持 + group 全体 disabled + 部分実行禁止** — **確定**
- [x] §7.5 残存 ABA 経路は全件を別 gate へ — **確定**
- [x] §3.3 検証順序（planning 前）— **確定**
- [x] §4.2 portal 4層境界 — **確定**
- [x] §5.2 B-3 は全 `pending_return` creator 対象 — **確定**
- [x] §6.1 PR-A1 core test 19件 — **確定**
- [x] §8.4 監査は #171 merge 条件ではなく downstream gate — **確定**
- [ ] PR-A1 の変更対象ファイル — **PR-A1 design brief で確定する**
- [ ] PR-A2 の変更対象ファイル — **PR-A2 design brief で確定する**
- [ ] L2 実施時期と承認者 — **PR-A2 Draft PR 本文で確定する**

**未チェック3件は PR-A1 / A2 の brief 段階で確定する。本 gate は merge 可能。**
