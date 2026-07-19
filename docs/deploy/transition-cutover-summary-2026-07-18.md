# strict / advisory 状態遷移 本番cutoverサマリ

実施日: 2026-07-18（JST）

```text
Deploy status: SUCCESS
```

strict版のData Reset、Hosting、Firestore Rules、業務smokeまで完了した。advisoryの実装基盤は本番コードへ
含まれるが、rollout gateは無効のままである。policy documentは未作成であり、仕様どおりfail-safeのstrictとして実行する。

## 実施前

### Repository / Hosting / Rules

- 最終cutover基準main: `a6e10e228646947e7c718c9644cb40a4a11df34a`
- Hosting release ID: `1783601460595000`
- Hosting version ID: `343888460e7cbf24`
- Hosting release time: `2026-07-09T12:51:00.595Z`
- Rules release: `projects/okmarine-tankrental/releases/cloud.firestore`
- Rules release update time: `2026-07-18T08:48:41.527284Z`
- Rules ruleset: `projects/okmarine-tankrental/rulesets/a6a7e85b-1761-44f4-a714-cc53957611e8`
- Rules normalized SHA-256: `6c9d126dad4980f20f92feda660d13a7d3840b1625d3ac4c74da27ce9e31e1a8`
- rollback RulesのGit正本: `b7e853c8f38071937951b871cbe0e3281dd22876`

### Firestore

- tanks: 145件
- 旧tank operation logs: 38件
- 対象transactions: 8件
- status: empty 133 / filled 9 / in_house 1 / lent 2
- database: `okmarine-tankrental / (default)`
- database UID: `8dcf700f-01a3-4861-bee9-d901504f26b4`

旧開発ログには`transitionPlan`等を必須化する前のschemaが含まれていた。新しい請求・売上・実績readerは
必須schema欠落をfail closedにするため、旧ログを残したままHostingだけを先行反映せず、暗号化snapshot取得後に
開発用操作データをResetする方針を採用した。

### Mode

- advisory build gate: `false`
- `settings/tankOperationPolicy`: document不存在
- 設定解決結果 / 実行時policy: fail-safe `strict`
- policy revision: default `0`

## 実施内容

### 反映済みPR

- PR #122: staff-only strict/advisory状態遷移本体
- PR #123: staff recovery理由入力の削除
- PR #124: 暗号化snapshot / restore core
- PR #125: 192-write atomic Reset
- PR #126: freeze、credential分離、verify-only、runbook等の運用安全基盤
- PR #127: infrastructure readiness toolとiCloud暗号化snapshot対応
- PR #128: Keychain保存修正
- PR #129: Reset時のtank基本情報保持
- PR #130: 固定one-time production execute契約の一時解放
- PR #131〜#134: request size、Rules baseline、失敗診断、module identityのcutover hotfix
- PR #135: cutover完了後のproduction Reset / restore 5ゲート再閉鎖と本サマリ

### 状態遷移・集計

- strictでは`OP_RULES`で直接許可された正規遷移だけを実行する。
- advisory用plannerは不一致操作を固定recovery recipeの正規stepへ展開するが、本番では未有効である。
- tank logは`transitionPlan`、`requiredEvidence`、policy、review状態を必須schemaとして持つ。
- 状態投影、貸出サイクル投影、正式集計投影を分離した。
- recoveryはtank状態を即時更新する一方、`pending`の間は請求・売上・スタッフ実績へ正式算入しない。
- 管理者の集計承認・除外、append-only review event、aggregation revisionを実装した。
- スタッフはrecovery理由を入力せず、補完step・現在状態・旧顧客・新顧客・最終状態を確認する。

### Cutover安全処理

- data migration SAとRules reader SAを別principalへ分離した。
- freeze Rulesを通常Rulesと別configでdeployした。
- AES-256-GCM暗号化snapshotを取得し、改ざん・hash・件数・復号を検証した。
- 145 tank更新、38 log削除、8 transaction削除、marker作成を単一atomic commitにまとめた。
- Reset後は独立verify-onlyで完全適用を確認した。
- advisory gateを`false`に固定してHostingをbuild / deployした。
- 最新の通常Rulesだけを専用configでdeployした。

## 暗号化snapshotとReset

