# タンク管理 Web

ダイビングタンクのレンタル管理システム（Web版）。
旧GASシステムからの移行・刷新プロジェクト。

> **📍 画面がどのファイルから来てるか迷ったら [SITEMAP.md](./SITEMAP.md)**。
> **📐 設計判断（なぜこう作るか）は [docs/architecture/README.md](./docs/architecture/README.md)**。
> architecture の正本は `docs/architecture/`。CLAUDE.md は作業手順・担当境界・禁止事項を規定する（両者は競合しない）。

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
│   ├── admin-customers/        # 顧客・ポータル利用者管理
│   └── */i18n.ts               # display boundary（ja/en辞書）
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
        ├── staff-auth.ts       # staff / staffByEmail 読み取り + mirror 同期・staffByUid write ヘルパー
        ├── diff-write.ts       # 差分更新ヘルパー
        └── （src/lib 直下）
            staff-operation-error.ts        # domain error code + catalog
            staff-display.ts                # display boundary
            tank-recovery-confirmation-message.ts
            locale.ts
```

## AI組織構造（秘書ハブ型）

全てのタスクは `@secretary`（さな）に依頼する。さなが設計・振り分け・品質管理を行い、実装は原則 Codex に委譲する。

```
ユーザー
  │
  ▼
┌─────────────┐
│ さな(秘書)  │  設計・判断・振り分け・品質管理・改善提案
│   (opus)    │  軽微タスクは直接対応
└──────┬──────┘
       │
       ├── Codex (既定: gpt-5.6-sol / effort max)  実装の主担当
       │    └─ 指定なしなら常に gpt-5.6-sol + max で発注
       │
       └── 救援スペシャリスト（Codexで詰まった時のみ）
            ├── @frontend (opus)   UI/UX
            ├── @backend  (opus)   Firebase/Auth/Firestore
            └── @migration (opus)  旧GAS → web移植
