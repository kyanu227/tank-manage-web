# 設計資料の正本性（Document Authority）

- 初版: 2026-07-19
- 改訂: 2026-08-02（第二稿。基準 `6c1d4c5` = origin/main）
- Status: この文書自体は**現行の運用正本**。ただし §2 の「Proposed」は未承認

---

## 0. この文書の構成

正本性を**4種類に分けて**記述する。一列に並べると、性質の違う権威が混ざって解釈が割れる。

| 種別 | 何に答えるか | 例 |
|---|---|---|
| **A. workflow / safety authority** | 誰が・どの手順で作業してよいか | `AGENTS.md` / `CLAUDE.md` |
| **B. architecture normative authority** | 何を・どう設計するか | `design-principles.md` / ADR / domain設計 |
| **C. current implementation factual authority** | 現在どう実装されているか | 現行コード / 現行テスト |
| **D. historical documents** | 過去にどう考えたか | 旧監査・旧roadmap |

**A と B は競合しない。** 前者は作業手順、後者は設計判断であり、同じ問いに答えていない。
**C は「今どうなっているか」の証拠であり、「今後もそうすべき」という規範ではない。**

---

## 1. Current authoritative order（現在有効。**これが現行の運用ルール**）

`design-principles.md` はDraftであるため、**現時点の正本順位は従来どおり**である。

| 順位 | 対象 | 種別 |
|---|---|---|
| 1 | `AGENTS.md`（規範ルール部分） | A |
| 2 | 現行コード | C |
| 3 | 現行テスト | C |
| 4 | `docs/architecture/write-ownership.md` / `feature-boundaries.md` | B（既存） |
| 5 | 本文書 | B（既存） |
| 6 | `CLAUDE.md` | A |
| 7 | `SITEMAP.md` | C |
| 8 | 旧roadmap・旧監査資料 | D |

**Draft文書（`design-principles.md` / `domain-map.md` / `clean-break-cutover-plan.md`）は、この順位に含まれない。** 参考資料として読んでよいが、実装判断の根拠にしない。

### 1.1 規範と事実記述の区別

`AGENTS.md` のうち**規範ルール**（許可・禁止・手順・優先方針）は順位1。
**事実記述**（ディレクトリ構成・実装状態）が現行コードと食い違う場合は**現行コードを正**とし、乖離を §4 に記録して更新候補とする。

---

## 2. Proposed authoritative order（ユーザー承認後に発効）

`design-principles.md` が正式正本化された後の順位。**承認まで発効しない。**

| 順位 | 対象 | 種別 |
|---|---|---|
| 1 | `AGENTS.md` / `CLAUDE.md` の**workflow / safety 規範** | A |
| 2 | **`docs/architecture/design-principles.md`** | **B（最上位）** |
| 3 | ADR（`docs/architecture/adr/`） | B |
| 4 | 現行コード | C |
| 5 | 現行テスト | C |
| 6 | `docs/architecture/` 実装詳細（`domain-map` / `write-ownership` / `feature-boundaries` / `clean-break-cutover-plan`） | B |
| 7 | domain-local 設計文書 | B |
| 8 | `SITEMAP.md` | C |
| 9 | historical | D |

### 2.1 A と B が矛盾した場合

順位1（workflow / safety）を優先する。ただしその矛盾は**解消すべき欠陥**として §4 に記録し、ユーザー承認のうえ修正する。

### 2.2 発効条件

1. ユーザーが `design-principles.md` の内容を承認する
2. 各Draft文書から `Status: Draft / Not yet authoritative` を外す
3. §4 の `AGENTS.md` / `CLAUDE.md` 修正を実施する（設計方針の重複を解消しないと、正本が再び分裂する）

---

## 3. 既存設計資料の処遇

### 3.1 凡例

| 判定 | 意味 |
|---|---|
| **retain** | 現役正本として維持 |
| **rewrite** | 内容を書き直す |
| **merge** | 新正本へ統合し元文書は廃止 |
| **supersede** | historical凍結。冒頭に注記を追記し削除しない |
| **hold** | 今回レビュー対象外。現状維持 |