- 保存先: `~/Library/Mobile Documents/com~apple~CloudDocs/TankCutover/`
- snapshot: `transition-plan-v1-a6e10e2-20260718T133140Z.snapshot.enc.json`
- snapshot ID: `9fee4626-a321-47d8-abe4-7a39ef23543a`
- payload SHA-256: `bb4962e9bc05f0a897a8946735068e1f75faf0edb1efe64c8feb07a563c2e40d`
- envelope SHA-256: `af29fd518ee6b48b0a37ce38b96976f578b7f22f26ea984e681e07c4c5583851`
- snapshot documents SHA-256: `50a8ae4fc52133769c72dc8a808402c829a1685c0630c34a695d072be2038b1d`
- source census SHA-256: `ae6125df1cff45aff13f0f2efbfaad2289a655fd39905bbc5054ad91ec8d89b6`
- reset plan SHA-256: `e280ab56145203144c6049e4b83cc36d7226a782c45d414f2ebd86360fbb817a`
- snapshot permission: `0600`
- hard link数: `1`

鍵本文はsnapshot、repository、stdout、このサマリへ保存していない。

Reset結果:

- atomic commit: 192 writes / 93,928 bytes
- commit time: `2026-07-18T13:33:38.529607Z`
- commit response: `confirmed`
- 独立verify-only: `reset_applied`
- stable state SHA-256: `02b69d8562b3ec12aaeaac6c1e45de0496001a851bea693d5ff84ea323830a78`
- restore dry-run: 192 writes / 140,191 bytes、全hash一致

Reset commitは再送していない。restore本実行も行っていない。

Migration marker:

- path: `migrationMarkers/transitionPlanRequiredV1`
- status: `completed`
- script version: `2`
- resetAt: `2026-07-18T13:33:37.991Z`
- main commit: `a6e10e228646947e7c718c9644cb40a4a11df34a`
- target counts: tanks 145 / logs 38 / transactions 8
- total writes: 192
- snapshot ID、payload / source / reset-plan SHA、operator principal、data principalを保存済み

## 実施後

### Firebase Hosting

- deploy source main: `a6e10e228646947e7c718c9644cb40a4a11df34a`
- cutover完了main（PR #135 merge）: `b31054c0db2e80a9595ad9b9f727adde564ec51d`
- site: `okmarine-tankrental`
- URL: `https://okmarine-tankrental.web.app`
- release ID: `1784381732201000`
- version ID: `f70481f57cc5ebed`
- status: `DEPLOY / FINALIZED`
- release time: `2026-07-18T13:35:32.201Z`
- files / bytes: 459 / 1,701,288
- build: `NEXT_PUBLIC_TANK_ADVISORY_ACTIVATION_ENABLED=false`

### Firestore Rules

- release: `projects/okmarine-tankrental/releases/cloud.firestore`
- ruleset: `projects/okmarine-tankrental/rulesets/854aea2e-4027-4b29-9ce2-af67519d762b`
- update time: `2026-07-18T13:37:27.887858Z`
- source: `firestore.rules`
- normalized SHA-256: `f24fa59afd669f65d2c8e9c311db5ac92de455dcbc844226c02c0b5635aa3d96`

最初のnormal Rules deployはRules APIのHTTP 503で失敗した。live Rulesが引き続きfreeze中であることを
read-only確認してから一度だけ再試行し、成功後にruleset・source・hashを再取得して照合した。

### Mode / execute gate

- `settings/tankOperationPolicy`: document不存在（HTTP 404をread-back確認）
- 管理UI表示 / 実行時policy: fail-safe `strict`
- policy revision: default `0`
- advisory UI: disabled
- advisory rollout gate: stopped
- production Reset / restore: CLI、service、lower RESTの5境界を`closed`へ再閉鎖
- cutover専用IAM: data migration SAとRules reader SAの期限付きdirect bindingを剥奪し、残存0件をread-back確認
- 専用service accountとcustom role自体は、監査記録として削除せず保持

## strict本番smoke

書込み前にadmin / staff / portalのread、取消時の非書込み、Reset状態維持を確認した。
point of no returnは`2026-07-18T13:43:16Z`。

対象tank: `A-00`、対象顧客: `SMOKE_TEST`

