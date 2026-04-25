# データレイヤ設計

Firestore への直接アクセスを repository に集約するための設計書。
対象コレクションは `tanks` / `logs` / `transactions` の3つに限定する。
他コレクションや `tank-operation.ts` の内部構造はこの設計では触らない。

## 1. 目的

- 画面・hooks が `firebase/firestore` を直接触る状態を解消する。
- 「どこで書いているか」を読むだけで追えるようにする。
- `tank-operation.ts` の業務ルール一元化を壊さずに、DB アクセス層を分離する。
- 将来のスキーマ変更・dev/prod 分離・監査ログ拡張に備えて変更点を repository に閉じ込める。

## 2. スコープ

### 今回の対象

- `tanks` の読み書き
- `logs` の読み（書きは原則 tank-operation 経由のまま）
- `transactions` の読み書き

### 今回やらないこと

- `customers` / `destinations` / `customerUsers` / `staff` / `staffByEmail` の repository 化
- `orderMaster` / `orders` / `tankProcurements` / `priceMaster` / `rankMaster` / `settings` / `notifySettings` / `lineConfigs` / `monthly_stats` / `delete_history` / `edit_history` の repository 化
- `tank-trace.ts` を repository に吸収すること（独立維持）
- `tank-operation.ts` の構造変更
- `submitTankEntryBatch` など既存の業務バッチの分解

## 3. 責務分担

```
                    ┌──────────────────────────────────────┐
                    │ 画面 / feature hooks                 │  UI 状態と表示用正規化
                    └───┬──────────────┬──────────────┬────┘
                        │              │              │
          (a) 業務操作   │    (b) 単純な │    (c) 追跡・│
          （貸出/返却/   │     DB 読み  │     集計表示 │
            充填/編集/   │     取り    │              │
            取消）      │              │              │
                        ▼              ▼              ▼
          ┌────────────────────┐ ┌──────────────┐ ┌──────────────────┐
          │ tank-operation.ts  │ │ repositories/│ │ tank-trace.ts    │
          │ 業務ルール・状態  │ │  tanks       │ │ 履歴追跡・集計   │
          │ 遷移・revision    │ │  logs        │ │ （画面から並列  │
          │ （runTransaction）│ │  transactions│ │   で呼ばれる）   │
          └─────────┬──────────┘ └──────┬───────┘ └────────┬─────────┘
                    │                   │                  │
                    │                   │            （移行後）
                    │                   │                  │
                    │                   │                  ▼
                    │                   │         ┌──────────────────┐
                    │                   │         │ logsRepository   │
                    │                   │         └────────┬─────────┘
                    │                   │                  │
                    ▼                   ▼                  ▼
          ┌──────────────────────────────────────────────────────────┐
          │ firebase/firestore SDK                                    │
          │ （repositories 内部 + tank-operation.ts / 業務ハブのみ）  │
          └──────────────────────────────────────────────────────────┘
```

- (a) 業務操作: 画面/hooks → `tank-operation.ts` → Firestore（`runTransaction`）
- (b) 単純な DB 読み取り: 画面/hooks → `repositories/*` → Firestore
- (c) 追跡・集計表示: 画面/hooks → `tank-trace.ts` → （移行後）`logsRepository` → Firestore

`tank-trace.ts` は `tank-operation.ts` の下流ではなく、画面/hooks から並列に呼ばれる service 層である点に注意。

### 各層のルール

- **画面 / feature hooks**
  - 業務操作は `tank-operation.ts` を呼ぶ。
  - 単純な読み取り・リスト取得は repository を呼ぶ。
  - `firebase/firestore` の import は禁止。
- **tank-operation.ts**
  - 業務ルール層。状態遷移の検証・追記型 revision の維持を担う。
  - 現状の `runTransaction` ベースの実装を維持する。
  - repository を使っても使わなくてもよい（Phase 4 で判断）。
- **repositories**
  - `firebase/firestore` の薄いラッパ。
  - クエリ・ドキュメントマッピング・スナップショット購読・バッチ書き込みだけを担う。
  - 業務判定（状態遷移の妥当性、ログ編集許可など）は持たない。
  - React / Next 依存は持たない。
  - `tank-rules.ts` からの **型・定数参照は許容** する（`STATUS` / `TankStatus` / `LOCATION` など）。表記揺れを防ぐため、正規値は tank-rules の定義を流用する。
  - ただし `canTransition` / `validateXxx` のような **状態遷移の妥当性判定ロジックは repository に持ち込まない**。業務判定は呼び出し側または `tank-operation.ts` に残す。
- **tank-trace.ts**
  - 追跡・集計ロジック。
  - 単なる CRUD ではないため repository には吸収しない。
  - 内部で `logs` を参照する部分は、Phase 2 以降で `logsRepository` に寄せてよい。
