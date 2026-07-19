# Feature境界の正本設計

- 作成日: 2026-07-19
- 対象commit: 7a118a4c1bce2b12bd272a6de8a69291e9d8d2ef（main HEAD）
- 入力: [residual-structure-audit-2026-07-19.md](../refactor/residual-structure-audit-2026-07-19.md)（同commit対象の残差監査。本文中の R-xx は同監査の項目ID）
- 位置づけ: 構造化リファクタにおける feature 境界の正本。実装PRはこの境界に従う
- 優先順位: AGENTS.md > 現行コード > 現行テスト > 本docs。矛盾を発見した場合は本docsを更新する

## 1. 基本形

```text
Route / Page
  → Feature Component
    → Feature Hook
      → Feature Workflow Service
        → Shared Domain Core または Repository
          → Firestore
```

適用原則:

- 全機能に機械的に全レイヤーを強制しない。単純な設定保存は「page → 保存service」の薄い経路で足りる（settings系service群は現状のままでよい）
- Feature Workflow Service 境界を必須とするのは高リスク操作のみ:
  tank lifecycle書き込み / 複数collection更新 / identity解決を伴う操作 / 監査（訂正・取消）/ atomicityを持つ操作
- 参照実装は return-tag-processing（R-14 解消済み）: hookは選択・通知のみ、serviceが再取得・変換・operation・transaction完了を担う

## 2. 共通原則

1. **Feature間の直接import禁止**。現行HEADで違反0件（残差監査 §5）。この状態を維持する。複数featureの組み合わせは composition 層（page / OperationsTerminal / layout）でのみ行う
2. **業務別 workflow service の分離**。次の業務を1つの汎用serviceへ統合しない:
   手動貸出・返却・充填 / 受注貸出 / 貸出先別一括返却 / 返却申請処理 / 破損 / 修理 / 耐圧検査 / 自社利用・自社返却 / ログ訂正・取消。
   `UniversalTankOperationService` や action を受け取る巨大汎用 workflow service は禁止
3. **共通化の上限**: OperationContext / identity解決 / タンクID正規化 / 共通入力型・結果型 / 純粋な変換関数 / スキャンUI / キュー表示 / 確認UI / 結果表示 まで。
   **各featureに残すもの**: 業務validation / action決定 / location決定 / note生成 / 関連transaction更新
4. **`src/lib/tank-operation.ts` の扱い**: 現在位置のまま、tank lifecycle・logs・revision・void・strict/advisory・atomic write の正本境界とする。
   禁止: ファイル移動（`src/lib/domain/` 等への移設）/ Repositoryへの分解の目的化 / 状態遷移意味の変更 / revision・voidの不変条件変更 / strict・advisoryの意味変更 / atomicityの分割。
   Feature Workflow Service から `applyTankOperation` / `applyBulkTankOperations` / `applyLogCorrection` / `voidLog` を直接呼ぶ構造が**正規経路**
5. **共通Component抽出の時期**: 2〜3機能の縦分離が完了し、同一責務・同一props・同一挙動が実証されたUIだけを機械的に抽出する。先回りで共通Componentを設計しない

## 3. Shared Domain Core（featureから共有してよい既存モジュール)

| module | 責務 |
|---|---|
| `src/lib/operation-context.ts` | OperationContext型・identity表現 |
| `src/lib/tank-operation.ts` | tank lifecycle atomic writer（唯一） |
| `src/lib/tank-id.ts` | タンクID正規化 |
| `src/lib/tank-rules.ts` / `tank-action-status-codes.ts` / `tank-action-status-labels.ts` / `tank-action-status-display.ts` | action・status code正本と表示変換 |
| `src/lib/return-tag-rules.ts` / `return-tag-labels.ts` | 返却タグの純粋変換 |
| `src/lib/tank-transition-policy.ts` / `tank-transition-projections.ts` / `tank-operation-limits.ts` | 遷移policy・純粋projection・atomic上限（pure test有） |
| `src/lib/firebase/repositories/*` | read repository（Phase 2-B完了範囲。AGENTS.md: 続きを勝手に始めない） |
| `src/components/*` | 汎用UI（QuickSelect, TankIdInput, ReturnTagSelector, DrumRoll 等） |

## 4. Feature一覧（As-Is → Target）

### 4.1 staff-operations（複合feature）

- 入口route: `/staff`（メイン）, `/staff/lend`, `/staff/return`, `/staff/fill` — いずれも薄いwrapper（監査 §3.1で確認済み）
- composition層: `src/features/staff-operations/OperationsTerminal.tsx`。sub-feature同士の直接依存は禁止し、束ねはTerminalのみが行う

#### a) manual-operation（手動貸出・返却・充填）

