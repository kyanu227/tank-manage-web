# Data Layer Migration Plan — Phase 2-A: 読出し系の棚卸し

`tanks` / `logs` / `transactions` の **読み取り** に絞って、画面・hooks・lib に散らばっている直接 Firestore アクセスを棚卸ししたもの。

実装には進まない。Phase 2-B 以降の置き換え発注のための材料。

## 調査範囲

- 対象ディレクトリ: `src/app/`, `src/components/`, `src/hooks/`, `src/lib/`
- 対象コレクション: `tanks` / `logs` / `transactions`
- 対象操作: **読み取りのみ**（`getDoc` / `getDocs` / `onSnapshot` / `query` の実行）
- 書き込み（`addDoc` / `updateDoc` / `setDoc` / `deleteDoc` / `writeBatch` / `runTransaction`）は除外

## 対象外（明示）

| ファイル | 理由 |
|---|---|
| `src/lib/tank-operation.ts` | 業務ハブ。Phase 2-A 対象外 |
| `src/features/procurement/lib/submitTankEntryBatch.ts` | 業務バッチ。対象外 |
| `src/lib/firebase/repositories/types.ts` | Phase 1 で作成した骨組み |
| `src/lib/firebase/{config,diff-write,customer-destination,customer-user,staff-auth}.ts` | tanks/logs/transactions 以外を扱う |
| `src/lib/order-types.ts` | 型定義のみ（type import） |
| `src/hooks/useInspectionSettings.ts` / `src/features/staff-operations/hooks/useDestinations.ts` | settings / destinations を扱う |
| その他 admin/portal の他コレクション操作画面 | customers / staff / settings / priceMaster / rankMaster / notifySettings 等 |

`src/lib/tank-trace.ts` は **調査対象に含める** が、置き換えはまだ行わない（独立維持）。

---

## 棚卸し一覧

### tanks 読み取り（7件）

| # | ファイルパス | 場所 | 使用 API | 性質 | 移行容易性 | 優先度 | 置き換え候補 |
|---|---|---|---|---|---|---|---|
| T1 | `src/hooks/useTanks.ts` | L35 | `getDocs(collection)` 全件 | 表示用（全ページの tanks 一覧） | **高**（最も単純） | **高** | `tanksRepository.getTanks()` |
| T2 | `src/features/staff-operations/hooks/useReturnApprovals.ts` | L95 | `getDoc(doc, tankId)` | 業務操作（返却承認時の現在状態確認） | **高** | 中 | `tanksRepository.getTank(tankId)` |
| T3 | `src/features/staff-operations/hooks/useBulkReturnByLocation.ts` | L34 | `getDocs(query, status in [LENT, UNRETURNED])` | 業務操作（一括返却対象抽出） | 中（statusIn フィルタ要） | 中 | `tanksRepository.getTanks({ statusIn: [...] })` ※拡張 |
| T4 | `src/app/portal/page.tsx` | L24 | `getDocs(query, location==X, status=="貸出中")` | 表示用（顧客の貸出状況） | **高** | **高** | `tanksRepository.getTanks({ location, status })` ※拡張 |
| T5 | `src/app/portal/return/page.tsx` | L51 | 同 T4 | 表示用（返却対象選択画面） | **高** | **高** | 同 T4 |
| T6 | `src/app/portal/unfilled/page.tsx` | L42 | 同 T4 | 表示用（未充填報告画面） | **高** | **高** | 同 T4 |
| T7 | `src/app/admin/page.tsx` | L43 | `getDocs(query, status=="貸出中")` | 表示用（管理ダッシュボード集計） | **高** | 中 | `tanksRepository.getTanks({ status })` ※拡張 |

### logs 読み取り（8件 + tank-trace 4件）

