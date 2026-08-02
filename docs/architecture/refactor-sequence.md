# 構造化リファクタのPR順序

> **[SUPERSEDED 2026-08-02]** PR順序としては historical（PR-01〜12 は全て完了）。後継は [clean-break-cutover-plan.md](./clean-break-cutover-plan.md)。
> **ただし §2 の検証プロトコル（挙動不変条件・payload固定テスト・L0/L2 検証levelとユーザー承認）は現在も有効**であり、cutover plan §8 が継承している。

- 作成日: 2026-07-19
- 対象commit: 7a118a4c1bce2b12bd272a6de8a69291e9d8d2ef（main HEAD）
- 入力: [residual-structure-audit-2026-07-19.md](../refactor/residual-structure-audit-2026-07-19.md)、[feature-boundaries.md](./feature-boundaries.md)、[write-ownership.md](./write-ownership.md)
- 実装担当: 原則Codex。1PRの単位は「1機能 / 1workflow service / 1query・read model / 1責務境界 / 1機械的な共通Component抽出」のいずれか

## 1. 混在禁止（全PR共通）

次を同じPRに混ぜない:

- service抽出とUI変更
- service抽出とschema変更
- service抽出と旧field削除
- ロジック移動と大規模ファイル移動
- Dashboard correctionとDashboard UI再編
- Rules変更とApplication code変更
- 請求仕様変更と構造整理
- strict/advisory仕様変更とfeature service抽出
- **service抽出とoperation context内容の変更**（source / workflow / returnCondition等のprovenance追加は、抽出完了後の別PR）

## 2. 全PR共通の完了条件

- 既存UI維持 / 保存payload維持 / 状態遷移維持 / atomicity維持
- actor・customer identity維持 / strict・advisory挙動維持 / recovery review挙動維持 / 請求・正式集計対象判定維持
- `git diff --check`
- 変更ファイルのeslint
- `npx tsc --noEmit --pretty false`
- `npm run build`
- `npm test`（vitest run — 既存unit test群の回帰確認）
- `npm run test:rules:transition` / `npm run test:transition-policy` / `npm run test:transition-projections`（既存の遷移系回帰スイート）
- PR固有のテスト（各PRに記載）
- 抽出系PR（PR-01〜PR-10）は、tank-operation境界をmockした**payload固定テスト（vitest）**を必須とする: operation inputを固定するcharacterization testとして、代表入力に対し抽出前後で `applyTankOperation` / `applyBulkTankOperations` / `applyLogCorrection` / `voidLog` へ渡る引数（action・location・note・OperationContextを含むpayload全体）が完全一致することを固定する。エラーメッセージ・確認文言・処理順序・失敗時挙動はテストまたは手動シナリオ表で固定する
- 抽出系PR（PR-01〜PR-10）のみ: 既存UIでの手動シナリオ確認。現行dev環境は本番Firestoreへ接続している（DB分離は将来課題）ため、実施は [full-app-flow-verification-plan.md](../verification/full-app-flow-verification-plan.md) の検証level運用と停止条件に従う — L0（read-only確認）は常時実施し、writeを伴う確認は検証用tank・note等を明記した上で、L2該当操作（tank status / logs / transactions 等）は**ユーザー個別承認の下で**実施する。確認結果と戻し方をPR本文へ記載する。docs-onlyや非抽出PRには適用しない
- **workflow serviceを直接呼ぶEmulator smokeは必須条件にしない**。現行のWeb SDK初期化（config.ts）は`connectFirestoreEmulator()`を呼ばず（環境変数`FIRESTORE_EMULATOR_HOST`で自動接続するのはAdmin SDKのみ）、`tank-operation.ts`はそのsingleton `db`を直接importするため、`firebase emulators:exec`内でserviceをimport・実行してもEmulator接続は保証されず、環境次第で本番接続となり得る（fail-closedでない）。既存のRulesテスト（`initializeTestEnvironment`の専用instance）・cutoverテスト（明示的なREST emulator client）もworkflow serviceを直接呼ぶ前例ではない。Emulator integration testはPR-D5のharness整備後の独立PRとする

## 3. PR一覧（実行順）

### Phase A — パターン確立（小さい縦経路から）

最初に最小の縦経路でworkflow serviceの型（ファイル配置・シグネチャ・PRチェックリスト）を確立し、以降のPRが踏襲する。手動操作（最複雑）から始めない理由は、パターン未確立のまま最大のhookを動かすリスクを避けるため。

