# Phase 2 進捗

## TankSnapshot 型追加 / tanks.latestLogId 導入 完了
- 変更ファイル: src/lib/tank-operation.ts, src/lib/tank-types.ts
- 内容: TankSnapshot を export し、TankDoc に latestLogId?: string | null を追加した。

## 新規ログ書き込み経路刷新 完了
- 変更ファイル: src/lib/tank-operation.ts
- 内容: applyTankOperation / applyBulkTankOperations を runTransaction 化し、active revision v1 と latestLogId を原子的に書く経路へ更新した。

## applyLogCorrection（Case A 同一 tankId） 完了
- 変更ファイル: src/lib/tank-operation.ts
- 内容: 同一タンク編集で旧 prevTankSnapshot を継承し、supersedes チェーンの新 active revision を作る処理を追加した。

## applyLogCorrection（Case B tankId 変更） 完了
- 変更ファイル: src/lib/tank-operation.ts
- 内容: oldTank を prev snapshot に復元し、newTank の現在 snapshot から新 revision を作る処理を追加した。

## voidLog 刷新 完了
- 変更ファイル: src/lib/tank-operation.ts
- 内容: voided boolean / delete_history を廃止し、active 最新ログだけを voided にして prevTankSnapshot へ復元する transaction 処理へ更新した。

## Dashboard ログ一覧 / 編集モーダル 完了
- 変更ファイル: src/app/staff/dashboard/page.tsx
- 内容: active ログ一覧を originalAt desc で取得し、PrefixNumberPicker と transitionAction ベースの編集モーダルへ置き換えた。

## Dashboard 取消モーダル / 履歴展開 完了
- 変更ファイル: src/app/staff/dashboard/page.tsx
- 内容: 取消理由必須モーダル、rootLogId 履歴展開、過去 revision への復元処理を追加した。

## logs active フィルタ更新 完了
- 変更ファイル: src/lib/tank-trace.ts, src/app/admin/billing/page.tsx, src/app/admin/sales/page.tsx, src/app/admin/staff-analytics/page.tsx, src/app/admin/page.tsx, src/app/portal/page.tsx, src/app/staff/mypage/page.tsx
- 内容: 通常表示・集計・追跡の logs 取得に where("logStatus", "==", "active") を追加した。

## 非タンクログ分離 完了
- 変更ファイル: src/app/staff/order/page.tsx
- 内容: 資材発注ログに logStatus: "active" と logKind: "order" を付与し、tank snapshot を持つログと分離した。

## Firestore index 確認事項 完了
- 変更ファイル: progress.md
- 内容: 必要になる可能性が高い index は logs(logStatus, originalAt desc), logs(logStatus, timestamp desc), logs(rootLogId, revision asc), logs(logStatus, tankId, timestamp desc), logs(logStatus, tankId, action, timestamp desc)。

## tsc 通過 完了
- 変更ファイル: なし
- 内容: npx tsc --noEmit --pretty false がエラーゼロで完了した。

## build 安定化 完了
- 変更ファイル: src/app/layout.tsx, package.json
- 内容: build 時の Google Fonts 取得と Turbopack sandbox bind 問題を避けるため、system font fallback と webpack build を明示した。

## build 通過 完了
- 変更ファイル: なし
- 内容: npm run build が成功し、全 32 route の静的生成が完了した。

## Phase 2-B-6 portal tanks 重複クエリ統一 完了
- 変更ファイル: src/app/portal/page.tsx, src/app/portal/return/page.tsx, src/app/portal/unfilled/page.tsx, docs/data-layer-migration-plan.md
- 内容: 3画面で重複していた tanks(location==customerName, status=="貸出中") の直接クエリを `tanksRepository.getTanks({ location, status: STATUS.LENT })` に統一した。"貸出中" 文字列リテラルは STATUS.LENT へ置換、未使用となった getDocs/query/where を import から除去。
- 検証: npx tsc --noEmit --pretty false が EXIT=0 で完了。
- メモ: location 文字列マッチ依存の改善案（customerId 参照化）を data-layer-migration-plan.md に追記。

