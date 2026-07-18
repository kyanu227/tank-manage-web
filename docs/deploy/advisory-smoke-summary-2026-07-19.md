# strict / advisory 管理者レビュー条件・本番smokeサマリ

実施日: 2026-07-19（JST）

Hosting / Rules / FirestoreのAPI timestampはUTC表記で記録する。

```text
Advisory smoke status: ROLLED BACK
```

ここでの`ROLLED BACK`は、一時的なadvisory activation、policy、synthetic test dataをstrict運用へ
戻したことを指す。PR #138の管理者レビュー条件コードと、それに対応する通常Firestore Rulesは本番に残す。

外部顧客の貸出サイクルへ影響するrecoveryだけを管理者レビュー対象にする変更は、PR #138で
実装・検証・本番反映した。strict regression、direct操作、外部顧客recoveryのpending・承認・
正式集計・請求印刷停止／解除までは本番で確認できた。

一方、Smoke Cの実行前キャンセル確認を、デバッグ接続中のChromeで`Escape`により行ったところ、
確認画面を閉じた後にも操作が確定した。ソース上は`window.confirm()`が`false`なら例外で中止し、
再transactionへ進まない実装であるため、製品挙動とブラウザ自動化のどちらに原因があるかは未確定である。
本番smokeとして「キャンセル時の書込み0件」を証明できなかったため、以後のSmoke C〜Eを停止し、
policyをstrict、activation gateをfalseへ戻した。作成済みのテスト操作は全て最新順にvoidした。

## 実施前

### Repository / Hosting / Rules

- 変更前main: `46daa2f6e162b60510114656e4ba4bc6f1c42c40`
- 変更後main / PR #138 merge commit: `e616ec3a483a66e7cce4705de8055dc89dbab1e3`
- PR #138: `Review only customer-impacting advisory recoveries`
- PR #138差分: 13 files / +777 / -83
- 実施前Hosting release: `1784381732201000`
- 実施前Hosting version: `f70481f57cc5ebed`
- 実施前Hosting release time: `2026-07-18T13:35:32.201Z`
- 実施前Rules ruleset: `projects/okmarine-tankrental/rulesets/854aea2e-4027-4b29-9ce2-af67519d762b`
- 実施前Rules normalized SHA-256: `f24fa59afd669f65d2c8e9c311db5ac92de455dcbc844226c02c0b5635aa3d96`
- activation gate: `false`
- `settings/tankOperationPolicy`: document不存在
- 実行時policy: fail-safe `strict`
- pending review: 0件

### テストデータ

- strict regression tank: `A-02`
- 外部顧客recovery tank: `A-04`
- 内部recovery予定tank: `A-05`
- synthetic customer: `smoke-customer-a` / `smoke-customer-b`
- synthetic customerの全操作単価: 0円
- 開始時の対象tank状態: `empty / 倉庫`

実顧客・実単価は使用していない。Data Reset、freeze Rules、暗号化snapshot、migration IAM、
production Reset / restore gateの再解放は行っていない。

## Review条件変更

旧条件:

```text
direct   -> not_required
recovery -> pending
```

新条件:

```text
direct
-> 常にnot_required

recovery + 外部顧客のrental_open / rental_closeあり
-> pending

recovery + hasUnknownAffectedCustomer=true
-> pending

external rental effectなしのinternal-only recovery
-> not_required
```

- top-level action名ではなく`transitionPlan.steps`の`businessEffect`とcustomer identityから判定する。
- service、正式集計projection、請求印刷停止、管理者review、Firestore Rulesを同じ契約へ揃えた。
- 正式集計対象はdirect、`recovery + not_required`、`recovery + approved`である。
- `pending`、`excluded`、`voided`、`superseded`は正式集計対象外である。
- internal-only recoveryは管理者レビューを待たず、正式集計変更時に`officialAggregationRevision`も更新する。
- 外部pendingだけが影響顧客の請求書印刷を停止する。

実装時の検証結果:

- `git diff --check`: PASS
- TypeScript: PASS
- changed-files ESLint: PASS
- production build: PASS
- Vitest: 339 passed / 1 skipped
- transition policy / projection tests: PASS
- Rules Emulator: 1 / 10 / 50 / 100件、100件再貸出、review 1 / 100件を含めPASS
- independent review: P0=0 / P1=0 / P2=0
- full lint: 既存baselineの5 errors / 36 warningsのみ

## strict状態での先行反映

順序どおり、gate=falseの新コード、通常Rules、strict regressionを先に確認した。

