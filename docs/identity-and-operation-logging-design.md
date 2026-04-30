# identity / operation logging 設計

StaffID / CustomerID を正本にした operation logging の設計方針。
実装前に、`logs` / `transactions` / operation service の責務と schema を固定する。

## 1. 目的

- 操作ログのスタッフ識別を名前文字列ではなく `staffId` に寄せる。
- 顧客・貸出先の識別を顧客名文字列ではなく `customerId` に寄せる。
- 表示名は履歴表示用 snapshot として保存し、正本 ID と表示名の役割を分ける。
- 画面・hook から `logs` を直接書かず、業務操作の書き込みを operation service に寄せる。
- repository は Firestore I/O に徹し、session 解決や操作者推定を持たせない。

## 2. 背景

現行のタンク操作ログは `src/lib/tank-operation.ts` を中心に追記型 revision chain で管理している。
一方で、操作者は `logs.staff` の名前文字列として保存されており、同姓同名・改名・メール変更・スタッフ無効化後の追跡に弱い。

`/staff/mypage` は現在 `logsRepository.getActiveLogs({ limit: 100 })` に依存している。
これは「自分のログ」ではなく「全体ログの直近100件」であり、スタッフ別の実績・履歴表示には `staffId` による絞り込みが必要になる。

顧客側も `logs.location` / `tanks.location` の顧客名文字列で表示・集計している箇所が残っている。
`customers` を貸出先・請求単位の正本にする方針に合わせ、新規 operation logging では `customerId` を top-level field として保存する。

まだ実運用前のため、旧ログ互換のための `logs.staff` / `logs.customer` のような曖昧な文字列 field は新設しない。

## 3. 基本方針

- `logs.staffId` をスタッフ識別の正本にする。
- `logs.staffName` を表示用 snapshot として保存する。
- `logs.staffEmail` は監査・確認補助として任意保存する。
- `logs.customerId` を顧客識別の正本にする。
- `logs.customerName` を表示用 snapshot として保存する。
- Firestore の検索・index 用に `staffId` / `customerId` は `logs` の top-level field に置く。
- コード上では `OperationActor` / `CustomerSnapshot` / `OperationContext` のような型でまとめて扱ってよい。
- `logs.staff` / `logs.customer` のような互換用・曖昧名 field は新規書き込みしない。
- `logs.location` は操作後の場所・貸出先表示用の当時名として残す。
- `tanks.location` は現在場所表示用の文字列として残す。
- `tanks.customerId` の追加はこの設計では決めない。別途 customer data model の判断事項として扱う。

## 4. 責務分担

### page

- 表示とイベント発火のみを担当する。
- Firestore SDK を直接 import しない。
- `logs` / `tanks` / `transactions` の整合更新を直接組み立てない。

### hook

- `staffSession` / `customerSession` から identity を取得する。
- workflow / use-case に `OperationContext` や `CustomerSnapshot` を渡す。
- UI 状態、入力検証、確認ダイアログ、画面固有の派生値を担当する。
- `addDoc` / `updateDoc` / `writeBatch` / `runTransaction` を画面都合で乱発しない。

### workflow / use-case

- 手動貸出、受注貸出、返却承認、破損、修理、耐圧検査、自社移動、タンク登録などの業務手順を組み立てる。
- どの transaction を完了させるか、どの customer snapshot を渡すかなどの業務意味を保持する。
- Firestore の低レベル I/O は domain operation service または repository に委譲する。

### domain operation service

- tank 状態変更、log 作成、transaction 更新を一貫して実行する。
- `OperationContext` を正規化し、`staffId` / `staffName` / `staffEmail` / `customerId` / `customerName` を保存する。
- `runTransaction` / batch による整合性管理を担当する。
- revision chain、void、correction window などの業務不変条件を維持する。

### repository

- Firestore の query / add / update / batch helper に徹する。
- session、localStorage、画面都合、スタッフ推定、顧客推定を知らない。
- 書き込み helper を持つ場合も、画面から直接呼ばせず operation service から使う。

## 5. identity 型

