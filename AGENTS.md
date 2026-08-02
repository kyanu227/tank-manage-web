# タンク管理 Web

ダイビングタンクのレンタル管理システム（Web版）。
現行Web版を正として保守・改善するプロジェクト。

## 技術スタック

| 技術 | バージョン | 用途 |
|------|-----------|------|
| Next.js | 16.1.6 | フレームワーク（App Router, 静的エクスポート） |
| React | 19.2.3 | UIライブラリ |
| TypeScript | 5 | 型安全 |
| Firebase Auth | 12.10.0 | 認証（Google, Email/Password） |
| Firestore | 12.10.0 | データベース |
| Firebase Hosting | — | デプロイ先（静的サイト） |
| Tailwind CSS | 4 | スタイリング |
| lucide-react | 0.577.0 | アイコン |

## ディレクトリ構造

```
src/
├── app/
│   ├── layout.tsx              # ルートレイアウト
│   ├── page.tsx                # → /portal リダイレクト
│   ├── globals.css             # CSS変数・プリセットクラス
│   ├── admin/                  # 管理画面（AdminAuthGuard）
│   │   ├── layout.tsx          # 管理レイアウト・ナビ
│   │   ├── page.tsx            # ダッシュボード
│   │   ├── settings/           # ポータル・耐圧検査・状態遷移モード設定
│   │   ├── permissions/        # ページ権限制御
│   │   ├── customers/          # 顧客管理・ポータル利用者管理
│   │   ├── notifications/      # 通知設定（メール・LINE）
│   │   ├── staff-analytics/    # スタッフ実績ランキング
│   │   ├── staff/              # 担当者管理
│   │   ├── money/              # 操作単価・ランク条件
│   │   ├── billing/            # 請求書発行
│   │   ├── sales/              # 売上統計
│   │   ├── operation-reviews/  # 例外操作レビュー
│   │   ├── order-master/       # 発注品目マスタ
│   │   ├── state-diagram/      # 状態遷移図
│   │   └── security-rules/     # Security Rules 確認
│   ├── staff/                  # スタッフ操作画面（StaffAuthGuard）
│   │   ├── layout.tsx          # スタッフレイアウト・ナビ
│   │   ├── page.tsx            # → /staff/lend リダイレクト
│   │   ├── lend/               # 貸出（手動/受注）
│   │   ├── return/             # 返却タグ処理・一括返却・手動返却
│   │   ├── fill/               # 充填
│   │   ├── damage/             # 破損報告
│   │   ├── repair/             # 修理完了
│   │   ├── inspection/         # 耐圧検査
│   │   ├── order/              # → /staff/supply-order 互換リダイレクト
│   │   ├── supply-order/       # 備品・資材発注
│   │   ├── tank-purchase/      # タンク購入
│   │   ├── tank-register/      # タンク登録
│   │   ├── mypage/             # マイページ
│   │   ├── inhouse/            # 自社タンク管理
│   │   └── dashboard/          # ステータス集計・ログ管理
│   └── portal/                 # 顧客ポータル（Firebase Auth + customerUsers）
│       ├── layout.tsx          # ポータルレイアウト・Auth状態管理
│       ├── page.tsx            # ホーム（貸出状況・ログ）
│       ├── login/              # ログイン（Google/メール）
│       ├── register/           # 新規登録
│       ├── setup/              # 初期設定（会社名・氏名・LINE名）
│       ├── order/              # タンク発注
│       ├── return/             # 返却申請（自動返却対応）
│       └── unfilled/           # 未充填報告
├── features/
│   ├── staff-operations/       # 貸出・返却・充填・受注
│   ├── staff-dashboard/        # スタッフ集計・ログ表示
│   ├── maintenance/            # メンテナンス workflow
│   ├── inhouse/                # 自社タンク workflow
│   ├── procurement/            # 備品発注・タンク購入/登録
│   └── admin-customers/        # 顧客・ポータル利用者管理
├── components/
│   ├── AdminAuthGuard.tsx      # 管理者認証・権限ガード
│   ├── StaffAuthGuard.tsx      # スタッフ認証ガード
│   ├── AuthPanel.tsx           # 認証画面共通パネル
│   └── QuickSelect.tsx         # タッチ対応クイック選択
└── lib/
    └── firebase/
        ├── config.ts           # Firebase初期化
        ├── repositories/       # tanks/logs/transactions の読み取りrepository
        ├── customer-user.ts    # portal Auth / customerUsers ヘルパー
        ├── staff-auth.ts       # staff / staffByEmail 同期ヘルパー
        └── diff-write.ts       # 差分更新ヘルパー
```