| # | ファイルパス | 場所 | 使用 API | 性質 | 移行容易性 | 優先度 | 置き換え候補 |
|---|---|---|---|---|---|---|---|
| L1 | `src/app/admin/billing/page.tsx` | L22 | `getDocs(query, logStatus=="active", orderBy timestamp desc)` | 表示用（請求書ベース） | **高** | **高** | `logsRepository.getLogsInRange()` ※拡張 or 新規 `getActiveLogs(options)` |
| L2 | `src/app/admin/sales/page.tsx` | L27 | 同 L1 + `limit(3000)` | 表示用（売上集計） | **高** | **高** | 同 L1 |
| L3 | `src/app/staff/mypage/page.tsx` | L23 | 同 L1 + `limit(100)` | 表示用（スタッフ実績） | **高** | **高** | 同 L1 |
| L4 | `src/app/admin/staff-analytics/page.tsx` | L17 | 同 L1 | 表示用（実績ランキング） | **高** | 中 | 同 L1 |
| L5 | `src/app/admin/page.tsx` | L39 | `getDocs(query, logStatus=="active", timestamp >= today)` | 表示用（管理ダッシュボード） | **高** | 中 | `logsRepository.getLogsInRange({ from })` |
| L6 | `src/app/portal/page.tsx` | L29 | `getDocs(query, logStatus=="active", location==X, orderBy timestamp desc, limit 30)` | 表示用（顧客ログ） | 中（location filter 要） | 中 | 新候補 `getActiveLogsByLocation(location, limit)` |
| L7 | `src/app/staff/dashboard/page.tsx` | L139 | `getDocs(query, logStatus=="active")` | 表示用（ダッシュボードログ一覧） | **高** | 中 | `logsRepository.getLogsInRange()` ※拡張 |
| L8 | `src/app/staff/dashboard/page.tsx` | L495 | `getDocs(query, rootLogId==X)` | 表示用（履歴ドリルダウン） | **高** | 中 | `logsRepository.getLogsByRoot(rootLogId)` |
| — | `src/lib/tank-trace.ts` | L64, L118, L171, L220 | 各種 logs クエリ | 業務追跡（service層） | 中 | **後回し** | 内部で `logsRepository` を呼ぶ形に書き換える方向で別タスク |

### transactions 読み取り（6件）

| # | ファイルパス | 場所 | 使用 API | 性質 | 移行容易性 | 優先度 | 置き換え候補 |
|---|---|---|---|---|---|---|---|
| X1 | `src/features/staff-operations/hooks/useOrderFulfillment.ts` | L67 | `getDocs(query, type=="order", status==X)` | 表示用（受注一覧） | **高** | **高** | `transactionsRepository.getOrders({ status })` |
| X2 | `src/features/staff-operations/hooks/useReturnApprovals.ts` | L44 | `getDocs(query, type=="return", status=="pending_approval")` | 表示用（返却承認待ち一覧） | **高** | **高** | `transactionsRepository.getReturns({ status })` |
| X3 | `src/app/admin/page.tsx` | L48 | `getDocs(query, status in ["pending","pending_approval"])` | 表示用（要対応件数） | 中（type 横断） | 中 | 新候補 `transactionsRepository.getPendingTransactions()` or `getOrders+getReturns` の和 |
| X4 | `src/app/staff/dashboard/page.tsx` | L145 | `getDocs(query, type=="order", status=="pending")` | 表示用（保留オーダー数） | **高** | 中 | `transactionsRepository.getOrders({ status:"pending" })` |
| X5 | `src/app/staff/dashboard/page.tsx` | L152 | `getDocs(query, type=="return", status=="pending_approval")` | 表示用（承認待ち数） | **高** | 中 | `transactionsRepository.getReturns({ status:"pending_approval" })` |
| X6 | `src/app/admin/settings/page.tsx` | L524 | `getDocs(query, createdByUid==uid, status=="pending_link")` | 業務操作（顧客リンク保存処理に付随） | 低（特殊条件） | 低 | 新候補 `transactionsRepository.findPendingLinksByUid(uid)` |

---

## 集計サマリ

- tanks 読取: **7件** / logs 読取: **8件** / transactions 読取: **6件**
- tank-trace.ts 内部 logs 読取: 4箇所（後回し）
- 合計: **21件**（tank-trace を除く）

## 推奨置き換え順（Phase 2-B 以降の発注順・ユーザー確定）

ユーザー指示で確定した順序。Phase 2-B-N の発注単位を明記する。

### 前半（tanks / logs 読み取り中心）

