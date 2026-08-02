# Domain Map

- 第二稿: 2026-08-02（基準 `6c1d4c5` = origin/main）
- **確定版: 2026-08-02（ユーザー最終判断により正式正本化）**
- **Status: Approved / Authoritative**
- 注意: **設計の承認であって実装の完了ではない。** §8 の gap は未解消
- 上位文書: [design-principles.md](./design-principles.md)

---

## 1. ディレクトリ配置の判断

### 1.1 3案の比較

| 軸 | A. `src/features` 維持 + 必要時のみdomain-local doc | B. `src/domains` と `src/features` を分離 | C. global docs のみ |
|---|---|---|---|
| ユーザーの発見しやすさ | ○ 画面名とfeature名が近い | △ 2箇所を探す | △ コードから文書へ辿れない |
| AIの理解しやすさ | ○ 対象feature配下で完結 | ○ domain概念は明確 | △ 全体docsを毎回読む |
| 原則の重複 | ○ globalは1つ | △ domain定義がdocsとcodeに二重化 | ○ 重複なし |
| コード変更への追随 | ○ 同一PRで更新できる | △ 3箇所の同期 | ✗ 乖離しやすい |
| import方向の明確さ | ○ 現行enforcementがそのまま効く | △ features→domains の管理が増える | ○ 変化なし |
| route配置との混同 | ○ 既に分離済み | △ 3層で混乱 | ○ 変化なし |
| 空階層・boilerplate | ○ 増えない | ✗ domain分の空dirが出る | ○ 増えない |
| ファイル移動リファクタ | ○ 不要 | ✗ 大規模移動。design-principles §24 違反 | ○ 不要 |

### 1.2 判断: **案A を採用**

**Why**:

1. 現行の `src/features/` は既に業務feature単位の縦分割であり、design-principles §4 の要求を満たしている。`src/domains/` を新設しても責務境界は変わらず、**ファイルの置き場所だけが変わる**。これは「先にファイルを移動し、後から責務を考える」に該当する
2. 現行HEADで feature間直接import 違反は 0件。境界は機能している
3. clean-break で必要なのは**再配置ではなく削除と依存是正**。移動と削除を混ぜると、どちらのレビューも困難になる

**ただし**: domain-local 文書は、**固有のinvariantが十分にあるdomainだけ**に置く。空の雛形やglobal原則のコピーは作らない。

---

## 2. Domain 一覧

### 2.0 業務の言葉 → 実装の入口（まずこれを見る）

domain名は英語だが業務用語は日本語なので、対応表を先に置く。**画面から探す場合は [SITEMAP.md](../../SITEMAP.md)**。

| 業務の言葉 | domain | 実装の入口 |
|---|---|---|
| 貸出（手動） | 2 | `features/staff-operations/services/manual-operation-workflow.ts` |
| 貸出（受注） | 2 | `lib/firebase/order-fulfillment-service.ts` ※ |
| 返却（手動） | 3 | `features/staff-operations/services/manual-operation-workflow.ts` |
| 返却（タグ処理） | 3 | `lib/firebase/return-tag-processing-service.ts` ※ |
| 返却（貸出先別一括） | 3 | `features/staff-operations/services/bulk-return-workflow.ts` |
| 返却（自社） | 5 | `features/inhouse/services/inhouse-return-workflow.ts` |
| 返却申請（顧客） | 7 | `lib/firebase/portal-transaction-service.ts`（作成のみ。確定は上記） |
| 充填 | 2 | `features/staff-operations/services/manual-operation-workflow.ts` |
| 破損 / 修理 / 耐圧検査 | 4 | `features/maintenance/services/{damage,repair,inspection}-workflow.ts` |
| 自社利用 | 5 | `features/inhouse/services/inhouse-use-workflow.ts` |
| タンク購入・登録 | 6 | `features/procurement/lib/submitTankEntryBatch.ts` |
| 備品発注 | 6 | `lib/firebase/supply-order.ts` |
| ログ訂正・取消 | 12 | `features/staff-dashboard/services/log-correction-workflow.ts` |
| 請求 | 9 | `src/lib/billing/` |
| 状態遷移そのもの | 1 | `src/lib/tank-operation.ts` / `tank-transition-policy.ts` |

