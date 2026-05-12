# Implementation Layer Architecture

作成日: 2026-05-12

対象 commit: `7e59ad3f47a08f7581be5efb0e20b31d37b8fba6`

対象 project: `okmarine-tankrental`

この document は、タンク管理 Web アプリの実装レイヤー責務を整理し、業務責務モデルと実装レイヤーを混同しないための正本設計として扱う。

今回の範囲:

- docs-only
- 実装変更なし
- `firestore.rules` 変更なし
- `firebase.json` 変更なし
- package files 変更なし
- Firestore data write なし
- Security Rules deploy なし
- Hosting deploy なし
- `firebase deploy` なし
- Firestore Console / script direct edit なし
- tank update なし
- logs create/edit/void/delete なし
- billing / sales / reward 変更なし
- component 実装変更なし

---

## 1. Purpose

この document の目的は、business responsibility model と implementation layer architecture を分離することである。

business responsibility model は、「誰が業務上の owner か」を扱う。

例:

- portal customer は未充填を報告する。
- staff は未充填報告を処理する。
- admin は read-only visibility / statistics / future notification surface として状況を見る。

implementation layer architecture は、「コード上でどの層が何を担当するか」を扱う。

例:

- page
- hook
- service
- command
- repository
- query
- stats
- component

この 2 つは別の設計軸である。

Codex が report 系、admin stats、shared component、Firestore write 境界を扱うとき、業務 owner の話をそのまま page / service / repository の配置に変換しない。特に portal unfilled report では、PR #77 で admin review / admin-only update 前提が superseded となり、handling owner は staff、admin は read-only visibility / statistics / future notification surface と整理された。この方針は業務責務モデルであり、admin page / staff page / repository の配置そのものを直接決めるものではない。

今後の土台にする領域:

- report 系の write / read / handling / notification 分離
- admin stats の read model 化
- shared component と feature component の整理
- page から service / hook / stats への責務移動
- Firestore write と UI refactor の PR 分離

---

## 2. Current Summary

現状の到達点:

- `tanks` / `logs` / `transactions` の read repository 化はかなり進んでいる。
- `logsRepository.getActiveLogs()`、`getLogsByRoot()`、`transactionsRepository.getOrders()`、`getReturns()`、`getPendingTransactions()` など、主要な読み取り処理は repository 経由に移行済み。
- write service 化も order / return / customer / settings 系で進んでいる。
- `src/lib/tank-operation.ts` は、高リスクな tank / logs 状態遷移の正本境界として維持する。
- `applyTankOperation` / `applyBulkTankOperations` / `applyLogCorrection` / `voidLog` は、tank status、logs revision、void、業務不変条件に関わるため、明示設計なしに分割・移動しない。
- admin stats layer は未整理であり、admin page が raw data を直接集計している箇所が残る。
- shared components は一部存在するが、dashboard panel / count card / status chip / report card / section label などは整理余地がある。

注意点:

- repository 化が完了しているのは主に read side である。
- write side は業務整合性が強いため、repository への単純移動を目的化しない。
- 既存 page に Firestore 直接 write が残っていることは、今後の新規実装で直接 write を増やす理由にはならない。
- `tank-operation.ts` と `tank-trace.ts` は、明示指示なしに大きく動かさない。

---

## 3. Layer Responsibilities

実装レイヤーの基本責務は次の通り。

| layer | responsibility |
|---|---|
| page | routing boundary。layout、guard 配下の画面 entry、feature component の配置だけを担う |
| hook | UI state、input、selection、alert、loading、refetch、service 呼び出しの接続を担う |
| command | 画面操作に対応する use case entry。単一業務操作の intent を表す |
| service | 業務操作の入口。validation、actor 解決、repository / operation 呼び出し、複数 write の orchestration を担う |
| repository | Firestore adapter。collection path、query、doc mapping、batch helper などの SDK 境界を担う |
| query | read side の用途別 query。repository を組み合わせ、画面や stats が必要とする read model を作る |
| stats | admin dashboard / analytics / report count 向けの集計 read model を作る |
| component | 表示・入力・操作 UI。Firestore I/O と業務 write orchestration は持たない |

### 3.1 Page

page は原則として薄い殻にする。

page が持ってよいもの:

- route entry
- guard / layout 配下の feature component 配置
- static metadata に相当する表示構造
- page-local の軽い composition

page が持たないもの:

- Firestore direct write
- raw Firestore data の複雑な集計
- tank / logs / transactions の業務状態遷移
- 複数 collection write の orchestration
- admin stats の仕様そのもの