- **Phase 2-B-1**: `src/hooks/useTanks.ts` — 全件取得 1箇所。最小単位で repository 化のテストケース。**この発注で `tanksRepository.getTanks()` を本実装する**
- **Phase 2-B-2**: `src/app/admin/billing/page.tsx` — logs 読み取り（`logStatus=="active"`）。`logsRepository.getActiveLogs()` または `getLogsInRange({ activeOnly: true })` 本実装の発注を兼ねる
- **Phase 2-B-3**: `src/app/staff/mypage/page.tsx` — logs 読み取り、limit 100
- **Phase 2-B-4**: `src/app/admin/sales/page.tsx` — logs 読み取り、limit 3000
- **Phase 2-B-5**: `src/app/admin/staff-analytics/page.tsx` — logs 読み取り
- **Phase 2-B-6**: portal の tanks(location + 貸出中) 重複クエリ統一 — `src/app/portal/page.tsx` / `src/app/portal/return/page.tsx` / `src/app/portal/unfilled/page.tsx` の3ファイル同時発注。`tanksRepository.getTanks({ location, status })` で完全統一可能なため一括が効率的

### 後半（transactions 系・残りの logs / 複合画面）

- **Phase 2-B-7**: `src/features/staff-operations/hooks/useOrderFulfillment.ts` (L67のみ) — `transactionsRepository.getOrders({ status })` 本実装 ✅ 完了
  - 当初想定では「L67 の単一 status クエリ」を対象としていたが、着手時点の現状コードは既に `["pending", "pending_approval", "approved"]` を `Promise.all` で並列取得する3並列構造に変わっていた。
  - 既存条件（`type=="order"` × `status==X` の3並列）を変えない方針に従い、Promise.all 構造を維持したまま各要素を `transactionsRepository.getOrders({ status })` 呼び出しへ置換した。
  - `normalizeOrderDoc` の呼び出しはフックから外し、repository 内部に閉じ込めた（「正規化は境界で吸収する」設計書方針に合致）。
  - `getOrders` の `since` は今回未対応。Phase 後半で対応する旨を repository 側のコメントに残した。
  - 書き込み処理（`approveOrder` / `fulfillOrder` の `updateDoc` / `batch.update`）は据え置き。
  - 検証: `npx tsc --noEmit` 0エラー。
- **Phase 2-B-8**: `src/features/staff-operations/hooks/useReturnApprovals.ts` (L44, L95) — `transactionsRepository.getReturns({ status })` + `tanksRepository.getTank()`
  - **8a 完了**: `fetchApprovals` の transactions 読み取りを `transactionsRepository.getReturns({ status: "pending_approval" })` に置換した。
    - 既存条件 `where("type","==","return")` + `where("status","==","pending_approval")` は repository 内部に閉じ込めた形で完全維持（`type=="return"` は必須付与、`status` は options 経由）。
    - `PendingReturn` への正規化は repository に持ち込まず、呼び出し側で `as unknown as PendingReturn[]` のキャストにより吸収（features 層の型を repository に持ち込まない方針）。
    - グルーピング・ソート処理（customerId 単位の Map 集約、createdAt desc ソート）は一切変更していない。
    - `since` オプションは未対応。Phase 後半で対応する旨を repository コメントに明記。
    - 未使用となった `collection / getDocs / query / where` を import から除去。`doc / getDoc / serverTimestamp` は fulfillReturns（8b 範囲）で必要なため据え置き。
    - 検証: `npx tsc --noEmit --pretty false` が EXIT=0 で完了。
  - **8b 完了**: 同ファイル `fulfillReturns` 内（旧 L94-98）の `getDoc(doc(db, "tanks", item.tankId))` を `tanksRepository.getTank(item.tankId)` に置換した。
    - `tanksRepository.getTank` を本実装（`getDoc` → 不在なら `null` → 存在すれば TankDoc 変換）。TankDoc 変換は `getTanks` と DRY にするため `toTankDoc(snap)` ヘルパへ切り出し、両者で共有（既存 `getTanks` の挙動は完全維持）。
    - 既存の `Promise.all`（承認対象 N 件を 1件ずつ並列で tanks/{id} 取得する構造）は維持。`getTanksByIds` での一括取得は今回見送り（既存挙動・例外メッセージ維持を優先）→ 将来検討候補。
    - 「タンクが存在しません」エラーメッセージとフォーマット（`[${tankId}] タンクが存在しません`）は完全維持。`currentStatus` の値も `String(raw.status ?? "")` 経由で生成されるため従来と同値。
    - 書き込み処理（`applyBulkTankOperations` 呼び出しと `batch.update(doc(db, "transactions", ...))`）には一切触らず。`doc` / `serverTimestamp` import はその書き込みで必要なため据え置き。`getDoc` import は未使用となったため除去。
    - 検証: `npx tsc --noEmit --pretty false` が EXIT=0 で完了。
