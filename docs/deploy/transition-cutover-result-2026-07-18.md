# strict / advisory 状態遷移 本番cutover結果

実施日: 2026-07-18（JST）

## 結論

状態遷移必須schemaへのData Reset、Hosting反映、通常Firestore Rules反映、strictモードの本番smokeを完了した。
全tankはReset後に`empty / 倉庫`へ初期化され、smoke対象A-00も`fill → lend → return`後に
`empty / 倉庫`へ戻っている。advisory rollout gateは無効のままで、保存済み設定・実行時モードはいずれもstrictである。

本番Reset / restore用のCLI、service、lower REST clientの5 execute境界は、cutover完了後のPRで再び閉鎖した。

## コードとsnapshot

- cutover基準main: `a6e10e228646947e7c718c9644cb40a4a11df34a`
- entrypoint hotfix: PR #134
- snapshot: `transition-plan-v1-a6e10e2-20260718T133140Z.snapshot.enc.json`
- snapshot ID: `9fee4626-a321-47d8-abe4-7a39ef23543a`
- payload SHA-256: `bb4962e9bc05f0a897a8946735068e1f75faf0edb1efe64c8feb07a563c2e40d`
- envelope SHA-256: `af29fd518ee6b48b0a37ce38b96976f578b7f22f26ea984e681e07c4c5583851`
- snapshot documents SHA-256: `50a8ae4fc52133769c72dc8a808402c829a1685c0630c34a695d072be2038b1d`
- source census SHA-256: `ae6125df1cff45aff13f0f2efbfaad2289a655fd39905bbc5054ad91ec8d89b6`
- reset plan SHA-256: `e280ab56145203144c6049e4b83cc36d7226a782c45d414f2ebd86360fbb817a`

snapshotは暗号化済み、mode `0600`、hard link数`1`として保存した。鍵本文はrepository、stdout、
この文書へ保存していない。

## Data Reset

- reset対象: tanks 145件、tank operation logs 38件、transactions 8件
- atomic commit: 192 writes / 93,928 bytes
- commit time: `2026-07-18T13:33:38.529607Z`
- commit response: `confirmed`
- 独立verify-only: `reset_applied`
- stable state SHA-256: `02b69d8562b3ec12aaeaac6c1e45de0496001a851bea693d5ff84ea323830a78`
- restore dry-run: 192 writes / 140,191 bytes、snapshot・payload・source・reset-plan hash一致

Resetの再送は行っていない。復元本実行も行っていない。

## Deploy

### Firebase Hosting

- site: `okmarine-tankrental`
- URL: `https://okmarine-tankrental.web.app`
- release ID: `1784381732201000`
- version ID: `f70481f57cc5ebed`
- status: `DEPLOY / FINALIZED`
- release time: `2026-07-18T13:35:32.201Z`
- files: 459
- bytes: 1,701,288
- build: `NEXT_PUBLIC_TANK_ADVISORY_ACTIVATION_ENABLED=false`

### Firestore Rules

- normal ruleset: `projects/okmarine-tankrental/rulesets/854aea2e-4027-4b29-9ce2-af67519d762b`
- update time: `2026-07-18T13:37:27.887858Z`
- source: `firestore.rules`
- normalized SHA-256: `f24fa59afd669f65d2c8e9c311db5ac92de455dcbc844226c02c0b5635aa3d96`

最初のnormal Rules deployはRules APIのHTTP 503で失敗した。live Rulesが引き続きfreeze rulesetであることを
read-only確認してから一度だけ再試行し、成功後にruleset・source・hashを再取得して照合した。

## 本番strict smoke

書込み前に管理・スタッフ・顧客画面のread、取消時の非書込み、Reset状態維持を確認した。
point of no returnは`2026-07-18T13:43:16Z`。

対象tank: `A-00`、対象顧客: `SMOKE_TEST`

| 操作 | Log ID | 状態 | policy / plan / review |
|---|---|---|---|
| fill | `guBeYJ3yrL73aM0DDPKG` | `empty → filled` | `strict / direct / not_required` |
| lend | `oYLfLEZOxhXswSB4zxGx` | `filled → lent` | `strict / direct / not_required` |
| return | `3SRHTblljHz7vKe6zYFU` | `lent → empty` | `strict / direct / not_required` |

3ログはいずれも`transitionPlan.version=1`、`requiredEvidence=[]`、operator step 1件である。
貸出は`rental_open`、返却は`rental_close`として保存された。返却確認ダイアログのcancelでは書込みがなく、
confirm後だけ返却ログが作成された。

最終確認:

- A-00: `empty / 倉庫`、customerなし、latestLogIdは返却ログと一致
- 全tank: 145本すべてempty、貸出中0本
- 本日の操作: fill 1 / lend 1 / return 1
- pending recovery review: 0件
- 売上統計: 3操作を正式集計
- スタッフ実績: YY 3操作
- 請求候補: SMOKE_TEST 1件、貸出1件、警告0件、設定単価により合計0円
- 状態遷移設定: 保存済みstrict / 実行時strict / policy revision 0
- advisory: UI無効、rollout gate停止中

## 既知の非blocker

- Firestore DATA_WRITE Data Access Audit Logsは未有効であり、ログ0件をwriter不存在の証明には使用していない。
- snapshot鍵の別媒体保管・復旧drillは継続運用事項である。
- advisory有効化はこのcutoverに含めていない。別の明示判断とbuild・smokeを必要とする。
