# maintenance 系ログの provenance 付与 — 設計note（F10 / R-25）

- 作成日: 2026-07-29
- 対象commit: `ddb2e8fc81e92c0c0ef2c3ab591562c18ad5d0ce`
- 位置づけ: **設計note。実装は含まない。保存payload変更のため独立トラック**
- 関連: `docs/identity-and-operation-logging-design.md`、`docs/architecture/refactor-sequence.md` §4（R-25）


## 0. 反証レビューによる訂正（2026-07-29）

独立 reviewer（Codex, read-only）が本note を **NEEDS_CORRECTION** と判定した。

### 訂正 1 — `source` の値選択が advisory 判定に**結合している**

本文 §4.1 は案 A（`manual`）と案 B（`maintenance`）を
「判別しやすさ」だけで比較したが、**実際には安全性に影響する**。

現在 advisory 対象は `source: manual | bulk_return` かつ
`workflow: tank_operation` だけである（`tank-transition-policy.ts:170`）。

| 案 | 影響 |
|---|---|
| A: `manual` | maintenance 操作が **advisory context に分類される** |
| B: `maintenance` | **strict のまま** |

現在 maintenance action は direct-only（`planTankTransition` の
`MAINTENANCE_ACTIONS` 分岐）なので直ちに recovery しないが、
**source 値の決定時にこの結合を明記する必要がある。**

→ **案 B（`maintenance`）の推奨は維持。** 理由に「advisory 分類を変えない」を追加する。

### 訂正 2 — F3 note との整合

本文 §4.3 は「backfill は追記型原則に反するので行わない」と正しく述べているが、
**F3 note は legacy log の backfill を実施案に置いていた**（矛盾）。

F3 note 側に訂正を入れ、「専用 migration 設計を前提とした独立課題」へ格上げ済み。
**本note の原則（直接 backfill しない）が正しい。**

## 1. 現状 — maintenance 3 workflow だけ provenance を送っていない

`src/lib/operation-context.ts` の `OperationContext` は
`actor` / `customer` / `transactionId` / `source` / `workflow` / `returnCondition` を持つ。

`src/lib/tank-operation.ts:1361-1362` は `context.source` / `context.workflow` が
**存在するときだけ** log document に書き込む。

| workflow service | `source` | `workflow` |
|---|---|---|
| `features/maintenance/services/damage-workflow.ts` | ❌ なし | ❌ なし |
| `features/maintenance/services/repair-workflow.ts` | ❌ なし | ❌ なし |
| `features/maintenance/services/inspection-workflow.ts` | ❌ なし | ❌ なし |
| `features/staff-operations/services/manual-operation-workflow.ts` | `manual` | `tank_operation` |
| `features/staff-operations/services/bulk-return-workflow.ts` | `bulk_return` | `tank_operation` |
| `features/inhouse/services/inhouse-use-workflow.ts` | `manual` | `tank_operation` |
| `features/inhouse/services/inhouse-return-workflow.ts` | `manual` | `tank_operation` |
| `lib/firebase/order-fulfillment-service.ts` | `order_fulfillment` | `order` |
| `lib/firebase/return-tag-processing-service.ts` | `return_tag_processing` | `return` |

maintenance の3 service はいずれも `const context = { actor };` のみ。

## 2. 影響

**provenance が完全にゼロなわけではない。**
maintenance ログも `action`（`damage_report` / `repaired` / `inspection`）、
`transitionAction`、`staffId` / `staffName`、`transitionPlan` を持つ。

失われているのは「**どの UI 経路から実行されたか**」という情報のみ。

しかし次のリスクがある:

- `source` / `workflow` で絞る集計・監査を後から書くと、
  **maintenance の3操作だけが静かに欠落する**
- `where("source","==",...)` は field を持たない document を除外するため、
  「全操作を source 別に集計する」クエリが破綻する
- provenance の有無が操作種別によって異なるという不整合が、
  データを読む側に暗黙の前提を強いる

## 3. なぜ今まで直されていないか

PR-01〜PR-03（damage / repair / inspection の workflow service 抽出）は
**挙動不変の抽出**として設計されており、
`docs/architecture/refactor-sequence.md` §1 が

> service抽出とoperation context内容の変更（source / workflow / returnCondition等の
> provenance追加は、抽出完了後の別PR）

を明示的に禁止していた。R-25 として §4 に「抽出完了後に独立 PR 系列として設計」と記録済み。

**抽出は完了したので、今が設計のタイミングである。**

## 4. 決めるべきこと

### 4.1 `source` の値

`OperationSource` の現行の値を確認したうえで決める。候補:

| 案 | 値 | 論点 |
|---|---|---|
| A | 3つとも `manual` | inhouse と同じ扱い。UI 経路としては確かに手動操作 |
| B | `maintenance` を新設 | maintenance 系であることが判別できる |
| C | `damage` / `repair` / `inspection` を個別に | `action` と重複する。**冗長** |

**案 B を推奨。** `action` が既に「何をしたか」を持つので、
`source` は「どの画面/経路から来たか」を表すべき。
`/staff/damage` `/staff/repair` `/staff/inspection` は
`MaintenanceTabs` で束ねられた1つの UI セクションなので `maintenance` が対応する。

案 A は inhouse と区別がつかなくなる。案 C は `action` と情報が重複する。

### 4.2 `workflow` の値

`OperationWorkflow` の現行値（`tank_operation` / `order` / `return` 等）を確認する。

maintenance は tank の状態遷移そのものなので **`tank_operation`** が自然。
新しい値を作る必要はない。

### 4.3 historical logs の扱い

既存の maintenance ログには `source` / `workflow` が無い。

| 選択肢 | 内容 | コスト |
|---|---|---|
| (a) backfill しない | 「ある時点以降のログにのみ provenance がある」と docs に明記 | 最小。ただし読む側が時期を意識する必要がある |
| (b) backfill する | 既存の maintenance ログに `source:"maintenance"` を追加 | **L2 write**。log は追記型で「本文を直接上書きしない」原則があるため、**原則に反する** |

**(a) を強く推奨。**
`logs` は追記型 revision チェーンであり、`applyLogCorrection` を経ない
直接更新は `docs/architecture/write-ownership.md` §3 で禁止されている。
provenance のためにこの原則を破るべきではない。

→ 読む側は `source` の欠落を「provenance 導入前のログ」として扱う。

### 4.4 billing / analytics への影響

現時点で `source` / `workflow` を条件に使っている読み取りがあるかを確認する。

- `src/lib/billing/source-logs.ts` — 名前に反して `source` field は使っていない。
  `projectRentalCycleEvents` / `projectOfficialAggregationEvent` を使う
- `src/lib/analytics/operation-stats.ts` — 確認が必要

**現在 `source` に依存する集計が無ければ、追加による回帰リスクは無い。**
逆に言えば、**追加しても現時点で得られる価値も無い**。
価値が出るのは「provenance を使った監査・分析」を実装するとき。

→ **単独では優先度が低い。** 実際に provenance を使う要求が出たときに
まとめて実施するのが合理的。

## 5. 実装時の制約

- **保存 payload の変更**である。`docs/architecture/refactor-sequence.md` §5 の
  設計停止条件「保存payloadを維持できない」に該当するため、
  **構造整理 PR と混ぜてはいけない**
- 変更は3 service の `context` オブジェクトのみ。
  `tank-operation.ts` は変更不要（既に `source` があれば書く実装になっている）
- 既存の payload 固定 test
  （`damage-workflow.test.ts` / `repair-workflow.test.ts` / `inspection-workflow.test.ts`）は
  **必ず落ちる**。これは意図した変更なので test を更新する
- 検証 level は **L2**（保存内容が変わるため、実データでの確認が要る）

## 6. 推奨する進め方

```
Step 1  L0  source / workflow に依存する読み取りが存在しないことを確認
            （billing / analytics / dashboard / admin を grep）

Step 2      OperationSource に "maintenance" を追加してよいか判断
            （型定義の変更 = 他の値との整合）

Step 3      3 service の context に source/workflow を追加
            payload 固定 test 3件を更新

Step 4  L2  検証用タンク（A-99）で damage → repair を実行し、
            保存された log document に source/workflow が入ることを確認
            → ユーザー個別承認の下で実施

Step 5      docs に「provenance は YYYY-MM-DD 以降のログにのみ存在する」旨を記録
```

## 7. 人間判断が必要な事項

1. **そもそも今やる価値があるか。** §4.4 のとおり、
   provenance を使う読み取りが無い現在、追加の実利は無い。
   「将来のため」だけを理由に保存 payload を変えるべきかは判断事項
2. `source` の値を `maintenance` にするか `manual` にするか
3. historical backfill をしない（= 時期によって provenance の有無が異なる）ことを受け入れるか
4. L2 検証を実施するタイミング

**Claude の推奨: 優先度は低い。** 他の課題（F3 / F6 / F7）を先に処理し、
provenance を実際に使う要求が出た時点で本note を実装に移す。

## 8. 本note で扱わないこと

- `returnCondition` の provenance（返却系は既に送出済み）
- legacy actor field（`approvedBy` / `fulfilledBy`）の write 停止（R-26、別課題）
- `logExtra` の設計
- provenance を使った監査機能そのもの（新機能）