### 3.2 Hook

hook は UI と service / query を接続する。

hook が持ってよいもの:

- input state
- selection state
- modal / alert state
- loading / submitting state
- optimistic UI の最小 state
- service 呼び出し
- refetch / reload orchestration

hook が持たないもの:

- Firestore direct write
- 複数 collection の業務 write 詳細
- tank status / logs revision の正本ルール
- stats の仕様本体

### 3.3 Command / Service

command / service は write side の業務入口である。

使い分け:

- command は UI action に対応する intent を表す薄い use case entry として使える。
- service は actor 解決、validation、repository / `tank-operation.ts` 呼び出し、batch / transaction orchestration を担う。
- 小さい feature では command を分けず、service 関数を直接 entry にしてよい。

service が持つもの:

- 業務 validation
- actor / identity の解決
- Firestore write の順序制御
- repository write helper の呼び出し
- `tank-operation.ts` など正本境界の呼び出し
- 将来の edit_history / delete_history 差し込み点

service が避けるもの:

- 表示専用 state
- DOM / React component 依存
- page-local の文言や alert 表現

### 3.4 Repository / Query / Stats

repository は Firestore adapter であり、業務責務 owner ではない。

repository が持つもの:

- collection / document path
- query constraints
- snapshot mapping
- Firestore Timestamp / nullable field の正規化
- service から呼ぶ汎用 write helper
- batch / transaction 参加 helper

repository が持たないもの:

- tank / logs 状態遷移の妥当性判断
- staff handling の業務 lifecycle 判断
- admin stats の意味付け
- UI 表示状態

query layer は read side の用途別 read model を作る。repository を組み合わせ、page / hook が raw Firestore data に依存し続ける状態を避ける。

stats layer は admin dashboard / analytics / report count 用の read model を作る。admin page が raw transactions や raw logs を直接集計し続ける構造は避ける。

### 3.5 Component

component は表示と入力の責務に閉じる。

`src/components` と `src/features/.../components` のどちらに置くかは、再利用範囲と業務依存の有無で決める。component は Firestore I/O を持たない。component から service を直接呼ぶ場合は、feature 内の狭い範囲に限り、page / hook との責務分担を明示する。

---

## 4. Write Side Architecture

write side の原則:

- page は Firestore に直接 write しない。
- hook は UI state、input、selection、alert、refetch、service 呼び出しの接続を担う。
- command / service は業務操作の入口とする。
- repository は Firestore adapter として扱う。
- 汎用 write helper は原則 service から呼ぶ。
- 高リスクな tank / logs 状態遷移は `tank-operation.ts` を正本境界として維持する。
- `tank-operation.ts` は明示設計なしに分割・移動しない。
- Security Rules と service validation は別レイヤーだが、設計上は整合させる。

### 4.1 Basic Flow

基本 flow:

```text
page
  -> hook
    -> command / service
      -> repository write helper
      -> tank-operation.ts when tank/logs lifecycle is involved
        -> Firestore SDK
```

page / hook は Firestore SDK を import しない方向に寄せる。既存の直接 write は段階的な移行対象であり、新規実装の標準形ではない。

### 4.2 Service Boundary

service は、後から履歴記録や通知を差し込める単位にする。

service にまとめるべき write:

- portal order / return / unfilled report create
- staff handling update
- staff / staffByEmail 同期更新
- customerUsers と pending transactions の紐付け
- customers の名称・単価・有効無効変更
- settings/adminPermissions や settings/inspection の保存
- notification settings の保存
- tank 登録 / 購入

service に置かず、`tank-operation.ts` の正本境界を使うべき write:

- `tanks.status` の変更
- `tanks.location` の業務遷移
- `logs` の作成
- `logs` の revision
- `logs` の void
- 貸出 / 返却 / 充填 / 修理 / 耐圧などの tank lifecycle 操作

### 4.3 Repository Write Helpers

repository の write helper は、Firestore adapter として薄く保つ。

許容する helper:

- 単一 document patch
- create payload の Timestamp 付与
- batch / transaction に参加する helper
- service 側で validation 済みの汎用 adapter

避ける helper:

- page から直接呼ばれる業務 write shortcut
- status lifecycle を隠し持つ helper
- `tank-operation.ts` と同じ業務不変条件を再実装する helper

### 4.4 Security Rules and Service Validation

Security Rules と service validation は別レイヤーである。