**※ 既知の配置例外**: 「受注貸出」と「返却タグ処理」は workflow 層の責務（業務validation・payload構築・`applyBulkTankOperations` 呼び出し）を持つが、`features/**/services/` ではなく **`src/lib/firebase/` にある**。design-principles §5.1 の層定義と実配置が食い違う唯一の箇所であり、§25 の意図的例外として登録済み。clean-break で `features` 配下へ移すかは未定（移動それ自体は §24 が禁じる「責務を変えないファイル移動」に当たるため、他の変更と同時でなければ行わない）。

---

「画面」ではなく「業務上の言葉と変更理由」で切る。現行コードに実体があるものだけを挙げる。

| # | domain | 責務 | 責務に含めないもの | 配置 |
|---|---|---|---|---|
| 1 | **tank-lifecycle** | tankの状態遷移・不変条件・event生成・atomic永続化 | 業務ごとの入力検証、UI、請求、**表示文言**（現行違反あり） | `src/lib/tank-*.ts` |
| 2 | **rental-operations** | 手動貸出/返却/充填、受注貸出 | 遷移validation本体、請求 | `features/staff-operations/` |
| 3 | **return-workflow** | 返却確定（タグ処理・一括返却）、タグ→condition変換 | 返却「申請」の作成（portal側） | `features/staff-operations/` + `lib/return-tag-*.ts` |
| 4 | **maintenance** | 破損報告・修理完了・耐圧検査、次回期限算出 | 遷移validation本体 | `features/maintenance/` |
| 5 | **inhouse-operations** | 自社利用・自社返却 | maintenanceとの統合（禁止） | `features/inhouse/` |
| 6 | **procurement** | タンク購入・登録、備品発注 | 既存tankの状態遷移 | `features/procurement/` + `lib/firebase/supply-order.ts` |
| 7 | **customer-portal** | 顧客の注文・返却申請・未充填報告 | 申請の確定（staff側） | `src/app/portal/` + `lib/portal/` |
| 8 | **identity-access** | staff/customer/portal-user の認証・権限・identity解決・**locale保存** | 業務操作 | `lib/firebase/staff-*.ts` / `customer-user.ts` / `*AuthGuard.tsx` |
| 9 | **billing** | 請求候補の導出、単価・税・丸め | tank/logsへのwrite | `src/lib/billing/` |
| 10 | **sales-analytics** | 売上集計、スタッフ実績・報酬 | write全般 | `lib/analytics/` + `lib/incentive-rules.ts` |
| 11 | **operational-read-models** | staff dashboard の集計・ログ表示 | write | `features/staff-dashboard/queries/` |
| 12 | **audit-correction** | ログ訂正・取消、例外操作レビュー | 通常操作 | `features/staff-dashboard/services/` + `lib/firebase/operation-review-service.ts` |
| 13 | **admin-configuration** | settings / master / 権限の管理 | 業務操作 | `src/app/admin/` + `lib/firebase/admin-*.ts` |
| 14 | **notification** | メール・LINE通知設定と送信 | 業務操作のrollback権限 | `lib/firebase/admin-notification-settings.ts` |
| 15 | **display / i18n**（第二稿で追加） | code → localized text、書式整形 | **業務判断、保存値の決定** | `features/*/i18n.ts`、`lib/staff-display.ts`、`lib/*-labels.ts`、`lib/operation-messages.ts`、`lib/tank-recovery-confirmation-message.ts` |

**統合・改名の判断**:

- `staff-operations` は rental / return / order-fulfillment を含む複合featureだが**分割しない**。3者は「現場端末での操作」という変更理由を共有し、`OperationsTerminal` が composition 層として機能している
- `maintenance` と `inhouse` は**統合しない**。変更理由が異なる（設備管理 vs 在庫運用）
- `dashboard` は read（11）と correction（12）に**分ける**
- **display / i18n（15）を独立domainとして明示する**。これは第二稿の追加。translation を各featureに散らすと、辞書の完全性と「保存値と表示の分離」が保証できなくなる

