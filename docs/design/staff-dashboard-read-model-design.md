# Staff Dashboard Query / Read Model 個別設計（PR-11）

- 作成日: 2026-07-27
- 対象base commit: `6a18275995bf6342a81cf88cfd06212a3c1e57c9`
- 対象route: `/staff/dashboard`
- 対象残差: R-21後半
- 前提: PR-10 merge済み
- 位置づけ: PR-11実装の個別設計正本
- 対象: read、集計、log sort、root履歴取得
- 対象外: write workflow、UI再編、schema、Rules、index追加

## 1. 目的と正本性

本書は、staff dashboardに残るquery・read model責務を、後続PR-11で等価抽出するための個別設計正本である。新設ファイル名、query条件、limit、sort、集計出力、履歴取得範囲をここで確定し、実装時の設計判断を残さない。

構造化リファクタ全体の順序は[構造化リファクタのPR順序](../architecture/refactor-sequence.md)、feature境界は[Feature境界の正本設計](../architecture/feature-boundaries.md)、write ownerは[Write Ownershipの正本設計](../architecture/write-ownership.md)を正本とする。正本順位は`AGENTS.md > 現行コード > 現行テスト > 既存docs`である。

### 1.1 現行事実と本書の判断

現行baseでは、`src/app/staff/dashboard/page.tsx`が次を保持している。

- active logs、active customers、未充填報告の並列取得
- repository返却順のactive logsに対する先頭200件cap
- 未充填報告の現行createdAt comparatorによるsortと10件cap
- tank status、貸出先、今日の操作の集計
- log表示順sort
- root revision履歴のlazy readとrevision昇順sort
- React state、loading、selection、modal、訂正可否、write workflow、JSX、CSS

PR-11では、このうちqueryと純粋read modelだけを移動する。表示値、入力順、sort式、例外透過、loading、refresh、write workflowは変更しない。

既存の`docs/data-layer-migration-plan.md`には、`getActiveLogs`が常に`timestamp desc`を付ける旨と、`getUnchargedReports`がstubである旨の古い記述が残る。現行コードでは`getActiveLogs({ orderBy: null })`と`getUnchargedReports()`が実装・利用済みである。本書では現行コードを事実として採用し、当該historical記録は本docs-only PRの2ファイル制約により変更しない。

## 2. スコープ

### 2.1 PR-11で扱う責務

- dashboard初期表示用source dataの取得
- active logsのclient cap
- 未充填報告のsortとclient cap
- root revision履歴の取得とsort
- tank status集計
- 総tank数
- 貸出先別集計
- 今日の操作集計
- 最近の未充填報告抽出
- log表示順sort
- dashboard用read model型

### 2.2 PR-11で扱わない責務

- write workflow
- correction service
- correction role・訂正可否
- UI分割・component抽出
- JSX・CSS・layout変更
- Firestore repository API追加・変更
- Firestore query条件変更
- Firestore index追加
- schema・field変更
- `useTanks()`の廃止・統合
- timestamp正規化の改善

## 3. PR-11の想定変更ファイル

後続PR-11で新設するファイルを次の4件に確定する。

```text
src/features/staff-dashboard/queries/dashboard-query.ts
src/features/staff-dashboard/queries/dashboard-query.test.ts
src/features/staff-dashboard/queries/dashboard-read-model.ts
src/features/staff-dashboard/queries/dashboard-read-model.test.ts
```

更新する既存ファイルは次の1件だけとする。

```text
src/app/staff/dashboard/page.tsx
```

想定変更ファイルは合計5件である。追加の`types.ts`、hook、component、repository、timestamp utilityは新設しない。

## 4. 責務分離

### 4.1 `dashboard-query.ts`

Firestore repositoryと既存read serviceを呼ぶ非純粋なread境界とする。

持つ責務:

- dashboard初期表示用source dataの3read並列取得
- active logsのdashboard用上限適用
- 未充填報告のsortと上限適用
- root単位のrevision履歴取得とsort
- repository結果の`DashboardLogEntry`への受け渡し

持たない責務:

- React state
- alert
- loading state
- selection state
- correction role
- write workflow
- aggregation
- UI label生成
- modal制御
- retry、fallback、部分成功、独自catch