### 3.2 規範・方針文書

| document | 判定 | new role | reason |
|---|---|---|---|
| `AGENTS.md` | **rewrite**（承認要） | A: workflow/safety正本 | §4 の乖離。設計方針部分は design-principles へ merge |
| `CLAUDE.md` | **rewrite**（承認要） | A: workflow + Claude/Codex境界 | 同上 |
| `SITEMAP.md` | retain | C: route対応の事実記述 | 更新のみ |
| `docs/project-direction.md` | **rewrite** | 業務目的とlong-term goalsのみ | §3.3 |
| `docs/architecture/design-principles.md` | **新設（Draft）** | B: architecture最上位（承認後） | 第二稿 |
| `docs/architecture/domain-map.md` | **新設（Draft）** | B: domain境界とSoT matrix | 第二稿 |
| `docs/architecture/clean-break-cutover-plan.md` | **新設（Draft）** | B: cutover実装順序 | 第二稿 |
| `docs/architecture/README.md` | **新設** | 入口 | — |
| `docs/architecture/document-authority.md` | **rewrite**（本文書） | 正本順位 | 4種別化 + Current/Proposed分離 |
| `docs/architecture/write-ownership.md` | retain | B: write owner実装正本 | 現行コードと一致 |
| `docs/architecture/feature-boundaries.md` | retain | B: feature境界実装正本 | 現行コードと一致 |
| `docs/architecture/refactor-sequence.md` | **supersede（ただし §2 は継承）** | D | PR-01〜12は**全て実装完了**。PR順序としての役割は clean-break-cutover-plan が引き継ぐ。**ただし §2 の検証プロトコル（挙動不変条件・payload固定テスト・L0/L2検証levelとユーザー承認）は現在も有効**であり、cutover plan §8 が明示的に継承する。supersede banner にもその旨を書く |

### 3.3 `docs/project-direction.md` を rewrite する理由（証拠付き）

| 記述 | 現行の事実 |
|---|---|
| §2「最初の実装で `tanks.customerId` を追加しない」 | **実装済み**（`tank-types.ts:10`） |
| §2「現行ポータルは `tanks.location == customerName` に依存」 | この依存が clean-break の削除対象（design-principles §8.5） |
| §4「Firestore schema の実変更を行わない」 | clean-break 前提と矛盾 |
| §4「migration / backfill script を作らない」 | **維持**（今後も不要） |
| §7「英語での基本操作」を将来機能として記載 | **実装済み**（PR #176〜#182） |
| §9 Implementation Order | refactor-sequence 完了と英語化完了により前提が変化 |

**残すもの**: §1 Purpose、§3 Long-Term Goals、§5 Data Design Principles、§8 Post-Structure Product Goals。

### 3.4 データモデル・identity 文書

| document | 判定 | reason |
|---|---|---|
| `docs/design/data-model-source-of-truth.md` | **merge → supersede** | SoT matrix は domain-map §5 が引き継ぐ。Tank ID Policy / Location Risk は design-principles §8.2・§8.5 へ統合 |
| `docs/identity-and-operation-logging-design.md` | **rewrite** | typed identity の意味定義は有効。§16「migration / backfill 方針」は clean-break で不要 |
| `docs/firestore-data-model-policy.md` | **merge → supersede** | design-principles §9 / domain-map §5 に統合 |
| `docs/design/customer-identity-location-normalization.md` | **supersede** | `location` 正規化の旧計画。clean-break では**廃止**するため前提が変わる |
| `docs/design/tank-id-operation-boundary-design.md` | retain | design-principles §8.2 の入力として有効 |
| `docs/design/tank-id-operation-compatibility-audit.md` | **supersede** | 互換性監査。対象消滅 |
| `docs/design/tank-id-usage-and-model-audit.md` | **supersede** | as-of監査。ただし ADR-001 の入力として参照する |
| `docs/customer-data-model-redesign.md` | **supersede** | 旧再設計案 |
| `docs/database-schema.md` | **rewrite**（cutover後） | reset後に新schemaで書き直す |