---

## 3. 依存グラフ

```text
              ┌──────────────────────────────┐
              │  identity-access (8)          │
              │  actor / customer / locale    │
              └───────────┬──────────────────┘
                          │ (OperationContext)
                          ▼
  ┌──────────┬──────────┬──────────┬──────────┬──────────┐
  │ rental   │ return   │ mainte-  │ inhouse  │ procure- │
  │ ops (2)  │ flow (3) │ nance(4) │ ops (5)  │ ment (6) │
  └────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┘
       └──────────┴──────────┴──────────┴──────────┘
                          │ (workflow → domain)
                          ▼
              ┌───────────────────────────────┐
              │   tank-lifecycle (1)          │
              │   遷移validation / cycle      │
              │   binding / atomic write      │
              └──────────────┬────────────────┘
                    ┌────────┴────────┐
                    ▼                 ▼
              tanks (current)     logs (event)
                                      │ projection（一方向・逆流禁止）
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
              billing (9)     sales-analytics(10)  read-models(11)

  display / i18n (15) ← component / hook が呼ぶ
                      ✗ domain (1) は呼んではいけない（現行違反 V1/V2）

  customer-portal (7) ──creates──> transactions ──confirmed by──> (2)(3)
  audit-correction (12) ──uses──> tank-lifecycle (1)
  admin-config (13) ──configures──> settings ──read by──> (9)(1)
  notification (14) ← fire-and-forget（失敗しても業務をrollbackしない）
```

### 3.1 禁止する依存

| 禁止 | 理由 | 現行 |
|---|---|---|
| billing / sales / read-models → write service | 読み取り専用 | 遵守 |
| tank-lifecycle → billing | operationは金額を知らない | 遵守 |
| **domain (1) → display/i18n (15)** | 表示都合が atomic writer に入る | **違反 V1/V2** |
| **domain (1) → React / browser API** | domainの純粋性 | **違反 V1**（`useStaffSession` 経由） |
| feature ↔ feature の直接import | composition層でのみ束ねる | 遵守 |
| portal (7) → tanks / logs 直接write | 申請と確定を混同しない | 遵守 |
| display/i18n (15) → domain判断 | 辞書が業務判定に混入する | 遵守 |

---

## 4. Domain-local 設計文書の配置

**Rule**: 固有のinvariantが十分にあるdomainだけ。空の雛形は作らない。

| domain | domain-local doc | 判断 |
|---|---|---|
| tank-lifecycle (1) | — | invariantは design-principles §2.2 と `tank-operation.ts` のコメントに集約済み。**新規作成しない** |
| return-workflow (3) | `docs/return-flow-policy.md`（既存維持） | 5つの返却入口という固有の複雑さ |
| billing (9) | `docs/billing-rule-design.md`（既存維持） | 税・丸め・割引の固有ルール |
| identity-access (8) | `docs/identity-and-operation-logging-design.md`（要書き直し） | typed identity の意味定義 |
| **display / i18n (15)** | `docs/i18n-ui-display-policy.md` / `docs/i18n-operation-message-policy.md`（既存維持） | 辞書運用・residual scan の固有ルール |
| その他 9 domain | — | 固有invariantが薄い。**作らない** |

**Why**: 15 domain 分の DESIGN.md を作ると大半が global 原則のコピーになる。コピーは陳腐化し「どちらが正か」問題を新たに生む。

---

## 5. Source-of-truth matrix

