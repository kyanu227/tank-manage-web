# サイト構造マップ

このドキュメントは「どの画面が、どのファイルから作られているか」を把握するための地図です。
新規参加者（人間・AI 双方）が最初に読む想定。CLAUDE.md と併読してください。

---

## 1. 全体の3ゾーン

```
                       / (ルート)
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
          /portal     /staff      /admin
         （顧客）    （スタッフ）  （管理者）
```

- ルート [`/`](src/app/page.tsx) は `/portal` に自動リダイレクト。
- 各ゾーンは **別の認証ガード** で守られる（第7節）。
- 共通レイアウト: [`src/app/layout.tsx`](src/app/layout.tsx) は body クラスと共通ラッパーを被せる薄い殻。認証は各ゾーンのガードで完結する。

---

## 2. ゾーン別レイアウト（外枠）

| ゾーン | レイアウト | ガード | ナビ定義場所 |
|---|---|---|---|
| 顧客ポータル | [`src/app/portal/layout.tsx`](src/app/portal/layout.tsx) | localStorage `customerSession` | 同ファイル内 |
| スタッフ | [`src/app/staff/layout.tsx`](src/app/staff/layout.tsx) | [`StaffAuthGuard`](src/components/StaffAuthGuard.tsx) | 同ファイル `SIDE_NAV` |
| 管理者 | [`src/app/admin/layout.tsx`](src/app/admin/layout.tsx) | [`AdminAuthGuard`](src/components/AdminAuthGuard.tsx) | 同ファイル `ALL_NAV_ITEMS` |

---

## 3. ポータル（顧客）画面マップ

```
/portal/login ──┬─ 新規 → /portal/register → /portal/setup ──┐
                │                                              ▼
                └─ 既存 ──────────────────────────────────→ /portal (Home)
                                                              │
                              ┌───────────┬──────────────┬────┴────┐
                              ▼           ▼              ▼         ▼
                        /portal/order  /portal/return /portal/unfilled (他)
                         （発注）      （返却申請）   （未充填報告）
```

| 画面 | URL | ファイル |
|---|---|---|
| ログイン | `/portal/login` | [`src/app/portal/login/page.tsx`](src/app/portal/login/page.tsx) |
| 新規登録 | `/portal/register` | [`src/app/portal/register/page.tsx`](src/app/portal/register/page.tsx) |
| 初期設定 | `/portal/setup` | [`src/app/portal/setup/page.tsx`](src/app/portal/setup/page.tsx) |
| ホーム | `/portal` | [`src/app/portal/page.tsx`](src/app/portal/page.tsx) |
| 発注 | `/portal/order` | [`src/app/portal/order/page.tsx`](src/app/portal/order/page.tsx) |
| 返却申請 | `/portal/return` | [`src/app/portal/return/page.tsx`](src/app/portal/return/page.tsx) |
| 未充填報告 | `/portal/unfilled` | [`src/app/portal/unfilled/page.tsx`](src/app/portal/unfilled/page.tsx) |

認証は Firebase Auth ではなく **localStorage の `customerSession`** ベース（ガード不要、レイアウトが直接判定）。

---

## 4. スタッフ画面マップ

### 4-1. ナビ構造

サイドメニュー（`src/app/staff/layout.tsx` の `SIDE_NAV`）:

| ラベル | href | 実体 |
|---|---|---|
| 操作 (貸出/返却/充填) | `/staff/lend` | 貸出/返却/充填は同じ OperationsTerminal |
| 自社管理 | `/staff/inhouse` | TankIdInput を使った単発操作 |
| メンテナンス | `/staff/damage` | `damage / repair / inspection` の3タブ |
| ダッシュボード | `/staff/dashboard` | 集計・ログ |
| 資材発注 | `/staff/order` | 資材の発注 |
| マイページ | `/staff/mypage` | スタッフ自身の情報 |

### 4-2. 操作ゾーン（最重要）

貸出・返却・充填の3画面は **同一の業務コンポーネントを URL だけ変えて再利用** しています。

```
/staff/lend    ─┐
/staff/return  ─┼─ all mount → OperationsTerminal (initialMode 違い)
/staff/fill    ─┘
```

| 画面 | URL | page.tsx | 共通ロジック |
|---|---|---|---|
| 貸出 | `/staff/lend` | [`src/app/staff/lend/page.tsx`](src/app/staff/lend/page.tsx) | → `OperationsTerminal initialMode="lend"` |
| 返却 | `/staff/return` | [`src/app/staff/return/page.tsx`](src/app/staff/return/page.tsx) | → `OperationsTerminal initialMode="return"` |
| 充填 | `/staff/fill` | [`src/app/staff/fill/page.tsx`](src/app/staff/fill/page.tsx) | → `OperationsTerminal initialMode="fill"` |

