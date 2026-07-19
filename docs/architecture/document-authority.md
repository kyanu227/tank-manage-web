# 設計資料の正本性（Document Authority）

- 作成日: 2026-07-19
- 対象commit: 7a118a4c1bce2b12bd272a6de8a69291e9d8d2ef（main HEAD）
- 位置づけ: 設計資料の正本順位と、旧資料の更新・凍結方針の正本

## 1. 正本順位

コードと資料、資料同士が矛盾する場合は次の順で評価する:

1. `AGENTS.md`
2. 現行コード
3. 現行テスト
4. 最新のaudit / design docs
   - `docs/architecture/feature-boundaries.md`（feature境界の正本）
   - `docs/architecture/write-ownership.md`（write ownerの正本）
   - `docs/architecture/refactor-sequence.md`（PR順序の正本）
   - 本文書（資料正本性の正本）
   - `docs/refactor/residual-structure-audit-2026-07-19.md`（対象commit時点の残差スナップショット）
5. `CLAUDE.md`
6. `SITEMAP.md`
7. 旧roadmap・旧監査資料

構造化リファクタにおいて、実装上の「親」は上記4の architecture 4文書とする。矛盾を発見した場合は、上位を正としつつ architecture 文書を更新する。

## 2. 現行コードと矛盾が確認された資料（2026-07-19時点の証拠付き）

| 資料 | 矛盾内容 | 現行の事実 |
|---|---|---|
| `AGENTS.md` | ディレクトリ図に `staff/orders` `staff/returns` `staff/maintenance` `staff/bulk-return` を記載 | いずれもroute実在せず。現行は lend / return / fill（OperationsTerminal薄wrapper）+ damage / repair / inspection / inhouse / dashboard / mypage / supply-order / tank-purchase / tank-register |
| `AGENTS.md` | 「`tanks.customerId` の追加は未決事項として扱い、勝手に実装しない」 | 現在貸出projectionとして実装済み（tank-types.ts:9-12、tank-operation.ts経由で書き込み。監査R-28） |
| `CLAUDE.md` | ディレクトリ構造（orders/returns/bulk-return記載、supply-order・tank-purchase・tank-register・inspection・repair・admin配下の新ページ群が欠落） | 上と同じroute構成。admin側も operation-reviews / security-rules / state-diagram / order-master / staff / customers/users / settings/portal / settings/tank-operations が存在 |
| `CLAUDE.md` | 顧客ポータル認証に「パスコード」経路を記載。`destinations` を現役コレクションとして記載 | 旧customers.passcode経路はPortal Auth Phase 0で廃止済み（AGENTS.md）。destinationsは廃止済み・コード参照なし |
| `SITEMAP.md` | 2026-04-27時点の画面構成 | 上記のstaff/admin route改編が未反映 |
| `docs/refactor/refactor-roadmap.md` | master/settings一律repository化、repository skeleton=未了write移行という前提 | 前提無効（監査R-33・R-34: Phase 2-B read移行完了、write未移行は意図的なphase分離） |
| `docs/design/strict-vs-assisted-transition-mode.md` §「production Reset未準備」 | cutover完了済み | 同資料自身が完了を追記済み（監査R-43）。この節のみhistorical |

## 3. 資料の分類

### 有効（現行仕様の正本として参照し続ける）

| 資料 | 役割 |
|---|---|
| `AGENTS.md` | 全体方針の最上位（§2の乖離は更新対象） |
| `docs/architecture/` 4文書 | 構造化リファクタの実装上の親 |
| `docs/design/strict-vs-assisted-transition-mode.md` | strict/advisory・transitionPlan・review・atomic上限の意味定義（実装済み R-42） |
| `docs/identity-and-operation-logging-design.md` | OperationContext・typed identity・provenanceの意味定義（R-24実装済み。R-25残差はrefactor-sequenceが管理） |
| `docs/project-direction.md` / `docs/firestore-data-model-policy.md` / `docs/return-flow-policy.md` / `docs/implementation-roadmap.md` | AGENTS.mdが指定するdirection正本（今回は内容の再分類をしていない） |
| `docs/cutover/transition-plan-v1-runbook.md` | cutover運用の正本（AGENTS.md指定） |

### historical凍結（削除も移動もしない。冒頭にsuperseded注記を追記する）

| 資料 | 凍結理由 / 引き継ぎ先 |
|---|---|
| `docs/refactor/refactor-roadmap.md` | obsolete前提を含む（R-33/R-34）。残課題はresidual audit→refactor-sequenceへ引き継ぎ済み |
| `docs/refactor/page-feature-boundary-audit.md` | as-of監査（2026-05-04）。残差はresidual auditへ |
| `docs/refactor/firestore-write-boundary-audit.md` | as-of監査（2026-05-05）。write ownerはwrite-ownership.mdが正本 |
| `docs/design/system-code-and-data-structure-audit.md` | as-of監査（2026-05-21）。残差はresidual auditへ |
| `docs/refactor/staff-operation-service-boundary-design.md` | 対象serviceは実装済み（R-13/R-14）。設計経緯の参考資料 |
| `docs/design/implementation-layer-architecture.md` | 層構造の旧計画。feature-boundaries.mdが置き換え |
| `docs/refactor/residual-structure-audit-2026-07-19.md` | **対象commit時点のスナップショット**。PR進行に伴い陳腐化するが更新しない（更新先はarchitecture文書） |

### 更新対象（docs-only単独PR・ユーザー承認前提）

| 資料 | 更新内容 |
|---|---|
| `AGENTS.md` | ディレクトリ図の現行化、tanks.customerId記述の現状化（projection実装済み・正本ではない旨） |
| `CLAUDE.md` | ディレクトリ構造・認証フロー・コレクション表の現行化。Codex発注の`progress.md`毎回追記ルールを、refactor-sequence §7の追跡方針（job status + PR本文 + .codex-logs/）と整合させるか判断 |
| `SITEMAP.md` | route一覧の現行化 |
| historical凍結の各資料 | 冒頭に「superseded by docs/architecture/（日付）」注記を追記 |

## 4. 運用ルール

- 資料の更新・凍結注記は**docs-onlyの単独PR**で行い、実装PRと混ぜない（AGENTS.md deploy/commit分離ルール準拠）
- `AGENTS.md` / `CLAUDE.md` はユーザーのワークフロー設定を含むため、変更は差分を明示してユーザー承認を得る
- 新しい監査を行った場合、古い監査は上書きせずhistorical化し、正本はarchitecture文書側を更新する

## 5. スコープ外

`docs/audit/` `docs/auth/` `docs/billing-*` `docs/cutover/` `docs/deploy/` `docs/verification/` ほか §2〜3に列挙していない資料は、今回の構造化設計ではレビューしておらず、再分類しない。現状の位置づけを維持する。