| collection / field | 分類 | 正本 | write owner | 再生成可能 |
|---|---|---|---|---|
| `tanks/{tankId}` document ID | source of truth | 自身 | `submitTankEntryBatch` | ✗ |
| `tanks.status` | current projection | logs | `tank-operation.ts` | ✅ |
| tank custody（新。§8.5） | current projection | logs | `tank-operation.ts` | ✅ |
| `tanks.customerId` / `customerName` | current projection | customers + logs | `tank-operation.ts` | ✅ |
| `tanks.latestLogId` | **stale guard token** | logs | `tank-operation.ts` | ✅ |
| return tag draft | **未決**（§9.1） | — | — | — |
| `tanks.type` / `note` | source of truth | 自身 | `submitTankEntryBatch` | ✗ |
| `logs`（`logKind: "tank"`） | **immutable event** | 自身 | `tank-operation.ts` | ✗ |
| `logs.transitionPlan` | immutable event | 自身 | `tank-operation.ts` | ✗ |
| **`logs.prevTankSnapshot` / `nextTankSnapshot`** | **audit snapshot（復元の実体。維持必須）** | 自身 | `tank-operation.ts` | ✗ |
| **`logs.previousLogIdOnSameTank`** | **復元ポインタ（維持必須）** | 自身 | `tank-operation.ts` | ✗ |
| `logs.logStatus` | source of truth | 自身 | `tank-operation.ts` | ✗ |
| `logs.transitionReviewStatus` | audit record | 自身 | **`operation-review-service.ts`**（tank-operation ではない） | ✗ |
| `logs`（`logKind: "procurement"`） | immutable event | 自身 | **`submitTankEntryBatch`** | ✗ |
| `logs`（資材発注） | immutable event | 自身 | **`supply-order.ts`**（`writeBatch`。非transactional） | ✗ |
| `transactions` | source of truth | 自身 | portal service（作成）/ staff service（確定） | ✗ |
| `customers` | source of truth | 自身 | `customers-service.ts` | ✗ |
| `customerUsers` | source of truth | 自身 | `customer-user.ts` 他 | ✗ |
| `staff` | source of truth | 自身 | `staff-sync-service.ts` 他 | ✗ |
| **`staff.locale`** | **source of truth** | 自身 | `staff-locale-service.ts` | ✗ |
| **`staffSession.locale`（localStorage）** | **cache** | `staff` | session writer | ✅ |
| `staffByEmail` / `staffByUid` | **cache / index** | `staff` | mirror helper | ✅ |
| `settings/*` | source of truth | 自身 | 各 settings service | ✗ |
| `priceMaster` / `rankMaster` / `orderMaster` | source of truth | 自身 | admin一括保存 | ✗ |
| `monthly_stats` | **cache** | logs | 集計service | ✅ |
| `operationReviewEvents` | audit record | 自身 | `operation-review-service.ts` | ✗ |
| `tankProcurements` | source of truth | 自身 | `submitTankEntryBatch` | ✗ |
| 請求候補 | **derived read model** | logs | 永続化しない | ✅ |
| 確定請求書 | **未決**（ADR-005） | — | — | — |
| rental cycle | **derived read model**（ADR-003） | logs | 永続化しない | ✅ |
| staff実績 | derived read model | logs | 永続化しない | ✅ |
| i18n 辞書 | source of truth（コード） | 各 `i18n.ts` | — | ✗ |

---

## 6. Target directory tree

> **これは TARGET であって現状の記述ではない。** 特に `src/app/**` を「route の薄い殻のみ」と書いているが、**現状は違う** — `src/app/staff/dashboard/page.tsx`（877行）は `normalizeCorrectionRole` / `canModifyLog` / `canCorrectLogReason` 等の**権限判定述語**を持ち、§5.1 が page 層に禁じる業務判断に当たる（gap G11）。`src/app/admin/billing/page.tsx` は1307行。
>
> ただし `feature-boundaries.md` §4.8 の「行数を理由に再構造化しない」は正しい判断であり、維持する。G11 は V4（role code化）と**同じコード**なので、両者は同時に直る。

**現行構造からの変更は最小**。clean-break は再配置ではなく削除・依存是正・schema変更として実行する。