- **Firestore SDK**
  - repositories とごく一部の業務ハブ（`tank-operation.ts` / `submitTankEntryBatch` など）の内側でのみ使う。

## 4. tanksRepository.ts

### 責務

- `tanks/{tankId}` の読み取り・業務遷移を伴わない単純な属性更新。
- タンク一覧のスナップショット購読と取得。
- タンクID の正規化入力を前提にした薄いラッパ。
- **削除は扱わない**。物理削除 API（`deleteTank` / `deleteTankInBatch`）は本 repository では提供しない。運用上タンクを「消したい」場合は `status: "破棄"` への遷移（`tank-operation.ts` 経由）や非表示フラグで表現する。物理削除が本当に必要な場合は `delete_history` への監査ログ書き込みとセットで別タスクとして設計する。

### 関数候補

- `getTank(tankId)` — 1件取得。存在しなければ `null`。
- `getTanks(options?)` — 全件または条件つき取得。`{ status?, location?, prefix?, statusIn? }` 程度。`statusIn` は複数ステータスのいずれかに合致するタンクを取得する用途（例: 一括返却対象の `[LENT, UNRETURNED]`）。
- `listenTanks(callback, options?)` — `onSnapshot` 購読。戻り値は unsubscribe。
- `getTanksByIds(tankIds)` — 複数ID の一括取得（10件ごとの `in` 分割に対応）。
- `updateTankFields(tankId, patch)` — 業務遷移を伴わない単純な属性更新のみを対象とする。
- `updateTankFieldsInBatch(batch, tankId, patch)` — 呼び出し側の `WriteBatch` / `Transaction` に参加するオーバーロード。許容/禁止範囲は `updateTankFields` と同じ。

#### `updateTankFields` / `updateTankFieldsInBatch` の許容範囲

**許容する更新（業務遷移を伴わない表示用メタ情報）**:

- `note`（メモ）
- `type`（タンク種別などの分類情報）
- `nextMaintenanceDate`（次回メンテ予定日 など）
- その他、業務遷移を伴わない表示用メタ情報

**禁止する更新（`tank-operation.ts` または業務ハブを通すべき）**:

- `status` の変更
- `location` の変更
- 貸出・返却・充填などの操作に伴う更新
- `latestLogId` の更新
- ログ作成を伴う更新

`updateTankFields` は業務遷移を伴わない単純な属性更新のみを対象とする。`status` / `location` / `latestLogId` などは扱わず、これらは `tank-operation.ts` 経由で更新する。

### やらないこと

- 状態遷移を伴う更新（`tank-operation.ts` の仕事）。
- ログとの整合性維持（`tank-operation.ts` の仕事）。
- **物理削除 API（`deleteTank` / `deleteTankInBatch`）は Phase 1 では提供しない**。タンクは業務履歴（logs / transactions）と結びつく正本であり、骨組み段階で物理削除 API を正式設計として残すと悪しきショートカットとして固定化されるため。
- 廃棄運用は **論理削除（`status: "破棄"` への遷移）を第一選択** とする。これは `tank-operation.ts` 経由で行う。
- 物理削除が本当に必要かどうかは、`delete_history` への監査ログ書き込みとセットで **別タスク** として切り出す（「今回はやらないこと」参照）。

## 5. logsRepository.ts

### 責務

- `logs` コレクションの読み取りクエリ。
- スナップショット購読。
- 物理削除は提供しない。

### 書き込みの扱い（Phase 別）

- **Phase 1〜2**: logsRepository は **読み取り中心**（現方針維持）。ログの新規作成・編集・取消はすべて `tank-operation.ts` の API（`appendTankOperation` / `applyTankOperation` / `applyLogCorrection` / `voidLog`）を経由する。
- **Phase 3 以降（判断事項）**: `tank-operation.ts` などの **業務ハブから使う batch 参加関数のみ** を logsRepository に置くことを許容する（例: `createLogInBatch(writer, ...)` / `voidLogInBatch(writer, ...)`）。目的は、業務ハブ内の書き込み処理を SDK から repository 境界に寄せ、テスタビリティと一貫性を上げること。
- **永続禁止**: 画面・feature hooks からの **ログ直接書き込みは Phase を問わず禁止**。logsRepository に書き込み系が追加されても、それは `tank-operation.ts` などの業務ハブ専用であり、UI 側からは呼ばない。

### 関数候補

