# recovery confirmation の UI 境界 — 設計note（S4）

- 作成日: 2026-07-29
- 対象commit: `ddb2e8fc81e92c0c0ef2c3ab591562c18ad5d0ce`
- 位置づけ: **設計note。実装は含まない。advisory 再有効化を前提とする**
- 前提: **advisory activation と同一 PR にしない**
- 関連: `docs/design/strict-vs-assisted-transition-mode.md`、`docs/deploy/advisory-smoke-summary-2026-07-19.md`


## 0. 反証レビューによる訂正（2026-07-29）— **本note は UNSOUND 判定。型契約が成立していない**

独立 reviewer（Codex, read-only）が本note を **UNSOUND** と判定した。
**§4.1 の resolver 型はそのままでは動作しない。**

### 訂正 1（致命的）— resolver が正しい confirmation を構築できない

本文 §4.1 の型:

```ts
export type RecoveryConfirmationResolver = (
  requirements: TankRecoveryRequirement[],
) => Promise<TankRecoveryConfirmation | null>;
```

**`TankRecoveryRequirement` には `fingerprint` / `latestLogId` / `policyRevision` が無い**
（`tank-operation.ts:238`）。

一方 fingerprint は `latestLogId` と `policyRevision` を含めて生成され
（`tank-operation.ts:518`）、次 transaction で**完全一致が必須**
（`tank-recovery-confirmation-validation.ts:33`）。

→ **UI resolver は正しい `TankRecoveryConfirmation` を構築できない。**

**訂正後の型**:

```ts
type RecoveryConfirmationResolver = (input: {
  fingerprint: string;
  requirements: TankRecoveryRequirement[];
}) => Promise<{ accepted: boolean; recoveryEvidence: RecoveryEvidence }>;
```

**fingerprint 自体は domain 側が付与する。** resolver には渡すだけにする。

### 訂正 2 — 「未注入時は現在と同じ error を throw」は現在挙動と**異なる**

現在の browser では「未注入」という概念が無く、必ず native confirm を出す
（`tank-operation.ts:696`）。throw fallback に変えるのは
**advisory 時の behavior change** である。

→ **全 eligible caller が注入済みになるまで native confirm fallback を維持する**こと。

### 訂正 3 — bulk API だけへの optional 引数では不足

`inhouse-use-workflow` は advisory 対象となる
`source:"manual"` / `workflow:"tank_operation"` で
**単体 `applyTankOperation` を呼ぶ**（`inhouse-use-workflow.ts:15`）。

→ `applyTankOperation` と `applyBulkTankOperations` の**両方**へ
   共通の内部 options として渡す。片方だけに足すと経路が分裂する。

### 訂正 4 — `assertRecoveryRequirementCanBeConfirmed` は表示整形ではない

本文 §4.1 はこれを「表示のための整形」に分類したが、**誤り**。
これは**確認不能な顧客情報での承認を止める安全検査**である
（`tank-operation.ts:747`）。

→ **safety validation は domain に残す。** UI へ移すと別 resolver が検査を迂回できる。
   表示 label / build 関数だけを pure export する。

### 訂正 5 — 「Step 1〜3 は dead path だから安全」は過剰

fingerprint 契約の不成立と単体 caller 未対応は、
**gate 再有効化まで発見されない潜伏不具合**になる。

→ Step 1〜3 を入れる場合も、fingerprint 契約と両 API 対応を先に確定させること。

### 訂正 6 — advisory 到達不能の根拠

`.env.local` にフラグが無いことは「現在の local build」を示すだけで、
**将来 / 別環境の build-time env まで false とは証明できない**。
最終本番 build が gate=false だったことは
`advisory-smoke-summary-2026-07-19.md:154` で確認できる。

### 訂正後の判定

**方向（callback 注入）は妥当だが、型契約を書き直すまで実装に入らない。**
advisory 再有効化の予定が決まるまで優先度は低い。

## 1. 現状

`src/lib/tank-operation.ts` は tank lifecycle の atomic writer であり、
`docs/architecture/feature-boundaries.md` §2.4 で「移動しない・分解しない」正本境界とされている。

その中に **UI 依存が1箇所ある**。

`tank-operation.ts:696-737` `requestRecoveryConfirmation()`:

