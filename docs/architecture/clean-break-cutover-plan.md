# Clean-break Cutover Plan

- 第二稿: 2026-08-02（基準 `6c1d4c5` = origin/main）
- 第三稿: 2026-08-02（独立レビュー3件を反映。順序を **reset-first** へ変更）
- Status: **Draft / Not yet authoritative**
- 上位文書: [design-principles.md](./design-principles.md) / [domain-map.md](./domain-map.md)

---

## 1. 実装戦略の判断

### 1.1 第二稿の順序は誤りだった（撤回）

第二稿は「依存是正 → 型 → write切替 → read切替 → reset」の順にすれば **dual read は一度も発生しない**と主張した。**これは誤り**である。レビューで2通りの反例が確認された。

| # | 反例 | 証拠 |
|---|---|---|
| 1 | **write切替とread切替の間に窓が開く** | P3-A（custody を書き、`location` を書かなくなる）から P4-B（custody を読む）までの間、既存docは `location` のみ・新規docは custody のみを持つ。readerは両方扱う（＝dual read）か、その間に触れたtankの表示が壊れるかの二択 |
| 2 | **より深刻: 訂正・取消が pre-cutover log を読めなくなる** | `logs.prevTankSnapshot` / `nextTankSnapshot` は **tanks doc の形をそのまま永続化したmirror**。`voidLog` / `applyLogCorrection` は現在状態を**再導出せず、この永続snapshotを読んで書き戻す**。さらに Rules がsnapshotとtank docをfield単位で照合する（`firestore.rules` の `tankSnapshotMatches`）。custody対応Rulesの下では、旧形式snapshotは `custodyKind = null`・tankは `"warehouse"` となり、**pre-cutoverの全logで訂正・取消がRulesに拒否される** |

反例2は §7 の設計停止条件「新旧schemaの dual read が避けられない → 順序設計の誤り」に該当する。つまり第二稿の計画は**自らの停止条件を踏んでいた**。

### 1.2 第三稿: **reset-first**

```text
依存是正 → 型・Rules準備 → 【data reset + Rules cutover】 → write/read切替 → 検証
```

**Why**: 本番データが存在しない（実運用前）。したがって**resetが最も安価な選択肢**であり、dual read の窓を原理的に消滅させる。旧形式のdocが1件も存在しなければ、旧形式を読むコードは不要になる。

**代償と受容理由**: reset 直後〜write/read切替完了までの間、アプリは新schemaの空DBに対して動く。実運用前なので業務影響がない。dev環境が分離済み（P0-C）であれば検証も阻害されない。

**reset-first を採らない場合の代案**: write切替・read切替・Rules・resetを**単一の停止窓（tank操作を止めた状態）**で一括実施する。ただしこれは §6 の混在禁止に反するため、**採るなら明示的な例外として記録する**。第三稿は reset-first を推奨する。

### 1.3 「1つのCodex task」と「1つのPR」を混同しない

型連鎖が絡む変更は途中で tsc が壊れるため **1つのCodex発注**にする（CLAUDE.md の方針）。ただしその成果物は、**変更理由ごとに分けたPR**として提出する。

---

## 2. 前提条件

- [ ] 実利用者が存在しないことの再確認（Firestore を read-only で確認）
- [ ] reset 前の完全バックアップ（既存 `cutover:snapshot:create`）
- [ ] 停止条件の合意（§7）
- [ ] **ADR-001〜004 の業務確認**（§5）

---

## 3. PR 分割（変更理由ごと）

各PRは単独で build / tsc / test が通り、単独 revert 可能であること。

### Phase 0 — 基盤（変更理由がそれぞれ独立。同一PRにしない）