## Phase 2-B-7 transactionsRepository.getOrders 本実装 / useOrderFulfillment 置換 完了
- 変更ファイル: src/lib/firebase/repositories/transactions.ts, src/features/staff-operations/hooks/useOrderFulfillment.ts, docs/data-layer-migration-plan.md
- 内容: `transactionsRepository.getOrders({ status, customerId })` を `where("type","==","order")` 必須付きで本実装し、normalizeOrderDoc を repository 内部に閉じ込めた。`useOrderFulfillment.fetchOrders` は3 status の Promise.all 構造を維持したまま `getOrders({ status })` 呼び出しへ置換、未使用の collection/getDocs/query/where 及び normalizeOrderDoc import を除去。書き込み処理（approveOrder / fulfillOrder）は据え置き。
- 検証: npx tsc --noEmit --pretty false が EXIT=0 で完了。
- メモ: `getOrders` の `since` は未実装、Phase 後半で対応する旨を repository コメントに残した。

## Phase 2-B-8a transactionsRepository.getReturns 本実装 / useReturnApprovals.fetchApprovals 置換 完了
- 変更ファイル: src/lib/firebase/repositories/transactions.ts, src/features/staff-operations/hooks/useReturnApprovals.ts, docs/data-layer-migration-plan.md
- 内容: `transactionsRepository.getReturns({ status, customerId })` を `where("type","==","return")` 必須付きで本実装。`useReturnApprovals.fetchApprovals` の直接クエリを `getReturns({ status: "pending_approval" })` に置換し、`PendingReturn` 化はフック側の `as unknown as PendingReturn[]` キャストで吸収（正規化は features 層の責任を維持）。グルーピング・ソート処理は無変更。fulfillReturns（tanks 読取・transactions 更新含む）は 8b 範囲のため未着手。未使用となった collection/getDocs/query/where を import から除去、doc/getDoc/serverTimestamp は fulfillReturns で使用継続のため据え置き。
- 検証: npx tsc --noEmit --pretty false が EXIT=0 で完了。
- メモ: `getReturns` の `since` は未実装、Phase 後半で対応する旨を repository コメントに残した。

## Phase 2-B-8b tanksRepository.getTank 本実装 / useReturnApprovals.fulfillReturns の tanks 読取置換 完了
- 変更ファイル: src/lib/firebase/repositories/tanks.ts, src/features/staff-operations/hooks/useReturnApprovals.ts, docs/data-layer-migration-plan.md
- 内容: `tanksRepository.getTank(tankId)` を本実装（getDoc → 不在なら null → 存在すれば TankDoc 変換）。TankDoc 変換は getTanks と共有するため `toTankDoc(snap)` ヘルパに切り出し（getTanks 既存挙動は完全維持）。`useReturnApprovals.fulfillReturns` 内で承認直前に行っていた `getDoc(doc(db,"tanks",item.tankId))` を `tanksRepository.getTank(item.tankId)` へ置換し、Promise.all による N 件並列取得構造と「タンクが存在しません」エラーメッセージを完全維持。書き込み処理（applyBulkTankOperations 呼び出し / batch.update(doc(db,"transactions",...))）には一切触らず。未使用となった getDoc import を除去、doc / serverTimestamp は書き込みで使用継続のため据え置き。
- 検証: npx tsc --noEmit --pretty false が EXIT=0 で完了。
- メモ: 1件ずつの並列取得を `getTanksByIds` での一括取得に置き換える案は今回見送り（既存挙動・例外メッセージ維持を優先）→ 将来検討候補として進行表に記録。

## Phase 2-B-9 admin/page.tsx 3コレクション読取の repository 化 / getPendingTransactions 本実装 完了
- 変更ファイル: src/lib/firebase/repositories/transactions.ts, src/app/admin/page.tsx, docs/data-layer-migration-plan.md
- 内容: `transactionsRepository.getPendingTransactions({ statuses })` を新規実装（type 横断、`where("status","in", statuses)` のみ。type フィルタは付けない、orderBy/limit/since も付けない、戻り値は TransactionDoc[] の生キャスト）。`admin/page.tsx` の3直接クエリ（logs: logStatus=="active"+timestamp>=todayStart / tanks: status=="貸出中" / transactions: status in ["pending","pending_approval"]）を `logsRepository.getActiveLogs({ from: todayStart })` / `tanksRepository.getTanks({ status: STATUS.LENT })` / `transactionsRepository.getPendingTransactions({ statuses: [...] })` に置換。Promise.all 3並列構造、staffSet 集計、length ベースの件数算出、setValues、loading state、CARD_DEFS / JSX は無変更。db/collection/getDocs/query/where/Timestamp の直接 import を全て除去。書き込み処理は追加なし。`getOrders` / `getReturns` の仕様は不変。
- 検証: npx tsc --noEmit --pretty false が EXIT=0 で完了。
- メモ: `getPendingTransactions` の `since` は未実装、Phase 後半で検討する。