```

### Codex 発注時のルール
- モデル既定: `gpt-5.6-sol`、effort 既定: `max`（超大型で並列委譲が効きそうな時のみ `ultra`）
- 発注前に、さなが要件・影響範囲・ファイル位置を整理して自己完結のプロンプトにする
- Codexの成果物はさなが動作確認・型チェック・デプロイまで責任を持つ

### Codex 発注の実行経路
- **大規模タスク（新規ファイル多数・1000行以上の改修など）**:
  `codex-companion.mjs task --background --write` で独立プロセスとして起動する
  - Agent ツール経由だとサブプロセスが途中で止まる挙動を確認済み。独立プロセスなら親のターンが終わっても生存
  - 追跡: `codex-companion.mjs status <job-id>` / 完了後 `result <job-id>` / 必要なら `cancel <job-id>`
- **進捗・判断の正本（2026-07-29 改訂）**:
  - GitHub PR 本文
  - merge 済み design note
  - `docs/architecture/clean-break-cutover-plan.md`（実装順序の正本。refactor-sequence は historical）
- **`progress.md`**: 長期 phase や cutover の集約記録に使う。
  **PR ごとの毎回追記は必須にしない**
  - 改訂前は「論理単位ごとに `progress.md` へ追記」を全発注で必須としていたが、
    PR-01〜12 では一度も運用されず、`docs/architecture/refactor-sequence.md` §7 とも
    矛盾していたため、実運用に合わせて正本を PR 本文側へ移した
  - 長時間の background 発注で途中経過を残したい場合は、Codex への指示として
    個別に追加してよい（既定では要求しない）
- **小規模タスク（〜200行・1〜2ファイル）**: Agent 経由で可
- **分割発注は原則しない**: 型や定数が絡む連鎖リファクタは途中状態で tsc/build が壊れるため、1本発注が原則
  - 例外: 独立機能が複数ある場合のみ、機能境界で分ける

## Claude / Codex shared workflow

Claude と Codex が並行作業する場合は、作業境界を先に固定する。Claude は UI/design の見た目と表示構造を担当し、Codex は domain logic、data model、Firestore integration、billing calculation、validation、deploy を担当する。

Claude UI PR は、全業務ロジックを毎回再監査しなくてもよいように、changed-file boundary と props contract でレビュー可能な差分にする。

### Codex owns

Codex が担当するもの:

- Firestore read/write
- repositories / services
- tank operation
- transaction update
- customerId / staffId identity
- billing calculation
- billing settings schema
- invoice candidate generation
- tax / rounding logic
- status/action code semantics
- Firestore Rules / indexes
- package / firebase.json
- validation / build / deploy
- smoke test

### Claude owns

Claude が担当してよいもの:

- visual layout
- presentational components
- CSS
- print CSS
- spacing / typography
- invoice visual design
- button placement
- responsive layout
- wording presentation
- visual hierarchy

### Claude UI-only allowed files

Claude may edit:

- `src/features/**/components/**/*.tsx`
- `src/features/**/styles/**/*.css`
- component-local presentational code
- CSS inside presentational components
- docs only when documenting UI behavior

Claude may edit with caution:

- `src/app/**/page.tsx`
  - only if the page is already a thin wrapper and no Firestore/query/calculation/stateful business logic is changed

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
- no package/rules/firebase.json changed

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
9. changes respect `docs/architecture/design-principles.md`

Codex should not rework visual preference, exact spacing, color choice, or aesthetic direction unless it breaks usability, printing, accessibility, or business meaning.

### Billing-specific rule

For billing UI/design work:

- Claude may edit invoice presentation components and print CSS.
- Claude must not recalculate totals.
- Claude must not change `InvoiceCandidate`.
- Claude must not change tax/rounding.
- Claude must not change customerId grouping.
- Claude must render `candidate.lineItems`, `candidate.total`, `candidate.tax`, and `settings` as provided.
- Any change to invoice amount, return-tag billing, T番号 logic, or settings schema belongs to Codex.

## ディレクトリ階層の方針

正本は [docs/architecture/domain-map.md](./docs/architecture/domain-map.md)。要点のみ:

- `src/components/` は汎用部品のみ
- 業務フロー単位の塊は `src/features/<feature-name>/` に閉じる
- `src/app/**/page.tsx` は `features/` を呼び出す薄い殻に留める
- **feature間の直接importは禁止**（composition層でのみ束ねる）
- `src/domains/` への移行は**行わない**（責務を変えないファイル移動は禁止）

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
firebase deploy      # Firebase Hosting デプロイ
```

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

`destinations` コレクションは廃止済みで、同コレクションへのコード参照はなく、
Firestore Rules も read / write を拒否する。

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

## ログ設計（追記型）

- ログ本文（tankId/action/status/location/staff/note 等）は直接上書きしない。編集時は旧ログを `superseded` にし、新 revision を作成する
- 編集は transaction で `active → superseded` + 新 revision 作成 + `tanks` 更新を原子的に行う
- 編集取消は古い内容をコピーした新 revision を作る（分岐を作らない一直線チェーン）
- ログ状態は `logStatus` に統一：`active` / `superseded` / `voided` のみ（旧 `voided: boolean` は廃止）
- 新規ログ作成は `appendTankOperation()` / `applyTankOperation()` 経由、編集・取消は `applyLogCorrection()` 経由（すべて `src/lib/tank-operation.ts`）
- 編集可は対象 tankId の最新 active ログのみ。途中ログは自動編集不可
- `editReason` は編集・取消時に必須
- 詳細フィールドは実装時に `tank-operation.ts` のコメントに記載（重複記述を避ける）

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

## 旧システム参照

旧GASシステムのコードは移植・参考用として読み取り専用で利用可能:

- `../タンク管理_Operate/` — スタッフ操作画面（**主要参照元**）
- `../タンク管理_Admin/` — 管理画面（構想段階、参考程度）
- `../ARCHITECTURE.md` — 旧システム設計書（タンク状態遷移、OP_RULES等）