| PR | 対象 | 触るファイル候補 | 触らない | 固有の不変条件・テスト |
|---|---|---|---|---|
| **PR-01** damage workflow service（パイロット） | /staff/damage の業務部分を `features/maintenance/services/damage-workflow.ts` へ | damage/page.tsx、新service | tank-operation.ts、tank-rules.ts、他page | ACTION.DAMAGE_REPORT・location・note文言・payload・context（actorのみ）完全一致。payload固定テスト（破損報告の代表入力1件以上） |
| **PR-02** repair workflow service | /staff/repair → `repair-workflow.ts` | repair/page.tsx、新service | 同上 | ACTION.REPAIRED・current status受け渡し一致。payload固定テスト（修理完了の代表入力1件以上） |
| **PR-03** inspection workflow service + 期限算出純粋関数 | /staff/inspection → `inspection-workflow.ts` + `lib/inspection-schedule.ts` | inspection/page.tsx、新service、新lib+unit test | 同上、settings write経路 | 期限算出結果が現行と同一であることをunit testで固定。tankExtra内容一致 |
| **PR-04** inhouse-use workflow service | /staff/inhouse の自社利用を `features/inhouse/services/inhouse-use-workflow.ts` へ | inhouse/page.tsx、新feature dir | tank-tag-service.ts | ACTION.IN_HOUSE_USE_RETRO・location=自社・事後報告note一致 |
| **PR-05** inhouse-return workflow service | 自社返却を `inhouse-return-workflow.ts` へ。tag marker write呼び出しも同service経由に移す | inhouse/page.tsx、新service | tank-tag-service.ts（owner関数は変更しない） | tag復元・保存タイミング・tag別action一致。開始条件: PR-04 |

### Phase B — staff-operations核心

| PR | 対象 | 要点 |
|---|---|---|
| **PR-06** manual-operation workflow service | `useManualTankOperation` のconfirm以降を `services/manual-operation-workflow.ts` へ（R-12） | 最大のPR。transition判定結果・queue挙動・confirm文言・`applyBulkTankOperations`呼び出し内容の完全一致。hookはUI stateへ縮小。開始条件: Phase Aでパターン確立済み |
| **PR-07** order-fulfillment validation移動 | 承認前check（useOrderFulfillment.ts:100-117）と確定時validation（同:219-257）の業務判定をserviceへ（R-13）。scan中のUI valid/error表示（同:128-187）はhookに残す | 触るのは useOrderFulfillment.ts と order-fulfillment-service.ts のみ。エラー文言・発火タイミングを不変条件とする。write経路・atomicity変更なし |
| **PR-08** bulk-return read/grouping query分離 | `queries/bulk-return-candidates.ts` 新設（R-15前半） | grouping結果・updatedAt近似・tag復元値の一致。write側は触らない |
| **PR-09** bulk-return workflow service | tag別action/location・payload構築・operation呼び出しを `services/bulk-return-workflow.ts` へ（R-15後半）。tag marker write呼び出しも同service経由に移す（tank-tag-serviceのowner関数は変更しない） | logNote marker・空tankNote・returnCondition非送出を維持（R-17は解消しない）。開始条件: PR-08 |

### Phase C — dashboard（厳密に3分割）

| PR | 対象 | 要点 |
|---|---|---|
| **PR-10** log-correction workflow service | 単一訂正 / 単一取消 / 一括貸出先変更 / 一括取消の4経路を `features/staff-dashboard/services/log-correction-workflow.ts` へ(R-21前半) | editReason必須・latest-only制約はtank-operation.ts側のまま。一括loopの順序・失敗時挙動一致。payload固定テスト（訂正・取消それぞれ代表入力） |
| **PR-11** dashboard query / read model分離 | 取得・集計を `features/staff-dashboard/queries/` へ | 開始条件: PR-10マージ + **個別設計note**（新設ファイル名・query条件・limit・sort・集計出力・履歴取得の範囲を本docの改訂として確定してから発注）。集計値の一致確認 |
| **PR-12** dashboard UI再編 | 表示構造の整理 | 開始条件: PR-11完了後、pageがthin wrapper化しているかを確認して個別設計。thin wrapperでない場合はClaude UI-only条件（AGENTS.md）を適用せずCodexが実装 |

#### PR-12 個別設計gate（2026-07-27）