- **Phase 2-B-9**: `src/app/admin/page.tsx` — 3コレクション同時。`getPendingTransactions()` 候補の発注を兼ねる ✅ 完了
  - `transactionsRepository.getPendingTransactions({ statuses })` を新規実装した（type 横断 + `where("status","in", statuses)` のみ）。`type` フィルタは付けていない（type 横断クエリが本関数の存在意義）。既定 statuses は `["pending", "pending_approval"]`、`orderBy` / `limit` / `since` は付与なし。戻り値は `TransactionDoc[]`（`{ id, ...data }` キャストのみ。`PendingOrder` / `PendingReturn` への正規化はしない）。
  - 既存条件3つは完全維持: ①logs `where("logStatus","==","active")` + `where("timestamp",">=",todayStart)` → `logsRepository.getActiveLogs({ from: todayStart })`、②tanks `where("status","==","貸出中")` → `tanksRepository.getTanks({ status: STATUS.LENT })`、③transactions `where("status","in",["pending","pending_approval"])` → `transactionsRepository.getPendingTransactions({ statuses: ["pending","pending_approval"] })`。`Promise.all` の3並列構造も維持。
  - KPI 集計（`staffSet` Set 構築、`logs.length` / `tanks.length` / `pendingTxs.length` の件数算出、`setValues` への代入）は呼び出し側に残し、repository 側に count / aggregation を持ち込まない方針を維持。
  - `getOrders` / `getReturns` の仕様は不変。`queryByType` のような共通化はしていない。
  - `db` / `collection` / `getDocs` / `query` / `where` / `Timestamp` の直接 import を全て除去。代わりに `logsRepository` / `tanksRepository` / `transactionsRepository` / `STATUS` を import。
  - 検証: `npx tsc --noEmit` 0エラー。
- **Phase 2-B-10**: `src/app/staff/dashboard/page.tsx` — 大きい画面、logs/transactions 複数
- **Phase 2-B-11**: `src/features/staff-operations/hooks/useBulkReturnByLocation.ts` (L34) — `statusIn` 拡張が実際に必要になるタイミング
- **Phase 2-B-12**: `src/app/admin/settings/page.tsx` (L524) — `findPendingLinksByUid()` 特殊条件、最後

### Phase 2-B-1 のスコープ（厳守）

- 対象は `src/hooks/useTanks.ts` **1ファイルのみ**
- 本実装するのは `tanksRepository.getTanks` **1関数のみ**。他の tanks repository 関数は `throw "not implemented in Phase 1"` のまま据え置き
- `GetTanksOptions` 型に `statusIn?: string[]` を**型定義のみ追加**（Phase 2-B-11 で実際に使う準備）
- `logsRepository` / `transactionsRepository` には触らない

## Phase 1 関数候補に対する追加提案（設計書には未反映、Phase 2-B 着手時に判断）

### tanksRepository
- `getTanks(options)` の `options` に **`status` / `location` / `statusIn`** を持たせる必要あり
- 候補シグネチャ: `getTanks(options?: { status?: string; location?: string; statusIn?: string[] })`

### logsRepository
- `getLogsInRange(options)` の `options` に **`activeOnly` / `limit` / `orderBy`** を持たせる
- 新規候補: `getActiveLogsByLocation(location: string, limit?: number)` — portal/page.tsx 用
- 既存 `getLogsByRoot` は staff/dashboard L495 でそのまま使える

### transactionsRepository
- 新規候補: `getPendingTransactions()` — orders + returns 横断（admin/page.tsx 用）
  - もしくは画面側で `getOrders({status:"pending"})` と `getReturns({status:"pending_approval"})` を Promise.all で並列実行する形でもよい
- 新規候補: `findPendingLinksByUid(uid: string)` — admin/settings/page.tsx の特殊条件用

---

## 後回しにするもの（Phase 2-A の対象外、別タスク）

| 項目 | 理由 |
|---|---|
| `src/lib/tank-trace.ts` | 追跡・集計の service 層。`logsRepository` を内部で呼ぶ形へ後日リファクタ |
| 全ファイルの **書き込み系**（addDoc / updateDoc / setDoc / writeBatch / runTransaction） | Phase 3 以降の対象。`tank-operation.ts` 経由か `transactionsRepository` の write API かを個別判断 |
| `src/lib/tank-operation.ts` 内部の読み取り | Phase 4 で別判断 |
| `src/features/procurement/lib/submitTankEntryBatch.ts` | 業務バッチ。対象外 |