| PR | 目的 | 変更責務 | 変更ファイル候補 | 完了条件 | deploy |
|---|---|---|---|---|---|
| **P0-A** docs draft 保存・レビュー | 第三稿をbranchへ保存 | docs のみ | `docs/architecture/*` | 独立レビュー反映済み。Draft のまま | なし |
| **P0-B** enforcement（宣言的のみ） | 依存方向の回帰を止める | **lint 設定のみ** | `eslint.config.mjs` | `no-restricted-imports` zone で5規則（domain→React/locale、operation→billing、billing→write service、feature↔feature、app/component/hookからwrite SDK）を強制。**現行違反 V1/V2 を検出してFAILすること**を確認後、allowlist登録 | なし |
| **P0-C** dev / production 分離 | 検証を本番から隔離 | **環境のみ** | dev Firebase project、`.env` 系 | dev が本番projectを向いていない | dev project作成のみ |
| **P0-D** document authority 発効 + supersede注記 | 正本順位を確定し、死んだ文書を死んだと分かる状態にする | docs のみ | `document-authority.md`、supersede判定の全文書へ1行banner、`AGENTS.md` / `CLAUDE.md` 修正（要ユーザー承認） | Proposed order 発効。**supersede判定の約20文書すべてに banner** | なし |

**P0-B から除外したもの**（第二稿からの変更）: 「write owner表との整合」「public export surface の肥大化検出」の2つのAST ruleは、**現時点で違反が存在しない**。違反のない規則をAST基盤ごと新設するのは §3 / §18 が禁じる先回り。**違反が出た時点で追加する**。既存の `dashboard-components.test.ts` が手法の前例として残っているため、着手コストは低い。

**P0-D を前倒しした理由**（第二稿は最終段階に置いていた）: supersede注記は機械的・業務判断不要・コードリスクゼロで、**この計画全体の中で「文書の混乱」を実際に減らす唯一の作業**。cutover後まで放置すると、それまでの全実装PRが「生きて見える死んだ文書」約20件を抱えた木の上で書かれる。

---

### Phase 1 — 依存是正（互換性ではない。現行の設計違反の修正）

| PR | 目的 | 完了条件 |
|---|---|---|
| **P1-A** domain の UI 対話・locale 依存の除去（V1/V2） | atomic writer から React / browser / locale 依存を切る | ①**`tank-operation.ts` 内の `window.` / `document.` 参照が0件**（←これが本体。locale importの除去だけでは不十分） ②`@/hooks/useStaffSession` を import しない ③payload・確認文言・エラー文言が現行と完全一致（characterization test） ④P0-B の allowlist から V1/V2 を削除 |
| **P1-B** display 文言の boundary 移動（V3） | domain のハードコード日本語を display boundary へ | 表示結果が現行と一致。**`scripts/staff-i18n-scan.ts` の `STAFF_I18N_SOURCE_ROOTS` に `src/lib` を追加**し、既存違反を baseline 登録（これをしないとV3の完了を検証できない） |
| **P1-C** role code 化（V4） | 日本語文字列を permission code から外す | `StaffCorrectionRole` が code（`admin` / `assistant_admin` / `staff`）。`operation-review-service` の `role !== "管理者"` が code比較。表示labelは display boundary。**schema変更を含むため Rules と `staff` / `staffByEmail` の値も対象** |

**P1-A の設計**（ADR-006）: `TankRecoveryConfirmationRequiredError` は既に caller へ throw される構造を持つ。ただし公開writerの呼び出し元は**9箇所**あるため、確認ループを各callerへ複製するのは §18 に反する。**resolver を注入するport**（design-principles §17）を採り、未注入時は fail-closed（確認が必要になったら例外）とする。`TankRecoveryConfirmationRequiredError` に `code` を付与すること（現在 plain `Error` 継承で code を持たない唯一のdomain errorであり、§12.3 違反）。

---

### Phase 2 — 型・Rules の準備（reset より前に揃える）

| PR | 目的 | 前提 | 完了条件 |
|---|---|---|---|
| **P2-A** custody model の型 + **Rules field list** | 無効状態を作れない構造を用意 | **ADR-002 確定** | ①`TransitionStep` が `custody: TankCustody`（union）を持ち、`planTankTransition` が生成する ②`resolveNextTankCustomerProjection` が union の projection になる ③**`firestore.rules` の `isTankProjectionChanged` / `tankSnapshotMatches` / `isInitialTankOperationSnapshotUpdate` / `isTankRestoreSnapshotUpdate` の field list に custody を追加** ④**`!isTankProjectionChanged()` の blanket allow を `hasOnly([許可field])` の deny-by-default へ反転** ⑤未知fieldのupdateが拒否されることのRules test |
| **P2-B** event schemaVersion | 未知versionを fail-closed に | — | `schemaVersion` を `assertOfficialAggregationSchemaReady` の**追加**チェックとして足す（**置換しない**。同関数は5つの独立検査を持つ） |

