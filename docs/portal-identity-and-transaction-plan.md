# portal identity / transaction 作成経路 設計

作成日: 2026-05-03

Customer と未紐付けの CustomerUser からのポータル発注を壊れにくく扱うための設計書。
本書を `portal identity` と `portal transaction` 作成経路の正本とし、後続 PR はここで固定した責務境界に沿って進める。

## 1. 目的

- `CustomerUser` と `Customer` の意味を分離する。
- `customerUserUid` / `createdByUid` と `customerId` の意味を分離する。
- 未紐付け CustomerUser の初回発注を拒否せず、`pending_link` の仮受注として受ける。
- `pending_link` を通常受注処理に混ぜず、Customer 紐付け後だけ通常の `pending` 受注へ昇格する。
- 返却・未充填報告は顧客正本との照合が必要なため、未紐付け CustomerUser では利用不可にする。
- page から Firestore 書き込みを切り離し、repository / service の責務を固定する。

## 2. 関連文書

| 文書 | 役割 |
|---|---|
| `AGENTS.md` | 作業ルール、customers / customerId 方針、deploy / commit 分離ルール |
| `docs/customer-data-model-redesign.md` | customers / customerUsers / destinations 廃止方針の整理 |
| `docs/identity-and-operation-logging-design.md` | staffId / customerId 正本化、repository と service の責務分担 |
| `docs/data-layer-design.md` | repository は Firestore I/O の薄い層にする方針 |

本書は `docs/customer-data-model-redesign.md` の portal transaction 部分を具体化する。

## 3. 現状メモ

現行コードでは、以下の直接書き込みが残っている。

| 場所 | 現状 |
|---|---|
| `src/app/portal/order/page.tsx` | page 内で `addDoc(transactions)` を呼び、常に `status: "pending"` を作成する |
| `src/app/portal/return/page.tsx` | page 内で `return` transaction を作成し、貸出中タンクは `customerName` / `tanks.location` で照合する |
| `src/app/portal/unfilled/page.tsx` | page 内で `uncharged_report` transaction を作成し、貸出中タンクは `customerName` / `tanks.location` で照合する |
| `src/app/portal/setup/page.tsx` | page 内で `customerUsers` を更新する |
| `src/lib/firebase/repositories/transactions.ts` | `findPendingLinksByUid(uid)` は実装済み。`createTransaction()` / `updateTransaction()` は骨組み |
| `src/lib/firebase/customer-linking-service.ts` | CustomerUser と Customer の紐付け service が既にある。後続 PR で本書の昇格方針に合わせて整理する |

この docs-only PR では `src/**` は変更しない。

## 4. 用語

| 用語 | 意味 |
|---|---|
| CustomerUser | Firebase Auth に紐づくポータルログイン利用者。ドキュメントは `customerUsers/{uid}` |
| Customer | 請求・貸出先・履歴集計の正本。ドキュメントは `customers/{customerId}` |
| customerUserUid | CustomerUser の Firebase Auth uid。誰がポータルから申し込んだかを示す |
| createdByUid | transaction 作成者の CustomerUser uid。`customerUserUid` を保存する field |
| customerId | どの会社・請求先・貸出先の業務かを示す正本 ID |
| customerName | Customer 紐付け後の既存 location 互換 snapshot。現行の `tanks.location` / `logs.location` 照合に使う |
| requestedCompanyName | 申込時に CustomerUser が自己申告した会社名 snapshot |
| pending_link | Customer 正本が未確定の仮受注。未完成の通常受注ではない |

## 5. 基本方針

`CustomerUser` はログイン利用者であり、請求・貸出先の正本ではない。
`Customer` は請求・貸出先・履歴集計の正本であり、通常の業務処理は `customerId` を持つ transaction を対象にする。

`customerUserUid` / `createdByUid` は「誰がポータルから申し込んだか」を表す。
`customerId` は「どの会社・請求先・貸出先の業務か」を表す。
この 2 つは service 境界で必ず分離して扱う。

未紐付け CustomerUser からの発注は `pending_link` として受ける。
これは通常受注の前段階ではあるが、スタッフの貸出処理に流せる通常受注ではない。
Customer 紐付けにより `customerId` / `customerName` が確定した時点で、`pending` に昇格して通常受注として扱う。