- **前提・開始条件 / 担当**: PR-11はmerge済み。現行`src/app/staff/dashboard/page.tsx`は23 state、13 named handler、query/read model orchestration、write/history/cache、JSX/CSSを保持するためthin wrapperではない。Codexが担当し、PR-12実装は個別設計正本 [staff-dashboard-ui-boundary-design.md](../design/staff-dashboard-ui-boundary-design.md) を追加する本docs-only PRのmerge後に開始する
- **採用architecture / 1PR判定**: 案B（page controller + controlled section components）。pageはpresentation-light controllerとなるがthin wrapperにはせず、controller hook / context / reducer / storeを新設しない。query/read/write/domain変更なし・controlled propsのみの機械抽出として1PRで実施可能
- **想定変更8件（上限8件）**: 更新`src/app/staff/dashboard/page.tsx`。新設`src/features/staff-dashboard/components/StaffDashboardView.tsx`、`DashboardSectionLabel.tsx`、`DashboardStatusSummary.tsx`、`DashboardOperationsSummary.tsx`、`DashboardLogsSection.tsx`、`DashboardCorrectionModals.tsx`、`dashboard-components.test.ts`。styles / hook / types / view-model / utility / barrelは新設しない
- **責務・state・props**: page=controllerがsession/tanks/query/read model、23 state、derived selection、permission/disabled reason、4 write handler、history fetch/cache、refresh、business/formatting結果を一意に所有する。componentsはreadonly data + controlled value + typed callbackだけを受け、state複製・business再計算・query/write/alert/`Date.now()`を行わない
- **helper / CSS**: business・permission・timestamp・formatting helperはpage側で結果化して渡す。presentational helperだけをcomponentへ移す。既存inline styleは各表示ownerへ機械移動し、root/header/loading/`@keyframes spin`/720px responsive styleは`StaffDashboardView`が所有する。見た目・class・breakpointは変更しない
- **Claude-safe surface**: 後続Claude UI-only PRで編集可能なのは上記6 component TSXだけ。page、component test、query、read model、workflow、repository/domain/package/Rules/index/Firebase設定は対象外。visual調整はPR-12と分離し任意の別PR
- **不変条件**: PR-11の初期3read・200件cap・customer順・未充填10/5件・today/local-day・sort/timestamp/`NaN`・root history、PR-10の4 write handler/payload/reason/role/actor/alert/state clear/refresh/catch/finally、全UI state、文言/DOM順/empty/loading/title/disabled/modal/selection/history/color/spacing/720px responsiveを維持する
- **検証**: TypeScript AST/source comparisonでhandler・query/read-model call・permission/timestamp helper・state owner・callback/modal wiring・text/CSS・forbidden importを固定し、追加packageなしのstatic render/component contract test、eslint/TypeScript/build/full unit/transition 3 suites、PR-head L0（mobile含む、business write 0件）を実施する

#### PR-11 個別設計gate（2026-07-27）

- **前提・開始条件**: PR-10はmerge済み。PR-11実装は、個別設計正本 [staff-dashboard-read-model-design.md](../design/staff-dashboard-read-model-design.md) を追加する本docs-only PRのmerge後に開始する
- **想定変更5件**: 新設 `src/features/staff-dashboard/queries/dashboard-query.ts` / `dashboard-query.test.ts` / `dashboard-read-model.ts` / `dashboard-read-model.test.ts`、更新 `src/app/staff/dashboard/page.tsx`。追加のtypes、hook、component、repositoryは新設しない
- **initial logs**: `logsRepository.getActiveLogs({ orderBy: null })`を使用する。`logStatus == "active"`以外のfilter、Firestore orderBy、limitは追加せず、repository返却順の先頭200件をclient sort前に採用する
- **customers / uncharged reports**: `listActiveCustomerSnapshots()`の返却順を維持する。`getUnchargedReports()`はtype以外のfilter、Firestore orderBy、limitを追加せず、現行のcreatedAt comparator（finite/nullish keyだけなら降順、`NaN`混在時は全体順を保証しない）で最大10件を保持し、表示は5件とする
- **tanks / read model**: tanksは`useTanks()`を維持する。read modelはtotal tank数、status別件数、貸出先別件数、今日の操作total/breakdown、最近の未充填報告を出力し、log表示sortを純粋関数へ分離する
- **today / timestamp**: today境界は注入した`nowMillis`のbrowser runtime local dayとする。数値`0`とraw `NaN`は`null`、Invalid Date・`±Infinity`・無効な`toDate()`／`toMillis()`は`NaN`になり得る現行挙動をcharacterizationとして維持し、日付正規化は別設計・別PRとする
- **root history**: `getLogsByRoot(rootLogId)`でroot chain全件を取得し、logStatus/logKind filter、Firestore orderBy、limit、paginationを追加せず、client側でrevision昇順（欠損=`0`）にする
- **変更しない境界**: repository API、Firestore query/index、schema、write workflowは変更しない。UI/JSX/CSS/component再編はPR-12へ分離し、PR-11完了後にpageのthin-wrapper化を確認して個別設計する