## Phase 2-B-10a staff/dashboard fetchData の logs / orders / returns 読取置換 / toLogDoc 生データ保持化 完了
- 変更ファイル: src/lib/firebase/repositories/logs.ts, src/app/staff/dashboard/page.tsx, docs/data-layer-migration-plan.md
- 内容: `staff/dashboard/page.tsx` の `fetchData` 内 3 つの直接クエリ（logs: `where("logStatus","==","active")` / orders: `where("type","==","order")`+`where("status","==","pending")` / returns: `where("type","==","return")`+`where("status","==","pending_approval")`）を `logsRepository.getActiveLogs()` / `transactionsRepository.getOrders({ status: "pending" })` / `transactionsRepository.getReturns({ status: "pending_approval" })` に置換。Promise.all の 4 並列構造（logs / orders / returns / customers）は維持、customers の `getDocs(collection(db, "customers"))` はスコープ外として未変更。`LogDoc` → `LogEntry` 変換は `as unknown as LogEntry[]` キャストで吸収（dashboard 固有の整形を repository に持ち込まない方針を維持、Phase 2-B-8a の PendingReturn と同パターン）。`originalAt ?? timestamp` 降順ソート・`slice(0, 50)`・`customerDestinations` 集約・`pendingOrders/pendingReturns` への `length` 代入は呼び出し側に維持。`pendingOrders/pendingReturns` は `.size` → `.length` のみ変更（意味等価）。`logs.ts` の `toLogDoc` は LogDoc 宣言フィールドのみを列挙する形から「生データを `Partial<LogDoc>` でスプレッド + LogDoc 必須フィールドを明示変換で上書き」する形に変更し、Firestore ドキュメントが持つ追加フィールド（`originalAt` / `prevTankSnapshot` / `nextTankSnapshot` / `transitionAction` / `logNote` / `editedBy` / `voidedBy` / `voidReason` / `voidedAt` 等）を保持。これにより dashboard の `originalAt` ベースのソートが repository 経由でも従来通り機能する。既存呼び出し元（admin/billing, staff/mypage, admin/sales, admin/staff-analytics, admin/page）は LogDoc 宣言フィールドのみ参照しているため追加フィールドが残っても影響なし。toggleHistory（L479-486、10b 範囲）は未着手のため `query` / `where` import は据え置き。書き込み処理（applyLogCorrection / voidLog / handleBulkLocationChange / handleBulkVoid）には一切触らず。LogEntry 型・JSX・useMemo/useEffect 群・`useTanks` / `useInspectionSettings` / `useStaffSession` も未変更。
- 検証: npx tsc --noEmit --pretty false が EXIT=0 で完了。
- メモ: toggleHistory（rootLogId logs 読取）の置換は Phase 2-B-10b で別作業。`logsRepository.getActiveLogs` の `since` 系オプションは未対応のまま。

## Phase 2-B-10b logsRepository.getLogsByRoot 本実装 / staff/dashboard toggleHistory の logs 読取置換 完了
- 変更ファイル: src/lib/firebase/repositories/logs.ts, src/app/staff/dashboard/page.tsx, docs/data-layer-migration-plan.md
- 内容: `getLogsByRoot(rootLogId)` を `where("rootLogId","==",rootLogId)` のみのシンプル本実装（orderBy/limit なし、`toLogDoc` 経由）。`staff/dashboard/page.tsx` の `toggleHistory` 内で行っていた直接クエリを `logsRepository.getLogsByRoot(rootId)` に置換し、`as unknown as LogEntry[]` キャストで型を吸収。`expandedRootId` の早期 return、`historyByRoot` キャッシュ、`historyLoadingRoot` ローディング状態、"履歴取得エラー: " エラーメッセージ、`revision` 昇順ソートは完全維持。10a で残置していた `query` / `where` import を除去（`collection` / `getDocs` は customers 読取で必要なため残置）。書き込み処理（applyLogCorrection / voidLog / handleBulkLocationChange / handleBulkVoid）・customers 読取・useMemo/useEffect 群・JSX には一切触らず。
- 検証: npx tsc --noEmit --pretty false が EXIT=0 で完了。