返却と未充填報告は、現在貸出中のタンクとの照合が必要である。
現状は `customerName` / `tanks.location` を使って貸出中タンクを取得しているため、未紐付け CustomerUser では正しい対象を特定できない。
そのため、未紐付け CustomerUser では `/portal/return` と `/portal/unfilled` を利用不可にする。

## 6. customerName の固定

現行実装では、staff 側の貸出先選択と `tanks.location` は主に `customers.name` を元にした文字列で動いている。
そのため、この PR では `customerUsers.customerName` / `PortalIdentity.customerName` / `transactions.customerName` を既存 location 互換の snapshot として扱う。
未紐付け時の自己申告名は `requestedCompanyName` に保存し、`customerName` には入れない。

Customer 紐付け時に service 側で次の location 互換名を作る。

```ts
const customerLocationName = customer.name?.trim() || customer.companyName?.trim();
```

この `customerLocationName` を `customerName` に snapshot する。
理由は、`/portal/page` / `/portal/return` / `/portal/unfilled` がまだ `customerName` を使って `tanks.location` / `logs.location` を検索するためである。
`name` が未設定または空文字の場合のみ `companyName` を使う。

請求・履歴表示用の display name としては `customer.companyName || customer.name` が自然だが、現時点で `customerName` にそれを入れると `tanks.location` と噛み合わない可能性がある。
`customerDisplayName` / `customerLocationName` の field 分離は後続 PR で扱う。

注意点:

- `customerName` は正本 ID ではない。
- Customer 名変更時に過去 transaction の `customerName` は一括更新しない。
- `requestedCompanyName` と `customerName` が異なることは正常な状態として扱う。
- location 互換名を作る責務は page ではなく service に置く。
- 請求・履歴表示用の `customerDisplayName` は `customerName` と混同せず、後続で別 field として検討する。

## 7. requested* snapshot の扱い

未紐付け発注では、申込時の自己申告情報を snapshot として残す。

```ts
requestedCompanyName: string;
requestedByName: string;
requestedLineName?: string;
```

これらは Customer 紐付け後も削除しない。
申込時に CustomerUser が入力した会社名・氏名・LINE 名と、後で紐付けた Customer の正式な顧客名を比較できるようにする。

役割分担:

| field | 役割 |
|---|---|
| `customerName` | Customer 紐付け後の既存 location 互換 snapshot |
| `requestedCompanyName` | 申込時の自己申告会社名 snapshot |
| `requestedByName` | 申込時の自己申告氏名 snapshot |
| `requestedLineName` | 申込時の LINE 名 snapshot |

## 8. PortalIdentity 型

portal transaction service は、CustomerUser と Customer の紐付け状態を型で分離して受け取る。

```ts
type LinkedPortalIdentity = {
  kind: "linked";
  customerUserUid: string;
  customerId: string;
  customerName: string;
  selfCompanyName?: string;
  selfName?: string;
  lineName?: string;
};

type UnlinkedPortalIdentity = {
  kind: "unlinked";
  customerUserUid: string;
  selfCompanyName: string;
  selfName: string;
  lineName?: string;
};

type PortalIdentity = LinkedPortalIdentity | UnlinkedPortalIdentity;
```

制限:

- `createPortalOrder()` は `PortalIdentity` を受ける。
- `createPortalReturnRequests()` は `LinkedPortalIdentity` だけを受ける。
- `createPortalUnfilledReports()` は `LinkedPortalIdentity` だけを受ける。

これにより、未紐付け CustomerUser から返却・未充填報告を作ってしまう事故を型で防ぐ。

## 9. 未紐付け CustomerUser で許可する操作

| 操作 | 未紐付け時の扱い | 理由 |
|---|---|---|
| `/portal/order` | 許可。`pending_link` として仮受付する | 発注は事後に Customer へ紐付け可能 |
| `/portal/return` | 利用不可 | 貸出中タンクとの照合に Customer 正本が必要 |
| `/portal/unfilled` | 利用不可 | 報告対象タンクが貸出中であることの照合が必要 |
| `/portal/page` の貸出状況・履歴 | 原則として未紐付け時は空表示または案内表示 | `customerName` / `customerId` が未確定のため |
| `/portal/setup` | 利用可 | self 情報の登録だけを行う |

