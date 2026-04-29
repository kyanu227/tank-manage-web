# Data Layer Migration Plan — `tanks` / `logs` / `transactions` 読み取り経路の repository 集約

画面・hooks に散らばっていた `tanks` / `logs` / `transactions` の直接 Firestore 読み取りを、`src/lib/firebase/repositories/` 配下の repository 経由に統一するためのプロジェクト記録。

## 現在の状態

**Phase 2-B 完了**（2026-04-26）。Phase 2-A の棚卸しで挙げた **21 箇所** の直接読み取りはすべて repository 経由に移行済み。残るのは repository 内部・業務ハブ（`tank-operation.ts`）・サービス層（`tank-trace.ts`、後回し方針）・書き込み系・対象外コレクションのみ。

設計書: [`./data-layer-design.md`](./data-layer-design.md)

---

## 1. Phase 2-B 完了サマリ

| 区分 | 件数 | 状態 |
|---|---|---|
| tanks 読み取り | 7 | ✅ すべて repository 化 |
| logs 読み取り | 8 | ✅ すべて repository 化 |
| transactions 読み取り | 6 | ✅ すべて repository 化 |
| **合計** | **21** | **✅ 完了** |

- 検証: 各フェーズ完了時に `npx tsc --noEmit` 0エラー / 既存挙動維持 / コミット分離
- 期間: Phase 2-B-1 〜 2-B-12（13 コミット、最終コミット `d97b63b`）
- 残作業: なし（読み取り経路のスコープ）

---

## 2. 実装済み repository 関数

### `tanksRepository`

| 関数 | 概要 | 利用元 |
|---|---|---|
| `getTanks(options)` | `status` / `statusIn` / `location` / `prefix` の AND フィルタ。id 昇順ソート | `useTanks`, portal 3画面, `admin/page`, `useBulkReturnByLocation` |
| `getTank(tankId)` | 1件取得（不在なら null） | `useReturnApprovals.fulfillReturns` |

**stub のまま据え置き**: `listenTanks` / `getTanksByIds` / `updateTankFields` / `updateTankFieldsInBatch`

### `logsRepository`

| 関数 | 概要 | 利用元 |
|---|---|---|
| `getActiveLogs(options)` | `logStatus=="active"` 必須 + `from` / `to` / `location` / `limit`。`timestamp desc` 必須 | `admin/billing`, `admin/sales`, `staff/mypage`, `admin/staff-analytics`, `admin/page`, `portal/page`, `staff/dashboard` |
| `getLogsByRoot(rootLogId)` | `rootLogId` 単一フィルタ（呼び出し側で revision 昇順ソート） | `staff/dashboard.toggleHistory` |

**stub のまま据え置き**: `getLog` / `getLogsByTank` / `getActiveLogsByTank` / `getLatestActiveLogForTank` / `getLogsByAction` / `getLogsInRange` / `listenLogsByTank` / `listenRecentLogs`

### `transactionsRepository`

| 関数 | 概要 | 利用元 |
|---|---|---|
| `getOrders(options)` | `type=="order"` 必須 + `status` / `customerId`。`normalizeOrderDoc` で `PendingOrder[]` 化 | `useOrderFulfillment`, `staff/dashboard` |
| `getReturns(options)` | `type=="return"` 必須 + `status` / `customerId`。`TransactionDoc[]` 生キャスト | `useReturnApprovals`, `staff/dashboard` |
| `getPendingTransactions(options)` | type 横断 + `status` `in` 配列 | `admin/page` |
| `findPendingLinksByUid(uid)` | `createdByUid` + `status=="pending_link"` 特殊条件 | `admin/settings.saveCustomerUsers` |

**stub のまま据え置き**: `createTransaction` / `updateTransaction` / `updateTransactionInBatch` / `getTransaction` / `getUnchargedReports` / `listenOrders` / `listenReturnApprovals` / `markOrderApproved` / `markOrderCompletedInBatch`

### 設計境界の確認

- 集計・正規化（`normalizeOrderDoc`）以外の業務ロジックは repository 側に持ち込まない
- `LogEntry` / `BulkTankWithTag` / `PendingReturn` 等の features 層型は repository に依存させない
- 呼び出し側は `as unknown as XxxDoc[]` キャストで型を吸収
- `since` オプションは未対応（コメントのみ残置）

---

## 3. 移行済みファイル一覧

### tanks（7件）