- `getLog(logId)` — 1件取得。
- `getLogsByTank(tankId, options?)` — タンク単位の履歴取得。`{ logStatus?, limit?, before?, after? }`。
- `getActiveLogsByTank(tankId, limit?)` — `logStatus == "active"` の時系列降順。
- `getLatestActiveLogForTank(tankId)` — 最新 active ログ。`tank-trace` や編集可否判定で使う。
- `getLogsByRoot(rootLogId)` — revision チェーン取得。
- `getLogsByAction(action, options?)` — action 指定の履歴（売上集計・trace の内部用）。
- `getActiveLogs(options?)` — `logStatus == "active"` 限定の汎用取得。`{ from?, to?, limit?, location? }`。複数画面で重複している「active log + orderBy timestamp desc」クエリを集約する用途。
- `getLogsInRange(options)` — 期間指定の汎用取得。`{ from?, to?, limit?, location?, activeOnly: boolean }`。**`activeOnly` は必須引数**。「active のみ読む」用途と「全ログを読む」用途が暗黙に混ざらないよう、呼び出し側で必ず明示する。
- `listenLogsByTank(tankId, callback)` — 画面表示用の購読。
- `listenRecentLogs(callback, limit?)` — ダッシュボード用の最新ログ購読。

#### 書き込み方針（関数候補章の補足）

- Phase 1〜2 の logsRepository は **読み取り中心**。書き込み関数は本章の関数候補に含めない。
- 将来的に置く可能性があるのは、`tank-operation.ts` などの業務ハブから使う **batch 参加関数のみ**（例: `createLogInBatch` / `voidLogInBatch`）。
- **画面・feature hooks から logsRepository の書き込み関数を直接呼ぶことは Phase を問わず禁止**。ログの新規作成・編集・取消は `tank-operation.ts` の API（`appendTankOperation` / `applyTankOperation` / `applyLogCorrection` / `voidLog`）を経由する。
- 詳細な Phase 別方針は上の「書き込みの扱い（Phase 別）」節を参照。

### やらないこと

- 書き込み（新規・編集・取消は `tank-operation.ts` の `appendTankOperation` / `applyTankOperation` / `applyLogCorrection` / `voidLog`）。
- `logStatus` を直接 `voided` / `superseded` に変える API は出さない。
- `logKind != "tank"` のログ（資材発注・タンク購入）についてもスキーマは同じだが、責務としては読み取り提供のみ。

## 6. transactionsRepository.ts

### 責務

- `transactions` の作成・読み取り・更新。
- type ごと（`order` / `return` / `uncharged_report`）の薄いクエリヘルパ。
- 書き込みは業務フックから直接呼ばれる想定（`tank-operation.ts` を介さない）。

### 関数候補

- `createTransaction(input)` — 1件作成。`createdAt` / `updatedAt` を自動付与。
- `updateTransaction(transactionId, patch)` — 単純更新。`updatedAt` を自動付与。
- `updateTransactionInBatch(batch, transactionId, patch)` — バッチ版。
- `getTransaction(transactionId)`
- `getOrders(options?)` — `type == "order"` のクエリ。`{ status?, customerId?, since? }`。
- `getReturns(options?)` — `type == "return"` のクエリ。
- `getUnchargedReports(options?)` — `type == "uncharged_report"` のクエリ。
- `listenOrders(status, callback)` — 受注画面用のスナップショット購読。
- `listenReturnApprovals(callback)` — 返却承認待ち購読。
- `markOrderApproved(orderId, approvedBy)` — status 遷移のショートカット（内部は update）。
- `markOrderCompletedInBatch(batch, orderId, fulfilledBy)` — 貸出完了と同 batch に参加するバッチ版。
- `getPendingTransactions()` — `status in ["pending", "pending_approval"]` 横断取得（admin ダッシュボード用）。実装は orders + returns の Promise.all 並列でよい。**Phase 2-B の後半で実装予定（Phase 2-B-1 の対象外）**。
- `findPendingLinksByUid(uid)` — `createdByUid == uid && status == "pending_link"` の特殊条件取得（admin/settings の顧客リンク処理用）。**Phase 2-B の後半で実装予定（Phase 2-B-1 の対象外）**。

### 正規化

- 読み込み時は既存の `normalizeOrderDoc()` を repository 内で呼び、`items[]` 正規化済みの形で返す。
- 旧スキーマ互換は repository 境界で吸収し、外には正規化済みの型を出す。

### やらないこと

- 業務状態遷移の妥当性検証（呼び出し側 or 上位サービス）。
- logs との整合性維持（貸出完了 → 貸出ログの連動は呼び出し側が transaction / batch を組む）。

## 7. tank-trace.ts の位置づけ

- 今回は独立維持する（B 案寄り）。
- 理由:
  - 単なる `logs` の CRUD ではなく「誰が最後に充填したか」など業務的な追跡関数が集まっている。
  - `logsRepository` に吸収すると repository が集計サービスに肥大化する恐れがある。
- 実装上の接続方針:
  - Phase 2 以降、`tank-trace.ts` 内部の直接 SDK 呼び出しを `logsRepository` 経由に置き換えても良い（`tank-trace.ts` のファイル自体は残す）。