未紐付けで利用不可の画面では、会社情報の確認・管理者による顧客紐付け後に利用できる旨を明示する。
この UI 表示は後続の page 移行 PR で扱う。

## 10. pending_link transaction schema

未紐付け CustomerUser からの発注は、1 発注 = 1 `transactions` document として作る。

```ts
{
  type: "order",
  status: "pending_link",

  customerId: null,
  customerName: "",

  createdByUid: customerUserUid,

  requestedCompanyName: selfCompanyName,
  requestedByName: selfName,
  requestedLineName: lineName,

  items: [
    {
      tankType: string,
      quantity: number,
    },
  ],

  deliveryType: "pickup" | "delivery",
  deliveryTargetName: string,

  note: string,
  orderNote: string,
  deliveryNote: string,

  source: "customer_portal",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
}
```

`note` / `orderNote` / `deliveryNote` は現行読み取り互換を踏まえ、当面は同じ内容を保存してよい。
後続で読み取り側の正規化が安定したら、保存 field の整理を別 PR で検討する。

紐付け済み CustomerUser からの発注は、同じ API から次の通常受注を作る。

```ts
{
  type: "order",
  status: "pending",

  customerId: linkedIdentity.customerId,
  customerName: linkedIdentity.customerName,

  createdByUid: linkedIdentity.customerUserUid,

  requestedCompanyName: linkedIdentity.selfCompanyName ?? "",
  requestedByName: linkedIdentity.selfName ?? "",
  requestedLineName: linkedIdentity.lineName ?? "",

  items,
  deliveryType,
  deliveryTargetName,
  note,
  orderNote,
  deliveryNote,
  source: "customer_portal",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
}
```

紐付け済みの場合も `requested*` を残してよい。
これにより、誰がどの自己申告情報で申し込んだかを後から確認できる。

## 11. pending_link の一覧表示方針

`pending_link` はスタッフ側の通常受注一覧には無条件に出さない。
通常の貸出処理に流してはいけない。

扱いは次のどちらかに限定する。

1. 通常受注一覧から除外する。
2. 管理者向けに「未紐付け受注」として通常受注とは別枠で表示する。

通常受注として扱う条件は、Customer 紐付け後に `pending` へ昇格していること。

読み取り側の注意:

- staff の通常受注取得は `type == "order"` かつ `status in ["pending", "approved"]` のように status を明示する。
- `getOrders()` を status 指定なしで通常受注画面に使う場合は、呼び出し側または repository 側で `pending_link` を除外する。
- 通常受注 badge / dashboard の要対応件数には `pending_link` を混ぜない。
- 未紐付け受注件数を表示する場合は、通常受注とは別の hook / UI で「未紐付け」件数として扱う。

## 12. Customer 紐付け時の昇格処理

CustomerUser と Customer の紐付け時に、その CustomerUser が作成した `pending_link` transaction を通常受注へ昇格する。
この処理は page ではなく `customerLinkingService` に閉じ込める。

昇格時の更新:

```ts
{
  status: "pending",
  customerId: linkedCustomer.id,
  customerName: customerLocationName,

  linkedAt: serverTimestamp(),
  linkedByStaffId: actor.staffId,
  linkedByStaffName: actor.staffName,
  linkedByStaffEmail: actor.staffEmail,
  updatedAt: serverTimestamp(),
}
```

`customerLocationName` は既存 `tanks.location` 互換を優先し、`linkedCustomer.name || linkedCustomer.companyName` で作る。

既存の `transactionsRepository.findPendingLinksByUid(uid)` は、`createdByUid == uid` かつ `status == "pending_link"` を探すため、この設計と相性がよい。
昇格 service はこの repository 関数を活用する。

昇格処理の不変条件:

- `pending_link` 以外の transaction を昇格対象にしない。
- `type !== "order"` の `pending_link` は通常想定しない。見つかった場合は昇格対象外またはエラー扱いにする。
- 既に別 Customer に紐付いている transaction は上書きしない。
- `requestedCompanyName` / `requestedByName` / `requestedLineName` は削除しない。
- staff actor は `OperationActor` と同等の `staffId` / `staffName` / `staffEmail` で記録する。

## 13. portalTransactionService API