## AI組織構造（秘書ハブ型）

全てのタスクは `@secretary` に依頼する。秘書が判断して最適なスペシャリストに振り分ける。

```
ユーザー
  │
  ▼
┌─────────────┐
│   秘書      │  判断・振り分け・品質管理・改善提案
│ (opus)      │  軽微タスクは直接対応
└──────┬──────┘
       │
       ├── @frontend (opus)   UI/UX・コンポーネント実装
       ├── @backend  (opus)   Firebase/Auth/Firestore
       ├── @migration (opus)  データ移行・互換性整理
       └── (秘書が必要に応じて新エージェント作成)
```

## Claude / Codex shared workflow

Claude と Codex が並行作業する場合は、作業境界を先に固定する。Codex は domain logic、data model、Firestore integration、billing calculation、validation、deploy の owner とする。Claude は UI/design、visual layout、presentational components、CSS、print CSS、spacing、typography、copy presentation の owner とする。

Claude UI-only PR は、changed-file boundary と props contract でレビュー可能な差分にする。Codex は毎回 UI 美観を再設計せず、禁止ファイル・props契約・build/validation・business logic 非変更を確認する。

### Claude UI-only allowed scope

Claude may edit:

- `src/features/**/components/**/*.tsx`
- `src/features/**/styles/**/*.css`
- component-local presentational code
- CSS inside presentational components
- docs only when documenting UI behavior

Claude may edit `src/app/**/page.tsx` only when the page is already a thin wrapper and no Firestore/query/calculation/stateful business logic is changed.

### Claude must not edit

Claude must not edit unless the task explicitly says otherwise:

- `src/lib/firebase/**`
- `src/lib/billing/calculate.ts`
- `src/lib/billing/settings.ts`
- `src/lib/billing/source-logs.ts`
- `src/lib/billing/invoice-candidate.ts`
- `src/lib/customer-identity-read.ts`
- `src/lib/tank-operation.ts`
- `src/lib/firebase/repositories/**`
- `firestore.rules`
- `firebase.json`
- `package.json`
- `package-lock.json`
- action/status code definitions
- operation context / identity types
- any file that changes billing amount, tax, rounding, customer grouping, or Firestore behavior

### UI-only PR requirements

A Claude UI-only PR must state:

- changed files
- visual summary
- no business logic changed
- no Firestore read/write changed
- no billing calculation changed
- no settings schema changed
- no customerId/staffId identity behavior changed
- no package/rules/index/firebase.json changed

Validation:

- `git diff --check`
- `npx tsc --noEmit --pretty false`
- changed files eslint
- `npm run build`
- `npm run lint` may fail only on known baseline errors

### Codex review policy for Claude UI PR

Codex should check:

1. changed files are inside allowed UI boundaries
2. no forbidden files changed
3. props contract is preserved
4. TypeScript/build pass
5. print CSS does not leak globally or hide unrelated app
6. no raw internal code appears in UI
7. no Firestore query/write was added
8. no billing/tax/customer identity logic was changed

Codex should not rework visual preference, exact spacing, color choice, or aesthetic direction unless it breaks usability, printing, accessibility, or business meaning.

### Billing-specific rule

For billing UI/design work, Claude may edit invoice presentation components and print CSS, but must render `candidate.lineItems`, `candidate.total`, `candidate.tax`, and `settings` as provided. Claude must not recalculate totals, change `InvoiceCandidate`, change tax/rounding, change customerId grouping, or change settings schema. Any change to invoice amount, return-tag billing, T番号 logic, or settings schema belongs to Codex.

## コード規約

- コンポーネント: PascalCase (`AdminAuthGuard`)
- 関数・変数: camelCase (`handleGoogleLogin`)
- 定数: UPPER_SNAKE_CASE (`ALL_NAV_ITEMS`)
- インデント: 2スペース
- コメント: 日本語
- 全ページに `"use client"` 必須（静的エクスポート構成）
- パスエイリアス: `@/*` → `./src/*`

## コマンド

```bash
npm run dev          # 開発サーバー (localhost:3000)
npm run build        # ビルド（静的エクスポート → out/）
npx tsc --noEmit     # 型チェック
firebase deploy --only hosting  # Firebase Hosting のみデプロイ
```