```text
src/
├── app/                          # route の薄い殻のみ
├── features/                     # 業務feature（縦分割）
│   ├── staff-operations/         # (2)(3)
│   │   ├── components/ hooks/ queries/ services/
│   │   ├── i18n.ts               # (15) feature-local display boundary
│   │   ├── bulk-return-display.ts # (15)
│   │   └── OperationsTerminal.tsx # composition層
│   ├── maintenance/              # (4) services/ は3ファイル独立を維持
│   ├── inhouse/                  # (5) services/ は2ファイル独立を維持
│   ├── procurement/              # (6)
│   ├── staff-dashboard/          # (11) queries/ + (12) services/ + i18n.ts
│   └── admin-customers/          # (13) の一部
├── components/                   # 汎用UI部品のみ
└── lib/
    ├── tank-operation.ts         # (1) 唯一のtank遷移writer
    │                             #     ★ locale依存を除去する（V1/V2）
    ├── tank-transition-policy.ts # (1) 遷移policy（pure）
    ├── tank-transition-projections.ts # (1)→(9)(10)(11) の event contract
    ├── tank-rules.ts / tank-action-status-codes.ts  # (1) code正本
    ├── tank-id.ts                # (1) ID正規化（pure）
    ├── operation-context.ts      # (8)→全workflow の identity契約
    ├── staff-operation-error.ts  # (1)+(15) error code正本 + catalog
    ├── staff-display.ts          # (15) display boundary
    ├── tank-action-status-labels.ts        # (15)
    ├── return-tag-labels.ts                # (15)
    ├── operation-messages.ts               # (15)
    ├── tank-recovery-confirmation-message.ts # (15)
    ├── locale.ts                 # (15) Locale型
    ├── billing/                  # (9)
    ├── analytics/                # (10)
    ├── portal/                   # (7)
    └── firebase/
        ├── repositories/         # read repository
        └── *-service.ts          # collection別 write owner
```

### 6.1 clean-break で**削除**されるもの

```text
✗ customer-identity-read.ts の legacy分岐（isLegacy / legacy-location:）
   → strict typed resolver へ置換（削除ではない。design-principles §8.6）
✗ invoice-candidate.ts の resolvePricing 名前一致検索
✗ dashboard-read-model.ts / bulk-return-candidates.ts の isLegacy 伝播
✗ admin/billing/page.tsx の「旧形式」警告表示
✗ staff-operation-error.ts の ja優先message経路（catalog一本化）
✗ `location` field → custody model へ置換
```

### 6.2 clean-break で**新設**されるもの

```text
+ custody model の型と構築ヘルパー（ADR-002 確定後）
+ tests/architecture/*.test.ts      # 全体横断の依存検証
+ eslint.config.mjs の no-restricted-imports
+ docs/architecture/adr/            # ADR-001〜006
```

### 6.3 clean-break で**是正**されるもの

```text
~ tank-operation.ts から getStaffLocale() import を除去（V1/V2）
  → locale は引数 / OperationContext で受ける
~ customer-identity-read.ts のハードコード日本語 → display boundary へ（V3）
```

---

## 7. Domain別 contract 要約

### 7.1 tank-lifecycle (1)

- **公開API**: `applyTankOperation` / `applyBulkTankOperations` / `applyLogCorrection` / `voidLog` / `appendTankOperation`
- **発行するevent**: `logs.transitionPlan`（typed、schemaVersion付き）
- **write owner**: `tanks` + `logs` + `settings/tankAggregationRevision`
- **atomicity境界**: 上記3つを単一 `runTransaction`
- **invariants**: design-principles §2.2 の全項目
- **許可される依存**: `tank-rules` / `tank-transition-policy` / `tank-action-status-codes` / `operation-context` / `firebase/config` / `staff-operation-error`（code部分）
- **禁止する依存**: React / Next / browser API / **locale / display boundary**（**現行違反 V1/V2**）
- **test**: pure unit + Emulator integration

### 7.2 billing (9)

- **公開API**: `buildInvoiceCandidates` / `calculateBillingCandidate`
- **消費するevent**: `projectOfficialAggregationEvent` / `projectRentalCycleEvents`
- **write owner**: なし（読み取り専用。確定請求書は ADR-005）
- **invariants**: fail-closed、pending review 印刷停止
- **禁止する依存**: `tank-operation.ts`、あらゆる write service
- **test**: pure unit + mutation test候補