`OperationsTerminal` の実体: [`src/features/staff-operations/OperationsTerminal.tsx`](src/features/staff-operations/OperationsTerminal.tsx)
（`src/app/staff/{lend,return,fill}/page.tsx` は全て薄い殻で、3行しかない）

#### OperationsTerminal が出す画面の分岐

```
OperationsTerminal
├── mode=lend + opStyle=manual   → <ManualOperationPanel>     （手動貸出）
├── mode=lend + opStyle=order    → <OrderListPanel>            （受注一覧）
│                                     ↓ クリック
│                                  <OrderFulfillmentScreen>    （受注詳細）
├── mode=return (一覧)            → <ReturnRequestList>        （返却リクエスト一覧）
│                                  + <BulkReturnByLocationPanel> （拠点別一括返却）
│                                     ↓ 「手動返却」ボタン
│                                  <ManualOperationPanel>      （手動返却モード）
│                                     ↓ リクエストをタップ
│                                  <ReturnApprovalScreen>       （返却承認画面）
└── mode=fill                     → <ManualOperationPanel>     （充填）
```

`opStyle`（手動/受注）はヘッダーの切替UIから `opStyleChange` という CustomEvent で伝達される。
レイアウト → OperationsTerminal への一方向通知。

#### OperationsTerminal を構成するファイル（`src/features/staff-operations/`）

| 種別 | パス | 役割 |
|---|---|---|
| オーケストレータ | [`OperationsTerminal.tsx`](src/features/staff-operations/OperationsTerminal.tsx) | 画面分岐・フック配線 |
| 型定義 | [`types.ts`](src/features/staff-operations/types.ts) | OpMode, QueueItem 等 |
| 定数 | [`constants.ts`](src/features/staff-operations/constants.ts) | MODE_CONFIG, BULK_TAGS 等 |
| コンポーネント | [`components/OperationModeTabs.tsx`](src/features/staff-operations/components/OperationModeTabs.tsx) | 貸出/返却/充填タブ |
| 〃 | [`components/ManualOperationPanel.tsx`](src/features/staff-operations/components/ManualOperationPanel.tsx) | 手動操作（ドラム+キュー+送信） |
| 〃 | [`components/OrderListPanel.tsx`](src/features/staff-operations/components/OrderListPanel.tsx) | 受注一覧 |
| 〃 | [`components/OrderFulfillmentScreen.tsx`](src/features/staff-operations/components/OrderFulfillmentScreen.tsx) | 受注詳細・スキャン |
| 〃 | [`components/ReturnRequestList.tsx`](src/features/staff-operations/components/ReturnRequestList.tsx) | 返却リクエスト一覧 |
| 〃 | [`components/ReturnApprovalScreen.tsx`](src/features/staff-operations/components/ReturnApprovalScreen.tsx) | 返却承認画面 |
| 〃 | [`components/BulkReturnByLocationPanel.tsx`](src/features/staff-operations/components/BulkReturnByLocationPanel.tsx) | 拠点別一括返却 |
| フック | [`hooks/useManualTankOperation.ts`](src/features/staff-operations/hooks/useManualTankOperation.ts) | 手動操作のキュー+送信 |
| 〃 | [`hooks/useOrderFulfillment.ts`](src/features/staff-operations/hooks/useOrderFulfillment.ts) | 受注処理 |
| 〃 | [`hooks/useReturnApprovals.ts`](src/features/staff-operations/hooks/useReturnApprovals.ts) | 返却承認 |
| 〃 | [`hooks/useBulkReturnByLocation.ts`](src/features/staff-operations/hooks/useBulkReturnByLocation.ts) | 一括返却 |
| 〃 | [`hooks/useDestinations.ts`](src/features/staff-operations/hooks/useDestinations.ts) | 貸出先マスタ |
| 〃 | [`hooks/useOperationSwipe.ts`](src/features/staff-operations/hooks/useOperationSwipe.ts) | 横スワイプでモード切替 |

### 4-3. メンテナンスゾーン

```
/staff/damage     ─┐
/staff/repair     ─┼─ <MaintenanceTabs> で3画面切替
/staff/inspection ─┘
```

| 画面 | URL | ファイル |
|---|---|---|
| 破損報告 | `/staff/damage` | [`src/app/staff/damage/page.tsx`](src/app/staff/damage/page.tsx) |
| 修理完了 | `/staff/repair` | [`src/app/staff/repair/page.tsx`](src/app/staff/repair/page.tsx) |
| 耐圧検査 | `/staff/inspection` | [`src/app/staff/inspection/page.tsx`](src/app/staff/inspection/page.tsx) |
| 共通タブ | — | [`src/components/MaintenanceTabs.tsx`](src/components/MaintenanceTabs.tsx) |