**P2-A が Rules を含む理由**（第二稿からの変更）: 現行 `isValidTankUpdate` は `!isTankProjectionChanged()` を許可条件に含む。9個のhardcoded keyのどれも変わらなければ**staffは任意のfieldを無制限に書ける**（log無し・transaction無し・stale guard無し）。custody fieldをRules側のlistへ追加せずに導入すると、**新fieldが恒久的に無防備になる**。これは architecture test / ESLint では検出**できない**種類の欠陥であり、型PRとRules PRを分けると窓が開く。

---

### Phase 3 — reset + Rules cutover（★停止・承認gate）

| PR | 目的 | 変更責務 | deploy | rollback |
|---|---|---|---|---|
| **P3-A** Rules cutover | 新schema対応Rules | **Rules のみ** | Rules-only deploy。専用レビュー・operation（AGENTS.md）。Hostingと混ぜない | pinned baseline rules |
| **P3-B** data reset + seed | 新schemaで作り直す | **データのみ** | **本番データ操作**。`docs/cutover/transition-plan-v1-runbook.md` の停止条件・承認gateに従う | snapshot restore |

**★ P3-B はユーザーの明示承認gate。**

---

### Phase 4 — application cutover

| PR | 目的 | 前提 | 完了条件 |
|---|---|---|---|
| **P4-A** custody write / read 切替 | `location` を廃止 | P2-A, P3-B | **write と read を同一PRで切り替える**（変更理由が1つ「`location` の二重意味を分ける」であり、分けると窓が開く）。`location` という名前のfieldが存在しない。**logs の当時snapshotは維持** |
| **P4-B** legacy identity fallback 削除 | G2 / G3 | P4-A | `isLegacy` / `legacy-location:` / `customersByName` が消滅。`customerId` を持たない log は**集計対象外として明示検出**。strict resolver へ置換（削除ではない） |
| **P4-C** 保存値の code 化（V5） | `logAction` / `location` の日本語保存値 | P4-A | 保存値が locale-independent。表示は display boundary |
| **P4-D** error catalog 一本化（G10） | ja優先経路の削除 | — | `locale === "ja"` の message 優先経路を削除。**catalog を `staff-operation-error.ts` から display boundary module へ分離**（domain error code と翻訳は変更理由が異なる） |

---

### Phase 5 — return tag draft（Rules とペア）

| PR | 目的 | 前提 | 完了条件 |
|---|---|---|---|
| **P5-A** draft 移設（application） | `tanks.logNote` 二重owner解消（V6） | **ADR-004 確定** | 案A採用時は `tank-tag-service.ts` と2つの呼び出し元の**削除**。`tanks` への `runTransaction` 外 write が0件 |
| **P5-B** marker Rules 削除 | Rules 側の marker 語彙を消す | P5-A | `isReturnTagMarkerOnlyUpdate` と `isTankProjectionChanged` の `logNote` 項目を削除。**Rules-only PR** |

**なぜ2本必要か**: marker の値allowlist（`"[TAG:unused]"` 等）が **Rules に埋まっている**ため、application側だけでは完了しない。§6 の「Rules変更とapplication変更を混ぜない」を守るには2本立てが必須。

---

### Phase 6 — 後続（clean-break の必須経路ではない）

| PR | 前提 |
|---|---|
| **P6-A** 確定請求書 | **ADR-005 確定**。製品要件が固まってから |
| **P6-B** rental cycle identity | **ADR-003 確定**。必要と判断された場合のみ |
| **P6-C** billing の fail-closed 運用改善 | 影響範囲の報告・quarantine表示・log読み取りの範囲限定（§F7） |
| **P6-D** 旧docs最終整理 | P0-D で banner 済み。残りの統合 |

