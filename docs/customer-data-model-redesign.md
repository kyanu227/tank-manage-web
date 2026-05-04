# customers / customerId 整理 指針

`customers` / `customerUsers` / `transactions.customerId` / `tanks.location` / `logs.location` が並立している現状を整理し、貸出先・請求単位の正本を `customers` に一本化するための作業指針。

2026-04-29 時点で、Firestore の `destinations` コレクションはコード上の参照・書き込み・管理 UI を削除済み。過去互換は考慮しない方針に切り替えた。Firestore 上に残る既存 `destinations` データの削除は、コード変更とは別作業として扱う。

設計方針自体は [`database-schema.md`](./database-schema.md#L568-L596) と [`admin-integration-plan.md`](./admin-integration-plan.md) で既に合意済み。本書はそれを **コードに落とす段取り** をまとめる。

## 関連ドキュメント

| 文書 | 役割 | 本書との関係 |
|---|---|---|
| [`docs/database-schema.md`](./database-schema.md) | Firestore スキーマの正本 | コレクション構造・フィールド定義・整理方針の出典 |
| [`docs/admin-integration-plan.md`](./admin-integration-plan.md) | 管理画面接続の優先度・service 境界 | 「正本に寄せる」運用の出典 |
| [`docs/data-layer-design.md`](./data-layer-design.md) | repository 集約の設計 | customers は対象外（Phase 2-B でも触っていない）。destinations は廃止済み |
| [`docs/data-layer-migration-plan.md`](./data-layer-migration-plan.md) | tanks/logs/transactions の読み取り集約 | Phase 2-B 完了。本書は別軸 |

## 用語

| 用語 | 意味 |
|---|---|
| 貸出先 | タンクの貸出・請求の単位となる会社・店舗 |
| ポータル利用者 | 顧客ポータルにログインする個人。Portal Auth Phase 0 以降は Firebase Auth + `customerUsers` を正本にする |
| 正本 | データの真の出所。同じ概念が複数あるとき、どれを信じるかの基準 |
| 履歴表示用名 | 当時の名前を保存しておくフィールド（後で正本側の名前を変えても過去表示に影響しない） |

---

## 1. 現状把握（実態調査の結果）

### 1.1 関連コレクション

| コレクション | 役割 | ID | 状態 |
|---|---|---|---|
| `customers` | 貸出先マスタ（請求・受注・返却の単位） | 自動 ID | **正本候補** |
| `destinations` | 旧 貸出先・料金マスタ | `customerUsers.uid` ベース | **廃止済み / コード参照削除済み** |
| `customerUsers` | ポータル利用者個人 | Firebase Auth uid | Portal Auth Phase 0 本番確認済み。admin/settings の紐付け処理でも利用 |
| `transactions` | 顧客申請・受注・返却 | 自動 ID | `customerId` / `customerName` / `createdByUid` を保持 |
| `logs` | タンク操作履歴 | 自動 ID | `location` 文字列保存（顧客名）+ `customerId`（任意） |
| `tanks` | タンク現在状態 | 正規化済み tankId | `location` 文字列保存（顧客名） |

### 1.2 customers のフィールド（実態）

```ts
{
  name: string;          // 表示・検索の基本名（必須）
  companyName?: string;  // 会社名（多くは name と同じ値）
  email?: string;
  price10?: number;      // 10L 単価（顧客別）
  price12?: number;      // 12L 単価
  priceAluminum?: number;
  isActive: boolean;
  createdAt, updatedAt
}
```

### 1.3 destinations の旧フィールド（廃止済み）

以下は旧コレクションに存在していたフィールド。現行コードでは `destinations` を正本・旧互換として扱わない。

```ts
{
  name: string;
  formalName?: string;    // 正式名称
  companyName?: string;
  lineName?: string;      // LINE 表示名
  email?: string;
  price10?: number;       // ★ customers と重複
  price12?: number;
  priceAluminum?: number;
  isActive: boolean;
  customerUid?: string;   // customerUsers.uid と紐付く想定
  createdAt, updatedAt
}
```

### 1.4 customerUsers のフィールド（実態）

`customerUsers` は portal user の正本。`portal/login` / `register` / `setup` / `layout` は Portal Auth Phase 0 で Firebase Auth + `customerUsers` ベースに移行済み。2026-04-29 の本番確認で create/read/update が成功した。

Firestore Rules はまだ正式deployしていない。Rules による `customerUsers` の正式保護は次フェーズでレビューする。

```ts
{
  uid: string;                // Firebase Auth uid（ドキュメント ID と一致）
  email: string;
  displayName?: string;
  selfCompanyName: string;    // 利用者本人が入力した会社名
  selfName: string;           // 利用者本人の氏名
  lineName?: string;
  customerId?: string | null; // 紐付け先 customers/{id}
  customerName?: string;      // 紐付け先の表示名（保存）
  // status は保存しない。computeCustomerUserStatus で派生する。
  setupCompleted: boolean;
  disabled: boolean;
}
```

status の派生ルール:

- `disabled === true` → `disabled`
- `setupCompleted !== true` → `pending_setup`
- `setupCompleted === true && !customerId` → `pending`
- `setupCompleted === true && customerId` → `active`

### 1.5 既存ヘルパーの実態

#### `src/lib/firebase/customer-user.ts`
- Portal Auth Phase 0 の本番実装
- `ensureCustomerUser`, `normalizeCustomerUser`, `needsCustomerUserSetup`, `saveCustomerPortalSession`, `computeCustomerUserStatus` を提供
- `status` は Firestore に保存せず派生値として扱う
- `customerId` / `customerName` / `disabled` は顧客自身の setup から保存しない

#### `src/lib/firebase/customer-destination.ts`
- 2026-04-26 に削除済み
- 旧 `syncCustomerDestination(payload)` は `destinations/{customerUsers.uid}` に冗長コピーを書く処理だった
- 2026-04-26 調査: `src` 配下で runtime の import / call ともに未検出。現時点の呼び出し元はなし
- `admin/settings` の destinations タブ削除後、dead code としてファイルごと削除した

### 1.6 主要画面・hook の参照経路

| 場所 | 何を読む | 何を書く | 備考 |
|---|---|---|---|
| `admin/customers/page.tsx` | `customers` 全件 | `customers` の作成・更新 | 顧客マスタ編集タブ |
| `admin/settings/page.tsx` | `staff`, `customers`, `customerUsers`, `orderMaster`, `settings` | 同左の更新 | destinations タブは削除済み |
| `admin/settings/page.tsx` の customers タブ | `customers` + `customerUsers` 全件 | `customerUsers.customerId` 紐付け、 transactions(`pending_link`) 更新 | ポータル利用者紐付け |
| `admin/billing/page.tsx` | `customers` 全件 | — | 単価参照 |
| `useDestinations`（`features/staff-operations/hooks/`） | **`customers` 全件**（名前は destinations だが実は customers を読む） | — | staff 操作画面の貸出先候補 |
| `staff/dashboard/page.tsx` | `customers` 全件 | — | 一括貸出先変更モーダル候補 |
| `portal/login` / `register` / `setup` / `layout` | Firebase Auth + `customerUsers` | localStorage `customerSession` 互換 session | Portal Auth Phase 0 本番確認済み |
| `portal/order` | `customerSession.uid/name` | `transactions` 作成（`status: "pending"`、delivery metadata 保存） | 旧ログイン方式のまま delivery 情報だけ追加済み |
| `portal/return` / `unfilled` | localStorage `customerSession` 互換 session | `transactions` 作成 | Portal Auth 後の互換 session を利用。個別schema整理は後続 |
| `useReturnTagProcessing.processReturnTags` | — | `applyBulkTankOperations` の `logExtra: { customerId }` | logs に customerId を付与 |
| `useOrderFulfillment.fulfillOrder` | — | 同上 | logs に customerId を付与 |

### 1.7 customerId / customerName / location の流れ

```
顧客が portal で発注する（現行main）
  └─ localStorage customerSession の uid/name を読む
      └─ transactions.status = "pending"
          customerId = session.uid || "unknown"
          customerName = session.name || "不明な顧客"
          createdByUid = session.uid || "legacy_customer"
          deliveryType / deliveryTargetName / note 等を保存

管理者が後で紐付け確定する（admin/settings の customers タブ。pending_link データがある場合）
  └─ customerUsers.customerId をセット
      └─ pending_link 状態の transactions を pending_approval に昇格
          customerId / customerName を上書きセット

スタッフが受注貸出する（useOrderFulfillment.fulfillOrder）
  └─ applyBulkTankOperations を呼ぶ
      └─ logExtra: { customerId } を logs に付与
      └─ tanks.location = customerName（顧客名の文字列）★ 履歴表示は location ベース

スタッフ画面の表示・集計
  └─ tanks.location（顧客名文字列）を直接使う ← portal の貸出中タンク表示・admin/billing 集計など
```

### 1.8 残っている重複・混乱

| # | 内容 | 影響 |
|---|---|---|
| C1 | `customers.name` と `customers.companyName` の役割が未確定（多くは同値） | 表示・検索のどちらが正かが画面ごとにバラバラ |
| C2 | 旧 `destinations.price10/12/Aluminum` と `customers.price10/12/Aluminum` が両方存在していた | コード上の単価正本は `customers` に寄せる。Firestore 旧データ削除は別作業 |
| C3 | `useDestinations` が **customers から読む**（命名と中身が逆） | 新規参加者が混乱、リネーム候補 |
| C4 | `syncCustomerDestination` が destinations に冗長コピーを書く処理として残存していた | 2026-04-26 に呼び出し元なしを確認し削除済み |
| C5 | `tanks.location` は顧客名文字列。`customerId` 参照ではない | 顧客名を変更すると過去タンクの location 表示と参照が切れる |
| C6 | `logs.location` も顧客名文字列 + 任意の `customerId` 併存 | 集計時にどちらを軸にするか不統一 |
| C7 | `transactions.customerNameInput` は portal Auth/customerUsers WIP 側のフィールド | 現行mainの portal/order では追加しない |
| C8 | `customerUsers.customerName` は紐付け確定時に保存するスナップショット | customer の name 変更時に同期するかどうかが未定 |
| C9 | portal session は Firebase Auth + `customerUsers` を正としつつ、画面互換用に localStorage `customerSession` を保存 | `portal/order` 等の旧 session 参照を後続で整理する |

---

## 2. 設計方針（合意済み）

[`database-schema.md` L568-L596](./database-schema.md) と [`admin-integration-plan.md`](./admin-integration-plan.md) で既に確定している。

### 2.1 役割分担

- `customers` — 貸出先・請求単位の **正本**
- `customerUsers` — ポータル利用者の独立マスタ（個人）
- `destinations` — **廃止済み**。正本・旧互換として使わない
- `customerId` — 正規参照（永続）
- `customerName` / `location` — 履歴表示用の当時名（過去ログ書き換えなし）

`logs.location` / `tanks.location` は `destinations` コレクションとは別概念。履歴表示・現在場所表示の文字列として残す。

### 2.2 既に正本化されている部分

- **`useDestinations` は実体として `customers` を読んでいる**（命名は古い）
- **`transactions` は `customerId` / `customerName` / `createdByUid` を分離保存**
- **`admin/customers` は customers 編集に専用**
- **`admin/billing` は customers ベース**
- **`admin/settings` の destinations タブは削除済み**
- **`src/lib/firebase/customer-destination.ts` は削除済み**
- **`portal/order` は旧 customerSession 方式のまま delivery metadata を保存**
- **Portal Auth Phase 0 は Firebase Auth + customerUsers ベースで本番確認済み**
- **`order-types` は delivery metadata を fallback 付きで読める**
- **staff operations は delivery / pickup 情報を表示できる**

### 2.3 まだ整理されていない部分

- `customers.name` vs `companyName` の役割
- `tanks.location` / `logs.location` の文字列依存
- `useDestinations` の命名（実体は `customers` 読み取り）
- Firestore Rules 本番化（未deploy）

### 2.4 Portal Auth Phase 0 本番確認

2026-04-29 に本番 Hosting 上で以下を確認済み。

- Email/Password provider は Firebase Console で有効化済み。
- Email/Password 新規登録により Firebase Auth user が作成された。
- `customerUsers/{uid}` の create/read/update が現行本番環境で成功した。
- `/portal/setup` へ誘導され、`selfCompanyName` / `selfName` / `lineName` を保存できた。
- setup 完了後に `/portal` へ戻り、`customerId` 未紐付け状態でも画面は壊れなかった。
- `/portal/order` に到達できた。
- `permission-denied` は発生しなかった。
- `status` field が保存されていないことを確認した。
- 確認用 Auth user と `customerUsers` doc は Firebase Console から手動削除済み。

同時に、`/portal` の `getActiveLogs()` 用に以下の Firestore composite index を Firebase Console で手動作成済み。

- collection: `logs`
- query scope: Collection
- `logStatus` Ascending
- `location` Ascending
- `timestamp` Descending
- `__name__` Descending

これは `logStatus == "active"` + `location == customerName` + `orderBy("timestamp", "desc")` に対応する index であり、`firestore.rules` の deploy ではない。

---

## 3. 整理ステップ（推奨順）

### Step 1 — スキーマ確定（コード変更なし、判断のみ）

#### 1-1. `customers.name` と `customers.companyName` の役割確定
- **案 A**（推奨）: `name` を表示名として一本化、`companyName` を deprecated とし読み取り側でフォールバックのみ残す
- **案 B**: `name` = 短縮表示名、`companyName` = 法人名と役割分離（請求書用に法人名が要る場合）
- 影響: `admin/customers` フォーム、`useDestinations` 表示、`staff/dashboard` の `name || companyName` フォールバック
- → 案 A で問題ない場合は次フェーズで `companyName` 書き込みを停止

#### 1-2. 単価フィールドの正本確定
- **決定**: `customers.price10 / price12 / priceAluminum` を正本、旧 `destinations.price*` は使わない
- **案 B**: 別マスタ `customerPriceMaster` に分離、貸出先と単価設定を独立に編集可能
- **案 C**: 顧客別単価をやめ全社統一（`priceMaster` のみ使う）
- 影響: `admin/billing`、`admin/customers`、将来の請求計算（C-9）
- → 案 A が現状最小変更。案 B/C は請求計算設計（C-9）と合わせて再判断

#### 1-3. `tanks.customerId` 追加の判断
- **案 A**: `tanks` に `customerId` を追加し、`location` は履歴表示用のみ
- **案 B**: `tanks.customerId` は追加せず、`location` 文字列マッチを継続
- **案 C**: portal 表示時のみ runtime で `customers.name` → tanks.location マッチで resolve（現状方式の継続）
- 影響範囲が大きいため **本書では決定しない**。後続フェーズで議論
- 進行表 [`data-layer-migration-plan.md`](./data-layer-migration-plan.md) の "portal の貸出中タンク取得を customerId 参照に" 項目と同件

#### 1-4. `customerUsers.customerName` 同期方針
- 紐付け時にスナップショットを保存する現状を維持し、**customer 側の name 変更時に customerUsers 側を同期するかどうか** を決める
- **案 A**: 同期する（管理画面で customer 名変更時に紐付き customerUsers / 過去 transactions の表示名は据え置き）
- **案 B**: 同期しない（customerUsers 側は紐付け時点のスナップショット）
- 業務影響を踏まえ案 A 推奨だが、変更履歴の扱い設計（A-5）と関連

### Step 2 — 管理画面側の正本表現（admin-integration-plan.md と連動）

#### 2-1. `admin/settings` の destinations タブの扱い
- 2026-04-29 にタブを撤去済み
- 本格運用前のため、旧 `destinations` データ互換は考慮しない
- Firestore 上の `destinations` データ削除はコード変更とは別作業

#### 2-2. `admin/customers` の name / companyName 表示統一
- Step 1-1 の決定に従う
- 入力フォームを `name` 一本に絞るか、両方残すか

#### 2-3. 単価の編集 UI 集約
- Step 1-2 の決定に従う
- `admin/customers` 側に単価編集を集約する

### Step 3 — staff 側参照経路の整理

#### 3-1. `useDestinations` のリネーム
- 現状: ファイル名は `useDestinations`、中身は `customers` を読む
- 推奨リネーム: `useCustomers` または `useCustomerOptions`（用途が「貸出先候補ドロップダウン」なので後者寄り）
- 利用元: `OperationsTerminal`, `ManualOperationPanel`, `staff/dashboard` の一括貸出先変更モーダル

#### 3-2. portal の貸出中タンク取得方式（Step 1-3 と連動）
- 現状: `tanksRepository.getTanks({ location: customerName, status: STATUS.LENT })`（Phase 2-B-6 でリポジトリ化済み）
- 案 A 採用なら: `getTanks({ customerId, status })` を新設
- 案 B/C 採用なら: 現状維持

### Step 4 — destinations の廃止

#### 4-1. `syncCustomerDestination` の廃止判定
- 2026-04-26 調査で `syncCustomerDestination` の runtime 呼び出し元はなし
- `src` 配下で import / call ともに未検出
- `admin/settings` の destinations タブ削除後に `src/lib/firebase/customer-destination.ts` を削除済み

#### 4-2. destinations 読み取りの全廃
- `admin/settings` の destinations タブ撤去済み
- `src` 配下で `collection(db, "destinations")` / `doc(db, "destinations", ...)` の runtime 使用はゼロ
- `useDestinations` は名前だけ古く、実体は `customers` を読む。リネームは別タスク

#### 4-3. destinations コレクションのアーカイブ
- 本格運用前のため過去互換は考慮しない
- Firestore 上の `destinations` データ削除は手動または別スクリプトで実施
- Firestore Security Rules の整理は別タスク

---

## 4. 影響範囲

### 4.1 コード変更が必要なファイル（推定）

| 区分 | ファイル | 想定変更 |
|---|---|---|
| 管理画面 | `src/app/admin/settings/page.tsx` | destinations タブ削除済み |
| 管理画面 | `src/app/admin/customers/page.tsx` | name / companyName 統一（Step 2-2）、単価編集（Step 2-3） |
| staff hook | `src/features/staff-operations/hooks/useDestinations.ts` | リネーム（Step 3-1） |
| staff hook 利用元 | `src/features/staff-operations/components/ManualOperationPanel.tsx` 等 | import パス変更 |
| 共通ヘルパー | `src/lib/firebase/customer-destination.ts` | 削除済み |
| portal | `src/app/portal/page.tsx` / `return/page.tsx` / `unfilled/page.tsx` | Step 1-3 採用案次第（A 採用なら customerId 参照に変更） |
| repository | `src/lib/firebase/repositories/tanks.ts` | Step 1-3 案 A 採用なら `customerId` オプション追加 |

### 4.2 データ影響

- 既存 `destinations` データ: 本格運用前のため互換は考慮しない。Firestore 上の削除はコード変更後の別作業
- 既存 `transactions.customerName` / `customerNameInput`: 履歴表示用として残す（書き換えない）
- 既存 `tanks.location` / `logs.location`: 顧客名文字列のまま残す（Step 1-3 で案 A 採用なら新規分のみ customerId 併記）

### 4.3 互換性懸念

- 過去ログの location 表示: 顧客名を変更したとき、ログ表示は当時名のまま（これは仕様）
- 旧スキーマの customer データ: `name` が空で `companyName` のみあるドキュメントがあるかもしれない → 読み取り側でフォールバック維持
- destinations のみに登録されていた貸出先: 本格運用前のため互換対象外。必要な貸出先は `customers` に登録する

### 4.4 Security Rules

- `destinations` の Rules 整理は別タスク
- `customerUsers.customerId` の更新権限は管理者のみ
- 本書のスコープでは Rules 自体は触らない

---

## 5. 判断が必要な分岐点（再掲）

| # | 分岐 | 影響 | 推奨 | 決定タイミング |
|---|---|---|---|---|
| D1 | `customers.name` vs `companyName` の役割 | 全画面の表示 | 案 A（name 一本化） | Step 1-1 |
| D2 | 単価の正本 | 請求設計（C-9）に影響 | `customers` に統一 | 決定済み、ただし C-9 で再確認 |
| D3 | `tanks.customerId` 追加 | portal / staff / logs に影響 | 議論中（後続フェーズで） | Step 3 着手前 |
| D4 | `customerUsers.customerName` 同期 | 管理画面の運用 | 案 A（同期する） | A-5 と同時 |
| D5 | destinations タブ撤去のタイミング | 管理画面 UX | 撤去 | 2026-04-29 実施済み |

---

## 6. 推奨実行順

| 順 | フェーズ | 内容 | 備考 |
|---|---|---|---|
| 1 | **設計確定** | D1 は継続、D2 / D5 は決定済み、D3 は別議論 | 本書をベースに ✅ |
| 2 | **Step 1-1, 1-2 反映** | スキーマの役割をコード上で明文化（型コメント・README） | コード変更最小 |
| 3 | **Step 2-1** | destinations タブ撤去 | 2026-04-29 実施済み |
| 4 | **Step 4-1** | `syncCustomerDestination` の呼び出し元確認・廃止判定 | 2026-04-26 実施済み、削除済み |
| 5 | **Step 3-1** | `useDestinations` リネーム | リネーム + import 更新 |
| 6 | **Step 2-2, 2-3** | customers 編集 UI 整理 | UX 改善 |
| 7 | **Step 4-2, 4-3** | destinations コード参照撤去 + Firestore 旧データ削除 | コード参照撤去は 2026-04-29 実施済み。旧データ削除は別作業 |
| 8 | **Step 1-3 → Step 3-2** | tanks.customerId 採用議論と portal 経路変更 | 大きい変更、別タスク |

順 8 は portal / staff の挙動が変わる可能性があるため、A-3（管理画面接続 P0）以降の作業が落ち着いてから着手するのが安全。

---

## 7. やらないこと（本書のスコープ外）

- 既存コードの変更（本書は **設計指針** のみ）
- repository 実装の変更
- `tank-operation.ts` / `tank-trace.ts` への手入れ
- Security Rules の改訂
- 請求計算（C-9）の設計（別書面で扱う）
- 報酬計算（C-9）の設計（別書面で扱う）
- monthly_stats / admin/sales の集計改善（C-10）
- 書き込み系 repository 化（D-11）
- Cloud Functions 化（D-13）
- 多言語化（D-14）

---

## 8. 関連 Issue / 過去メモ

### `data-layer-migration-plan.md` の関連メモ
- 「portal の貸出中タンク取得を `customerId` 参照に」（次フェーズ候補・データモデル改善）
- 「`customerUsers` への紐付け確定時の transactions(`pending_link`) 更新」は Phase 2-B-12 で `findPendingLinksByUid` として repository 化済み

### `admin-integration-plan.md` の関連メモ
- L40: 貸出先名・有効/無効 の管理画面接続 P0（service 推奨、正本を customers に寄せる）
- L41: 貸出先別単価 の管理画面接続 P1（正本を決めて重複解消）
- L42: ポータル利用者と貸出先の紐付け P0（service 必須、pending transaction 更新を伴う）
- L184: 推奨実装優先度 P0「customers を貸出先正本として扱う方針を管理画面に反映」
- L223-227: 推奨する次の設計タスク → 本書がそれに該当

### `database-schema.md` の関連箇所
- L23 用語: 貸出先 = customers 正本
- L322-325: destinations 方針 = 廃止済み
- L568-596: customers 正本化と destinations 廃止方針を明記

---

## 9. 次の作業着手前のチェックリスト

本書を読んでから次の作業に入る場合のチェック:

- [ ] 本書の **Step 1**（D1）にユーザー判断が出ているか確認
- [x] D2（単価の正本）は `customers` に統一する方針で決定済み
- [x] D5（destinations タブ撤去）は 2026-04-29 に実施済み
- [ ] D3（`tanks.customerId`）は **本書では未決**。決定しないまま Step 1〜2 を進めてよい
- [x] `syncCustomerDestination` の呼び出し元調査（Step 4-1）は 2026-04-26 に実施済み。runtime import / call は未検出
- [ ] `admin-integration-plan.md` の P0 項目（staff service 境界、settings 変更履歴）と並列で進める場合は、変更箇所の競合に注意
- [ ] Phase 2-B 完了済みなので、tanks/logs/transactions の **読み取り** は repository 経由に統一済み。本書の作業で直接 Firestore を呼びたくなったら repository 化を検討すること

---

## Appendix A. 既存ヘルパー一覧

| ファイル | 関数 | 役割 | 整理時の方針 |
|---|---|---|---|
| `src/lib/firebase/customer-user.ts` | `ensureCustomerUser(user)` 等 | portal Auth / customerUsers Phase 0 | 本番確認済み。Rules 正式deployは次フェーズ |
| `src/lib/firebase/customer-destination.ts` | `syncCustomerDestination(payload)` | destinations への冗長コピー | 2026-04-26 に呼び出し元なしを確認し削除済み |

## Appendix B. 既存 transactions の customerId / customerName 保存パターン

```ts
// portal/order/page.tsx (顧客発注、現行main)
{
  customerId: session.uid || "unknown",
  customerName: session.name || "不明な顧客",
  createdByUid: session.uid || "legacy_customer",
  status: "pending",
  deliveryType,
  deliveryTargetName,
  note,
  orderNote,
  deliveryNote,
}

// portal/return/page.tsx, unfilled/page.tsx (顧客返却・未充填、現行main)
{
  customerId,
  createdByUid,
}

// admin/settings/page.tsx (顧客紐付け確定)
batch.update(doc(db, "transactions", item.id), {
  customerId,                // customerUsers.customerId にセットされた値
  customerName,              // 管理者が選んだ customers の表示名
  status: "pending_approval",
  linkedAt: serverTimestamp(),
})

// useOrderFulfillment / useReturnTagProcessing (スタッフ承認・完了)
applyBulkTankOperations(..., (batch) => {
  batch.update(doc(db, "transactions", id), {
    status: "completed",
    fulfilledAt, fulfilledBy,
  });
});
// logExtra: { customerId } で logs に customerId を付与
```

## Appendix C. 「貸出先候補」の現状実装

`useDestinations` フックは **`customers` を全件読み**、有効なもの（`isActive !== false`）をドロップダウン候補として返している。実装上は既に customers 寄り。

```ts
// src/features/staff-operations/hooks/useDestinations.ts:15
const custSnap = await getDocs(collection(db, "customers"));
```

つまり「destinations」という名前と中身が逆転している状態。今回の `destinations` コレクション廃止では挙動変更を避けるためリネームしない。Step 3-1 で改名するだけで実体は変わらない。