Firestore では検索しやすい top-level field として保存する。
コード上では以下の型を境界に使う。

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
};
```

`OperationActor.staffId` と `OperationActor.staffName` は必須。
`staffEmail` は任意だが、保存できる場合は保存する。
`role` / `rank` は operation 判断や表示補助には使えるが、Firestore index の主軸にはしない。

`CustomerSnapshot` は顧客が関係する operation のみ必須。
顧客が関係しない修理・耐圧検査・充填・自社利用などでは省略できる。

## 6. staff identity の取得

`staffSession` には現時点で `id` / `name` / `email` / `role` / `rank` が保存されている。
このため、operation 境界へ渡す actor は session から組み立てられる。

推奨 helper:

```ts
export function getStaffIdentity(): OperationActor | null;
export function requireStaffIdentity(): OperationActor;
export function useStaffIdentity(): OperationActor | null;
```

設置場所は `src/hooks/useStaffSession.ts` または identity 専用 helper が妥当。
既存の `getStaffName()` は段階的に置き換える。

`requireStaffIdentity()` は `staffId` がない場合に fallback 名で書き込まず、操作を止める。
`"スタッフ"` のような fallback は表示用途に限定し、監査ログの正本には使わない。

## 7. customer identity の取得

portal 側は `customerSession` から `customerId` / `customerName` / `customerUserUid` を取得できる。
staff 操作側は `customers` の選択肢から `CustomerSnapshot` を作る。

推奨 helper:

```ts
export function getCustomerPortalIdentity(): CustomerSnapshot | null;
export function requireCustomerPortalIdentity(): CustomerSnapshot;
```

staff 操作の貸出先選択 hook は、名前文字列だけでなく以下を返す形にする。

```ts
type SelectedCustomer = {
  customerId: string;
  customerName: string;
};
```

`selectedDest` から `customerOptions.find(...).id` を毎回逆引きするより、選択値自体を `customerId` に寄せ、表示名を snapshot として保持する方が安全。

## 8. LogDoc schema 方針

推奨 schema:

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

  staffId: string;
  staffName: string;
  staffEmail?: string;

  customerId?: string;
  customerName?: string;

  location?: string;
  note?: string;
  logNote?: string;
  transactionId?: string;

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
};
```

注意点:

- `logStatus` は既存 revision 機構に合わせて `"active" | "superseded" | "voided"` を維持する。
- `staffId` / `customerId` は top-level field にする。
- `staffName` / `customerName` は当時表示名の snapshot として保存する。
- `location` は操作後の場所・貸出先表示名として残す。
- `logs.staff` は新規書き込みしない。
- `logs.customer` は新設しない。
- correction / void の操作者は、元 operation の actor と区別して `editedByStaff*` / `voidedByStaff*` に保存する。

## 9. TransactionDoc schema 方針

`transactions` は顧客申請・受注・返却・未充填報告の正本として、既存の `customerId` / `customerName` / `createdByUid` を維持する。
スタッフ操作による承認・完了は、名前文字列だけでなく staff identity を保存する。

推奨追加 field:

```ts
type TransactionDoc = {
  id: string;
  type: "order" | "return" | "uncharged_report";
  status: string;

  customerId?: string;
  customerName?: string;
  createdByUid?: string;

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

新規書き込みでは `approvedBy` / `fulfilledBy` のような曖昧な名前文字列 field を増やさない。
既存 field の読み取り互換を残すかどうかは、実運用前データの扱いを確認してから決める。

## 10. TankOperationInput 方針

`TankOperationInput.logExtra` に `staffId` / `staffName` / `staffEmail` / `customerId` / `customerName` を詰める方針は避ける。
identity は operation の必須文脈であり、任意 extra にすると呼び出し漏れを型で防げない。

推奨形:

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

`logExtra` は `transactionId`、業務固有フラグ、procurement 関連 ID などに限定する。
`staffId` / `customerId` のような横断的な正本 field は `OperationContext` から operation service が展開する。

## 11. 現行コードでの主な移行対象

`getStaffName()` 依存:

- `src/features/staff-operations/hooks/useManualTankOperation.ts`
- `src/features/staff-operations/hooks/useOrderFulfillment.ts`
- `src/features/staff-operations/hooks/useReturnApprovals.ts`
- `src/features/staff-operations/hooks/useBulkReturnByLocation.ts`
- `src/app/staff/damage/page.tsx`
- `src/app/staff/repair/page.tsx`
- `src/app/staff/inspection/page.tsx`
- `src/app/staff/inhouse/page.tsx`
- `src/features/procurement/components/TankEntryScreen.tsx`
- `src/app/staff/dashboard/page.tsx`

直接 `logs` 書き込み:

- `src/lib/tank-operation.ts`
- `src/features/procurement/lib/submitTankEntryBatch.ts`
- `src/lib/firebase/supply-order.ts`

直接 `transactions` 書き込み:

- `src/features/staff-operations/hooks/useOrderFulfillment.ts`
- `src/features/staff-operations/hooks/useReturnApprovals.ts`
- `src/app/portal/order/page.tsx`
- `src/app/portal/return/page.tsx`
- `src/app/portal/unfilled/page.tsx`
- `src/app/admin/settings/page.tsx`

customer 名文字列依存:

- `src/features/staff-operations/hooks/useDestinations.ts`
- `src/features/staff-operations/hooks/useManualTankOperation.ts`
- `src/features/staff-operations/hooks/useOrderFulfillment.ts`
- `src/app/portal/page.tsx`
- `src/app/portal/return/page.tsx`
- `src/app/portal/unfilled/page.tsx`
- `src/app/admin/billing/page.tsx`

## 12. repository 変更案

`logsRepository` に追加する読み取り関数:

```ts
getActiveLogsByStaffId(staffId: string, options?: {
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<LogDoc[]>;

getActiveLogsByCustomerId(customerId: string, options?: {
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<LogDoc[]>;

getActiveLogsByTank(tankId: string, limit?: number): Promise<LogDoc[]>;
```

用途:

- `/staff/mypage`: `getActiveLogsByStaffId(session.id, { limit: 100 })`
- portal 履歴: `getActiveLogsByCustomerId(customerId, { limit: 30 })`
- 顧客別請求・売上: `customerId` を軸に集計
- tank trace: `tankId` / `action` / `timestamp` を軸に追跡

`transactionsRepository` は既存の `getOrders({ customerId })` / `getReturns({ customerId })` を維持し、必要に応じて type 横断の customer query を追加する。

## 13. 必要 index

Firestore composite index は Firebase Console で手動管理する。
`firestore.rules` deploy とは別作業として扱う。

想定 index:

| collection | fields | 用途 |
|---|---|---|
| `logs` | `logStatus` Asc, `staffId` Asc, `timestamp` Desc, `__name__` Desc | `/staff/mypage`、スタッフ別実績 |
| `logs` | `logStatus` Asc, `customerId` Asc, `timestamp` Desc, `__name__` Desc | portal 履歴、顧客別履歴 |
| `logs` | `logStatus` Asc, `tankId` Asc, `timestamp` Desc, `__name__` Desc | タンク履歴 |
| `logs` | `logStatus` Asc, `tankId` Asc, `action` Asc, `timestamp` Desc, `__name__` Desc | tank trace の直前充填者・貸出元特定 |
| `transactions` | `type` Asc, `status` Asc, `customerId` Asc | 受注・返却の顧客別絞り込み |
| `transactions` | `type` Asc, `status` Asc, `customerId` Asc, `createdAt` Desc, `__name__` Desc | 顧客別 transaction の時系列表示 |

既存の `logs` `logStatus` Asc / `location` Asc / `timestamp` Desc / `__name__` Desc index は、`location` 文字列履歴が残る間は維持する。
新規の顧客履歴・集計は `customerId` index に寄せる。

## 14. migration 方針

- 実運用前のため、旧データ互換・backfill は原則重視しない。
- 新規書き込みから `staffId` / `staffName` / `staffEmail` を保存する。
- 顧客が関係する新規書き込みから `customerId` / `customerName` を保存する。
- 既存 `logs.staff` を前提にした新規処理は追加しない。
- 既存 `logs.location` は履歴表示用の当時名として残す。
- 既存 `tanks.location` は現在場所表示用として残す。
- `tanks.customerId` 追加は別設計で決定するまで実装しない。
- 過去ログの顧客名・スタッフ名は一括書き換えしない。

## 15. 禁止事項

- 画面・feature hooks から `logs` を直接作成しない。
- `logs.staff` / `logs.customer` のような曖昧な互換 field を新設しない。
- repository に session 解決や staff 推定ロジックを持たせない。
- `firestore.rules` を本タスクで deploy しない。
- `firebase.json` に `firestore.rules` を接続しない。
- `firebase deploy` 単体を実行しない。
- Hosting deploy は明示指示がある場合のみ `firebase deploy --only hosting:okmarine-tankrental --project okmarine-tankrental` を使う。
- `.codex-logs/` を commit しない。
- `tank-operation.ts` の revision / void / correction 不変条件を崩さない。

## 16. operation service 共通化案

共通化すべきもの:

- `OperationContext` の必須チェック。
- `OperationContext` から `LogDoc` top-level field への展開。
- `applyTankOperation` / `applyBulkTankOperations` の log 作成処理。
- 受注貸出・返却承認での tank/log/transaction 一貫更新。
- dashboard の edit / void actor 記録。
- procurement / supply-order の非タンクログ actor schema。

共通化しすぎると危険なもの:

- タンク状態遷移ログとタンク購入・登録ログを同一 API に押し込むこと。
- 資材発注ログを tank operation と同じ revision chain に入れること。
- portal の transaction 作成を staff actor 前提の operation に混ぜること。
- `tanks.logNote` のタグだけ更新する処理を状態遷移 operation と同一視すること。
- dashboard の edit / void を単純 update helper に落とすこと。

## 17. 実装順序

### 1. docs-only

この設計書を追加し、実装範囲・禁止事項・commit 分割を固定する。

### 2. identity helper / 型追加

- `OperationActor` / `CustomerSnapshot` / `OperationContext` を追加する。
- `getStaffIdentity()` / `requireStaffIdentity()` / `useStaffIdentity()` を追加する。
- Firestore 書き込み schema はまだ変えない。

### 3. repository read 関数追加

- `logsRepository.getActiveLogsByStaffId()`
- `logsRepository.getActiveLogsByCustomerId()`
- 必要なら `getActiveLogsByTank()`

### 4. tank operation schema 移行

- `TankOperationInput.staff` を `context.actor` へ移行する。
- `customerId` / `customerName` は `context.customer` から保存する。
- `logs.staff` 新規書き込みを止める。
- `logs.staffId` / `logs.staffName` / `logs.staffEmail` を保存する。

### 5. transaction actor field 移行

- 受注承認: `approvedByStaffId` / `approvedByStaffName` / `approvedByStaffEmail`
- 受注貸出完了: `fulfilledByStaffId` / `fulfilledByStaffName` / `fulfilledByStaffEmail`
- 返却承認完了: 同上
- customer user 紐付け: `linkedByStaff*`

### 6. 非タンクログ移行

- `submitTankEntryBatch`
- `submitSupplyOrder`

非タンクログでも `staffId` / `staffName` / `staffEmail` を保存する。
`logKind` は `procurement` / `order` を維持する。

### 7. UI read 移行

- `/staff/mypage` を `staffId` で絞る。
- admin dashboard の稼働スタッフ数を `staffId` で count する。
- staff analytics を `staffId` group + `staffName` 表示にする。
- portal 履歴を `customerId` で絞る。
- billing / sales は customerId 正本へ段階移行する。

## 18. commit 分割方針

推奨 commit:

1. `docs: add identity and operation logging design`
2. `types: add operation identity helpers`
3. `repositories: add staff/customer log queries`
4. `operations: write staff identity to tank logs`
5. `operations: write customer identity snapshots to tank logs`
6. `transactions: record staff identity for approvals`
7. `procurement: align non-tank log actor fields`
8. `staff: filter mypage logs by staff id`
9. `admin: aggregate staff stats by staff id`
10. `portal: query logs by customer id`

UI-only commit と Firestore 書き込み schema 変更 commit は分ける。
docs-only commit は実装 commit と分ける。
icon / PWA 画像更新は混ぜない。

## 19. 実装前に確認すべき事項

- `staffSession.id` が全ログイン経路で必ず `staff/{id}` になっているか。
- dev auth bypass の `id` を本番データと衝突しない値として扱えるか。
- passcode login を再有効化した場合も `id` / `email` / `role` / `rank` が保存されるか。
- `customerSession.uid` と `customerSession.customerId` のどちらを portal transaction の `customerId` として使うか。
- 未紐付け customer user の transaction を `pending_link` にする条件。
- `customerName` snapshot の元にする表示名を `customers.name` / `companyName` のどちらに統一するか。
- `tanks.customerId` を追加するかどうか。これは本設計では未決。
- dashboard edit / void の actor field 名を `editedByStaff*` / `voidedByStaff*` で固定するか。
- 既存 `approvedBy` / `fulfilledBy` を読み取り互換として残す必要があるか。
- composite index をどの順番で Firebase Console に作成するか。

## 20. 最初の実装範囲

最初の実装は docs-only の次に、identity helper と型追加だけに絞る。

推奨プロンプト:

```text
OperationActor / CustomerSnapshot / OperationContext の型と、
getStaffIdentity / requireStaffIdentity / useStaffIdentity を追加してください。
Firestore 書き込み schema はまだ変更しないでください。
既存 getStaffName は互換のため残してください。
firestore.rules / firebase.json は触らないでください。
```

この段階では runtime の書き込み挙動を変えず、後続 commit で `tank-operation.ts` と呼び出し元を移行する。