| 項目 | 内容 |
|---|---|
| Component | `components/ManualOperationPanel.tsx` |
| Hook | `hooks/useManualTankOperation.ts` |
| Workflow Service | ★新設 `services/manual-operation-workflow.ts` |
| 読み書き | read: tanks, customers（useTanks / useDestinations経由）/ write: tanks+logs（tank-operation経由） |
| As-Is | hookにUI state・入力・transition判定・identity/context・action/location/note決定・payload構築・operation呼び出しが同居（R-12） |
| Target | confirm以降（identity/context解決・action/location/note決定・payload構築・`applyBulkTankOperations`呼び出し）をserviceへ。hookはUI state・入力・queue表示のみ |
| 変更不要 | 保存payload・遷移判定結果・confirm文言・operation呼び出し内容 |

#### b) order-fulfillment（受注貸出）

- service既存: `src/lib/firebase/order-fulfillment-service.ts`（operation+transaction完了のatomicityはservice側で確保済み）
- As-Is残差: 顧客・数量・種別validationがhook内（R-13）
- Target: validationをservice側へ移す。write経路・atomicityは変更しない

#### c) return-tag-processing（返却申請処理）

- R-14解消済み。**変更不要領域**（本設計の参照実装）

#### d) bulk-return-by-location（貸出先別一括返却）

| 項目 | 内容 |
|---|---|
| As-Is | hookにread/grouping・local state・tag操作・返却workflowが同居（R-15）。tag一時stateは`tanks.logNote` marker（R-17）。日付poolは`updatedAt`近似（R-28） |
| Target | ★`queries/bulk-return-candidates.ts`（read・grouping・日付pool）と ★`services/bulk-return-workflow.ts`（tag別action/location・payload構築・operation呼び出し）へ分離。hookはUI stateとtag選択のみ |
| 制約 | `logNote` markerの意味・保存値・タイミングを変えない（解消はschema変更を伴うため別設計）。returnCondition非送出も現状維持（provenance追加は別PR） |

### 4.2 maintenance（破損・修理・耐圧 — 3つの独立workflow）

- 入口route: `/staff/damage`, `/staff/repair`, `/staff/inspection`（現状は各pageが業務を保持 R-18/R-19）
- Target: `src/features/maintenance/services/` に `damage-workflow.ts` / `repair-workflow.ts` / `inspection-workflow.ts` を**3ファイル独立**で新設。maintenance汎用serviceへの統合は禁止
- 耐圧の次回期限算出は ★`src/features/maintenance/lib/inspection-schedule.ts` 純粋関数+unit test（R-19）
- pageは選択・確認UIとworkflow呼び出しのみに縮小
- 変更不要: ACTION code / location文字列 / note文言 / operation payload / context内容（現状actorのみ R-25 — 抽出PRでは現状維持）

### 4.3 inhouse（自社利用・自社返却 — 2つの独立workflow）

- 入口route: `/staff/inhouse`（現状page内に検証・tag復元/保存・payload・operationが同居 R-20）
- Target: ★`src/features/inhouse/` を新設し `services/inhouse-use-workflow.ts` / `services/inhouse-return-workflow.ts` を分離
- tag markerの read/write は `tank-tag-service` 経由を維持。maintenanceへの統合禁止

### 4.4 staff-dashboard（3段階で分離。同一PR禁止）

- 入口route: `/staff/dashboard`（取得・集計・品質報告・訂正・取消・履歴・一括loopが集中 R-21）
- 第1段: ★`src/features/staff-dashboard/services/log-correction-workflow.ts` — 単一訂正 / 単一取消 / 一括貸出先変更 / 一括取消の4経路をservice化。atomic本体は`tank-operation.ts`の`applyLogCorrection` / `voidLog`のまま
- 第2段: ★query / read model 分離
- 第3段: UI分割（AGENTS.mdのClaude UI境界と協調可）
- `mode=revert`はruntime caller無しの現状を維持。新規caller追加は別設計

### 4.5 procurement — 変更不要領域

feature内にworkflow（`lib/submitTankEntryBatch.ts`）を保持済み。縦経路として完成形

### 4.6 admin-customers — 後続候補（今回のsequence対象外）

R-04（link actor解決がcomponent内）・R-05（payload構築・重複名判定がcomponent内）は残差だが、障害影響と変更頻度が staff操作系より低い。Phase A〜C完了後に判断

### 4.7 portal — 概ね解消済み

R-01 / R-03 解消済み。R-02（自動返却の時刻比較・日次key・自動submitがpage内）は後続候補

### 4.8 admin / billing / sales / analytics — 行数を理由に再構造化しない

- billingのlegacy location/name fallback（R-29）は請求仕様の論点であり、構造化PRから除外（Codex領域の別設計）
- read側はrepository＋純粋集計関数（`operation-stats.ts`型）を維持。巨大な共通analytics serviceを作らない

## 5. Read sideの分離原則

- Repository(Firestore query) / Query・Read Model(用途別整形) / Stats(純粋集計) / UI の責務を分ける
- 用途別read model候補: staff dashboard / billing / sales / staff analytics / staff mypage / portal home / bulk return。**必要になったPRで個別に設計**し、先回りで作らない
- 共通化してよいのは純粋集計関数まで