### 4-4. その他スタッフ画面

| 画面 | URL | ファイル |
|---|---|---|
| 自社管理 | `/staff/inhouse` | [`src/app/staff/inhouse/page.tsx`](src/app/staff/inhouse/page.tsx) |
| ダッシュボード | `/staff/dashboard` | [`src/app/staff/dashboard/page.tsx`](src/app/staff/dashboard/page.tsx) |
| 資材発注 | `/staff/order` | [`src/app/staff/order/page.tsx`](src/app/staff/order/page.tsx) |
| マイページ | `/staff/mypage` | [`src/app/staff/mypage/page.tsx`](src/app/staff/mypage/page.tsx) |

---

## 5. 管理者画面マップ

サイドバー（`src/app/admin/layout.tsx` の `ALL_NAV_ITEMS`）:

| 画面 | URL | ファイル |
|---|---|---|
| ダッシュボード | `/admin` | [`src/app/admin/page.tsx`](src/app/admin/page.tsx) |
| 設定変更 | `/admin/settings` | [`src/app/admin/settings/page.tsx`](src/app/admin/settings/page.tsx) |
| 通知設定 | `/admin/notifications` | [`src/app/admin/notifications/page.tsx`](src/app/admin/notifications/page.tsx) |
| 売上統計 | `/admin/sales` | [`src/app/admin/sales/page.tsx`](src/app/admin/sales/page.tsx) |
| スタッフ実績 | `/admin/staff-analytics` | [`src/app/admin/staff-analytics/page.tsx`](src/app/admin/staff-analytics/page.tsx) |
| 金銭・ランク | `/admin/money` | [`src/app/admin/money/page.tsx`](src/app/admin/money/page.tsx) |
| 請求書発行 | `/admin/billing` | [`src/app/admin/billing/page.tsx`](src/app/admin/billing/page.tsx) |
| 状態遷移図 | `/admin/state-diagram` | [`src/app/admin/state-diagram/page.tsx`](src/app/admin/state-diagram/page.tsx) |
| 顧客管理 | `/admin/customers` | [`src/app/admin/customers/page.tsx`](src/app/admin/customers/page.tsx) |
| ページ権限 | `/admin/permissions` | [`src/app/admin/permissions/page.tsx`](src/app/admin/permissions/page.tsx) |

権限制御: [`AdminAuthGuard`](src/components/AdminAuthGuard.tsx) が
Firestore `settings/adminPermissions` を見て、ログインスタッフのロールに応じて表示可否を決める。

---

## 6. 横断コンポーネント（`src/components/`）

ゾーンに依存しない汎用部品のみ。業務フロー固有の部品は `src/features/` に入れる。

| コンポーネント | 用途 | 使う画面 |
|---|---|---|
| [`AuthPanel`](src/components/AuthPanel.tsx) | Google/メール/パスコードのログイン共通UI | portal/login, StaffAuthGuard, AdminAuthGuard |
| [`DrumRoll`](src/components/DrumRoll.tsx) | 縦スクロールの選択UI（アルファベット等） | TankIdInput, ManualOperationPanel, OrderFulfillmentScreen |
| [`TankIdInput`](src/components/TankIdInput.tsx) | DrumRoll + 隠し数字入力 + OKボタンの塊 | inhouse, damage |
| [`QuickSelect`](src/components/QuickSelect.tsx) | 貸出先などのタッチ選択ボタン群 | ManualOperationPanel（貸出先） |
| [`StaffAuthGuard`](src/components/StaffAuthGuard.tsx) | スタッフ認証ガード | staff レイアウト |
| [`AdminAuthGuard`](src/components/AdminAuthGuard.tsx) | 管理者認証＋権限ガード | admin レイアウト |
| [`MaintenanceTabs`](src/components/MaintenanceTabs.tsx) | damage/repair/inspection 切替 | メンテ3画面 |

> **注意**: 「ManualOperationPanel」はスタッフ操作専用なので `src/components/` ではなく
> `src/features/staff-operations/components/` に置いている。この判断基準が今後も設計の軸。

---

## 7. 認証フロー

```
┌────────────────────────────────────────────────────────────────────┐
│ 顧客ポータル                                                         │
│   /portal/login → パスコード or Google/メール                         │
│     ├─ staff が作成済み顧客 → /portal                                │
│     └─ 新規 → /portal/register → /portal/setup → /portal            │
│   セッション: localStorage.customerSession                            │
├────────────────────────────────────────────────────────────────────┤
│ スタッフ                                                             │
│   StaffAuthGuard → パスコード or Google/メール                       │
│   セッション: localStorage.staffSession + Firestore staff を再検証    │
├────────────────────────────────────────────────────────────────────┤
│ 管理者                                                               │
│   AdminAuthGuard → Google/メール (Firebase Auth 必須)                │
│   → Firestore staff lookup → settings/adminPermissions で権限判定    │
└────────────────────────────────────────────────────────────────────┘
```