```ts
function requestRecoveryConfirmation(error): TankRecoveryConfirmation {
  if (typeof window === "undefined") {
    throw new Error("自動補完には画面上での現物確認が必要です。ブラウザから操作してください。");
  }
  error.requirements.forEach(assertRecoveryRequirementCanBeConfirmed);
  for (const [index, requirement] of error.requirements.entries()) {
    const accepted = window.confirm([...].join("\n"));   // ← domain 層から native dialog
    if (!accepted) throw new Error("自動補完操作をキャンセルしました。");
  }
  ...
}
```

呼び出し構造（`tank-operation.ts:405-433`）:

```
runPlannedOperationsWithRecoveryConfirmation()
  for (;;) {
    try { return await runTransaction(db, ...) }        // ← transaction 内
    catch (e) {
      const req = asRecoveryConfirmationRequiredError(e);
      if (!req) throw e;
      const confirmation = requestRecoveryConfirmation(req);   // ← transaction 外で confirm
      planned = planned.map(op => ({ ...op, input: { ...op.input, recoveryConfirmation: confirmation }}));
    }
  }
```

**設計として正しい点**: `window.confirm` は transaction callback の**外**で呼ばれている。
transaction 内で blocking dialog を出すと Firestore の retry と衝突するため、
この構造自体は妥当。

## 2. 現在の到達可能性

`ADVISORY_ACTIVATION_ENABLED`（`tank-transition-policy.ts:18`）は
`process.env.NEXT_PUBLIC_TANK_ADVISORY_ACTIVATION_ENABLED === "true"`。

- `.env.local` に当該変数は**設定されていない**（変数名の存在確認のみ実施）
- `resolveRuntimeTransitionEnforcement` は gate が false なら常に `strict` を返す
- `planTankTransition` は `policyMode !== "advisory"` のとき
  `blocked("strict_transition_required")` を返す（`tank-transition-policy.ts:292-297`）

→ **現在 recovery plan は生成されず、この confirm 経路は到達不能。**

ただし `docs/deploy/advisory-smoke-summary-2026-07-19.md` により、
**2026-07-19 に本番で `gate=true` を一時 deploy し、advisory popup を含む
L2 smoke を完了したうえで strict / gate=false へ戻している**ことが確認できる。

→ **未検証の死蔵コードではなく、検証済みで意図的に off にしてある機能。**
削除・整理の対象ではない。

## 3. 課題

### 3.1 domain 層が UI modality に結合している

`tank-operation.ts` は atomic writer の正本でありながら、
「確認は native `window.confirm` である」ことを知っている。

結果:

- `typeof window === "undefined"` で明示的に throw する必要がある
- 確認 UI を変えるには **domain 層のファイルを触る**ことになる
- 確認フローの unit test に DOM が必要になる

### 3.2 in-app browser での実行可能性（**未確認**）

`confirm()` が常に `false` を返す環境では、advisory 有効時の recovery 操作が
すべて「キャンセル」になり実行できない。

**この挙動をリポジトリ内の証拠から確認することはできなかった。**
運用メモとしては記録があるが、コードベースからは検証不能。
→ **実機での確認が必要。** 本note では「未確認のリスク」として扱う。

### 3.3 一括操作での UX

`requestRecoveryConfirmation` はタンクごとに1回 `confirm()` を呼ぶ
（`tank-operation.ts:709`）。10本の一括操作なら10回のネイティブダイアログが出る。
コメントには「一括操作でもタンクごとに全stepと確認対象を読めるよう」とあり意図的だが、
UX としては重い。

## 4. 設計方針 — callback 注入

`tank-operation.ts` から UI を切り離し、**確認手段を呼び出し側が注入する**。

```
                       ┌─────────────────────────────┐
UI (hook / component)  │ RecoveryConfirmationResolver │  ← modal を出して Promise を返す
                       └──────────────┬──────────────┘
                                      │ 注入
                       ┌──────────────▼──────────────┐
workflow service       │  applyBulkTankOperations(    │
                       │    inputs, extraOps, opts )  │
                       └──────────────┬──────────────┘
                                      │
domain                 │  tank-operation.ts           │  ← window を知らない
                       └──────────────────────────────┘
```

### 4.1 型（案）

```ts
export type RecoveryConfirmationResolver = (
  requirements: TankRecoveryRequirement[],
) => Promise<TankRecoveryConfirmation | null>;   // null = キャンセル
```

- `tank-operation.ts` は resolver を受け取り、未指定なら**現在と同じ error を throw**
  （= fail-closed。「確認手段が無ければ実行しない」）