| 旧 | 新 | フェーズ |
|---|---|---|
| `src/hooks/useTanks.ts` 全件取得 | `tanksRepository.getTanks()` | 2-B-1 |
| `src/app/portal/page.tsx` 貸出中 | `tanksRepository.getTanks({ location, status: STATUS.LENT })` | 2-B-6 |
| `src/app/portal/return/page.tsx` 貸出中 | 同上 | 2-B-6 |
| `src/app/portal/unfilled/page.tsx` 貸出中 | 同上 | 2-B-6 |
| `src/app/admin/page.tsx` 貸出中件数 | `tanksRepository.getTanks({ status: STATUS.LENT })` | 2-B-9 |
| `useReturnApprovals.fulfillReturns` 1件確認 | `tanksRepository.getTank(tankId)` | 2-B-8b |
| `useBulkReturnByLocation.fetchBulkTanks` | `tanksRepository.getTanks({ statusIn: [LENT, UNRETURNED] })` | 2-B-11 |

### logs（8件）

| 旧 | 新 | フェーズ |
|---|---|---|
| `src/app/admin/billing/page.tsx` active logs | `logsRepository.getActiveLogs()` | 2-B-2 |
| `src/app/staff/mypage/page.tsx` active logs (limit 100) | `logsRepository.getActiveLogs({ limit: 100 })` | 2-B-3 |
| `src/app/admin/sales/page.tsx` active logs (limit 3000) | `logsRepository.getActiveLogs({ limit: 3000 })` | 2-B-4 |
| `src/app/admin/staff-analytics/page.tsx` active logs | `logsRepository.getActiveLogs()` | 2-B-5 |
| `src/app/admin/page.tsx` 本日 active logs | `logsRepository.getActiveLogs({ from: todayStart })` | 2-B-9 |
| `src/app/portal/page.tsx` 顧客向け logs (limit 30) | `logsRepository.getActiveLogs({ location, limit: 30 })` | 2-B-6 周辺 |
| `src/app/staff/dashboard/page.tsx` active logs 一覧 | `logsRepository.getActiveLogs()` | 2-B-10a |
| `src/app/staff/dashboard/page.tsx` 履歴展開 (rootLogId) | `logsRepository.getLogsByRoot(rootId)` | 2-B-10b |

### transactions（6件）

| 旧 | 新 | フェーズ |
|---|---|---|
| `useOrderFulfillment.fetchOrders` (3 status 並列) | `transactionsRepository.getOrders({ status })` × 3 | 2-B-7 |
| `useReturnApprovals.fetchApprovals` | `transactionsRepository.getReturns({ status: "pending_approval" })` | 2-B-8a |
| `src/app/admin/page.tsx` 要対応件数 | `transactionsRepository.getPendingTransactions({ statuses: ["pending","pending_approval"] })` | 2-B-9 |
| `src/app/staff/dashboard/page.tsx` pending orders | `transactionsRepository.getOrders({ status: "pending" })` | 2-B-10a |
| `src/app/staff/dashboard/page.tsx` pending_approval returns | `transactionsRepository.getReturns({ status: "pending_approval" })` | 2-B-10a |
| `src/app/admin/settings/page.tsx` pending_link | `transactionsRepository.findPendingLinksByUid(uid)` | 2-B-12 |

---

## 4. 意図的に残す直接アクセス

### repository 内部
- `src/lib/firebase/repositories/{tanks,logs,transactions}.ts` — 集約先なので Firestore SDK を直接使う

### 業務ハブ・サービス層

| ファイル | 役割 | 方針 |
|---|---|---|
| `src/lib/tank-operation.ts` | tanks / logs の整合性を保つ書き込みハブ（`runTransaction`、`appendTankOperation`、`applyLogCorrection` 等） | Phase 2-B 対象外。書き込み経路の整理は Phase 3 以降 |
| `src/lib/tank-trace.ts` | logs の追跡・集計 service 層（L64, L118, L171, L220 の 4 箇所） | Phase 2-A 棚卸し時から後回し方針。`logsRepository` 内部呼び出しへの書き換えは別タスク |
| `src/features/procurement/lib/submitTankEntryBatch.ts` | タンク登録・購入の業務バッチ | 対象外 |

### 書き込み系（Phase 3 以降の候補）

- `src/app/portal/order/page.tsx` / `portal/return/page.tsx` / `portal/unfilled/page.tsx` — `addDoc(collection(db, "transactions"), ...)`
- `src/features/staff-operations/hooks/useOrderFulfillment.ts` — `updateDoc` / `batch.update(doc(db, "transactions", ...))`
- `src/features/staff-operations/hooks/useReturnApprovals.ts` — `batch.update(doc(db, "transactions", ...))`
- `src/app/admin/settings/page.tsx` — `batch.update(doc(db, "transactions", ...))`（customer リンク確定時）
- `src/features/staff-operations/hooks/useBulkReturnByLocation.ts` — `writeBatch(db).update(ref, { logNote })`（tag 操作）
- `src/app/staff/inhouse/page.tsx` — tanks メタ更新
- `src/app/staff/order/page.tsx` — `batch.set(doc(collection(db, "logs")), ...)`（非タンク order log）