---

## 調査から気づいたアンチパターン・改善余地

- **active log + orderBy timestamp desc の重複**: L1〜L5 が似たクエリを各画面で個別に書いている。`logsRepository.getActiveLogs({ from?, to?, limit?, location? })` 1本にまとめると保守性が上がる
- **portal の tanks クエリ重複**: T4〜T6 が同一の `(location==X, status=="貸出中")` を別々に書いている。`tanksRepository.getTanks({ location, status })` で完全に統一可能
- **tanks 全件取得**: `useTanks.ts` は全件取得・全画面で共有。タンク数が増えると重い。Phase 2-B では現状動作維持で repository 化のみ行い、最適化（onSnapshot キャッシュ等）は別タスクで議論
- **status in 句の表現**: `statusIn` を options に入れるか、もっと業務寄りの名前（`getRentedTanks()` など）にするかは Phase 2-B 着手時に判断
- **将来候補（admin/sales）**: 月次売上画面は現状 limit 3000 の active ログを全件取得してクライアント側で日次集計している。
  将来的には以下のいずれかに寄せる候補:
  - **monthly_stats コレクション**を主データソースに（既に「過去の月間実績」タブが利用しているので統合余地あり）
  - **期間指定クエリ** `getActiveLogs({ from, to })` で対象月のみ取得し、3000件上限による集計欠損リスクを除去
  Phase 2-B-4 では既存挙動維持のため limit 3000 をそのまま維持した。
- **将来候補（portal の貸出中タンク取得）**: portal の貸出中タンク取得は `location` 文字列マッチ（`tanks.location == customerName`）に依存している。
  destinations と顧客名の整合がズレると取りこぼしが発生するため、将来的には `customerId` 参照（tanks 側に customerId を持たせる、もしくは destinations 経由で名寄せする）への移行を検討する。
  Phase 2-B-6 では既存挙動維持のため location 文字列マッチをそのままリポジトリ呼び出しに移植した。
- **将来候補（書き込み系の repository 化）**: `useReturnApprovals.fulfillReturns` などが `batch.update(doc(db, "transactions", ...))` で transactions の `status` / `fulfilledAt` / `fulfilledBy` を直接更新している。
  `transactionsRepository.updateTransactionInBatch` を本実装してこれを寄せる候補があるが、Phase 2-B は読み取り経路のみのスコープなので**別フェーズで扱う**。
- **将来候補（since オプションの統一実装）**: `getOrders` / `getReturns` の `GetOrdersOptions.since` / `GetReturnsOptions.since` は現状未対応のままコメントだけ残してある。
  「`createdAt` / `updatedAt` / `timestamp` のどれを境界にするか」を含めて、既存クエリ置換フェーズが終わってから一括検討する。
- **将来候補（tanks 単一取得のバッチ化）**: `useReturnApprovals.fulfillReturns` の N 件並列 `getTank` は、`tanksRepository.getTanksByIds` を本実装すれば 1〜数回の `documentId() in [...]` クエリに集約できる。
  ただし「存在しない tankId をエラーで弾く」既存挙動の維持には差分集合チェックが要るため、Phase 2-B-11（`statusIn` 実機運用）または読み取り最適化フェーズで再検討する。
- **将来候補（`getPendingTransactions({ statuses })` のガード）**: 現状の `getPendingTransactions` は呼び出し元（admin ダッシュボード）が `["pending","pending_approval"]` の2件固定なので問題ないが、将来別の呼び出し元が `statuses: []`（空配列）や 10 件超の配列を渡すと Firestore の `in` 句仕様でエラーになる。
  再利用が増えるタイミングで「空配列の早期 return」「10件超の分割クエリ」のガードを入れる検討が必要。今回は呼び出しが固定なので未対応のまま。

---

## 今回はやらないこと

- 既存コードの変更（読み取りも書き込みも）
- 設計書（`data-layer-design.md`）への追記
- repository 関数の実装（Phase 1 のまま `throw "not implemented"`）
- tank-trace.ts のリファクタ
- logs / transactions / tanks の **書き込み** 経路の置き換え