### 4.2 `dashboard-read-model.ts`

Firestoreへ接続しない純粋変換境界とする。

持つ責務:

- dashboard用表示modelの型
- `DashboardLogEntry`型
- tank status集計
- 総tank数
- 貸出先別集計
- 今日の操作集計
- 最近の未充填報告抽出
- log表示順sort

持たない責務:

- repository・read service呼び出し
- React
- `Date.now()`の直接呼び出し
- UI state
- write
- alert
- history cache

### 4.3 `page.tsx`

次をpageに残す。

- `useTanks()`
- React state
- dashboard fetch開始とsource state反映
- `useEffect`
- `dashboardLoading`、`tanksLoading`、loading表示
- `logSortOrder`
- edit mode
- selection
- modal
- correction role
- correction可否判定
- write service呼び出し
- alert
- `historyByRoot` cache
- `historyLoadingRoot`
- expanded root
- correction後のrefresh orchestration
- JSX・CSS

## 5. 型と公開API

### 5.1 `DashboardLogEntry`

page内の現行`LogEntry`を`dashboard-read-model.ts`へ移し、`DashboardLogEntry`としてexportする。

```ts
type DashboardDateValue =
  | Date
  | number
  | string
  | { toDate: () => Date }
  | { toMillis: () => number }
  | null;

type DashboardLogStatus = "active" | "superseded" | "voided";

export interface DashboardLogEntry {
  id: string;
  tankId: string;
  action: string;
  transitionAction?: string;
  staffId?: string;
  staffName?: string;
  staffEmail?: string;
  customerId?: string;
  customerName?: string;
  location?: string;
  timestamp?: DashboardDateValue;
  originalAt?: DashboardDateValue;
  revisionCreatedAt?: DashboardDateValue;
  note?: string;
  logNote?: string;
  logStatus?: DashboardLogStatus;
  logKind?: string;
  transitionPlan?: { kind?: "direct" | "recovery" };
  transitionReviewStatus?: "not_required" | "pending" | "approved" | "excluded";
  rootLogId?: string;
  revision?: number;
  editedByStaffId?: string;
  editedByStaffName?: string;
  editedByStaffEmail?: string;
  editReason?: string;
  voidedByStaffId?: string;
  voidedByStaffName?: string;
  voidedByStaffEmail?: string;
  voidReason?: string;
  voidedAt?: DashboardDateValue;
  prevTankSnapshot?: TankSnapshot;
  nextTankSnapshot?: TankSnapshot;
}
```

fieldの削除、rename、required/optional変更は行わない。`DashboardDateValue`と`DashboardLogStatus`はmodule private型でよく、追加の型ファイルは作らない。

### 5.2 初期source query API

`dashboard-query.ts`の公開APIを次の形で確定する。

```ts
export type StaffDashboardSourceData = {
  logs: DashboardLogEntry[];
  customerOptions: CustomerSnapshot[];
  unfilledReports: TransactionDoc[];
};

export async function fetchStaffDashboardSourceData(
): Promise<StaffDashboardSourceData>;

export async function fetchStaffDashboardLogHistory(
  rootLogId: string,
): Promise<DashboardLogEntry[]>;
```

名称・戻り値のfield名は変更しない。

### 5.3 read model API

`dashboard-read-model.ts`の公開型と関数を次の形で確定する。

```ts
export type DashboardLogSortOrder = "desc" | "asc";

export type DashboardTankSummary = Record<string, number>;

export type DashboardCustomerIdentitySummary = {
  key: string;
  customerId?: string;
  displayName: string;
  lent: number;
  unreturned: number;
  total: number;
  isLegacy: boolean;
};

export type DashboardTodayStats = {
  total: number;
  breakdown: Array<{
    action: string;
    count: number;
  }>;
};

export type StaffDashboardReadModel = {
  totalTanks: number;
  tankSummary: DashboardTankSummary;
  byLocation: DashboardCustomerIdentitySummary[];
  todayStats: DashboardTodayStats;
  recentUnfilledReports: TransactionDoc[];
};

export type BuildStaffDashboardReadModelInput = {
  tanks: readonly TankDoc[];
  logs: readonly DashboardLogEntry[];
  customerOptions: readonly CustomerSnapshot[];
  unfilledReports: readonly TransactionDoc[];
  staffLocale: Locale;
  nowMillis: number;
};

export function buildStaffDashboardReadModel(
  input: BuildStaffDashboardReadModelInput,
): StaffDashboardReadModel;

export function sortStaffDashboardLogs(
  logs: readonly DashboardLogEntry[],
  order: DashboardLogSortOrder,
): DashboardLogEntry[];
```