- service validation は UX、業務不変条件、actor 解決、write payload 整形を担う。
- Security Rules は Firestore への最終アクセス制御を担う。
- service で許可する write と Security Rules で許可する write は、設計上ずれないようにする。
- Security Rules の deploy は別作業であり、docs-only PR や実装 PR に混ぜない。

---

## 5. Read Side Architecture

read side の原則:

- Firestore read は repository / query 層に集約する。
- hook は画面単位の read model を受け取り、UI に接続する。
- page が raw Firestore data を直接集計し続ける構造は避ける。
- admin stats は raw transactions を admin page に直接渡さず、stats layer を介す。

### 5.1 Basic Flow

基本 flow:

```text
repository
  -> query
    -> stats when aggregation is needed
      -> hook
        -> page / component
```

単純な一覧取得では、hook が repository を直接呼んでもよい。ただし、複数 collection を組み合わせる、集計仕様を持つ、admin dashboard の count として再利用される、といった read は query / stats layer に分ける。

### 5.2 Query Layer

query layer は read use case に名前を付ける。

例:

- staff dashboard 用の active logs read model
- portal home 用の rental summary read model
- customer detail 用の transaction summary
- report list 用の unfilled report read model
- admin notification surface 用の report read model

query layer は repository から取得した raw data を、画面が扱いやすい形に正規化する。UI 文言や component state は持たない。

### 5.3 Stats Layer

stats layer は admin / analytics 向けの集計仕様を集約する。

stats layer が返すもの:

- count
- trend
- by customer
- by tank
- by staff
- by status
- notification / handling の状態別 count

stats layer が避けるもの:

- React state
- page-specific styling
- Firestore write
- tank lifecycle write

admin page は stats layer の read model を表示する。raw transactions / raw logs を page に渡して page 内で集計仕様を持つ構造は避ける。

---

## 6. Report Architecture Example

report 系の適用例として、portal unfilled report を正本例にする。

### 6.1 Source of Truth

未充填報告の source of truth:

```text
transactions.type == "uncharged_report"
```

意味:

- portal customer が未充填を報告した事実を記録する。
- `transactions.status == "completed"` は「報告 record 作成完了」を意味する。
- `transactions.status` は staff handling lifecycle を表さない。
- tank lifecycle、logs、billing、reward とは自動連動させない。

### 6.2 Write Side

portal write:

- portal unfilled report create service が担当する。
- page は選択された tank / input を service に渡す。
- service は customer identity、payload、Timestamp、source を整える。
- Firestore write は service から repository / adapter を介して行う。

staff write:

- staff handling service が担当する。
- handling owner は staff。
- staff が更新する metadata は `handlingStatus` / `handledBy...` / `handlingNote` を中心にする。
- `handlingStatus` は `transactions.status` と分離する。
- Phase 初期では tank update / logs create / billing / reward に副作用を出さない。

admin write:

- admin は handling owner ではない。
- admin は初期 Phase では report handling metadata を更新しない。
- admin write を追加する場合は、read-only visibility / notification settings / admin settings など、handling とは別目的として設計する。

### 6.3 Read Side

staff read:

- staff 用 query / hook を介して report list を読む。
- read model は staff が処理に必要な項目を中心にする。
- raw transactions を staff page で直接集計し続けない。

admin read:

- admin は stats layer + admin hook を介す。
- admin dashboard は count / trend / status breakdown を表示する。
- admin は read-only visibility / statistics / future notification surface として扱う。

### 6.4 Handling and Notification Separation

handling metadata:

```text
handlingStatus
handledAt
handledByStaffId
handledByStaffName
handledByStaffEmail
handlingNote
duplicateOfTransactionId
```

notification metadata の将来候補:

```text
notificationStatus
managementNotifiedAt
notifiedChannels
notificationError
lastNotificationAttemptAt
```

方針:

- notification は future notification service として扱う。
- notification は `handlingStatus` と分離する。
- LINE 通知などは management notification であり、handling metadata と混ぜない。
- 通知済みは「staff が処理した」ことを意味しない。
- staff handled は「管理者へ通知済み」を意味しない。

---

## 7. Admin Stats Layer

admin stats layer は、admin dashboard / notification / audit view で再利用できる read model を作る。

portal unfilled report 系で必要になる stats:

- 未対応報告数
- 月次件数
- 顧客別件数
- タンク別件数
- `handlingStatus` 別 count
- `notificationStatus` 別 count

### 7.1 Candidate Read Model

候補 read model:

```ts
type UnfilledReportStats = {
  totalCount: number;
  openCount: number;
  monthlyCounts: Array<{ month: string; count: number }>;
  byCustomer: Array<{ customerId: string | null; customerName: string; count: number }>;
  byTank: Array<{ tankId: string; count: number }>;
  byHandlingStatus: Array<{ status: string; count: number }>;
  byNotificationStatus: Array<{ status: string; count: number }>;
};
```

この型は設計上の候補であり、今回の PR では実装しない。

### 7.2 Layering

admin stats の flow:

```text
transactionsRepository / report query
  -> unfilled report stats layer
    -> useAdminUnfilledReportStats
      -> admin dashboard / future notification view
```

admin page が `transactions.type == "uncharged_report"` の raw documents を直接 map / reduce して count を作る状態は、将来的には避ける。

### 7.3 Future Consumers

admin stats layer の利用先:

- admin dashboard
- admin statistics page
- future notification management surface
- audit / history view
- monthly quality report
- customer support / billing review の入口

ただし、billing / sales / reward の計算仕様に入る変更は別設計とする。未充填報告 stats を追加することと、請求・報酬へ反映することは同じ PR にしない。

---

## 8. Shared / Feature Components

component の配置は、再利用範囲と業務依存度で決める。

### 8.1 `src/components` に置くもの

`src/components` は、複数 feature で使える汎用 UI に限定する。

候補:

- auth panel
- quick select
- generic dashboard panel
- generic count card
- generic status chip
- generic section label
- generic empty state
- generic loading / error state

条件:

- Firestore I/O を持たない。
- 特定 collection schema に強く依存しない。
- staff / admin / portal のいずれかに閉じた業務判断を持たない。
- props で表示に必要な read model を受け取る。

### 8.2 `src/features/...` に置くもの

`src/features/.../components` は、特定業務 feature に閉じた UI に置く。

候補:

- staff unfilled report list
- staff handling status selector
- admin unfilled report stats panel
- portal unfilled report tank selector
- customer report card
- return tag processing card
- maintenance report card

条件:

- feature 固有の read model に依存してよい。
- feature hook / service と組み合わせて使ってよい。
- 他 feature へ共有する前に、props と文言が汎用化できるかを確認する。

### 8.3 Page-local のままでよいもの

page-local に残してよいもの:

- 1 page でしか使わない小さな layout composition
- 一時的な docs / verification 用表示
- 抽出しても再利用性が低い 20-30 行程度の表示ブロック
- feature 化前の実験的 panel

ただし、page-local component でも Firestore direct write や stats 仕様を持たない。

### 8.4 Component整理方針

整理候補:

- dashboard panel
- count card
- status chip
- report card
- section label
- empty state
- loading state
- alert / notice panel

方針:

- 先に read model と service / stats boundary を決める。
- UI refactor だけの PR と Firestore write / schema / rules 変更 PR を分ける。
- 今回の PR では component 実装変更はしない。
- component 名や props は、business responsibility owner ではなく表示する read model に合わせる。

---

## 9. Prohibited and Caution Items

この document に基づく今後の作業では、以下を混ぜない。

禁止:

- UI refactor と Firestore write / schema / rules 変更を混ぜること
- docs-only PR と実装 PR を混ぜること
- Hosting deploy と Security Rules deploy を混ぜること
- 無指定 `firebase deploy`
- Security Rules deploy
- Hosting deploy
- Firestore Console / script direct edit
- Firestore data create/update/delete
- tank update
- logs create/edit/void/delete
- billing / sales / reward 変更
- `firestore.rules` 変更
- `firebase.json` 変更
- package files 変更

注意:

- `tank-operation.ts` は明示設計なしに分割・移動しない。
- `tank-trace.ts` は明示設計なしに内部 repository 化を始めない。
- `destinations` コレクションを復活させない。
- repository 化を目的化しない。
- write side の repository 化は service / operation の責務分担とセットで設計する。
- admin read-only visibility を admin handling owner と読み替えない。
- notification metadata を handling metadata と混ぜない。

---

## 10. Non-Goals for This PR

この PR では次を行わない。

- implementation code の変更
- Firestore Rules の変更
- Firebase config の変更
- package files の変更
- Firestore data migration
- Firestore data create / update / delete
- service / repository / hook / component の実装
- admin stats layer の実装
- shared component の実装
- tsc / build
- deploy

tsc / build を実行しない理由:

- 今回の差分は docs-only であり、TypeScript / Next.js の実装 artifact を変更しない。
- package files、source files、Firebase config、Rules を変更しない。
- 検証は Markdown 差分の whitespace / conflict marker 確認に限定する。

docs-only 検証として実行するもの:

```bash
git diff --check
git diff --cached --check
```