設置候補:

```text
src/lib/firebase/portal-transaction-service.ts
```

API 案:

```ts
type CreatePortalOrderInput = {
  identity: PortalIdentity;
  items: OrderItem[];
  deliveryType: "pickup" | "delivery";
  deliveryTargetName: string;
  note: string;
};

type CreatePortalReturnRequestsInput = {
  identity: LinkedPortalIdentity;
  items: Array<{
    tankId: string;
    condition: "normal" | "unused";
  }>;
  source: "customer_portal" | "auto_schedule";
};

type CreatePortalUnfilledReportsInput = {
  identity: LinkedPortalIdentity;
  tankIds: string[];
};

async function createPortalOrder(input: CreatePortalOrderInput): Promise<string>;
async function createPortalReturnRequests(input: CreatePortalReturnRequestsInput): Promise<string[]>;
async function createPortalUnfilledReports(input: CreatePortalUnfilledReportsInput): Promise<string[]>;
```

責務:

- `PortalIdentity` から transaction schema を組み立てる。
- linked の order は `status: "pending"` にする。
- unlinked の order は `status: "pending_link"` にする。
- return / unfilled は `LinkedPortalIdentity` だけを受ける。
- `createdByUid` には常に `customerUserUid` を入れる。
- `customerId` と `customerUserUid` を混同しない。
- `requested*` snapshot を保存する。
- Firestore の実際の add/update は `transactionsRepository` に委譲する。

持たせないもの:

- localStorage の読み取り。
- Firebase Auth user の直接解決。
- React state。
- UI 表示文言。

## 14. customerLinkingService API

設置候補:

```text
src/lib/firebase/customer-linking-service.ts
```

既に同名 service があるため、後続 PR では既存実装を本書の責務に合わせて整理する。

API 案:

```ts
type CustomerSnapshotForLinking = {
  id: string;
  name: string;
  companyName?: string;
};

type LinkCustomerUserInput = {
  customerUserUid: string;
  customer: CustomerSnapshotForLinking;
  actor: OperationActor;
};

type LinkCustomerUserResult = {
  linkedCustomerUserUid: string;
  linkedCustomerId: string;
  promotedTransactionIds: string[];
};

async function linkCustomerUserToCustomer(
  input: LinkCustomerUserInput,
): Promise<LinkCustomerUserResult>;
```

責務:

- CustomerUser と Customer の紐付けを保存する。
- `customerLocationName = customer.name || customer.companyName` を作る。
- CustomerUser 側に `customerId` / `customerName` を保存する。
- `findPendingLinksByUid(customerUserUid)` で `pending_link` transactions を取得する。
- 対象 transaction を `pending` に昇格する。
- `linkedAt` / `linkedByStaffId` / `linkedByStaffName` / `linkedByStaffEmail` を保存する。

注意:

- `status` は `computeCustomerUserStatus()` で派生する方針を維持する。新規実装では CustomerUser の Firestore document に `status` を保存しない。
- 複数 CustomerUser の一括紐付け UI がある場合も、service 内部では 1 ユーザー単位の処理を合成する。
- `pending_link` 昇格は CustomerUser 更新と同一 batch / transaction に寄せる。

## 15. transactionsRepository に置くもの

repository は Firestore I/O の薄い層にする。
session 解決、localStorage、画面都合、Customer 表示名生成、業務 status 判断は持たせない。

追加候補:

```ts
async function createTransaction(input: CreateTransactionInput): Promise<string>;

async function updateTransaction(
  transactionId: string,
  patch: TransactionPatch,
): Promise<void>;

function updateTransactionInBatch(
  writer: RepositoryWriter,
  transactionId: string,
  patch: TransactionPatch,
): void;

async function bulkUpdatePendingLinksForCustomerUser(input: {
  customerUserUid: string;
  patch: TransactionPatch;
}): Promise<string[]>;
```

`bulkUpdatePendingLinksForCustomerUser()` は必須ではない。
既存の `findPendingLinksByUid(uid)` と `updateTransactionInBatch()` の組み合わせで十分なら追加しない。

repository に置くもの:

- collection / doc / query / add / update / batch 参加処理。
- `createdAt` / `updatedAt` の自動付与。
- 旧 schema 読み取りの正規化。

