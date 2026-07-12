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
`recoveryReason`、`recoveryEvidence`、`recoveryConfirmationFingerprint`を保存する。

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

状態・policy・planが確認後に変わればfingerprintが一致せず、再確認になる。UIのconfirm/promptは
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
`pending → approved`、direct operation、approved logのvoid/correctionでは正式集計revisionも増やす。
保存済み`monthly_stats`のstale判定には`officialAggregationRevision`だけを使用する。

recovery logの直接編集は行わず、最新active logだけを取消して正しい操作を再実行する。
voidのsnapshot復元もlatest active logだけに限定する。

## Atomic上限とRules

`MAX_ATOMIC_TANK_OPERATIONS = 100`。スタッフ直接のadvisory recoveryについて
1 / 10 / 50 / 100件をRules Emulatorで検証する。
上限超過時は自動分割せずエラーにする。
全readをwriteより前に完了し、transaction callback内でUI stateや外部副作用を更新しない。

Firestore Emulatorで次を実測済み:

```text
1 / 10 / 50 / 100 advisory recovery transaction: PASS
101 tank operation: DENIED
order / return / uncharged_report recovery: DENIED
order_lend / transactionId付きrecovery: DENIED
customer transaction direct operation under advisory setting: PASS
existing strict return transaction completion: PASS
100 log review transaction: PASS
policy write admin-only: PASS
active revision transitionPlan mutation: DENIED
```

再検証:

```bash
PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run test:rules:transition
npm run test:transition-policy
```

既存baseline Rulesには過去のdeploy記録があるが、今回の状態遷移Rules差分は未deployである。
この実装作業ではdeployせず、別のRulesレビュー・本番化工程を必須とする。rollout順序:

```text
コード反映（runtime strict固定）
→ strict smoke
→ Rulesレビュー・本番化
→ Rules smoke
→ rollout gateをtrueにしたbuild
→ 管理画面でadvisory有効化
```

## 初回Data Reset

`scripts/reset-transition-plan-v1.mts`はdry-runが既定で、`--project`を常に必須とする。
tank documentと基本情報を保持し、
全tankの操作projectionを`empty / 倉庫 / customerなし / latestLogIdなし / staffなし / logNoteなし`
へ初期化する。旧tank operation logsと開発用order/return/uncharged_report transactionを削除する。
damaged/defective/disposedも今回だけemptyへ戻す。

```bash
npm run reset:transition-plan-v1 -- --project=<explicit-project-id>

# バックアップとdry-run確認後だけ
npm run reset:transition-plan-v1 -- \
  --project=<explicit-project-id> \
  --execute \
  --confirm=RESET_TRANSITION_PLAN_V1 \
  --backup-ref=<verified-backup-reference>
```

現リポジトリにはbackup referenceを対象project・作成時刻まで機械検証できるregistry/manifestが
存在しない。この検証方式を導入するまでは`--execute`をfail closedで停止し、文字列の
`backupRef`だけで実行可能にしない。検証方式導入後は開始時に
`migrationMarkers/transitionPlanRequiredV1`を`in_progress`で取得し、成功時`completed`、
失敗時`failed`として記録する。completed/in_progressの再実行は拒否する。
strict/advisory切替ではresetを実行しない。
