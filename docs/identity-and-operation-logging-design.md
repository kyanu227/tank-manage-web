# identity / operation logging typed field design

StaffID / CustomerID を正本にした operation logging と、`logs` typed field の設計方針。

この文書は実装前の docs-only 設計であり、Firestore data、migration、rules、deploy、実装コードは変更しない。

## 1. 目的

- `logs` に検索・集計・監査で使う情報を top-level typed field として残す。
- `staffId` / `customerId` を identity の正本にし、`staffName` / `customerName` / `location` は当時表示 snapshot として扱う。
- `logs` を過去操作 event / audit trail の source of truth として整理し、現在状態の source of truth にはしない。
- `tanks` / `logs` / `transactions` の責務を分け、`logExtra` / `note` / `logNote` に正本情報を詰め込まない。
- dashboard edit / void / correction、portal transaction、procurement、tag-only 更新を通常の tank operation と混ぜすぎない。
- 後続実装を、小さい PR に分けられる形で整理する。

## 2. 背景と現状の問題

タンクID正規化フェーズでは、`tankId` helper、Firestore read-only audit、主要 staff operation 接続、Hosting deploy、smoke test まで完了した。
既存 data は `A-00` / `A-01` / `A-OK` を含む canonical 方針におおむね収まっている。

次の課題は、`tanks` / `logs` / `transactions` の責務分離と operation logging の typed field 設計である。

現行構造には次のリスクがある。

| Risk | Why it matters |
|---|---|
| `location == customerName` 依存 | 顧客名変更、請求、portal 履歴、顧客別検索で identity が崩れる |
| `logs.staff` / `tanks.staff` 文字列依存 | 同姓同名、改名、退職、スタッフ実績集計に弱い |
| `logExtra` / `note` / `logNote` に業務情報を詰める | 検索・集計・監査・Rules hardening の基盤にしづらい |
| `transactions` と `logs` の紐付けが弱い | どの申請・受注がどの tank operation log を生んだか追跡しづらい |
| return condition が tag / note / transaction condition に分散 | 未使用返却、未充填返却、持ち越し、通常返却の集計が不安定になる |

このアプリは既に PR #87 以降の実装、既存 Firestore data、Hosting deploy、smoke test があるため、greenfield として扱わない。
既存 `logs` / `transactions`、dashboard edit / void / correction の revision 機構、既存 UI の読み取り互換を考慮する。

## 3. `tanks` / `logs` / `transactions` の責務分離

| Collection | Source of truth | Snapshot / audit role | Should not be |
|---|---|---|---|
| `tanks` | タンクの現在状態 | 現在 status / location / staff 表示 / latestLogId | 過去履歴、申請 workflow、顧客 identity master |
| `logs` | 過去操作 event / audit trail | 当時の staff / customer / location / tank snapshot | 現在状態の source of truth |
| `transactions` | portal / staff workflow の申請・受注・返却申請 | customer snapshot、staff 処理 snapshot、workflow status | tank lifecycle 状態の source of truth |
| `customers` | 貸出先・請求単位 identity master | 現在の顧客名、単価、有効状態 | 過去ログの表示名そのもの |
| `staff` / `staffByEmail` | staff identity / auth mapping | 現在の staff 名、email、role、rank | 過去操作 actor snapshot |

通常の画面や業務処理は、現在状態を毎回 `logs` から再構成せず、`tanks` の current projection を読む。
`logs` は状態遷移の根拠・復元材料にはなるが、日常の current state read model ではない。

## 4. `staffId` / `customerId` を正本にする理由

`staffId` は操作 actor の identity 正本にする。
スタッフ名・email・role は変更され得るため、実績・報酬・監査・void/correction actor の判定を名前文字列に寄せない。

`customerId` は貸出先・請求単位の identity 正本にする。
顧客名は変更され得るため、請求、売上、portal 履歴、顧客別検索を `location` や `customerName` だけに依存させない。

新規 operation logging では、次を top-level field 候補にする。