- gate=false Hosting release: `1784389355301000`
- gate=false Hosting version: `5cb153c6e10b60a6`
- release time: `2026-07-18T15:42:35.301Z`
- Rules ruleset: `projects/okmarine-tankrental/rulesets/fd260ac3-c05a-44d3-afae-cfeb2f1820a7`
- Rules update time: `2026-07-18T15:43:02.845470Z`
- Rules normalized SHA-256: `0ff72e3c774cc01567dbfd9209b59e5066af38d2bf43a740f28294124eaf83c2`

`A-02`でdirect fill、direct lend、direct returnを実行し、全logが
`transitionPlan.kind=direct`、`transitionReviewStatus=not_required`であること、advisory popupが
出ないこと、pending reviewが0件であることを確認した。請求・売上・スタッフ実績画面も正常に読めた。

## Advisory一時有効化

- gate=true Hosting release: `1784390374428000`
- gate=true Hosting version: `5f0f663d0f23461e`
- release time: `2026-07-18T15:59:34.428Z`
- main SHA: `e616ec3a483a66e7cce4705de8055dc89dbab1e3`
- policy: `transitionEnforcement=advisory`
- policy revision: 1
- policy更新時刻: `2026-07-18T16:01:30.978Z`
- 管理UI再読取: 保存済みadvisory / runtime advisory / revision 1

古いタブにはgate=false bundleが残り得たため、以後の確認はquery付きの新規navigationで最新bundleを
取得した。最新画面にはadvisory有効中のbannerが表示された。

## Smoke結果

### Smoke A: direct

`A-04`でdirect fill後、`smoke-customer-a`へdirect lendした。

- fill log: `direct / not_required`
- lend log: `direct / not_required`
- review一覧: 0件
- 正式集計: 即時反映
- popup: なし

advisory有効中でもstrict-valid操作はdirectのままで、外部顧客を含むことだけを理由にreview対象に
ならないことを確認した。

### Smoke B: 外部顧客recovery・承認

`smoke-customer-a`へ貸出中の`A-04`を`smoke-customer-b`へ貸し出した。

保存されたplan:

```text
system return from smoke-customer-a (rental_close)
-> system fill (state_only)
-> operator lend to smoke-customer-b (rental_open)
```

確認結果:

- top-level log: 1件
- `transitionPlan.kind=recovery`
- nested steps: 3件
- `transitionReviewStatus=pending`
- `affectedCustomerIds`: synthetic customer A / Bの2件と一致
- `hasUnknownAffectedCustomer=false`
- `requiredEvidence`: physical tank / possession / previous customer / fill state
- 保存済みevidence: required 4項目が全て`true`
- recovery confirmation fingerprint: 保存あり
- popup: 現在状態、旧顧客、新顧客、全step、最終状態、外部集計保留を表示
- スタッフ理由入力: なし
- tank状態: 操作直後にsynthetic customer Bへの`lent`
- pending作成時: `tankDataRevision=9`、`officialAggregationRevision=8`
- 承認前: synthetic customer Aの請求印刷停止、synthetic customer Bは正式請求候補へ未算入

管理画面でreview理由`本番スモーク確認済み`を入力してapprovedにした。

- review event: `c1ZbNv38xpFBjy0bsjFt`
- event decision: `approved`
- event / log相互参照: 一致
- reviewedAt: `2026-07-18T16:16:16.013Z`
- 承認後: `officialAggregationRevision=9`
- 承認後: synthetic customer A / Bの請求候補が再取得され、印刷停止が解除
- 売上・スタッフ実績: 再取得後に承認済みrecoveryを反映

このapproved logはcleanup時にvoidしたが、append-only review eventは監査履歴として残した。

### Smoke C: キャンセル検証で停止

`A-04`をsynthetic customer BからAへ再貸出する確認画面を開き、実行前キャンセルの書込み0件を
検証した。確認画面自体は、現在状態、旧顧客、新顧客、3step、最終状態を正しく表示した。

開始前のread-back:

```text
tank=A-04 / lent / smoke-customer-b
A-04 log count=3
tankDataRevision=10
officialAggregationRevision=9
pending=0
```

デバッグ接続中のChromeで`Escape`によりnative confirmationを閉じた後のread-back:

```text
tank=A-04 / lent / smoke-customer-a
A-04 log count=4
tankDataRevision=11
officialAggregationRevision=9
pending=1
```

新規logは、synthetic customer Bの`rental_close`、system fill、synthetic customer Aの
`rental_open`を持つ`recovery / pending`であり、正式集計revisionは増えていなかった。

ソース上の`requestRecoveryConfirmation()`は`window.confirm()`が`false`なら例外を送出し、
再transactionへ進まない。今回の結果はデバッグ接続中のnative dialog処理の影響を否定できず、
製品の通常ブラウザ操作としてのキャンセル挙動は未確定である。ただし本番smokeの必須条件を満たせないため、
原因を推測して続行せず停止条件を適用した。