### 対象外コレクション

`staff` / `customers` / `customerUsers` / `orderMaster` / `settings` / `notifySettings` / `lineConfigs` / `monthly_stats` / `priceMaster` / `rankMaster` / `tankProcurements` / `orders`

主な利用元: `admin/settings`, `admin/customers`, `admin/money`, `admin/notifications`, `admin/permissions`, `admin/sales`（monthly_stats）, `admin/billing`（customers）, `staff/supply-order`, `staff/dashboard`（customers）, `useDestinations`, `useInspectionSettings` 等。

`src/lib/firebase/customer-user.ts` は portal Auth / customerUsers 移行用の未commit WIP が存在する場合があるが、現行mainの repository migration 完了範囲には含めない。

---

## 5. 次フェーズ候補（将来課題）

優先度は将来の必要性を見て再判断する。

### 読み取り最適化

- **`tank-trace.ts` の repository 経由化**: 4 箇所の logs 読み取りを `logsRepository` 内部呼び出しに寄せる。設計上 service 層の独立は維持しつつ、SDK 直接利用だけ集約する
- **tanks 全件取得の onSnapshot 化**: `useTanks` の `getTanks()` 全件をリアルタイム購読へ。`listenTanks` の本実装が前提
- **listen 系の本実装**: `listenLogsByTank` / `listenRecentLogs` / `listenOrders` / `listenReturnApprovals` の onSnapshot 実装。リアルタイム反映が必要な画面の判定が前提
- **tanks 単一取得のバッチ化**: `useReturnApprovals.fulfillReturns` の N 件並列 `getTank` を `getTanksByIds`（`documentId() in [...]` 分割クエリ）に集約。「存在しない tankId をエラーで弾く」既存挙動の維持には差分集合チェックが必要
- **`getPendingTransactions({ statuses })` のガード**: `statuses: []`（空配列）や 10 件超で Firestore の `in` 句がエラーになる。再利用が増えるタイミングで「空配列の早期 return」「10件超の分割」のガード追加

### 書き込み系の repository 化（Phase 3 想定）

- `transactionsRepository.createTransaction` / `updateTransaction` / `updateTransactionInBatch` / `markOrderApproved` / `markOrderCompletedInBatch` の本実装
- `tanksRepository.updateTankFields` / `updateTankFieldsInBatch` の本実装（`useBulkReturnByLocation.updateTag` 等で利用）
- `logs` への直接書き込み（`src/app/staff/order/page.tsx` の非タンク order log 等）の判定方針

### API 仕様の追加

- **`since` オプションの統一実装**: `getOrders` / `getReturns` / `getPendingTransactions` の `since` を一括対応。「`createdAt` / `updatedAt` / `timestamp` のどれを境界にするか」の判断含む
- **`getActiveLogs` の `to` 期間指定**: `from` だけでなく `to` も実機運用で使うか確認

### データモデル改善

- **portal の貸出中タンク取得を `customerId` 参照に**: 現状 `tanks.location == customerName` の文字列マッチに依存している。`destinations` は廃止済みのため名寄せには使わない。`tanks` 側に `customerId` を持たせるか、`customers.name` と `location` の文字列マッチ継続を判断する
- **`admin/sales` の monthly_stats 統合**: 現状 limit 3000 の active logs をクライアント集計。`monthly_stats` を主データソースに、または `getActiveLogs({ from, to })` で対象月のみ取得し、3000 件上限による集計欠損リスクを除去

---

## Archived Notes

ここから下は Phase 2-A 棚卸し時 / Phase 2-B 着手前 / Phase 2-B-N 進捗ログ など、上記サマリと重複する歴史的なメモ。整理の都合で残してあるが、最新の状態は上記 1〜5 を参照すること。

### A1. Phase 2-A 当初の棚卸しテーブル

調査範囲:
- 対象ディレクトリ: `src/app/`, `src/components/`, `src/hooks/`, `src/lib/`
- 対象コレクション: `tanks` / `logs` / `transactions`
- 対象操作: 読み取りのみ（`getDoc` / `getDocs` / `onSnapshot` / `query` の実行）
- 書き込み（`addDoc` / `updateDoc` / `setDoc` / `deleteDoc` / `writeBatch` / `runTransaction`）は除外