- `logs.staffId`
- `logs.staffName`
- `logs.staffEmail`
- `logs.customerId`
- `logs.customerName`
- `logs.transactionId`
- `logs.source`
- `logs.workflow`
- `logs.returnCondition`

## 5. `staffName` / `customerName` / `location` を snapshot として残す理由

名前文字列は正本にはしないが、履歴表示と監査には必要である。

- 顧客名が後から変わっても、過去ログでは当時の表示名を確認したい。
- スタッフ名が変わっても、過去操作の画面表示は当時名で読みたい。
- `location` は「操作後の場所・貸出先表示名」として既存 UI と互換性がある。

そのため、`staffName` / `customerName` / `location` は snapshot として残す。
ただし、検索・集計・請求・報酬の主軸は `staffId` / `customerId` に寄せる。

## 6. 曖昧な文字列 field を新設しない理由

`logs.staff` / `logs.customer` のような曖昧な文字列 field は新設しない。

理由:

- 正本 ID なのか表示 snapshot なのか区別できない。
- 改名・同姓同名・統合・無効化に弱い。
- index 設計や Security Rules hardening の前提にしづらい。
- `staffId` / `staffName`、`customerId` / `customerName` の役割分担と衝突する。

既存互換の読み取りで `logs.staff` 相当を参照する必要がある場合でも、新規 write schema は typed field に寄せる。

## 7. Operation identity types

コード上では identity をひとかたまりで渡し、Firestore には検索しやすい top-level field として展開する。

```ts
export type OperationActor = {
  staffId: string;
  staffName: string;
  staffEmail?: string;
  role?: string;
  rank?: string;
};

export type CustomerSnapshot = {
  customerId: string;
  customerName: string;
};

export type OperationContext = {
  actor: OperationActor;
  customer?: CustomerSnapshot;
  transactionId?: string;
  source?: OperationSource;
  workflow?: OperationWorkflow;
  returnCondition?: ReturnCondition;
};
```

`actor.staffId` と `actor.staffName` は staff operation では必須。
顧客が関係しない充填、修理、耐圧、自社利用などでは `customer` を省略できる。

候補 enum:

```ts
export type OperationSource =
  | "manual"
  | "order_fulfillment"
  | "return_tag_processing"
  | "bulk_return"
  | "portal"
  | "procurement"
  | "dashboard_correction"
  | "system";

export type OperationWorkflow =
  | "tank_operation"
  | "order"
  | "return"
  | "uncharged_report"
  | "procurement"
  | "supply_order"
  | "dashboard_edit"
  | "dashboard_void";

export type ReturnCondition =
  | "normal"
  | "unused"
  | "uncharged"
  | "keep";
```

enum 名と値は実装時に既存 `ACTION` / `RETURN_TAG` / transaction `condition` と照合して固定する。

## 8. `LogDoc` 推奨 schema

```ts
export type LogDoc = {
  id: string;

  tankId: string;
  action: string;
  transitionAction?: string;

  logStatus: "active" | "superseded" | "voided";
  logKind: "tank" | "order" | "procurement";
  rootLogId?: string;
  revision?: number;

  timestamp: Timestamp;
  originalAt?: Timestamp;
  revisionCreatedAt?: Timestamp;

  staffId?: string;
  staffName?: string;
  staffEmail?: string;

  customerId?: string;
  customerName?: string;

  transactionId?: string;
  source?: OperationSource;
  workflow?: OperationWorkflow;
  returnCondition?: ReturnCondition;
  billable?: boolean;

  location?: string;
  note?: string;
  logNote?: string;

  prevStatus?: string;
  newStatus?: string;
  prevTankSnapshot?: unknown;
  nextTankSnapshot?: unknown;
  previousLogIdOnSameTank?: string | null;

  editedByStaffId?: string;
  editedByStaffName?: string;
  editedByStaffEmail?: string;
  editReason?: string;

  voidedByStaffId?: string;
  voidedByStaffName?: string;
  voidedByStaffEmail?: string;
  voidReason?: string;
  voidedAt?: Timestamp;

  logExtra?: Record<string, unknown>;
};
```

Notes:

- `staffId` / `customerId` は将来の新規 operation log では基本的に保存する。
- 既存 log や非 staff 起点 log があるため、読み取り型では optional として扱う余地を残す。
- `transactionId` は portal order / return / uncharged report から生じた tank operation log の紐付けに使う。
- `source` は発生元、`workflow` は業務フロー分類、`returnCondition` は返却の扱いを typed field にする。
- `billable` は請求・売上設計で必要性を再評価する。今すぐ必須 field にはしない。
- `logs` に `prefix` / `number` / `sortKey` は重複保存しない。`tankId` は canonical ID を保存する。

## 9. `TransactionDoc` 推奨 schema

`transactions` は workflow の source of truth であり、tank state の正本ではない。

```ts
export type TransactionDoc = {
  id: string;
  type: "order" | "return" | "uncharged_report";
  status: string;

  customerId?: string;
  customerName?: string;
  createdByUid?: string;
  source?: "customer_portal" | "staff" | "system";

  tankId?: string;
  tankIds?: string[];
  items?: unknown[];

  condition?: ReturnCondition;
  finalCondition?: ReturnCondition;

  approvedAt?: Timestamp;
  approvedByStaffId?: string;
  approvedByStaffName?: string;
  approvedByStaffEmail?: string;

  fulfilledAt?: Timestamp;
  fulfilledByStaffId?: string;
  fulfilledByStaffName?: string;
  fulfilledByStaffEmail?: string;

  linkedAt?: Timestamp;
  linkedByStaffId?: string;
  linkedByStaffName?: string;
  linkedByStaffEmail?: string;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};
```

`approvedBy` / `fulfilledBy` のような名前だけの field は、新規 schema の主軸にしない。
既存読み取り互換が必要なら、typed field を優先し、旧 field は fallback として扱う。

## 10. `TankOperationInput` 方針

`TankOperationInput` は `staff` 文字列ではなく `context: OperationContext` を持つ方針に寄せる。

```ts
export interface TankOperationInput {
  tankId: string;
  transitionAction: TankAction;
  logAction?: string;
  currentStatus?: string;

  location?: string;
  tankNote?: string;
  logNote?: string;

  context: OperationContext;

  logExtra?: Record<string, unknown>;
  tankExtra?: Record<string, unknown>;
  skipValidation?: boolean;
}
```

`staffId` / `customerId` のような横断的な正本 field を `logExtra` に入れると、呼び出し漏れを型で防ぎにくい。
operation service が `OperationContext` を受け取り、`LogDoc` top-level field に展開する。

## 11. `logExtra` に残してよい情報・残すべきでない情報

| Category | Policy |
|---|---|
| `transactionId` | top-level typed field に昇格する |
| `source` / `workflow` | top-level typed field に昇格する |
| `returnCondition` | top-level typed field に昇格する |
| `staffId` / `staffName` / `staffEmail` | `OperationContext.actor` から top-level field に展開する |
| `customerId` / `customerName` | `OperationContext.customer` から top-level field に展開する |
| 一時 UI 状態 | 原則保存しない |
| 画面表示だけの補助ラベル | `note` / snapshot に限定し、機械判定に使わない |
| workflow 固有の低頻度 metadata | `logExtra` に残してよいが、集計・検索の主軸になった時点で top-level 化する |

`logExtra` は移行期や低頻度 metadata の受け皿としては有効だが、正本情報を置く場所にはしない。

## 12. `transactionId` / `source` / `workflow` / `returnCondition` 方針

### `transactionId`

portal order、portal return、portal unfilled report、staff processing が tank operation を生む場合、`logs.transactionId` を保存する。
これにより、transaction と logs を timestamp / note / tankId から推定せずに追跡できる。

### `source`

どの入口から発生した操作かを示す。

Examples:

- `manual`
- `order_fulfillment`
- `return_tag_processing`
- `bulk_return`
- `portal`
- `procurement`
- `dashboard_correction`
- `system`

### `workflow`

業務フロー単位の分類を示す。
`source` が入口、`workflow` が業務文脈という分担にする。