### 3.5 i18n 文書（第二稿で追加）

| document | 判定 | reason |
|---|---|---|
| `docs/i18n-ui-display-policy.md` | **retain** | display boundary の domain-local 正本。design-principles §12 との整合を確認すること |
| `docs/i18n-operation-message-policy.md` | **retain** | operation message の正本 |

### 3.6 業務フロー文書

| document | 判定 | reason |
|---|---|---|
| `docs/return-flow-policy.md` | retain | return-workflow の domain-local 正本 |
| `docs/billing-rule-design.md` | retain | billing の domain-local 正本 |
| `docs/design/strict-vs-assisted-transition-mode.md` | retain | strict/advisory の意味定義。実装済み |
| `docs/design/strict-vs-passthrough-operation-mode.md` | **supersede** | 上記に置き換えられた旧案 |
| `docs/return-tag-processing-naming-design.md` | retain | 命名の根拠 |
| `docs/pending-return-status-migration-design.md` | **supersede** | migration前提。clean-breakで不要 |
| `docs/action-status-code-pivot-design.md` | **supersede** | code化完了済み |

### 3.7 監査・ロードマップ

| document | 判定 | reason |
|---|---|---|
| `docs/implementation-roadmap.md` | **supersede** | Phase 0〜9 の前提が変化（構造化完了 + 英語化完了）。役割は clean-break-cutover-plan へ |
| `docs/refactor/*`（5件） | supersede（既に凍結済み） | as-of監査 |
| `docs/design/implementation-layer-architecture.md` | supersede（既に凍結済み） | feature-boundaries が置き換え |
| `docs/design/system-code-and-data-structure-audit.md` | supersede（既に凍結済み） | as-of監査 |
| `docs/audit/*`（3件） | supersede | as-of完了報告 |

### 3.8 cutover / deploy / verification

| document | 判定 | reason |
|---|---|---|
| `docs/cutover/transition-plan-v1-runbook.md` | **retain** | cutover運用の正本。data reset で再利用。**削除しない** |
| `docs/cutover/infra-readiness-tools.md` | retain | 同上 |
| `docs/cutover/rules-bypass-writer-inventory.md` | retain | Rules設計の入力 |
| `docs/verification/full-app-flow-verification-plan.md` | **retain** | 検証level L0〜L3 と停止条件の正本 |
| `docs/deployment-and-firestore-change-rules.md` | retain | deploy規範 |
| `docs/security-rulebook.md` | retain | Rules設計の正本 |
| `docs/verification/*` / `docs/deploy/*`（結果記録） | **retain as record** | **実施記録**であり設計正本ではない。書き換えない。設計判断の根拠には使わない |

### 3.9 今回レビュー対象外（hold）

`docs/auth/` / `docs/design/portal-unfilled-report-*` / `docs/design/staff-dashboard-*` / `docs/admin-integration-plan.md` / `docs/data-layer-*` / `docs/phase-2-b-verification.md` / `docs/portal-identity-and-transaction-plan.md` / `docs/status-and-transition-purpose-audit.md` / `docs/tank-workflow-semantics-plan.md` / `progress.md`

**現状維持**。今回の設計監査では内容をレビューしていない。

---

## 4. AGENTS.md / CLAUDE.md で修正が必要な箇所

**本タスクでは変更していない。** ユーザー承認のうえ docs-only の別PRで実施する。