#### tanks 読み取り（7件）

| # | ファイルパス | 場所 | 使用 API | 性質 | 置き換え候補 |
|---|---|---|---|---|---|
| T1 | `src/hooks/useTanks.ts` | L35 | `getDocs(collection)` 全件 | 表示用 | `tanksRepository.getTanks()` |
| T2 | `useReturnApprovals.ts` | L95 | `getDoc(doc, tankId)` | 業務操作 | `tanksRepository.getTank(tankId)` |
| T3 | `useBulkReturnByLocation.ts` | L34 | `getDocs(query, status in [LENT, UNRETURNED])` | 業務操作 | `tanksRepository.getTanks({ statusIn })` |
| T4 | `src/app/portal/page.tsx` | L24 | `getDocs(query, location==X, status=="貸出中")` | 表示用 | `tanksRepository.getTanks({ location, status })` |
| T5 | `src/app/portal/return/page.tsx` | L51 | 同 T4 | 表示用 | 同 T4 |
| T6 | `src/app/portal/unfilled/page.tsx` | L42 | 同 T4 | 表示用 | 同 T4 |
| T7 | `src/app/admin/page.tsx` | L43 | `getDocs(query, status=="貸出中")` | 表示用 | `tanksRepository.getTanks({ status })` |

#### logs 読み取り（8件 + tank-trace 4件）

| # | ファイルパス | 場所 | 使用 API | 性質 | 置き換え候補 |
|---|---|---|---|---|---|
| L1 | `admin/billing/page.tsx` | L22 | `getDocs(query, logStatus=="active", orderBy timestamp desc)` | 表示用 | `getActiveLogs()` |
| L2 | `admin/sales/page.tsx` | L27 | 同 L1 + `limit(3000)` | 表示用 | 同 |
| L3 | `staff/mypage/page.tsx` | L23 | 同 L1 + `limit(100)` | 表示用 | 同 |
| L4 | `admin/staff-analytics/page.tsx` | L17 | 同 L1 | 表示用 | 同 |
| L5 | `admin/page.tsx` | L39 | `getDocs(query, logStatus=="active", timestamp >= today)` | 表示用 | `getActiveLogs({ from })` |
| L6 | `portal/page.tsx` | L29 | `getDocs(query, logStatus=="active", location==X, orderBy timestamp desc, limit 30)` | 表示用 | `getActiveLogs({ location, limit })` |
| L7 | `staff/dashboard/page.tsx` | L139 | `getDocs(query, logStatus=="active")` | 表示用 | `getActiveLogs()` |
| L8 | `staff/dashboard/page.tsx` | L495 | `getDocs(query, rootLogId==X)` | 表示用 | `getLogsByRoot(rootLogId)` |
| — | `tank-trace.ts` | L64, L118, L171, L220 | 各種 logs クエリ | service層 | **後回し** |

#### transactions 読み取り（6件）

| # | ファイルパス | 場所 | 使用 API | 性質 | 置き換え候補 |
|---|---|---|---|---|---|
| X1 | `useOrderFulfillment.ts` | L67 | `getDocs(query, type=="order", status==X)` | 表示用 | `getOrders({ status })` |
| X2 | `useReturnApprovals.ts` | L44 | `getDocs(query, type=="return", status=="pending_approval")` | 表示用 | `getReturns({ status })` |
| X3 | `admin/page.tsx` | L48 | `getDocs(query, status in ["pending","pending_approval"])` | 表示用 | `getPendingTransactions()` |
| X4 | `staff/dashboard/page.tsx` | L145 | `getDocs(query, type=="order", status=="pending")` | 表示用 | `getOrders({ status:"pending" })` |
| X5 | `staff/dashboard/page.tsx` | L152 | `getDocs(query, type=="return", status=="pending_approval")` | 表示用 | `getReturns({ status })` |
| X6 | `admin/settings/page.tsx` | L524 | `getDocs(query, createdByUid==uid, status=="pending_link")` | 業務操作 | `findPendingLinksByUid(uid)` |

### A2. Phase 2-B 発注順（当初計画）

ユーザー指示で確定した順序:

#### 前半（tanks / logs 読み取り中心）
- **2-B-1**: `useTanks.ts` — `tanksRepository.getTanks()` 本実装
- **2-B-2**: `admin/billing/page.tsx` — `logsRepository.getActiveLogs()` 本実装
- **2-B-3**: `staff/mypage/page.tsx` — limit 100
- **2-B-4**: `admin/sales/page.tsx` — limit 3000
- **2-B-5**: `admin/staff-analytics/page.tsx`
- **2-B-6**: portal 3画面の tanks 重複クエリ統一