`firebase.json` は `firestore.rules` に接続済み。現在の本番Rulesは2026-06-02のcommit
`b7e853c8f38071937951b871cbe0e3281dd22876`と同じ本文を、2026-07-18のReset前abortで
再deployしたreleaseとしてread-only確認済み。
ただし、それ以後の状態遷移Rules差分は未deployである。通常作業ではRulesをdeployせず、
Rules-onlyの専用レビュー・operationでだけ明示project/configを指定して実行する。
HostingとRulesを同じdeploy commandへ混ぜない。cutoverでは
`docs/cutover/transition-plan-v1-runbook.md`を正本とし、production reset / restore gateを
運用安全PRだけで開放しない。freeze中止・rollbackにはpinned baseline config、reset完了後の
通常復帰にはpost-cutover normal configを使い分ける。

Firestore composite index は Firebase Console で手動管理しているものがある。2026-04-29 時点で `logs` の `logStatus` Asc / `location` Asc / `timestamp` Desc / `__name__` Desc index は作成済み。これは `getActiveLogs()` の portal 履歴表示用であり、Rules deploy ではない。

## Firestore コレクション

### コア

| コレクション | キー | 主要フィールド |
|---|---|---|
| staff | {docId} | id, name, email, isActive, role, rank, passcode |
| staffByEmail | {emailKey} | staffId, email, role, isActive |
| customers | {docId} | name, companyName, email, price*, isActive |
| customerUsers | {uid} | uid, email, selfCompanyName, selfName, lineName, customerId, customerName, setupCompleted, disabled |
| tanks | {tankId} | status, location, staff, latestLogId, nextMaintenanceDate |
| logs | {docId} | timestamp, action, tankId, staff, location, customerId, logStatus, rootLogId, revision |
| transactions | {docId} | type(order/return/uncharged_report), status, items, customerId, customerName, createdByUid |
| destinations | {docId or uid} | 廃止済み。コード参照・書き込み・管理UIは削除済み |

### マスター・設定

| コレクション | キー | 用途 |
|---|---|---|
| orderMaster | {docId} | 発注品目定義 |
| orders | {docId} | 資材発注データ |
| priceMaster | {docId} | 操作単価設定 |
| rankMaster | {docId} | ランク条件 |
| settings | adminPermissions | ページ権限 pages: {path: [roles]} |
| settings | portal | ポータル設定 autoReturnHour/Minute |
| notifySettings | {docId} | メール・LINE通知設定 |
| lineConfigs | {docId} | LINE連携設定 |
| monthly_stats | {docId} | 月次売上アーカイブ |
| delete_history | {docId} | 削除監査ログ |
| edit_history | {docId} | 編集監査ログ |

## 認証フロー

```
顧客ポータル:
  /portal/login → Firebase Auth（Email/Password または Google）
    ├─ customerUsers.setupCompleted=true → /portal
    └─ setup未完了 → /portal/setup → /portal
  正本: Firebase Auth uid + customerUsers/{uid}
  画面互換セッション: localStorage (customerSession)
  ※ 旧 customers.passcode 経路は Portal Auth Phase 0 で廃止済み。

スタッフ:
  StaffAuthGuard → Firebase Auth（Google または Email/Password）
  セッション: Firebase Auth + localStorage (staffSession) + Firestore staff検証
  ※ パスコード実装は NEXT_PUBLIC_ENABLE_STAFF_PASSCODE_LOGIN=true の場合だけ表示される。
     ただし未認証利用者は Firestore Rules により staff を read できず、
     単独の未認証ログイン経路としては成立しない。

管理者:
  AdminAuthGuard → Google/メール → Firebase Auth
  → Firestore staff lookup → settings/adminPermissions で権限チェック
```

## ユーザーロール

- `admin` — 管理者（全機能アクセス可）
- `準管理者` — 一部管理ページへのアクセス（adminPermissions で制御）
- `worker` — スタッフ（操作画面のみ）
- `customer` — 顧客（ポータルのみ）

## Project direction

長期目的は、コード構造化、Firestore保持データの簡素化、状態遷移の一貫化、返却フローの安定化によって、バグが入りにくく影響範囲を追いやすいタンク管理システムにすること。

**architecture の設計原則は本文書では規定しない。** 次を正本として読む。

- [docs/architecture/README.md](docs/architecture/README.md) — 入口
- [docs/architecture/design-principles.md](docs/architecture/design-principles.md) — 設計原則の正本
- [docs/architecture/domain-map.md](docs/architecture/domain-map.md) — domain境界と source of truth
- [docs/architecture/document-authority.md](docs/architecture/document-authority.md) — 正本順位
- [docs/architecture/adr/](docs/architecture/adr/) — 確定した設計判断