---

## 4. 依存関係

```text
P0-A (docs保存) ─ P0-B (lint) ─ P0-C (env) ─ P0-D (authority + banner)
                        ↓
        P1-A (UI対話除去) / P1-B (文言) / P1-C (role code)
                        ↓
   ADR-002 → P2-A (custody型 + Rules field list) / P2-B (schemaVersion)
                        ↓
              P3-A (Rules cutover) → P3-B (data reset) ★承認gate
                        ↓
   P4-A (custody write+read) → P4-B (legacy削除) / P4-C (保存値code化) / P4-D (catalog)
                        ↓
        ADR-004 → P5-A (draft移設) → P5-B (marker Rules削除)
                        ↓
              P6-A〜D（必須経路ではない）
```

---

## 5. 実装前に必要な業務判断（ADR）

| ADR | 論点 | 必要な業務情報 | block |
|---|---|---|---|
| **ADR-001** | tank identity（surrogate要否） | 刻印の打ち直し / 誤登録の復旧方法 / 番号体系変更の予定 | P2-A |
| **ADR-002** | custody model + `custodyKind` の値域 | 倉庫・自社・顧客以外の保管先（修理業者・検査機関）はあるか。**`inspection` が `lent` から実行できる現仕様は意図的か**（`allowedPrev: []`） | P2-A |
| **ADR-003** | rental cycle identity | 訂正・取消後も cycle identity が必要か。**論点は `inspection` の1ケースに絞られた**（design-principles §8.3） | P6-B |
| **ADR-004** | return tag draft の置き場所 | 端末をまたぐ共有が必要か / 同時編集 / draft の失効 | P5-A |
| **ADR-005** | billing finalization | 請求確定という業務イベントが存在するか | P6-A |
| **ADR-006** | domain の UI対話・locale 依存の是正方法 | （技術判断。業務情報不要 — resolver port を推奨） | P1-A |

---

## 6. 混在禁止（全PR共通）

- schema変更 と UI変更
- **Rules変更 と application code変更**
- 請求仕様変更 と 構造整理
- data reset と code変更
- docs-only と 実装
- enforcement 追加 と 環境分離
- 依存是正 と schema変更

**例外**: P2-A は型とRules field listを同時に変える。理由は §Phase 2 に明記のとおり、分けると新fieldが無防備になる窓が開くため。**この例外は意図的であり、記録する。**

---

## 7. 設計停止条件

- design-principles §2.2 の業務不変条件を維持できない
- atomicity の分割が必要になる
- 請求額・税・丸めの意味変更が必要になる
- 1PR内で複数機能の挙動が変わる
- **新旧schemaの dual read が避けられない**（→ 順序設計の誤り。順序を見直す）
- ADR未確定のまま schema を決めようとしている

---

## 8. 各PR共通の完了条件

**注**: 本節は [refactor-sequence.md](./refactor-sequence.md) §2 を継承する。同文書は historical だが、そこに書かれた**検証プロトコルは有効**であり、以下はその要約である。詳細な手順は同 §2 と [full-app-flow-verification-plan.md](../verification/full-app-flow-verification-plan.md) を正とする。

- `git diff --check`
- 変更ファイルの eslint
- `npx tsc --noEmit --pretty false`
- `npm run build`
- `npm test`
- `npm run test:rules:transition` / `test:transition-policy` / `test:transition-projections`
- architecture / lint enforcement（P0-B以降必須）
- staff i18n residual scan（表示に触れるPR）
- **既存UI維持 / 保存payload維持 / 状態遷移維持 / atomicity維持**（挙動不変が要求されるPR）
- **payload固定テスト（characterization test）** — workflow を触るPRは必須
- **手動シナリオ確認**: L0（read-only）は常時。write を伴う L2 該当操作（tank status / logs / transactions）は**ユーザー個別承認の下で**実施し、結果と戻し方をPR本文へ記載する
- PR本文に design-principles §23 チェックリスト結果を記載