#### 後半（transactions / 残り logs / 複合画面）
- **2-B-7**: `useOrderFulfillment.ts` — `getOrders()` 本実装
- **2-B-8a**: `useReturnApprovals.fetchApprovals` — `getReturns()` 本実装
- **2-B-8b**: `useReturnApprovals.fulfillReturns` — `getTank()` 本実装
- **2-B-9**: `admin/page.tsx` — 3コレクション同時 + `getPendingTransactions()` 本実装
- **2-B-10a**: `staff/dashboard.fetchData`
- **2-B-10b**: `staff/dashboard.toggleHistory` — `getLogsByRoot()` 本実装
- **2-B-11**: `useBulkReturnByLocation.ts` — `statusIn` 実機運用
- **2-B-12**: `admin/settings.saveCustomerUsers` — `findPendingLinksByUid()` 本実装

### A3. Phase 2-B 各回の詳細進捗ログ

各フェーズの実装ノートは `progress.md` の該当エントリに集約済み。詳細はそちらを参照。
（コミット履歴: `b8f5843` / `1015c37` / `9730838` / `e3bfd37` / `1f186ae` / `fefcb5f` / `110df60` / `d97b63b` ほか）

特筆事項:
- **2-B-7**: `useOrderFulfillment.fetchOrders` は当初想定の単一 status クエリではなく、3 status (`pending` / `pending_approval` / `approved`) の `Promise.all` 並列構造に変わっていた。並列構造を維持したまま各要素を `getOrders({ status })` に置換
- **2-B-8a**: `PendingReturn` への正規化は features 層の責任とし、repository には持ち込まない方針を確立
- **2-B-10a**: `toLogDoc` を「生データのスプレッド + LogDoc 必須フィールドの明示変換上書き」形に修正し、`originalAt` / `prevTankSnapshot` 等の追加フィールドを保持できるようにした
- **2-B-12**: 書き込み近接のため、読み取り置換に伴い `batch.update(d.ref, ...)` → `batch.update(doc(db, "transactions", item.id), ...)` の参照先表記のみ touch（書き込み payload は完全維持）

### A4. Phase 2-A 当初の「やらないこと」

Phase 2-A 棚卸し時点で明示していた制約。Phase 2-B でも踏襲した。

- 既存コードの変更（読み取りも書き込みも） — Phase 2-A 棚卸し中は守った。Phase 2-B では計画通り段階置換
- 設計書（`data-layer-design.md`）への追記 — Phase 2-B でも仕様変更は最小限
- repository 関数の実装 — Phase 1 のまま `throw "not implemented"` で放置 → Phase 2-B で必要分だけ本実装
- `tank-trace.ts` のリファクタ — 後回し方針を維持
- logs / transactions / tanks の **書き込み** 経路の置き換え — Phase 3 以降

### A5. Phase 1 関数候補に対する追加提案（着手時メモ）

Phase 2-B 着手時点の検討メモ。実際の実装結果は上記 2 章を参照。

#### tanksRepository
- `getTanks(options)` の `options` に `status` / `location` / `statusIn` を持たせる必要あり
- 候補シグネチャ: `getTanks(options?: { status?: string; location?: string; statusIn?: string[] })`
  → 実装: `prefix` も追加され、4 オプションで確定

#### logsRepository
- `getLogsInRange(options)` の `options` に `activeOnly` / `limit` / `orderBy` を持たせる
- 新規候補: `getActiveLogsByLocation(location, limit?)` — portal/page 用
  → 実装: `getActiveLogs({ from, to, location, limit })` 1 本に集約。`getLogsByRoot` も本実装

#### transactionsRepository
- 新規候補: `getPendingTransactions()` — orders + returns 横断（admin/page 用）
  もしくは画面側で `getOrders({status:"pending"})` と `getReturns({status:"pending_approval"})` を Promise.all
  → 実装: `getPendingTransactions({ statuses })` で type 横断 status `in` 配列
- 新規候補: `findPendingLinksByUid(uid)` — admin/settings の特殊条件用
  → 実装: そのまま採用

### A6. Phase 2-B-1 のスコープ（厳守事項、当時メモ）

- 対象は `src/hooks/useTanks.ts` 1ファイルのみ
- 本実装するのは `tanksRepository.getTanks` 1 関数のみ
- `GetTanksOptions` 型に `statusIn?: string[]` を**型定義のみ追加**（Phase 2-B-11 で実際に使う準備）
- `logsRepository` / `transactionsRepository` には触らない