## 6. 初期source query

### 6.1 並列取得

`fetchStaffDashboardSourceData()`は次の3readを`Promise.all`で並列取得する。

```text
active logs
active customer snapshots
uncharged reports
```

逐次取得へ変更しない。query側でretry、fallback、部分成功、空配列化、独自catchを行わない。いずれかのread rejectionは同じErrorをpageへ透過する。

### 6.2 active logs

現行どおり次をexactに呼ぶ。

```ts
logsRepository.getActiveLogs({
  orderBy: null,
});
```

repository側の条件:

- `logStatus == "active"`
- Firestore側`orderBy`なし
- Firestore側`limit`なし
- from/to条件なし
- location条件なし
- action条件なし
- logKind条件なし
- customer条件なし
- staff条件なし

`orderBy: null`は、`timestamp`を持たないrevision log等をFirestoreの`orderBy("timestamp")`で除外せず、dashboard側が`originalAt ?? timestamp`を用いて表示順を決めるための指定である。

PR-11では次を追加しない。

- `orderBy("timestamp")`
- `orderBy("originalAt")`
- Firestore `limit(200)`
- 複合query
- 新規index
- client fallback query

### 6.3 active logsのclient cap

現行どおりrepository返却順の先頭200件を、表示用sortより前に採用する。

```ts
const logs = repositoryLogs.slice(0, 200);
```

- repository返却順を維持する
- client sortより先に200件へ制限する
- 厳密な「時系列上の最新200件」は保証しない
- server-side limitへの変更は別設計とする

### 6.4 customers

現行どおり次を呼ぶ。

```ts
listActiveCustomerSnapshots()
```

- active customer snapshotを全件取得する
- dashboard query側で追加filterしない
- dashboard query側で追加sortしない
- limitなし
- service返却順序を維持する
- customer option UIと貸出先別集計で同じ配列を使用する

`listActiveCustomerSnapshots()`内部のactive判定とcustomerName sortは既存serviceの責務であり、PR-11では変更しない。

### 6.5 未充填報告

現行どおり次を呼ぶ。

```ts
transactionsRepository.getUnchargedReports()
```

repository条件:

- `type == "uncharged_report"`
- status filterなし
- customerId filterなし
- Firestore orderByなし
- Firestore limitなし
- `createdAt`のsince条件なし

取得後、client側で次を行う。

```ts
const sortedReports = [...reports].sort(
  (a, b) =>
    (timestampToMillis(b.createdAt) ?? 0)
    - (timestampToMillis(a.createdAt) ?? 0),
);

const unfilledReports = sortedReports.slice(0, 10);
```

確定事項:

- `null`またはmissing `createdAt`は`0`へfallbackする
- Invalid Date等から生じた`NaN`は`?? 0`の対象ではなく`NaN`のまま
- comparatorは`NaN`を返し得る
- Invalid Dateを明示的に末尾へ送らない
- comparatorが比較するkeyがfiniteまたはnullishだけの場合はcreatedAt降順
- `NaN`を含む場合、配列全体がcreatedAt降順になることは保証しない
- comparatorが`0`相当となる同値要素はstable sort
- 元のreports配列を変更しない
- stateへ保持する上限は10件
- dashboard badgeは最大10件の`unfilledReports.length`
- 詳細表示は先頭5件
- statusを`pending`等へ限定しない

### 6.6 tanks

PR-11ではtank取得を現行の`useTanks()`に残す。