- 将来の判断材料:
  - A 案（`logsRepository` に吸収）: trace が薄くなってきた場合。
  - B 案（独立維持）: trace に新しい追跡ロジック（破損責任・売上連動など）が増える場合。
- 現時点では B 案のまま据え置き、設計判断は後回しにする。

## 8. WriteBatch / runTransaction の方針

### 原則

- 業務的な整合性が必要な書き込みは `runTransaction`。
- 整合性より通数・効率が重要な書き込みは `writeBatch`。
- 画面は原則 batch を直接組み立てない。repository の関数を呼ぶ。ただし「複数 repository にまたがる整合性」が必要な場面は、呼び出し側で batch を組み、repository の `*InBatch` オーバーロードに渡す。

### tank-operation.ts との境界

- `tank-operation.ts` の内部では引き続き `runTransaction` を使う。
- `applyBulkTankOperations` は `extraOps(writer)` を受け取っており、ここに batch 的な追加書き込みを参加させる余地がある。
  - 例: 受注完了と同トランザクションで `transactions/{id}` を `completed` にする。
- このため、`transactionsRepository` には `*InBatch` 系を必ず用意し、`extraOps` から呼べるようにする。

### *InBatch オーバーロードの形

```ts
// 例（決定ではなく形の指針）
export function updateTransactionInBatch(
  writer: WriteBatch | Transaction | TankOperationWriter,
  transactionId: string,
  patch: Partial<TransactionDoc>,
): void;
```

- `WriteBatch` / `Transaction` / `TankOperationWriter` のいずれでも受けられるよう、最小共通インターフェースで書く。
- 将来型が増えても signature を維持できる形にする。

## 9. 禁止事項

- 画面コンポーネント・feature hooks から `firebase/firestore` を直接 import しない。
- repository から React / Next / `tank-operation` を import しない。
- `tank-rules.ts` の型・定数参照は許容するが、状態遷移判定ロジック（canTransition / validateXxx 等）は持たない。
- repository が業務判定（状態遷移妥当性、ログ編集許可、未返却判定など）を持たない。
- `logs` の物理削除 API を提供しない。取消は `voidLog`、編集は `applyLogCorrection` だけを正とする。
- `tanks` のステータス直接書き換えは repository からは提供しない（業務遷移は `tank-operation.ts` 経由）。
- 旧スキーマ互換の正規化は repository 境界で完結させる。画面で「古いフィールドも読む」コードを書かない。

## 10. 段階的移行手順

### Phase 1 — 骨組み作成

- `src/lib/firebase/repositories/` を新設（`firebase/config.ts` などの既存 firebase ラッパと同居させる）。
- `tanks.ts` / `logs.ts` / `transactions.ts` / `types.ts` / `index.ts` を空骨組みで用意。
- 型とシグネチャだけ先に定義し、実装は空 or throw で置く。
- 既存コードからは呼ばない。ビルドが通ることだけ確認。

### Phase 2 — 読み出し系から置き換え

- 影響が小さい場所から repository の読み出し関数に寄せる。
  - 例: `useTanks.ts` → `tanksRepository.listenTanks` / `getTanks`
  - 例: `tank-trace.ts` → `logsRepository` の読み出し関数
  - 例: `useReturnApprovals` / `useOrderFulfillment` の読み取り部分 → `transactionsRepository`
- 読み出しだけなので戻り値の型が一致していれば置換が機械的。

### Phase 3 — tank-operation を経由しない書き込みを置き換え

- `transactions` の作成・status 遷移（ポータルからの発注・返却申請・未充填報告）を `transactionsRepository.createTransaction` / `updateTransaction` / `*InBatch` に寄せる。
- `tanks` の単純フィールド更新（メモ・type・`nextMaintenanceDate`）を `tanksRepository.updateTankFields` に寄せる。
- このフェーズで「画面からの `firebase/firestore` 直接 import」を原則ゼロにする。

### Phase 4 — tank-operation.ts 内部の読み出しを寄せるか判断

- `tank-operation.ts` 内の read を `logsRepository` / `tanksRepository` に寄せるかは別途判断。
- 寄せる場合も `runTransaction` の中では `tx.get()` が必要なので、repository 側で `(tx, ...)` を受けるオーバーロードが増えるだけの想定。
- 現状維持でも問題ない。むやみに寄せない。

## 11. 今回はやらないこと（再掲）

- `customers` / `destinations` / `customerUsers` / `staff` / `staffByEmail` などの repository 化。
- `tank-trace.ts` の吸収。
- `tank-operation.ts` の構造変更・API 変更。
- `submitTankEntryBatch` など既存業務バッチの分解。
- dev/prod 分離・`.env.development` の設定（別設計書で扱う）。
- スキーマ変更・移行スクリプト（`docs/migration-policy.md` で扱う）。
