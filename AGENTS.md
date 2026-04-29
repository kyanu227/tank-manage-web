# タンク管理 Web

ダイビングタンクのレンタル管理システム（Web版）。
現行Web版を正として保守・改善するプロジェクト。

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
│   ├── layout.tsx              # ルートレイアウト
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
│   │   ├── order/              # → /staff/supply-order 互換リダイレクト
│   │   ├── supply-order/       # 備品・資材発注
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
│   └── QuickSelect.tsx         # タッチ対応クイック選択
└── lib/
    └── firebase/
        ├── config.ts           # Firebase初期化
        ├── repositories/       # tanks/logs/transactions の読み取りrepository
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

`firestore.rules` は下書き扱いで未deploy。`firebase.json` に firestore rules を接続しない。`firebase deploy --only firestore:rules` は明示指示があっても、Rules 本番化タスクとして別途レビューするまで実行しない。

## Firestore コレクション

### コア

| コレクション | キー | 主要フィールド |
|---|---|---|
| staff | {docId} | id, name, email, isActive, role, rank, passcode |
| staffByEmail | {emailKey} | staffId, email, role, isActive |
| customers | {docId} | name, companyName, email, price*, isActive |
| customerUsers | {uid} | uid, email, selfCompanyName, customerId, customerName, status, setupCompleted |
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
  /portal/login → 既存ログイン方式
    ├─ 既存顧客（admin作成済み）→ /portal
    └─ 新規 → /portal/register → /portal/setup → /portal
  セッション: localStorage (customerSession)
  ※ Firebase Auth + customerUsers 正本化は未commit WIP / 未deploy。現行mainの本番仕様として扱わない。

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

`src/lib/firebase/customer-user.ts` は portal Auth / customerUsers 移行用の未commit WIP が存在する場合があるが、現行mainの本番実装ではない。明示指示なしに stage / commit しない。

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

現在の優先順位は repository 化の継続ではない。

優先順位:

1. `customers` / `customerId` 整理（`destinations` は廃止済み）
2. 管理画面接続 P0
3. `edit_history` / `delete_history` の共通記録フォーマット
4. `staff` / `staffByEmail` 更新の service 境界
5. `settings/adminPermissions` と `settings/inspection` の変更履歴
6. `customers` 正本化の管理画面反映
7. 貸出先別単価の正本整理
8. 報酬計算・ランク計算・請求計算の設計
9. `monthly_stats` / `admin/sales` 改善
10. 書き込み系 repository 化
11. `tank-trace.ts` の内部 repository 化
12. Cloud Functions 化
13. 軽量多言語化

## customers / customerId の方針

顧客・貸出先まわりの作業では、以下の方針を守る。

- `customers` を将来的な貸出先・請求単位の正本として扱う
- `destinations` は廃止済み。旧互換としても使わない
- `src/lib/firebase/customer-destination.ts` は削除済み
- `admin/settings` の destinations タブは削除済み
- Firestore 上の `destinations` データ削除はコード変更とは別作業として扱う
- `logs.location` は履歴表示用の当時名として残す
- `tanks.location` は現在場所表示用の文字列として残す
- `customerId` は将来的な正規参照として使う
- 既存 `logs` を一括で書き換えない
- 顧客名変更時に過去ログを書き換えない
- 新規データでは `customerId` + `location` の併用を検討する
- `tanks.customerId` の追加は未決事項として扱い、勝手に実装しない

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
- `firestore.rules` は下書き扱い。未deployであり、`firebase.json` に接続しない。
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

AGENTS.md 更新後、次に進める候補:

- `docs/customer-data-model-redesign.md` の実装ステップ分解
- `customersRepository` の最小設計
- `edit_history` / `delete_history` 共通フォーマットの設計
- `staff` / `staffByEmail` 更新 service の設計

ただし、これらの実装は明示指示があるまで行わない。
