# 状態遷移「厳格／自動補完」実装仕様

更新日: 2026-07-13

## 実装境界

- `strict`: transaction内で読んだ現在状態から直接許可された操作だけを実行する。
- `advisory`: 通常運用の不一致だけを固定recipeでstrict-validな複数stepへ展開する。
- `OP_RULES`は両モードで不変。validation skipは存在しない。
- document不存在・設定欠落・不正値はstrict。policy read失敗は操作全体を中止する。
- rollout gateが閉じたbuildは、Firestore値がadvisoryでもruntime strictへ固定する。
- advisory recoveryは`manual` / `bulk_return`かつ`workflow == tank_operation`で、
  `transactionId`を持たないスタッフ直接操作だけに適用する。
- 顧客起点の受注・返却申請・未充填申請を処理する経路は、設定がadvisoryでも
  plannerをstrictとして実行する。top-level `policyMode`は設定snapshotを保存し、
  `transitionPlan`はdirectだけを許可する。既存の直接遷移だけを許可し、
  order / return / uncharged_report transaction処理自体は変更しない。

設定document:

```text
settings/tankOperationPolicy
  transitionEnforcement: strict | advisory
  policyRevision: number
```

advisory有効化build:

```text
NEXT_PUBLIC_TANK_ADVISORY_ACTIVATION_ENABLED=true
```

## Log schema

`logKind == "tank"`では、全revisionに次を必須とする。

```ts
type TransitionPlan = {
  version: 1;
  kind: "direct" | "recovery";
  steps: TransitionStep[];
  requiredEvidence: RecoveryEvidenceKey[];
};

type TransitionStep = {
  action: TankOperationActionCode;
  fromStatus: TankStatusCode;
  toStatus: TankStatusCode;
  actorType: "system" | "operator";
  businessEffect: "state_only" | "rental_open" | "rental_close";
  customerId?: string;
  customerName?: string;
  location?: string;
};
```

Top-levelには`transitionReviewStatus`、`policyMode`、`policyRevision`、
`affectedCustomerIds`、`hasUnknownAffectedCustomer`を保存する。recoveryではさらに
`recoveryEvidence`、`recoveryConfirmationFingerprint`を保存する。スタッフには理由入力を
要求せず、管理者が正式集計への算入を判断する`reviewReason`は引き続き必須とする。

visible operation 1件につきtop-level logは1件だけ作り、system stepはnested planに保存する。

## 初回固定recipe

許可する補完:

- `empty → system fill → operator lend`
- `lent/unreturned → system return → system fill → operator lend`
- `in_house → system inhouse_return → system fill → operator lend`
- `lent/unreturned → system return → operator fill`
- `in_house → system inhouse_return → operator fill`
- 上記と同じ返却・充填を経る`inhouse_use` / `inhouse_use_retro`

初回対象外:

- 状態を作るためのsystem lend
- 空・充填済みからの仮想貸出を経る返却・持ち越し
- 破損報告、故障・不良化、修理、耐圧検査、検査不合格、廃棄の補完
- `lent/unreturned → system return → operator damage_report`

メンテナンス操作はstrict/advisoryとも既存の直接遷移条件を満たす場合だけ実行する。
`disposed`は常に停止し、`damaged` / `defective`から通常貸出へ戻すには実担当者の
修理・検査操作を必要とする。

## 確認とfingerprint

plannerが`requiredEvidence`を決め、UIは指定項目だけを表示する。確定時に全項目がtrueか
transaction内で再検証する。fingerprintにはtank ID、transaction読取時のlatestLogId、
status、location、customerId、visible action、全step、requiredEvidence、policyRevisionを含む。
一括時はtank ID順のcanonical JSONをSHA-256化する。

状態・policy・planが確認後に変わればfingerprintが一致せず、再確認になる。UIのconfirmは
transaction callback外でのみ実行する。

## Reviewと集計

