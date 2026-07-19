# 構造化リファクタのPR順序

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
- 既存UIでの手動シナリオ確認: 対象フローをdev環境で1周し、挙動不変を確認して結果をPR本文へ記載する（実DBへの試験書き込みを伴うため対象・件数は最小にし、必要に応じて訂正・取消フローで戻す）
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