| 操作 | Log ID | 状態 | policy / plan / review |
|---|---|---|---|
| fill | `guBeYJ3yrL73aM0DDPKG` | `empty → filled` | `strict / direct / not_required` |
| lend | `oYLfLEZOxhXswSB4zxGx` | `filled → lent` | `strict / direct / not_required` |
| return | `3SRHTblljHz7vKe6zYFU` | `lent → empty` | `strict / direct / not_required` |

3ログはいずれも`transitionPlan.version=1`、`requiredEvidence=[]`、operator step 1件である。
貸出は`rental_open`、返却は`rental_close`として保存された。返却confirmの前に一度cancelし、
cancel時はtankとlatestLogIdが変わらず、confirm後だけ返却ログが作成された。

確認結果:

- staff / admin login: 成功
- tank read / reload保持: 成功
- A-00最終状態: `empty / 倉庫`、customerなし、latestLogIdは返却ログと一致
- 全tank: 145本すべてempty、貸出中0本
- 一操作一active log: fill / lend / returnの3件だけ
- pending recovery review: 0件
- 売上統計: fill 1 / lend 1 / return 1、合計3操作
- スタッフ実績: YY 3操作
- 請求候補: SMOKE_TEST 1件、貸出1件、警告0件、設定単価により合計0円
- 個別・一括印刷: 候補がprint-ready、print block 0件で、両方の印刷処理起動を確認（PDFファイル保存は未実施）
- portal customer read: 成功、返却後の貸出表示0件
- raw action code / 内部fieldのUI露出: なし
- advisory recovery: 利用不可

## 利用者から見て変わったこと

- 不正な状態のタンク操作を、状態不整合のまま保存しなくなった。
- strictでは正規の状態遷移だけを許可する。
- advisory用の自動補完基盤は追加されたが、本番ではまだ無効である。
- タンクの現在状態と一操作一ログを同じtransactionで更新する。
- 請求・売上・スタッフ実績は共通の投影ルールから計算する。
- 将来recoveryを有効化した場合も、管理者承認前は請求・売上・実績へ正式算入しない。
- スタッフはrecovery理由を入力せず、画面に示された補完内容を確認して実行する。
- 旧開発用操作データを削除し、全タンクを`empty / 倉庫`から開始した。
- Reset直後かつ最初の業務write前の失敗なら、暗号化snapshotからatomic restoreできる設計を検証した。
  現在はstrict smokeの業務ログがあるため、既存snapshotを現状評価なしに直接restoreしない。

## Rollback情報

- データ: 上記暗号化snapshotは監査・復旧元として保持する。strict smoke後の現在はsnapshotのexact restore
  preconditionを満たさないため、blind restoreせず、freeze後に現状を評価してforward fixまたは承認済み復元計画を選ぶ。
- 直前Hosting: release `1783601460595000` / version `343888460e7cbf24`
- 直前Rules: ruleset `a6a7e85b-1761-44f4-a714-cc53957611e8`
- 直前Rules hash: `6c9d126dad4980f20f92feda660d13a7d3840b1625d3ac4c74da27ce9e31e1a8`
- production execute gateは再閉鎖済みであり、rollbackには別の明示レビューと再開放が必要である。

## 2026-07-18 cutover時点の未実施項目

以下は2026-07-18のcutover完了時点の一覧である。2026-07-19にadvisoryを一時有効化し、通常
ブラウザのキャンセル、承認・除外、internal-only recovery、void・再実行、請求・売上・実績の
本番smokeを完了した。その後は`strict / revision 4 / activation gate=false`へ復帰済みである。
詳細は[advisory smokeサマリ](./advisory-smoke-summary-2026-07-19.md)を参照する。現在も残る運用課題は、
snapshotとKeychain鍵の保持期限決定、および不要後の安全な削除である。

- advisory rollout gateの一時有効化（2026-07-19完了、確認後に再停止）
- policyをadvisoryへ一時変更（2026-07-19完了、確認後にstrictへ復帰）
- advisory recoveryの本番smoke（2026-07-19完了）
- 管理者reviewの承認 / 除外smoke（2026-07-19完了）
- 承認前後の請求・売上・実績反映確認（2026-07-19完了）
- snapshotとKeychain鍵の保持期限決定、および不要後の安全な削除（未完了）

既知の非blocker:

- Firestore DATA_WRITE Data Access Audit Logsは未有効であり、ログ0件をwriter不存在の証明には使用していない。
- snapshot鍵の別媒体保管・別Mac復旧drillは今回の必須条件に含めていない。