- direct: `transitionReviewStatus = not_required`
- recovery: 状態snapshotを即時更新し、`transitionReviewStatus = pending`
- terminal transition: `pending → approved | excluded`
- `reviewedAt`は監査日時だけに使い、業務日時は`originalAt ?? timestamp`を使う。
- review transactionごとにappend-only batch eventを1件作り、対象`logIds`、判断、実認証actor、
  理由、最小log snapshotを保存する。各review済みlogとrevision documentは同じevent IDを参照する。

投影は分離する。

```text
projectStateTransitions       全step
projectRentalCycleEvents      rental_open / rental_close
projectOfficialAggregationEvent directまたはapprovedの最終operator step
```

pending recoveryの影響顧客は請求書印刷を停止する。影響顧客不明なら全件停止する。
再取得通知と正式集計cacheの無効化は、同じrevisionへ混在させない。

```text
settings/tankAggregationRevision
  tankDataRevision                 raw log・pending・印刷停止状態の変更で増分
  officialAggregationRevision      正式集計対象が変わる場合だけ増分
  changedLogIds                    transactionで変更したlog ID
  officialAggregationLogIds        正式集計を変えたlog ID subset
```

請求・売上・スタッフ実績画面は`tankDataRevision`を購読してraw logsから再取得する。
pending作成と`pending → excluded`では`officialAggregationRevision`を増やさない。
`pending → approved`、direct operation、direct logのcorrection、正式集計対象logのvoidでは
正式集計revisionも増やす。
保存済み`monthly_stats`のstale判定には`officialAggregationRevision`だけを使用する。

訂正・取消は次の境界で固定する。

- direct logは既存の訂正機能を利用できる。
- recovery logは直接訂正せず、既存logのplan・evidence・fingerprintを上書きしない。
- 誤ったrecoveryが対象tankのlatest active logである場合だけ取消できる。
- 取消後は現在のpolicyとtransaction内の実状態から正しい操作を再実行する。
- 再実行がrecoveryになる場合は、再計画したtransitionPlan、確認したevidence、再生成したfingerprintを
  持つ別logを作成し、`transitionReviewStatus: "pending"`として管理者レビューへ送る。
- 後続active logがある過去recoveryは取消せず、過去snapshotを現在のtankへ復元しない。

ここで「再生成したfingerprint」は再実行時の確認内容から改めて計算・保存するという意味であり、
取消によって完全に同じ前提状態へ戻った場合までhash値の相違を要求するものではない。

## Atomic上限とRules

`MAX_ATOMIC_TANK_OPERATIONS = 100`。スタッフ直接のadvisory recoveryについて
1 / 10 / 50 / 100件をRules Emulatorで検証する。
上限超過時は自動分割せずエラーにする。
全readをwriteより前に完了し、transaction callback内でUI stateや外部副作用を更新しない。

Firestore Emulatorで次を実測済み:

```text
1 / 10 / 50 / 100 advisory recovery transaction: PASS
100 three-step re-lend recovery transaction: PASS
101 tank operation: DENIED
order / return / uncharged_report recovery: DENIED
order_lend / transactionId付きrecovery: DENIED
customer transaction direct operation under advisory setting: PASS
existing strict return transaction completion: PASS
100 log review transaction: PASS
policy write admin-only: PASS
active revision transitionPlan mutation: DENIED
operation/originalAt改ざん・official actor付替え: DENIED
一般staffの72時間超過correction / void: DENIED
```

再検証:

```bash
PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run test:rules:transition
npm run test:transition-policy
```

既存baseline Rulesには過去のdeploy記録があるが、今回の状態遷移Rules差分は未deployである。
この実装作業ではdeployせず、別のRulesレビュー・本番化工程を必須とする。