### 7.3 display / i18n (15)

- **公開API**: `getStaffOperationText` / `getStaffOperationErrorMessage` / `getLegacyTankActionLabel` 等
- **source of truth**: 各 `i18n.ts` の辞書（コード内）
- **invariants**: ja/en 辞書のキー完全性、未管理日本語の不在、**業務判定に使われないこと**
- **許可される依存**: `locale.ts`、code定義（`tank-action-status-codes` 等）
- **禁止する依存**: repository、workflow、Firestore
- **test**: dictionary完全性test + `staff-i18n-scan` residual scan

---

## 8. 現行コードと新設計の主要gap

| # | gap | 現状 | target | 種別 | domain |
|---|---|---|---|---|---|
| **V1** | domain が React hook module を import | `tank-operation.ts:63` → `@/hooks/useStaffSession` | locale を引数で受ける | **依存是正** | 1 |
| **V2** | domain が locale を暗黙に読む | `tank-operation.ts:776` | 同上 | **依存是正** | 1 |
| **V3** | domain module にハードコード日本語 | `customer-identity-read.ts` | display boundary へ | **依存是正** | 1,15 |
| G1 | `location` の意味が2つ | 場所と顧客名が同一field | custody model（ADR-002） | 互換性+設計 | 1〜5,9,11 |
| G2 | legacy identity fallback | `isLegacy` が請求・dashboard・一括返却に伝播 | strict resolver へ置換 | **互換性** | 9,11,2 |
| G3 | 名前による単価解決 | `customersByName` 一致検索 | `customerId` のみ | **互換性** | 9 |
| G4 | return tag draft の置き場所 | `tanks.logNote` 二重owner | ADR-004 | 設計 | 1,3,5 |
| G5 | event schemaVersion が暗黙 | 形状検査で代用 | 明示field | 設計 | 1,9,10 |
| G6 | 確定請求書がない | 候補を毎回導出 | ADR-005 | **要件未確定** | 9 |
| G7 | 全体横断enforcement不足 | 局所的機構は存在（§21.1） | 一般化 | 設計 | 全 |
| G8 | dev が本番Firestore直結 | DB分離なし | dev project 分離 | 環境 | 全 |
| ~~G9~~ | ~~`logKind` 欠落の推測処理~~ | **撤回**。当該コードは推測ではなく **fail-closed guard**。削除対象ではない（design-principles §22.1） | — | — | — |
| G10 | error message の ja 優先経路 | `locale === "ja"` 分岐 | catalog一本化 | **互換性** | 15 |
| **V4** | 日本語文字列が permission code | `StaffCorrectionRole = "管理者"…`、`role !== "管理者"` を transaction 内で比較 | code化 | **依存是正 + schema** | 1,8,12,13 |
| **V5** | 保存値が日本語文字列 | `logAction: "受注貸出"` / `location: "倉庫"` | code化 | **依存是正 + schema** | 1,2,3 |
| **V6** | 非transactional な `tanks` write が stale guard を迂回 | `tank-tag-service.ts:9` の bare `updateDoc` | draft移設で削除 | **設計** | 1,3,5 |
| **G11** | page 層に権限判定述語 | `staff/dashboard/page.tsx` の `canModifyLog` 等 | V4 と同時に解消 | 設計 | 12 |
| **G12** | Rules に deny-by-default でない blanket allow | `!isTankProjectionChanged()` で未知fieldが無制限に書ける | `hasOnly()` へ反転 | **安全性** | 1 |
| **G13** | billing の fail-closed が全社停止 + 全log読み | 1件のmalformed logで全顧客の請求が停止。`getActiveLogs()` は無制限 | 影響範囲報告 + quarantine + 読み取り範囲限定 | 設計 | 9 |

**種別の意味**: 「互換性」= clean-breakで消える。「依存是正」= 互換性ではなく現行の設計違反。「設計」= 業務要件から評価が必要。「要件未確定」= 製品判断が先。