- `dashboard-query.ts`から`tanksRepository.getTanks()`を直接呼ばない
- `useTanks()`の全件取得を維持する
- repositoryのID昇順を維持する
- `tanksLoading`を維持する
- `refetchTanks()`を維持する
- dashboard固有queryと共有tank hookを同PRで統合しない

## 7. timestamp変換

### 7.1 現行挙動として維持するhelper

`dashboard-query.ts`と`dashboard-read-model.ts`で必要なtimestamp変換は、現行dashboardの`toDate()`／`timestampToMillis()`本文をそのまま使用する。

```ts
function timestampToMillis(value: unknown): number | null {
  const date = toDate(value);
  return date ? date.getTime() : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return new Date((value as { toMillis: () => number }).toMillis());
  }
  if (typeof value === "string") {
    const date = new Date(value.replace(/-/g, "/"));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
```

新しいtimestamp utilityファイルや追加の公開APIは作らない。

- pageの既存`timestampToMillis()`／`toDate()`は、72時間の訂正可否判定と`formatTime()`が引き続き使用するため、本文を変更せずpageに残す
- `dashboard-query.ts`には、未充填報告sort用のmodule private helperとして同じ本文を置く
- `dashboard-read-model.ts`には、today集計とlog sort用のmodule private helperとして同じ本文を置く
- 3箇所のhelper本文が一致することをAST比較で固定する
- runtime挙動はquery/read modelの公開関数を通すcharacterization fixtureで固定する

`Number.isFinite()`、汎用Invalid Date検査、`NaN`正規化を追加しない。

### 7.2 現行挙動として維持する境界値

| 入力 | 結果 |
|---|---|
| `null` / `undefined` / `false` / `""` / number `0` / raw number `NaN` | `null` |
| valid `Date` | epoch millis |
| Invalid `Date` | `NaN` |
| finite non-zero number | `new Date(number).getTime()` |
| `Infinity` / `-Infinity` | `NaN` |
| valid `toDate()` | returned `Date#getTime()` |
| Invalid Dateを返す`toDate()` | `NaN` |
| valid `toMillis()` | `new Date(millis).getTime()` |
| `NaN` / `Infinity` / `-Infinity`を返す`toMillis()` | `NaN` |
| valid string | `value.replace(/-/g, "/")`をDate変換したmillis |
| invalid string | `null` |

raw number `NaN`はJavaScriptでfalsyであるため、先頭の`if (!value) return null`により`null`となる。Invalid `Date`や`new Date(±Infinity)`はDate objectとしてtruthyであり、`Date#getTime()`の`NaN`がそのまま返る。

これらは望ましい新仕様ではなく、**現行挙動として維持する境界値**である。日付正規化の改善は、実データ影響を調査したうえでPR-11完了後の別設計・別PRとして扱う。

## 8. read model

### 8.1 tank status集計

各tankについて次を用いる。

```ts
const status =
  coerceTankStatusCode(tank.status)
  ?? tank.status
  ?? "不明";
```

出力は`DashboardTankSummary`とする。

- 全tankを集計する
- status codeへ変換可能ならcodeをkeyにする
- 変換不能ならraw statusをkeyにする
- nullishなら`不明`
- countのみ
- zero countのstatusを追加しない
- `totalTanks`は`tanks.length`
- status labelと色の生成はpageに残す

### 8.2 貸出先別集計

対象statusは`lent`と`unreturned`だけとする。

identity input:

```ts
{
  customerId: tank.customerId,
  customerName: tank.customerName,
  location: tank.location,
}
```

identity optionsを作る前に、現行どおりcustomerIdを次で正規化する。

```ts
const normalizedCustomerId =
  normalizeCustomerIdentityText(tank.customerId);
```

identity options:

```ts
{
  currentCustomerName:
    normalizedCustomerId
      ? customerNameById.get(normalizedCustomerId)
      : undefined,
  legacyUnknownLabel: "未設定",
}
```

group keyは`identity.key`とし、`lent`、`unreturned`、`total`を集計する。

sort:

```ts
b.total - a.total
|| a.displayName.localeCompare(b.displayName)
```

確定事項:

- customerIdを正本とする
- legacy customerName/location fallbackを維持する
- current customer master nameの表示を優先する
- legacy判定を維持する
- 同一customerIdを1groupにする
- zero groupは出力しない