Firebase Auth の薄いラッパー（Context）は廃止済み。認証状態は各ガード（`StaffAuthGuard` / `AdminAuthGuard`）と localStorage で完結する。

ロール:
- `admin` — 全機能
- `準管理者` — `settings/adminPermissions` で許可された管理ページのみ
- `worker` — スタッフ操作画面のみ
- `customer` — ポータルのみ

---

## 8. データ層（`src/lib/`）

### 8-1. タンク状態の書き込みは1箇所に集約

```
 画面（どこでも）
       │
       ▼
 tank-operation.ts
   ├─ applyTankOperation()       単一タンク
   ├─ applyBulkTankOperations()  複数タンク + 追加書き込み
   ├─ appendTankOperation()      batch に追記
   └─ voidLog()                  ログの論理削除
       │
       │ いずれも必ず
       ▼
  tanks/{id}.status + location 更新  ＆  logs/{id} 追加 を
  writeBatch で原子的に実行（ログなしの状態変更は構造的に不可能）
```

| ファイル | 役割 |
|---|---|
| [`src/lib/tank-operation.ts`](src/lib/tank-operation.ts) | タンクの状態更新 + ログ書き込みの唯一の経路 |
| [`src/lib/tank-rules.ts`](src/lib/tank-rules.ts) | 状態遷移ルール（OP_RULES, RETURN_TAG 等） |
| [`src/lib/tank-types.ts`](src/lib/tank-types.ts) | TankDoc 型 |
| [`src/lib/tank-trace.ts`](src/lib/tank-trace.ts) | タンク履歴の追跡 |
| [`src/lib/order-types.ts`](src/lib/order-types.ts) | 受注（transactions type=order）の型・正規化 |
| [`src/lib/billing-rules.ts`](src/lib/billing-rules.ts) | 請求計算 |
| [`src/lib/incentive-rules.ts`](src/lib/incentive-rules.ts) | スタッフランク・インセンティブ計算 |
| [`src/lib/firebase/config.ts`](src/lib/firebase/config.ts) | Firebase 初期化 |
| [`src/lib/firebase/customer-destination.ts`](src/lib/firebase/customer-destination.ts) | customers ⇄ destinations 同期 |

### 8-2. 共通フック（`src/hooks/`）

| フック | 役割 |
|---|---|
| [`useTanks`](src/hooks/useTanks.ts) | `tanks` 全件取得 + refetch |
| [`useStaffSession`](src/hooks/useStaffSession.ts) | localStorage からスタッフ情報 |
| [`useInspectionSettings`](src/hooks/useInspectionSettings.ts) | 耐圧検査の有効期限設定 |

### 8-3. Firestore コレクション（主要）

| コレクション | キー | 用途 |
|---|---|---|
| `users` | uid | Firebase Auth 連携 |
| `staff` | docId | スタッフマスタ |
| `customers` | docId | 顧客マスタ |
| `tanks` | docId | タンク状態（status, location, staff） |
| `logs` | docId | 操作ログ（必ず tank 更新とペアで書かれる） |
| `transactions` | docId | 受注/返却/未充填報告（type で判別） |
| `destinations` | uid | 貸出先 |
| `orderMaster` | docId | 発注品目定義 |
| `orders` | docId | 資材発注 |
| `priceMaster` | docId | 操作単価 |
| `rankMaster` | docId | ランク条件 |
| `settings/adminPermissions` | — | ページ権限 |
| `settings/portal` | — | ポータル設定 |

---

## 9. 設計の軸（迷ったらこれ）

1. **画面固有の部品は `src/features/<feature>/`** に閉じ込める。`src/components/` は汎用のみ。
2. **`src/app/**/page.tsx` は薄い殻**。ロジックは features か lib へ。
3. **タンクの書き込みは tank-operation.ts 経由のみ**。logs と原子的にペアで書く。
4. **`batch.update()` を使う**（`batch.set(..., {merge:true})` は幽霊ドキュメントを作るため原則禁止）。
5. **YAGNI を守る**。重複があっても、仕様差が大きいなら無理に共通化しない。理解できない抽象はバグの温床。

---

## 10. このドキュメントの更新ルール

- ページ追加・削除時はこのファイルの該当表を更新する
- `features/` 下に新しい feature ディレクトリを作ったら §6 の注意書きの下に追記する
- 設計の軸（§9）は Sana（秘書）の判断でしか更新しない