本文書（AGENTS.md / CLAUDE.md）は **workflow / safety authority** であり、「誰がどの手順で作業してよいか」を規定する。
architecture 文書は **architecture normative authority** であり、「何をどう設計するか」を規定する。両者は競合しない。同一事項で矛盾した場合は本文書を優先し、その矛盾を document-authority §4 へ記録する。

## 現在のアーキテクチャ状態

Phase 2-B の read migration は完了済み。

`tanks` / `logs` / `transactions` の主要な読み取り処理は repository 経由に移行済み。今後、明示指示なしに Phase 2-B の続きを始めない。

実装済み repository 関数の例:

- `tanksRepository`
  - `getTank`
  - `getTanks`
- `logsRepository`
  - `getActiveLogs`
  - `getLogsByRoot`
- `transactionsRepository`
  - `getOrders`
  - `getReturns`
  - `getPendingTransactions`
  - `findPendingLinksByUid`

repository 化が完了しているのは主に読み取り処理。書き込み系は全面的には repository 経由ではないが、これは未完了ではなく意図的なフェーズ分け。

## Firestore 直接アクセスの扱い

以下の Firestore 直接アクセスは現時点で許容する。

- `src/lib/firebase/repositories/*` 内部
- `src/lib/tank-operation.ts`
- `src/lib/tank-trace.ts`
- `src/features/procurement/lib/submitTankEntryBatch.ts` などの業務バッチ
- 既存の書き込み系処理
- Phase 2-B の対象外コレクション
  - `customers`
  - `customerUsers`
  - `staff`
  - `staffByEmail`
  - `settings`
  - `orderMaster`
  - `priceMaster`
  - `rankMaster`
  - `monthly_stats`
  - `notifySettings`
  - `lineConfigs`
  - その他、Phase 2-B の対象外と明記されたマスタ・設定コレクション

Firestore 直接アクセスが残っているという理由だけで、勝手に repository 化しない。書き込み系 repository 化は別フェーズ。

`destinations` コレクションは廃止済み。新規の直接アクセス・repository・UIを追加しない。Firestore 上の既存データ削除はコード変更とは別作業として扱う。

`src/lib/firebase/customer-user.ts` は Portal Auth Phase 0 の本番実装。`status` は Firestore に保存せず、`computeCustomerUserStatus` で派生する。`portal/setup` から `customerId` / `customerName` / `disabled` を保存しない。

## Repository 化の現状

現在完了しているのは、主に読み取り処理の repository 化。

書き込み系には業務整合性が関わるため、勝手に移行しない。

- `tanks.status` の変更
- `logs` の作成
- `logs` の revision / void
- `transactions` の承認・完了
- `applyTankOperation`
- `applyBulkTankOperations`
- `submitTankEntryBatch`
- `staff` / `staffByEmail` の同期更新
- `customerUsers` と pending transactions の紐付け

書き込み処理を変更する場合は、repository だけでなく service / operation の責務分担も含めて設計する。

## 現在の優先順位

現在の優先順位は repository 化の継続ではない。architecture 設計は確定済み。実装順序は [docs/architecture/clean-break-cutover-plan.md](docs/architecture/clean-break-cutover-plan.md) に従う（**実装は未着手**）。

直近の優先順位:

1. Direction docs の固定（今回の docs-only 作業）
2. `[TAG:*]` と `condition` の変換を純粋関数に集約する
3. 返却申請と返却確定の境界を崩さず、返却フローを安定化する
4. actor / customer / action / status の identity context を安定させる
5. 日本語文字列判定を増やさず、action code / status code 化へ段階的に寄せる
6. `customers` / `customerId` 整理、請求・売上・報酬計算の設計へ進む

`tanks.customerId` は**現在貸出の projection として実装済み**（`src/lib/tank-types.ts`）。顧客 identity の正本ではない（正本は `customers` / `logs`）。

`tanks.location` は **clean-break で廃止予定**（custody model へ置換）。詳細は [ADR-002](docs/architecture/adr/ADR-002-custody-model.md)。

## customers / customerId の方針

顧客・貸出先まわりの作業では、以下の方針を守る。

- `customers` を将来的な貸出先・請求単位の正本として扱う
- `destinations` は廃止済み。旧互換としても使わない
- 旧 `customer-destination.ts` ヘルパーは削除済み
- `admin/settings` の destinations タブは削除済み
- Firestore 上の `destinations` データ削除はコード変更とは別作業として扱う
- `logs.location` は履歴表示用の当時名として残す
- `tanks.location` は現在場所表示用の文字列として残す
- `customerId` は将来的な正規参照として使う
- 既存 `logs` を一括で書き換えない
- 顧客名変更時に過去ログを書き換えない
- 新規データでは `customerId` + `location` の併用を検討する
- `tanks.customerId` は projection として実装済み。顧客identityの正本にはしない（[ADR-002](docs/architecture/adr/ADR-002-custody-model.md)）

