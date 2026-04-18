# タンク管理 Web

ダイビングタンクのレンタル管理システム（Web版）。
旧GASシステムからの移行・刷新プロジェクト。

## 技術スタック

| 技術 | バージョン | 用途 |
|------|-----------|------|
| Next.js | 16.1.6 | フレームワーク（App Router, 静的エクスポート） |
| React | 19.2.3 | UIライブラリ |
| TypeScript | 5 | 型安全 |
| Firebase Auth | 12.10.0 | 認証（Google, Email/Password, パスコード） |
| Firestore | 12.10.0 | データベース |
| Firebase Hosting | — | デプロイ先（静的サイト） |
| Tailwind CSS | 4 | スタイリング |
| lucide-react | 0.577.0 | アイコン |

## ディレクトリ構造

```
src/
├── app/
│   ├── layout.tsx              # ルートレイアウト（AuthProvider）
│   ├── page.tsx                # → /portal リダイレクト
│   ├── globals.css             # CSS変数・プリセットクラス
│   ├── admin/                  # 管理画面（AdminAuthGuard）
│   │   ├── layout.tsx          # 管理レイアウト・ナビ
│   │   ├── page.tsx            # ダッシュボード
│   │   ├── settings/           # マスターデータ管理
│   │   ├── permissions/        # ページ権限制御
│   │   ├── customers/          # 顧客管理・PIN管理
│   │   ├── notifications/      # 通知設定（メール・LINE）
│   │   ├── staff-analytics/    # スタッフ実績ランキング
│   │   ├── money/              # 操作単価・ランク条件
│   │   ├── billing/            # 請求書発行
│   │   └── sales/              # 売上統計
│   ├── staff/                  # スタッフ操作画面（StaffAuthGuard）
│   │   ├── layout.tsx          # スタッフレイアウト・ナビ
│   │   ├── page.tsx            # メイン操作（貸出/返却/充填）
│   │   ├── orders/             # 受注管理・返却承認・一括返却（3タブ）
│   │   ├── returns/            # 現場返却（※ordersに統合済み、残存）
│   │   ├── damage/             # 破損報告
│   │   ├── maintenance/        # メンテナンス（修理・耐圧）
│   │   ├── order/              # 資材発注
│   │   ├── mypage/             # マイページ
│   │   ├── inhouse/            # 自社タンク管理
│   │   ├── bulk-return/        # 一括返却（※ordersに統合済み、残存）
│   │   └── dashboard/          # ステータス集計・ログ管理
│   └── portal/                 # 顧客ポータル（localStorageセッション）
│       ├── layout.tsx          # ポータルレイアウト・セッション管理
│       ├── page.tsx            # ホーム（貸出状況・ログ）
│       ├── login/              # ログイン（パスコード/Google/メール）
│       ├── register/           # 新規登録
│       ├── setup/              # 初期設定（会社名・パスコード表示）
│       ├── order/              # タンク発注
│       ├── return/             # 返却申請（自動返却対応）
│       └── unfilled/           # 未充填報告
├── components/
│   ├── AdminAuthGuard.tsx      # 管理者認証・権限ガード
│   ├── StaffAuthGuard.tsx      # スタッフ認証ガード
│   ├── AuthPanel.tsx           # 認証画面共通パネル
│   ├── QuickSelect.tsx         # タッチ対応クイック選択
│   └── layout/
│       └── AppHeader.tsx       # 共通ヘッダー [スケルトン]
└── lib/
    ├── contexts/
    │   └── AuthContext.tsx      # Firebase認証コンテキスト
    └── firebase/
        ├── config.ts           # Firebase初期化
        └── customer-destination.ts  # 顧客・貸出先同期ヘルパー
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
       ├── @migration (opus)  旧GAS → web移植
       └── (秘書が必要に応じて新エージェント作成)
```

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
| users | {uid} | role, name |
| staff | {docId} | id, name, email, isActive, role, rank, passcode |
| customers | {docId} | uid, email, companyName, passcode, setupCompleted |
| tanks | {docId} | status, location, staffId |
| logs | {docId} | timestamp, action, tankId, staffId, location |
| transactions | {docId} | type(order/return/uncharged_report), status, items |
| destinations | {uid} | name, companyName, email, passcode, price*, isActive |

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
  /portal/login → パスコード or Google/メール
    ├─ 既存顧客（admin作成済み）→ /portal
    └─ 新規 → /portal/register → /portal/setup → /portal
  セッション: localStorage (customerSession)

スタッフ:
  StaffAuthGuard → パスコード or Google/メール
  セッション: localStorage (staffSession) + Firestore staff検証

管理者:
  AdminAuthGuard → Google/メール → Firebase Auth
  → Firestore staff lookup → settings/adminPermissions で権限チェック
```

## ユーザーロール

- `admin` — 管理者（全機能アクセス可）
- `準管理者` — 一部管理ページへのアクセス（adminPermissions で制御）
- `worker` — スタッフ（パスコード認証、操作画面のみ）
- `customer` — 顧客（ポータルのみ）

## 旧システム参照

旧GASシステムのコードは移植・参考用として読み取り専用で利用可能:

- `../タンク管理_Operate/` — スタッフ操作画面（**主要参照元**）
- `../タンク管理_Admin/` — 管理画面（構想段階、参考程度）
- `../ARCHITECTURE.md` — 旧システム設計書（タンク状態遷移、OP_RULES等）