### Phase D — 収穫（gate条件を満たせば順不同。D番号は識別子であり実行順ではない）

| PR | 対象 | gate条件 |
|---|---|---|
| **PR-D1系列** 共通UI抽出（スキャンUI・キュー表示・確認UI・結果表示） | 1PR=1component（D1-1, D1-2, …と採番）。同一責務・同一props・同一挙動が実証されたものだけ | Phase A+B完了 |
| **PR-D2** 機械的リネーム（R-35） | `useDestinations` → `useCustomerOptions` へrename（read先はcustomers-serviceのため）。変更ファイル: hooks/useDestinations.ts（ファイル名含む）と OperationsTerminal.tsx:10,141-166,272。関連型名も追随（定義位置は実装時に確認）。挙動変更なし | 随時 |
| **PR-D3** dead code整理 | `updateTransaction`（repositories/transactions.ts）等、caller 0を機械確認の上で削除 | 随時 |
| **PR-D4** docs整理 | CLAUDE.md / SITEMAP.md / AGENTS.mdのディレクトリ記述現行化 + progress.md運用縮小の提案 | 随時。docs-only単独PR、ユーザー承認前提（[document-authority.md](./document-authority.md)参照） |
| **PR-D5** Emulator smoke harness | workflow serviceをEmulatorで実行するtest harnessを独立設計・新設。fail-closed要件: ①`firebase emulators:exec --project demo-structural-smoke`（CLIと同じdemo-*固定）配下でのみ動作 ②`FIRESTORE_EMULATOR_HOST`未設定なら即異常終了 ③接続先をlocalhostのEmulatorに限定し、それ以外への接続を拒否 ④`connectFirestoreEmulator()`を**workflow serviceのimport・実行より前に**明示呼び出し ⑤Rules用mock staff認証context（Auth Emulator）+ staff / staffByEmail / tanks のfixture投入 ⑥emulators:exec終了で状態破棄（完全な後始末）。触るのはscripts/・専用firebase config（新規ファイル）・package.jsonのscript追加のみ。検証はdemo projectでのwrite→read roundtrip | Emulator上の実行検証が必要になった時のみ（本sequenceの必須前提ではない）。**PR-01のdamage抽出には混ぜない** |

## 4. sequence対象外（別設計 or 別トラック）

| 項目 | 理由 |
|---|---|
| R-02 portal自動返却判定のservice化 | 低優先。後続候補 |
| R-09 staffByEmail mirror一本化 | 意味変更なしで可能か要確認。可能なら小PR化 |
| R-10 alertMonths/validityYears二重保存 | schema/正本分離の別設計 |
| R-17 logNote一時state解消 | schema変更の別設計 |
| R-23 uncharged_report handling fields | schema変更の別設計 |
| R-25 provenance（source/workflow/returnCondition）caller coverage | 保存内容の追加=意味的変更。抽出完了後に独立PR系列として設計 |
| R-26 legacy actor field write停止 | 保存payload変更。別設計 |
| R-28 currentLentAt projection | schema変更の別設計 |
| R-29 legacy location/name fallback削除 | 請求仕様（Codex領域の別設計） |
| R-30 tank-trace query整理 | 挙動変更リスク。別設計 |
| R-36 staffSession write/clear集約 / R-37 CustomEvent置換 | 認証・イベント設計の別トラック |
| R-39 edit_history実装 | 新機能 |
| R-40 dev-staff実データ衝突 / R-41 Console index状態 | コード外の運用確認タスク（Firestore実データ / Firebase Console） |

## 5. 設計停止条件

次のいずれかが判明した時点で、そのPRの構造化作業を**中断**し、論点を新規設計docへ記録して次の独立PRへ進む:

- schema変更が必要
- Firestore Rules変更が必要
- 請求額・税・丸め・顧客groupingの変更が必要
- 状態遷移・strict/advisory・revision/voidの意味変更が必要
- atomicityの分割が必要
- tank-operation.tsの移動・分解が必要
- 保存payloadを維持できない
- 1PR内で複数機能の挙動が変わる

## 6. rollback単位

各PR = 単独revert可能な単位とする。PR内で新設したファイルはそのPRの中でのみ参照され、revertで参照が残らないこと。

## 7. 追跡方法

- 進捗はcodex-companionのjob status + PR本文 + `.codex-logs/`（gitignore済み）で追跡する
- tracked `progress.md` への毎回追記を本sequenceの前提にしない。現行CLAUDE.mdの追記運用との整合は PR-D4（docs整理）で扱い、それまでは既存運用を維持してよい