## 管理画面接続の方針

管理画面から変更する対象は、以下に限定する。

- 運用値
- マスタ
- 権限
- 表示・通知設定

管理画面化しないもの:

- `tank-rules.ts` の `STATUS` / `ACTION` / `OP_RULES`
- `tank-operation.ts` の状態遷移ルール
- `logs` の書き込み API
- revision / void の業務不変条件
- Security Rules

単純なマスタ更新は repository 経由でよい場合がある。ただし、複数コレクション更新・権限・履歴・同期を伴うものは service / operation を通す。

重要な管理変更には、将来的に `edit_history` を付ける。ただし、現時点では `edit_history` の本格実装は行わない。新しい管理更新処理を作る場合は、後から履歴記録を差し込めるように、Firestore への保存処理を画面イベント内に散らさず、関数単位にまとめる。

service / operation を通すべき例:

- `staff` と `staffByEmail` の同期更新
- `staff.role` の変更
- `customerUsers` と pending transactions の紐付け
- `customers` の名称・単価・有効無効変更
- ログ修正可能時間の設定化
- タンク登録 / 購入
- `transactions` の完了処理

## deploy / commit 分離ルール

- 通常 deploy は `firebase deploy --only hosting` のみ。
- `firebase.json` は`firestore.rules`へ接続済み。現在の本番Rulesは2026-06-02のcommit
  `b7e853c8f38071937951b871cbe0e3281dd22876`と同じ本文を、2026-07-18のReset前abortで
  再deployしたreleaseとしてread-only確認済み。
- 現行Rules差分のdeployは通常deployに含めず、Rules-onlyの専用レビュー・operationへ分離する。
- freeze/normal Rulesは専用configと明示projectを使い、Hostingと混ぜない。
- UI-only commit と Firestore 書き込み / Firebase Auth / schema 変更 commit は分ける。
- docs-only commit は実装 commit と分ける。
- icon / PWA画像更新は UI やロジック変更と分ける。
- `.codex-logs/` は commit しない。
- UI-only に含めてよいもの: 表示調整、タブUI、スワイプ表示、アイコン/PWA画像、レイアウト整理。
- UI-only に含めてはいけないもの: `addDoc`, `setDoc`, `updateDoc`, `writeBatch`, `runTransaction`, `deleteDoc`, Firebase Auth 関連、`transactions` / `tanks` / `logs` / `tankProcurements` / `customerUsers` の schema 変更、`firestore.rules`, `firebase.json`。
- commit 前に `git status --short` と対象差分の禁止ワード混入を確認する。

## Codex 作業ルール

Codex が作業する場合は、以下を守る。

- 1回の作業範囲を小さくする
- 既存挙動を変えない
- 関係ないファイルを触らない
- UI変更を混ぜない
- repository 化を目的化しない
- 書き込み系を勝手に移行しない
- `tank-operation.ts` は明示指示なしに触らない
- `tank-trace.ts` は明示指示なしに触らない
- Security Rules は明示指示なしに触らない
- Cloud Functions 化は明示指示なしに行わない
- 大規模リファクタリングを一度に行わない

コード変更をした場合は、必ず以下を報告する。

- 変更ファイル
- 変更内容
- 既存挙動をどう維持したか
- 触っていない範囲
- `tsc` 結果

コード変更後は原則として以下を実行する。

```bash
npx tsc --noEmit --pretty false
```

必要に応じて `npm run build` も実行する。

## 次に進めるべき作業

architecture 設計は確定済み（PR #183）。次は [clean-break-cutover-plan.md](docs/architecture/clean-break-cutover-plan.md) の Phase 0 から。

- P0-B: architecture enforcement（ESLint `no-restricted-imports`）
- P0-C: dev / production Firebase 分離
- P0-D: supersede 注記の付与
- P1-A〜D: 依存是正（domain の `window`/locale 排除、表示文言の移動、role code 化、`inspection.allowedPrev` 制限）

**実装は明示指示があるまで行わない。** Firestore reset / Rules cutover / deploy はいずれも未実施。

完了済み（再着手不要）:

- 返却タグ・`condition` 変換の純粋関数化
- 業務別 workflow service の分離（PR-01〜12）
- action / status の code 化（日本語文字列判定 0件）
- staff 画面の ja/en 対応（PR #176〜#182）