- `TankRecoveryRequirement` は既に export 済みの型で、
  確認に必要な情報（tankId / status / location / customer / plan / requiredEvidence）を持つ
- `RECOVERY_EVIDENCE_LABELS` / `buildRecoveryRequirementDetails` /
  `assertRecoveryRequirementCanBeConfirmed` は**表示のための整形**なので、
  domain から UI 側へ移すか、pure 関数として export して UI が使う

### 4.2 決めるべきこと

| 論点 | 選択肢 |
|---|---|
| **resolver の渡し方** | (a) `applyBulkTankOperations` の第3引数 optional<br>(b) module level の register 関数<br>(c) React context |
| | (a) を推奨。(b) は暗黙のグローバル状態、(c) は domain が React を知ることになる |
| **表示整形の置き場所** | (a) `tank-operation.ts` に pure 関数として残し export<br>(b) `src/lib/` の別 module へ移す<br>(c) UI feature 側へ移す |
| | (a) を推奨。`transitionPlan` の構造知識が必要で、domain と密結合しているため |
| **未注入時の挙動** | 現在と同じ throw（fail-closed）。**変更しない** |
| **retry ループ** | 現行の `for(;;)` を維持する。resolver が Promise を返すだけで構造は変わらない |
| **一括時の確認粒度** | (a) タンクごと（現行）<br>(b) 全体で1回 + 一覧表示<br>→ **仕様変更**なので別判断 |

### 4.3 atomic writer との境界（絶対に守ること）

- **resolver は transaction callback の外でのみ呼ぶ。** 現行構造を維持する
- resolver が Promise を返すため、`runTransaction` の外で `await` する
- transaction の再実行時に**必ず再 plan される**（`commitPlannedOperations` が再度 read する）
  ため、fingerprint による整合性検査
  （`assertRecoveryConfirmationsMatchReplannedState`）は**変更してはいけない**
- `tank-operation.ts` の**移動・分解はしない**。resolver の受け口を足すだけ

## 5. 得られるもの

| | 現在 | callback 注入後 |
|---|---|---|
| domain の `window` 依存 | あり | **なし** |
| 確認 UI の変更 | `tank-operation.ts` を触る | UI 側だけで完結 |
| in-app browser 対応 | `confirm()` に依存 | アプリ内 modal に置換可能 |
| 一括時の UX | ネイティブ dialog × N | 自由に設計可能 |
| unit test | DOM が必要 | resolver を mock するだけ |

## 6. 推奨する進め方

```
Step 1      resolver 型と受け口を tank-operation.ts に追加する（optional 引数）
            未注入時の挙動は現在と完全に同一（throw）
            → behavior change なし。単独 PR にできる
            → 既存の payload 固定 test は影響を受けない

Step 2      表示整形（RECOVERY_EVIDENCE_LABELS / buildRecoveryRequirementDetails /
            assertRecoveryRequirementCanBeConfirmed）を pure 関数として export
            → behavior change なし

Step 3      UI 側に resolver 実装（アプリ内 modal）を作る
            workflow service 経由で注入する
            → advisory が off の間は到達しないので、実質 dead path のまま安全に入る

Step 4  L2  advisory gate を有効にした環境で実機確認
            → 2026-07-19 の smoke と同じ手順を踏む
            → **advisory activation とは別 PR**

Step 5      window.confirm 経路の削除（Step 3 の resolver が正本になった後）
```

**Step 1〜3 は advisory が off の状態で安全に入れられる。**
Step 4 のみ advisory 有効化を伴い、これは独立した運用判断。

## 7. 人間判断が必要な事項

1. **advisory を再度有効化する予定があるか。** 予定が無いなら本note の優先度は低い
2. in-app browser で `confirm()` が機能しないという運用上の観察を、
   **実機で再確認できるか**（コードからは検証不能）
3. 一括操作時の確認粒度を変えるか（タンクごと → 全体1回）。これは**仕様変更**
4. Step 5（`window.confirm` 経路の削除）まで行うか、両方を残すか

## 8. 本note で扱わないこと

- advisory activation そのもの（gate の有効化）
- `transitionPlan` / recovery recipe の意味変更
- `assertRecoveryConfirmationsMatchReplannedState` の fingerprint 設計
- `/admin/operation-reviews` のレビュー UI
- `tank-operation.ts` の分割・移動（**禁止**）