### 8.3 今日の操作集計

対象は、初期queryでrepository返却順の先頭200件へ制限済みのactive logsとする。

日付境界:

- runtime local timezone
- JST固定へ変更しない
- UTC固定へ変更しない
- `nowMillis`をpure functionへ注入する
- pure function内で`Date.now()`を呼ばない

```ts
const now = new Date(nowMillis);
const startOfDay = new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate(),
).getTime();
```

pageでは、現行のtoday集計が再計算される`logs`／`staffLocale`変更時だけ現在時刻millisをcaptureする。tanks、customers、unfilled reportsだけの更新や無関係renderではtoday境界を取り直さない。現行lintのrender purityを維持するため、page側の取得も現行と同じ`new Date()`を用い、`Date.now()`は使用しない。

```ts
const todayInputs = useMemo(
  () => ({
    logs,
    staffLocale,
    nowMillis: new Date().getTime(),
  }),
  [logs, staffLocale],
);

const readModel = useMemo(
  () => buildStaffDashboardReadModel({
    tanks,
    logs: todayInputs.logs,
    customerOptions,
    unfilledReports,
    staffLocale: todayInputs.staffLocale,
    nowMillis: todayInputs.nowMillis,
  }),
  [tanks, customerOptions, unfilledReports, todayInputs],
);
```

これにより、単一read modelを再構築してもtoday境界の更新契機は現行`useMemo([logs, staffLocale])`と同じになる。

各logの時刻は`originalAt ?? timestamp`を用いる。現行条件をそのまま固定する。

```ts
const ms = timestampToMillis(log.originalAt ?? log.timestamp);
if (ms == null || ms < startOfDay) return;
```

`ms`が`NaN`の場合、`ms == null`と`ms < startOfDay`はいずれも`false`となる。このためInvalid Date等から生じた`NaN` timestampのlogは、現行では今日の操作集計へ算入され得る。これは**既知の制約。PR-11では修正しない**。

action key:

```ts
getLegacyTankActionLabel(action, staffLocale)
?? action
?? "不明"
```

同じ表示labelは同じgroupへ集約する。

breakdown sort:

```ts
b.count - a.count
|| a.action.localeCompare(b.action)
```

出力は`total`と`breakdown`とする。

### 8.4 最近の未充填報告

`StaffDashboardReadModel.recentUnfilledReports`は、query側で作成済みの最大10件から次を返す。

```ts
unfilledReports.slice(0, 5)
```

page側のbadgeはread modelではなくsource dataの`unfilledReports.length`を使用する。read model側でstatus、source、customer filterを追加しない。

### 8.5 log表示順sort

`sortStaffDashboardLogs()`は入力配列を変更せず、copyをsortする。

sort keyは`originalAt ?? timestamp`とする。

```ts
const aTime = timestampToMillis(a.originalAt ?? a.timestamp) ?? 0;
const bTime = timestampToMillis(b.originalAt ?? b.timestamp) ?? 0;

return order === "desc"
  ? bTime - aTime
  : aTime - bTime;
```

確定事項:

- `originalAt`を優先する
- `timestamp`をfallbackにする
- `revisionCreatedAt`はsort keyに使わない
- `null`だけが`0`へfallbackする
- `NaN ?? 0`は`NaN`
- Invalid Date等をepoch `0`へ正規化しない
- comparatorは`NaN`を返し得る
- comparatorが`0`相当となる要素はstable sort
- asc / desc双方で現行式を維持する
- pageの`logSortOrder` stateを維持する

## 9. root revision履歴

`fetchStaffDashboardLogHistory(rootLogId)`は次をexactに呼ぶ。

```ts
logsRepository.getLogsByRoot(rootLogId)
```

repository条件:

```text
where("rootLogId", "==", rootLogId)
```

次を追加しない。

- logStatus filter
- logKind filter
- Firestore orderBy
- Firestore limit
- pagination
- sourceLogId query

取得後、現行どおりrevision昇順へsortする。

```ts
(a.revision ?? 0) - (b.revision ?? 0)
```

履歴範囲:

- root chainに属する全取得結果
- active
- superseded
- voided
- revision欠損は`0`
- revision昇順

repositoryが返したfresh arrayをquery内でsortする現行責務を維持する。cache、loading、alert、expanded stateはquery層へ移さない。

## 10. pageに残すderived stateとUI workflow

次はread modelへ移さない。

- `selectedLogs`
- `allSelectableLogIds`
- `bulkLocationMode`
- `bulkLocationOptions`
- edit disabled reason
- void disabled reason
- bulk location unavailable reason
- correction role normalization
- correction windowの表示判定
- `canModify` / `canCorrect`
- modal input state
- session表示

これらはselection、role、modalに依存するUI workflowであり、PR-10のwrite境界とも密接である。

履歴について次もpageに残す。

- `rootId = log.rootLogId ?? log.id`
- click時の展開・閉じる
- lazy load
- `historyByRoot` cache
- cache済みなら再queryしない
- `historyLoadingRoot`
- error alert
- expanded root state
- 1画面内の表示

## 11. loading・error・refresh

### 11.1 初期取得

次の順序を維持する。

```text
dashboardLoading=true
query実行
logsをstate反映
unfilledReportsをstate反映
customerOptionsをstate反映
catch console.error
finally dashboardLoading=false
```

query側にcatchを追加しない。

### 11.2 loading表示

```text
dashboardLoading || tanksLoading
```

### 11.3 correction後

次の並列refreshを維持する。

```ts
await Promise.all([
  fetchData(),
  refetchTanks(),
]);
```

`fetchData()`の内部で`fetchStaffDashboardSourceData()`を呼ぶ。文言、await、並列性、state/history clear順序を変更しない。

### 11.4 history

```text
historyLoadingRootを設定
query実行
cacheへ保存
catchで既存alert
finallyでloading解除
```

## 12. PR-11実装時の必須テスト

### 12.1 `dashboard-query.test.ts`

初期source:

- 3readを1回ずつ呼ぶ
- deferred Promiseで3readが並列開始されること
- logs query exact `{ orderBy: null }`
- customers query exact
- uncharged query exact
- logsをrepository返却順の先頭200件へ制限
- logsをquery内で時系列sortしない
- customer配列の順序を維持
- initial source配列を変更しない
- read rejectionを同じError instanceで透過

未充填報告:

- 有効なcreatedAtを降順sort
- `null` / missing createdAtは`0`
- Invalid Date由来の`NaN`は`0`へ変換しない
- comparatorが`NaN`となる固定fixtureの現行sort結果
- 上限10件
- source配列を変更しない

root history:

- exact root ID
- filter / orderBy / limitなし
- root chain全件
- revision昇順
- missing revision=`0`
- history rejectionを同じError instanceで透過

### 12.2 timestamp conversion characterization

test目的のexportは追加しない。TypeScript ASTでpage、`dashboard-query.ts`、`dashboard-read-model.ts`から`timestampToMillis`と`toDate`の関数本文を抽出し、3箇所が本書の提示本文と一致することを固定する。加えて、query/read modelの公開関数へ境界値fixtureを渡し、sort・today集計から観測可能なruntime挙動を固定する。

AST本文一致と公開behavior fixtureの組み合わせで最低限次を固定する。

- `0` → `null`
- valid Date → millis
- Invalid Date → `Number.isNaN(result) === true`
- finite non-zero number → millis
- raw `NaN` number → `null`
- `Infinity` number → `NaN`
- valid `toDate()` → millis
- Invalid Dateを返す`toDate()` → `NaN`
- valid `toMillis()` → millis
- `NaN`を返す`toMillis()` → `NaN`
- `Infinity` / `-Infinity`を返す`toMillis()` → `NaN`
- valid string → millis
- invalid string → `null`

直接の戻り値が公開behaviorだけでは区別できない境界値はAST本文一致で固定する。helperをtest目的でexportしない。

### 12.3 `dashboard-read-model.test.ts`

tank:

- tank total
- canonical status集計
- raw status fallback
- unknown fallback
- zero countを追加しない

貸出先:

- `lent` / `unreturned`だけを集計
- customerId group
- legacy customerName group
- legacy location group
- unknown group
- current customer master name優先
- `lent` / `unreturned` count
- byLocation sort

today stats:

- runtime local day semantics
- `null` timestampは除外
- 過去timestampは除外
- 当日timestampは算入
- Invalid Date由来の`NaN` timestampが現行条件では算入されること
- `originalAt`が存在する場合は`timestamp`より優先
- action display label grouping
- breakdown sort

recent reports:

- 最大10件のsourceから先頭5件
- status / source / customer filterを追加しない

log sort:

- `null` timestampは`0` fallback
- Invalid Date由来の`NaN`は`0`へ変換しない
- comparatorが`NaN`となる固定fixtureの現行sort結果
- desc / asc双方
- `originalAt`優先
- `timestamp` fallback
- `revisionCreatedAt`を使わない
- input配列を変更しない

### 12.4 Page QC

- source query呼び出しへの置換だけ
- `useTanks()`維持
- loading/error維持
- source state反映順序維持
- correction handler差分なし
- selection差分なし
- UI / JSX / CSS差分なし
- history cache差分なし
- exact alert差分なし
- correction後refreshのawait・並列性差分なし

## 13. L0方針

後続PR-11はread/query抽出であり、production-write L2の対象外とする。正本に従いL0を実施する。

確認対象:

- total tank数
- status別件数
- 貸出先別件数
- 今日の操作 total / breakdown
- 未充填報告badgeと最大5件表示
- recent active logsの件数とsort toggle
- root historyのrevision順
- correction modal表示
- correction writeは実施しない

StaffAuthGuard maintenance writeはbusiness-data writeと分けて記録する。L0のためにConsole、REST、Admin SDKからデータを変更しない。

## 14. PR-11の対象外

- UI分割
- component抽出
- CSS変更
- layout変更
- chart追加
- server component化
- realtime listener
- pagination
- infinite scroll
- repository API追加
- repository API変更
- Firestore query変更
- Firestore index追加
- schema変更
- log field変更
- transaction field変更
- write workflow変更
- correction service変更
- correction role変更
- 72時間制約変更
- active log上限改善
- today timezone変更
- uncharged report status filter
- legacy identity cleanup
- `useTanks()`廃止
- timestamp helperの有限値検査・Invalid Date正規化

PR-12のUI再編をPR-11へ混ぜない。PR-11完了後、pageがthin wrapper化したかを確認し、PR-12を個別設計する。

## 15. 既知の制約

次は現行挙動として維持する既知の制約であり、PR-11では修正しない。

1. active logsはFirestore順序未指定のまま取得し、repository返却順の先頭200件を採用する
2. したがって厳密な「最新200件」は保証しない
3. Firestore `orderBy`追加はtimestamp欠損logを除外する可能性がある
4. uncharged reportsは全statusを取得する
5. historyはroot chain全件でlimitなし
6. tanksは全件取得する
7. today判定はbrowser runtime local timezoneを使用する
8. read modelは現在の最大200 active logsだけを今日集計へ使用する
9. timestamp helperは数値`0`とraw number `NaN`をfalsyとして`null`にする
10. Invalid Date、`Infinity`、`-Infinity`、無効な`toDate()`／`toMillis()`は`NaN`を返し得る
11. nullish fallbackは`NaN`へ適用されない
12. log sort comparatorは`NaN`を返し得る
13. 未充填報告sort comparatorは`NaN`を返し得る
14. 今日の操作集計では`NaN` timestampが除外されない場合がある
15. 9〜14は現行挙動のcharacterizationであり、日付正規化の改善は実データ調査を伴う別設計・別PRとする

## 16. PR-11実装完了条件

- 想定変更5ファイルだけ
- query API・read model APIが本書と一致
- repository API・Firestore query・index・schema変更なし
- `useTanks()`維持
- initial source、集計、sort、historyの出力が現行と一致
- timestamp境界値characterizationがPASS
- query/read model固有testがPASS
- page QCがPASS
- full unit、eslint、TypeScript、build、既存transition testがPASS
- L0結果を記録
- production business-data write 0件
- production-write L2対象外の理由を記録
- UI再編・PR-12を混在させない