| # | ファイル | 現在の記述 | 問題 | 提案 |
|---|---|---|---|---|
| 1 | `AGENTS.md` | 「`tanks.customerId` の追加は未決事項として扱い、勝手に実装しない」 | **実装済み**（`tank-types.ts:10`） | 「現在貸出のprojectionとして実装済み。顧客identityの正本ではない」へ |
| 2 | `AGENTS.md` / `CLAUDE.md` | 変更禁止に `firestore.indexes.json` を列挙 | **リポジトリにもgit履歴にも存在しない** | 列挙から削除し「index は Console 手動管理」と明記 |
| 3 | `AGENTS.md` | 「`docs/implementation-roadmap.md` の順序で進める」 | roadmap を supersede するため参照先が無効化 | `clean-break-cutover-plan.md` へ変更 |
| 4 | `AGENTS.md` | §次に進めるべき作業 6項目 | 大半が完了済み（tag純粋関数化・service境界・code化・英語対応） | 現行の残作業へ差し替え |
| 5 | `AGENTS.md` / `CLAUDE.md` | Project direction / Core principles / Architecture direction の節 | `design-principles.md` と**内容が重複**。二重管理 | 節を削り参照1行へ置換 |
| 6 | `CLAUDE.md` | ディレクトリ構造図 | i18n module 群が未記載 | 現行化 |
| 7 | `AGENTS.md` | 「`destinations` は廃止済み」 | `firestore.rules` に match ブロックが残存 | Rules cutover の削除対象に含める |
| 8 | `AGENTS.md` | 「多言語対応は業務ロジックから日本語文字列依存を外した後に進める」 | **完了扱いにできない**。`action` の日本語判定は0件だが、**`role` は日本語文字列のまま permission code として機能**（V4）。英語化は表示層のみ完了 | 「表示の英語化は完了。ただし `role` の code化は未了（V4）」へ |
| 9 | `README.md`（root） | `create-next-app` の初期テンプレートのまま | **新規参加者が最初に開くファイルが、どこも指していない**。`docs/architecture/README.md` への流入経路が実質存在しない | 3行の入口（SITEMAP / architecture / AGENTS）へ差し替え |
| 10 | `SITEMAP.md` §8-1 | 「tank write は `writeBatch` で原子的に実行」 | **事実誤り**。`tank-operation.ts` は `runTransaction` 4箇所、`writeBatch` 0箇所。順位7の「事実記述」正本が、最重要ファイルについて誤った事実を述べている | `runTransaction` へ訂正 |
| 11 | `SITEMAP.md` §9 rule 4 | 「`batch.set(..., {merge:true})` は幽霊ドキュメントを作るため原則禁止」 | この規則は**具体的で理由もあるのに `design-principles.md` §24 に無い**。一方 `{merge:true}` は10ファイル以上で実際に使われている | 規則が有効なら §24 へ移し違反を棚卸し。obsolete なら SITEMAP から削除 |
| 12 | `CLAUDE.md` | `refactor-sequence.md` を「進捗・判断の正本」として列挙 | 同文書は supersede 判定。ただし**§2 の検証プロトコル（payload固定テスト・L0/L2・ユーザー承認）は有効**で、cutover plan §8 が継承する | 列挙から外し、検証プロトコルの参照先としてのみ残す |
| 13 | `feature-boundaries.md` L6 / `staff-dashboard-read-model-design.md` L16 | 各文書が独自に「優先順位: AGENTS.md > 現行コード > …」を宣言 | 正本順位が**5箇所**に散在している | 各文書の当該行を削除し、本文書への参照へ置換 |

**#5 が最も重要**。設計方針が `AGENTS.md` / `CLAUDE.md` / `project-direction.md` / `design-principles.md` の4箇所に散ると、「実装者によって解釈が変わる」状態が再発する。設計方針の記述は design-principles に一本化し、他は参照に留めるべき。

---

## 5. 運用ルール

- 資料の更新・凍結注記は **docs-only の単独PR** で行い、実装PRと混ぜない
- `AGENTS.md` / `CLAUDE.md` の変更は差分を明示してユーザー承認を得る
- 新しい監査を行った場合、古い監査は上書きせず historical 化する
- **supersede 判定の文書は削除しない**。冒頭に superseded 注記を追記する。Git履歴が保存場所である
- 新しい architecture 規則を追加するときは、**同じPRで強制手段（lint / test）も追加する**（design-principles §21.3）
- **設計文書を作成・改訂するときは、必ず `origin/main` を基準に監査する**（第一稿が古いlocal mainを基準にした失敗の再発防止）