## Phase 2-B-11 useBulkReturnByLocation fetchBulkTanks の tanks 読取置換 完了
- 変更ファイル: src/features/staff-operations/hooks/useBulkReturnByLocation.ts, docs/data-layer-migration-plan.md
- 内容: `fetchBulkTanks` の直接クエリ（`status in [LENT, UNRETURNED]`）を `tanksRepository.getTanks({ statusIn: [STATUS.LENT, STATUS.UNRETURNED] })` に置換。既存 `statusIn` 実装を利用し、新規 repository 関数追加なし。TankDoc → BulkTankWithTag は呼び出し側の `as unknown as` キャストで吸収し、tag 推定・location グルーピング・id ソート・expanded 初期化は維持。
- メモ: `updateTag` / `handleBulkReturnForLocation` / `applyBulkTankOperations` には触らず、`getTanksByIds` も本実装していない。
- 検証: npx tsc --noEmit が EXIT=0 で完了。

## Phase 2-B-10a リグレッション修正 staff/dashboard ログ取りこぼし 完了
- 変更ファイル: src/lib/firebase/repositories/logs.ts, src/app/staff/dashboard/page.tsx, docs/phase-2-b-verification.md
- 症状: 本番デプロイ後、staff/dashboard のログ一覧に一部のログが表示されない（特に `originalAt` を主軸に持つ revision ログ）。
- 原因: Phase 2-B-10a で導入した `logsRepository.getActiveLogs()` が `orderBy("timestamp", "desc")` を必須付与しており、Firestore 仕様（orderBy 指定フィールドが存在しないドキュメントは結果から除外）により、`timestamp` を持たない active ログが取得対象から漏れていた。元の dashboard コードは orderBy なし全件取得 → クライアント側で `originalAt ?? timestamp` で再ソートしていた。
- 修正: `GetActiveLogsOptions` に `orderBy?: "timestamp" | null` を追加し、`null` 指定時のみ `orderBy` を付与しないように変更。`staff/dashboard.fetchData` の呼び出しを `getActiveLogs({ orderBy: null })` に変えて元挙動を復元。
- 影響範囲: dashboard のみ。他の `getActiveLogs` 呼び出し（admin/billing, staff/mypage, admin/sales, admin/staff-analytics, admin/page, portal/page）は引数を変えていないので既定の `orderBy("timestamp", "desc")` が維持され、挙動変更なし。
- 触らず: タグ付き返却処理、tank-operation.ts、tank-trace.ts、書き込み系。
- 検証: npx tsc --noEmit が EXIT=0 で完了。本番再デプロイ後の最終確認はユーザー実施予定。

## admin layout ヘッダー削除 / サイドバー整理 完了
- 変更ファイル: src/app/admin/layout.tsx, progress.md
- 内容: admin 画面の上部 sticky header を削除し、ログイン中スタッフのアバター・staffName・staffRole を desktop / mobile sidebar 上部へ移動。ログアウトボタンを sidebar 下部へ移動し、desktop collapsed 時はアイコンのみ表示にした。mobile は main content 左上の小さな menu ボタンから sidebar を開く構造に変更。
- 外部リンク: 「現場用」「顧客ポータル」を「現場アプリ」「顧客アプリ」に変更し、アプリ切替の補助リンクとして小さめの padding / font / icon / slate 系カラーへ調整。
- 触らず: ADMIN_NAV_GROUPS / visibleNavGroups / allowedPaths / adminOnly / staffRole 判定、AdminAuthGuard の既存ロジック、admin 各ページ本体、staff / portal 画面、Firestore 関連、tank-operation.ts、Security Rules。
- 検証: npx tsc --noEmit が EXIT=0。npm run build は通常実行では Google Fonts 取得のネットワーク制限で失敗、ネットワーク許可付き再実行で EXIT=0（37 route 静的生成完了）。