service に置くもの:

- linked / unlinked の判定。
- `pending` / `pending_link` の選択。
- location 互換の `customerName` の生成。
- return / unfilled を linked のみに制限する判断。
- `pending_link` を通常受注に昇格してよいかの検証。

## 16. page 移行順

移行はファイル数ではなく責務境界ごとに進める。
各 PR は `docs -> type/helper -> repository -> service -> page 移行 -> read 整理` の順序を守る。

推奨順:

1. `/portal/order`
   - page 内の `addDoc(transactions)` を `portalTransactionService.createPortalOrder()` へ移す。
   - linked は `pending`、unlinked は `pending_link` にする。
2. `customerLinkingService`
   - CustomerUser と Customer の紐付け時に `pending_link` を `pending` へ昇格する。
   - admin 紐付け処理へ接続する。
3. `/portal/return`
   - `LinkedPortalIdentity` 必須にする。
   - 未紐付け時は利用不可表示にする。
   - transaction 作成を `createPortalReturnRequests()` へ移す。
4. `/portal/unfilled`
   - `LinkedPortalIdentity` 必須にする。
   - 未紐付け時は利用不可表示にする。
   - transaction 作成を `createPortalUnfilledReports()` へ移す。
5. `/portal/setup`
   - setup 更新を service 化する。
   - `customerId` / `customerName` は保存しない。
6. `/portal/page`
   - `customerId` / `customerName` の扱いを整理する。
   - 未紐付け時の貸出状況・履歴表示を明示的な状態にする。

## 17. portal/setup 方針

`/portal/setup` は CustomerUser 本人の初期情報だけを扱う。

保存するもの:

```ts
{
  selfCompanyName: string,
  selfName: string,
  lineName: string,
  setupCompleted: true,
  updatedAt: serverTimestamp(),
}
```

保存しないもの:

- `customerId`
- `customerName`
- `disabled`
- `status`

`customerId` / `customerName` は admin が Customer に紐付けた時だけ保存する。
`status` は Firestore に保存せず、`computeCustomerUserStatus()` で派生する。

## 18. /portal/page の read 整理方針

現状の `/portal/page` は `customerSession.name` を使い、`tanks.location` と `logs.location` を検索している。
これは `tanks.customerId` が未決である現状では維持するが、未紐付け CustomerUser では正しい貸出先を特定できない。

方針:

- linked の場合だけ、現行の `customerName` / `location` ベース read を行う。
- unlinked の場合は貸出中タンク・履歴を取得しない。
- unlinked の場合は、発注は仮受付できるが返却・未充填報告は顧客確認後に利用できる旨を表示する。
- 将来 `logs.customerId` / `tanks.customerId` へ移行する場合は、別設計・別 PR とする。

`tanks.customerId` の追加は本書では決めない。

## 19. Firestore 読み書き回数と index

最初の実装では過度な最適化をしない。
service 境界を固定した後で、実際の read / write 回数を測って最適化する。

想定 read / write:

| 処理 | read | write |
|---|---:|---:|
| linked order 作成 | 0 から 1 | transactions 1件 add |
| unlinked order 作成 | 0 から 1 | transactions 1件 add |
| return 作成 | 貸出中 tanks read | transactions N件 add |
| unfilled 作成 | 貸出中 tanks read | transactions N件 add |
| CustomerUser 紐付け | customerUsers / pending_link transactions read | customerUsers 1件 update + transactions N件 update |

`0 から 1` は、identity を localStorage session から組み立てるか、最新 CustomerUser を Firestore から確認するかで変わる。
正確性を優先する場面では service 呼び出し前に最新 CustomerUser を読む。

index 方針:

| collection | fields | 用途 |
|---|---|---|
| `transactions` | `createdByUid` Asc, `status` Asc | `findPendingLinksByUid(uid)` |
| `transactions` | `type` Asc, `status` Asc, `customerId` Asc | 通常受注・返却・未充填の顧客別取得 |
| `transactions` | `type` Asc, `status` Asc, `customerId` Asc, `createdAt` Desc, `__name__` Desc | 顧客別 transaction の時系列表示 |

Firestore composite index は Firebase Console で手動管理する。
`firestore.rules` deploy とは別作業として扱う。

## 20. やらないこと