Examples:

- `tank_operation`
- `order`
- `return`
- `uncharged_report`
- `procurement`
- `supply_order`
- `dashboard_edit`
- `dashboard_void`

### `returnCondition`

返却系の扱いを typed field にする。

- `normal`
- `unused`
- `uncharged`
- `keep`

`returnCondition` は `RETURN_TAG` / transaction `condition` / `finalCondition` と対応させる。
長期的には manual return、bulk return、return tag processing の保存形をこの field で揃える。

## 13. dashboard edit / void / correction との関係

dashboard edit / void / correction は revision chain に関わるため、通常 operation と同じ単純更新 helper に落とさない。

方針:

- 元 operation actor と correction actor を分ける。
- 元 operation は `staffId` / `staffName` / `staffEmail` を保持する。
- edit actor は `editedByStaffId` / `editedByStaffName` / `editedByStaffEmail` に保存する。
- void actor は `voidedByStaffId` / `voidedByStaffName` / `voidedByStaffEmail` に保存する。
- `logStatus` active / superseded / voided と `rootLogId` / `revision` の既存不変条件を壊さない。
- `latestLogId` と revision / void / correction の整合は別 PR で確認する。

dashboard correction は最後に回す。
先に operation logging schema と読み取り互換を固め、revision 影響を分けて扱う。

## 14. 通常 tank operation と混ぜすぎない領域

### procurement

タンク登録・購入は `tankProcurements` や procurement log を持つ。
複数タンクをまとめて扱う procurement event は、単一 tank lifecycle log と同じ revision chain に押し込まない。
ただし actor snapshot と canonical `tankId` は typed field 方針に合わせる。

### supply-order

資材発注は tank lifecycle ではない。
`logs` に記録する場合でも `logKind: "order"` などで区別し、tank status transition と混同しない。

### portal transactions

portal transaction は workflow request の source of truth である。
portal が transaction を作成した時点で tank status を動かさない。
staff processing が tank operation を生む場合に、`logs.transactionId` で紐付ける。

### tag-only `tanks.logNote` updates

返却タグや一時状態を `tanks.logNote` に載せる更新は、状態遷移 operation とは意味が違う。
tag-only 更新を通常 operation log と同一視しない。
永続的に検索・集計したい返却扱いは `logs.returnCondition` など typed field に寄せる。

## 15. 必要になり得る composite index

Firestore composite index は Firebase Console 手動管理とし、Security Rules deploy とは分ける。

| Collection | Fields | Use |
|---|---|---|
| `logs` | `logStatus` Asc, `staffId` Asc, `timestamp` Desc, `__name__` Desc | staff mypage / staff analytics |
| `logs` | `logStatus` Asc, `customerId` Asc, `timestamp` Desc, `__name__` Desc | portal history / customer history |
| `logs` | `logStatus` Asc, `tankId` Asc, `timestamp` Desc, `__name__` Desc | tank trace |
| `logs` | `logStatus` Asc, `transactionId` Asc, `timestamp` Desc, `__name__` Desc | transaction to logs trace |
| `logs` | `logStatus` Asc, `returnCondition` Asc, `timestamp` Desc, `__name__` Desc | return condition analysis |
| `logs` | `logStatus` Asc, `source` Asc, `workflow` Asc, `timestamp` Desc, `__name__` Desc | workflow audit |
| `transactions` | `type` Asc, `status` Asc, `customerId` Asc, `createdAt` Desc, `__name__` Desc | customer workflow history |
| `transactions` | `type` Asc, `status` Asc, `fulfilledByStaffId` Asc, `fulfilledAt` Desc | staff fulfillment history |

既存の `logs` `logStatus` Asc / `location` Asc / `timestamp` Desc / `__name__` Desc index は、`location` 文字列履歴が残る間は維持する。
新規の顧客履歴・集計は `customerId` index に寄せる。

## 16. migration / backfill 方針

この文書では migration を実行しない。

方針:

- 新規 write から typed field を保存する。
- 既存 `logs` / `transactions` は破壊的に書き換えない。
- 既存 `location` / `staff` 文字列を一括変更しない。
- 既存 log の顧客名・スタッフ名 snapshot は過去表示として残す。
- 読み取りは typed field 優先、旧 field fallback の順にする。
- backfill が必要になった場合は read-only audit、migration design、dry-run、実行 PR を分ける。
- `tanks.customerId` 追加はこの文書では決めない。current loan projection / customers 正本化の別設計で扱う。

互換性不要とは扱わない。
既存 Firestore data、dashboard revision / void / correction、portal workflow、staff operations を前提に、段階移行する。

## 17. 実装順序と commit 分割案

推奨順:

1. identity helper / types only
   - `OperationActor`
   - `CustomerSnapshot`
   - `OperationContext`
   - `getStaffIdentity`
   - `requireStaffIdentity`
   - `useStaffIdentity`
   - Firestore write schema はまだ変えない。
2. logsRepository read-only helper
   - `getActiveLogsByStaffId`
   - `getActiveLogsByCustomerId`
   - `getActiveLogsByTank`
   - typed field がない既存 data への fallback 方針を確認する。
3. operation logging schema migration
   - `TankOperationInput` を `context` 受け取りへ段階移行する。
   - `applyTankOperation` / `applyBulkTankOperations` が `OperationContext` から typed field を保存する。
   - manual / order / return tag / damage / in-house の呼び出し元を小さく分ける。
4. transactions actor fields
   - `approvedByStaffId` / `approvedByStaffName` / `approvedByStaffEmail`
   - `fulfilledByStaffId` / `fulfilledByStaffName` / `fulfilledByStaffEmail`
   - `linkedByStaffId` / `linkedByStaffName` / `linkedByStaffEmail`
5. UI / read migration
   - staff mypage を `staffId` で絞る。
   - portal 履歴を `customerId` で絞る。
   - staff analytics / billing / sales は typed field を優先する。
6. dashboard edit / void / correction
   - revision 不変条件を再確認してから、edit / void actor typed field を追加する。
7. indexes / rules
   - composite index は Firebase Console 手動作成。
   - Security Rules hardening は別レビュー。

推奨 commit / PR 分割:

1. `docs: update identity and operation logging design`
2. `types: add operation identity helpers`
3. `repositories: add staff and customer log read helpers`
4. `operations: write staff identity to tank logs`
5. `operations: write customer identity snapshots to tank logs`
6. `transactions: record staff identity for workflow actions`
7. `procurement: align non-tank log actor fields`
8. `staff: read mypage logs by staff id`
9. `portal: read logs by customer id`
10. `admin: aggregate staff stats by staff id`

docs-only、UI-only、Firestore write schema、index / rules、migration は混ぜない。

## 18. 禁止事項

- この docs-only 段階で実装コードを変更しない。
- Firestore data create/update/delete を行わない。
- migration / backfill を実行しない。
- `firestore.rules` を変更しない。
- `firebase.json` を変更しない。
- Security Rules deploy / Firestore deploy / Hosting deploy / 無指定 firebase deploy を行わない。
- 既存 `logs` を一括で書き換えない。
- dashboard edit / void / correction の revision 機構を破壊的に変える前提にしない。
- `logs.staff` / `logs.customer` のような曖昧な文字列 field を新規 schema として増やさない。
- `logExtra` / `note` / `logNote` に、永続的な検索・集計・監査の正本情報を詰め込まない。

## 19. 次フェーズで決めること

- `OperationSource` / `OperationWorkflow` / `ReturnCondition` の enum 値。
- `logs.billable` を今入れるか、billing design 後に入れるか。
- `transactions.condition` / `transactions.finalCondition` と `logs.returnCondition` の正確な対応。
- `tanks.customerId` または current loan projection を持つかどうか。
- `latestLogId` と revision / void / correction の整合ルール。
- typed field が欠ける既存 logs の読み取り fallback。
- 必要 index の作成順序。

最初の実装は identity helper / types only に限定する。
Firestore write schema の変更、operation service 移行、UI/read migration は後続 PR に分ける。