既存active tank logにはtransitionPlanがなく、既存lent tankにはcustomerId/customerNameがない場合がある。
そのため、Data Resetより先にこのconsumer/UIをHostingへ反映してはいけない。PR mergeはdeploy許可を意味せず、
検証可能なbackup方式が導入されてData Resetとschema verificationが完了するまでHosting反映をblockingする。
resetとdeployの間に旧形式logが再作成されないよう、切替は操作停止を伴うmaintenance windowで実施する。

rollout順序:

```text
PR merge（Hosting未反映）
→ snapshot / restore・atomic Reset実装のmerge（production executeは無効）
→ freeze Rules・credential・writer停止・runbookのレビュー
→ maintenance window開始（全clientとRules迂回writerを停止）
→ dedicated freeze Rules deploy・反映待ち・deny smoke
→ 本番暗号化snapshot取得・Reset dry-run・本実行・schema verification
→ runtime strict固定のHosting deploy
→ 通常Rules deploy・Rules smoke・strict smoke
→ maintenance window終了
→ Firestoreの保存済みpolicyがstrictであることを再確認（advisoryならgate build前にstrictへ戻す）
→ rollout gateをtrueにしたbuild
→ 管理画面でadvisory有効化
```

## 初回Data Reset

実運用手順、Rules迂回writer停止、credential、freeze/normal Rules、ambiguous outcome、rollbackは
[`transitionPlan v1 cutover runbook`](../cutover/transition-plan-v1-runbook.md)を正本とする。

暗号化snapshotを唯一の正本として、`scripts/reset-transition-cutover-snapshot.mts`が
summary-only dry-runを行う。tank documentと分類済みの基本情報を保持し、全tankの操作projectionを
`empty / 倉庫 / customerなし / latestLogIdなし / staffなし / logNoteなし`へ初期化する。
旧tank operation logsと開発用order/return/uncharged_report transactionを削除し、
damaged/defective/disposedも今回だけemptyへ戻す。未知tank field、unknown logKind / transaction type、
snapshot後のpath・updateTime・field hash・inventory差分、subcollection、既存markerがあれば停止する。

```bash
npm run --silent reset:transition-plan-v1 -- \
  --project=<explicit-project-id> \
  --database=<explicit-database-id> \
  --expected-database-uid=<database-uid> \
  --expected-main-commit=<40-character-main-sha> \
  --key-id=<keychain-key-id> \
  --snapshot=<absolute-encrypted-snapshot-path>
```

Reset計画は、tank full overwrite、tank log / transaction delete、`completed` migration marker作成を
一つのFirestore REST Commitへまとめる。各既存documentにはsnapshot時の`updateTime`、markerには
`exists:false`をpreconditionとして使用し、400 writes / 8 MiBの内部上限を検査する。
dry-run stdoutには件数、status集計、write数、決定的なrequest bytes上限、hashだけを出す。
request bytes上限は、Firestore timestampを最大幅へ置換した計測用copyから算出する。実際に保存する
timestampやcommit bodyは変更せず、実bodyがこの上限以下かつ8 MiB以下であることを検査する。
`resetPlanSha256`は実行時刻の`resetAt`だけを除いた正規化済み契約から生成し、
別processで行うdry-runとexecuteが同じsnapshot・同じreset計画であることを比較できるようにする。

本PR段階ではproduction `--execute`をCLI、service、REST clientの全境界で停止する。
freeze Rules、Rulesを迂回するwriter停止、credential/principal照合、runbookが別PRで完了するまで
本番Resetは実行できない。失敗時に`failed` markerを別writeで残さず、曖昧なcommit応答は
完全なread-back検証に成功した場合だけ成功扱いにする。
反復read-backでsnapshot時点の原状態を観測しても未適用とは断定せず、maintenanceを維持したまま
後続runbookのverify-only手順で適用状態を確定する。自動再commitは行わない。
commit直前の再照合後に新規対象documentを追加するwriterまでは既存documentのpreconditionだけで
排除できないため、production executeの解放条件にはdedicated freeze RulesとRules迂回writer停止を含める。
strict/advisory切替ではresetを実行しない。