- `firestore.rules` の変更。
- `firebase.json` の変更。
- package 系ファイルの変更。
- `tanks.customerId` の追加。
- `tank-operation.ts` の変更。
- `tank-trace.ts` の変更。
- return / unfilled の未紐付け対応。
- `pending_link` を通常受注一覧へ無条件に混ぜること。
- `destinations` の復活。
- `src/lib/firebase/customer-destination.ts` の復活。
- 既存 `logs` の一括書き換え。
- Customer 名変更時の過去 transaction 一括書き換え。
- Cloud Functions 化。

## 21. smoke test 観点

後続実装 PR では、少なくとも以下を確認する。

- 紐付け済み CustomerUser が `/portal/order` で発注すると `transactions.status == "pending"` になる。
- 未紐付け CustomerUser が `/portal/order` で発注すると `transactions.status == "pending_link"` になる。
- `pending_link` には `customerId: null` / `customerName: ""` が入る。
- `pending_link` には `createdByUid` と `requestedCompanyName` / `requestedByName` / `requestedLineName` が残る。
- `pending_link` はスタッフ側の通常受注処理に流れない。
- admin が CustomerUser を Customer に紐付けると、対象 CustomerUser の `pending_link` が `pending` へ昇格する。
- 昇格後に `customerId` / `customerName` / `linkedAt` / `linkedByStaffId` / `linkedByStaffName` / `linkedByStaffEmail` が入る。
- 昇格後も `requestedCompanyName` / `requestedByName` / `requestedLineName` は残る。
- 未紐付け CustomerUser は `/portal/return` を使えない。
- 未紐付け CustomerUser は `/portal/unfilled` を使えない。
- `/portal/setup` は `customerId` / `customerName` / `status` を保存しない。
- `customerName` には既存 location 互換の `customer.name || customer.companyName` の snapshot が入る。
- 請求・履歴表示用の `customerDisplayName = customer.companyName || customer.name` は後続で別 field として検討する。

## 22. PR 分割

推奨 PR:

1. docs-only
   - 本書を追加する。
2. PortalIdentity helper
   - `LinkedPortalIdentity` / `UnlinkedPortalIdentity` / `PortalIdentity` を追加する。
   - Firestore 書き込みは変えない。
3. transactionsRepository write helper
   - `createTransaction()` / `updateTransaction()` / `updateTransactionInBatch()` を実装する。
   - repository は Firestore I/O に徹する。
4. portalTransactionService
   - `createPortalOrder()` / `createPortalReturnRequests()` / `createPortalUnfilledReports()` を追加する。
   - page はまだ移行しない。
5. `/portal/order` 移行
   - order の直接 `addDoc` を service 経由にする。
   - unlinked order を `pending_link` にする。
6. customerLinkingService
   - CustomerUser と Customer の紐付け時に `pending_link` を `pending` に昇格する。
   - `customerName` を既存 location 互換の `name || companyName` に固定する。
7. admin 紐付け処理への接続
   - 管理画面の CustomerUser 紐付け UI から service を使う。
8. `/portal/return` 移行
   - linked のみ許可し、直接 `addDoc` を service 経由にする。
9. `/portal/unfilled` 移行
   - linked のみ許可し、直接 `addDoc` を service 経由にする。
10. `/portal/setup` 整理
    - setup 更新を service 化し、`customerId` / `customerName` / `status` を保存しない方針を明確化する。
11. `/portal/page` read 整理
    - linked / unlinked の表示状態を分ける。
    - 将来の `customerId` read 移行に備える。

docs-only commit は実装 commit と分ける。
UI-only 変更と Firestore 書き込み schema 変更は分ける。

## 23. 次に実装すべき PR

次は `PortalIdentity helper` PR が最小単位として妥当。

範囲:

- `LinkedPortalIdentity` / `UnlinkedPortalIdentity` / `PortalIdentity` の型追加。
- `CustomerPortalSession` から `PortalIdentity` を組み立てる helper 追加。
- 未紐付け return / unfilled を型で拒否できる helper 追加。
- Firestore 書き込み schema はまだ変えない。
- page 移行はまだ行わない。

この順番なら runtime の書き込み挙動を変えずに、後続の repository / service / page 移行を安全に進められる。