### 未実施

- Smoke Cのexcluded判断・review event確認
- Smoke Dのinternal-only recovery `not_required`
- Smoke Eのinternal recovery void・再実行

これらは自動テストとRules EmulatorではPASSしているが、今回の本番smokeでは成功扱いにしない。

## Rollback / Cleanup

停止後は次の順で通常運用へ戻した。

1. 管理UIでpolicyをstrictへ変更し、revision 2を保存
2. gate=falseでproduction build
3. Hostingだけを再deploy
4. Smoke Cで作成されたpending recoveryをvoid
5. Smoke Bのapproved recoveryをvoid
6. Smoke Aのdirect lend / fillを最新順にvoid
7. `A-02`のstrict regression return / lend / fillを最新順にvoid
8. synthetic customer A / Bをinactive化
9. Firestoreと管理画面を再読取

最終状態:

- policy: `strict`
- policy revision: 2
- policy更新時刻: `2026-07-18T16:24:36.084Z`
- activation gate: `false`
- runtime: strict
- advisory banner / popup entry: 最新bundleで非表示
- pending review: 0件
- `A-02`: `empty / 倉庫 / latestLogIdなし`
- `A-04`: `empty / 倉庫 / latestLogIdなし`
- `A-05`: `empty / 倉庫`（未使用）
- synthetic customer A / B: inactive
- `A-02` / `A-04` / `A-05`のactive log: 0件
- `tankDataRevision=18`
- `officialAggregationRevision=15`
- 管理review画面: 承認待ちなし
- 請求: synthetic customer A / Bの候補なし、既存`SMOKE_TEST`だけ、警告0件、印刷可能
- 売上: 2026-07-19の操作0件、既存2026-07-18分だけ
- スタッフ実績: 既存baselineの貸出1 / 返却1 / 充填1 / 合計3へ復帰
- 実顧客のactive log・請求候補への追加なし

最終Hosting:

- release: `sites/okmarine-tankrental/releases/1784391921010000`
- version: `sites/okmarine-tankrental/versions/83a7eb0b79e03ec0`
- release time: `2026-07-18T16:25:21.010Z`
- build: `NEXT_PUBLIC_TANK_ADVISORY_ACTIVATION_ENABLED=false`

最終Rules:

- release: `projects/okmarine-tankrental/releases/cloud.firestore`
- ruleset: `projects/okmarine-tankrental/rulesets/fd260ac3-c05a-44d3-afae-cfeb2f1820a7`
- release update time: `2026-07-18T15:43:02.845470Z`
- normalized SHA-256: `0ff72e3c774cc01567dbfd9209b59e5066af38d2bf43a740f28294124eaf83c2`
- source: `firestore.rules`

production Reset / restore gateはCLI・serviceでfalseのままであり、次の2ファイルを同時実行した
gate testは合計15件PASSした。

```text
npx vitest run scripts/cutover/production-execute-gates.test.ts \
  scripts/cutover/production-execute-entrypoints.test.ts
```

cutover専用service account / roleは今回のsmokeでは使用・再作成・変更していない。

## 構造化後に再確認すべき回帰基準

次回は、デバッグ接続や自動dialog handlerのない通常ブラウザで、最初に人間が`キャンセル`ボタンを
明示クリックし、別経路のread-only監査で次を確認する。

1. tank snapshot不変
2. log件数不変
3. pending件数不変
4. `tankDataRevision`不変
5. `officialAggregationRevision`不変

この5条件が通った場合だけ、次の順で残りを再実行する。

1. direct fill / external lendは`direct / not_required`
2. external customer recoveryは`pending`
3. approved前は正式集計対象外・影響顧客の印刷停止
4. approved後は正式集計反映・印刷停止解除・append-only review event作成
5. 別external recoveryを`excluded`にし、tank更新済み・正式集計対象外・official revision不変を確認
6. internal-only recoveryを`recovery / not_required`として即時正式集計し、review一覧・印刷停止対象外を確認
7. 最新active recoveryのvoidでprev snapshotと正式集計を戻す
8. 元logのplan / evidence / fingerprintを変更せず、別logとして再実行する
9. 最新順void、synthetic customer inactive化、strict rev増分、gate=false deployで清掃する

native confirmationの通常ブラウザ手動キャンセルでも書込みが発生する場合は製品blockerとし、
in-app confirmation modal等へ置き換えてから再実行する。通常ブラウザでは書込み0件である場合、
今回の事象は自動化環境固有として証跡に追記する。
