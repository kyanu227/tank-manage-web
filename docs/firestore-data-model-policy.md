# Firestore Data Model Policy

## Purpose

この文書は、主要 Firestore collection の責務と、今後の整理方針を固定する入口文書である。

詳細な監査・設計は以下も参照する。

- `docs/design/data-model-source-of-truth.md`
- `docs/data-layer-migration-plan.md`
- `docs/refactor/firestore-write-boundary-audit.md`
- `docs/customer-data-model-redesign.md`

## Core Rule

各 collection は、業務上の正本を分けて持つ。

- `tanks`: 現在状態のスナップショット
- `logs`: 操作履歴の正本
- `transactions`: 顧客起点の業務フロー
- `customers`: 貸出先・請求単位のマスタ
- `staff`: 操作主体のマスタ

名前や表示ラベルは snapshot として必要な場合がある。ただし、`staffName` / `customerName` / `location` / 日本語 action 文字列を業務ロジックの正本にしない。

## tanks

`tanks` は現在状態のスナップショット。

「今このタンクがどこにあり、どの状態か」を表す。通常画面の高速 read や操作直前の現在状態確認では `tanks` を読む。

### 現在状態として残す候補

- `status`
- `location`
- `latestLogId`
- `updatedAt`

### 物理タンク属性として残す候補

- `type`
- `note`
- `nextMaintenanceDate`
- `createdAt`
- `maintenanceDate`

### 将来整理候補

- `staff`
- `logNote`

`staff` は直近操作スタッフの表示用 snapshot として使われている。長期的には `latestLogId` から `logs` を参照して導出できる可能性がある。

`logNote` は現在 `[TAG:unused]` / `[TAG:uncharged]` などの一時タグにも使われている。次のコード変更フェーズでは、保存形式を変えずに `[TAG:*]` と `condition` の変換を純粋関数へ集約する。最初に削除しない。

### 注意

- `tanks.location` は現行ポータルの `customerName` 検索に使われているため、最初に正規化しない
- `tanks.customerId` の追加は最初の実装で行わない
- `tanks` に申請履歴や操作履歴を詰め込まない
- `transactions.status` を `tanks.status` と混同しない
- `tanks.updatedAt` を貸出日時・返却日時・請求根拠の唯一正本にしない

## logs

`logs` は操作履歴の正本。

「いつ、誰が、どのタンクに、何をしたか」を残す。過去表示、監査、編集、取消、revision chain の中心にする。

### 方針

- `logStatus` は `active` / `superseded` / `voided` を維持する
- edit / void / revision の仕組みを壊さない
- 将来的には `staffId` / `staffName` / `customerId` / `customerName` を top-level field として扱う
- `staffName` / `customerName` / `location` は当時表示用 snapshot として扱う
- `logExtra` に正本 ID を詰め込む設計は避ける
- 操作種別の集計は、長期的には日本語 `action` 文字列ではなく action code / `transitionAction` 相当へ寄せる

`logs` は過去に何が起きたかの正本であり、現在状態の正本ではない。現在状態は `tanks` に持たせる。

## transactions

`transactions` は顧客起点の業務フロー。

注文、返却申請、未充填報告などを扱う。`transactions` は workflow の状態を表し、タンク状態そのものの正本ではない。

### 方針

- portal return request は `transactions(type="return", status="pending_return")` を作るだけ
- `pending_return` の時点では `tanks` / `logs` を更新しない
- staff が確認・処理した段階で `tanks` / `logs` を更新し、transaction を `completed` にする
- 将来的には `approvedByStaffId` / `approvedByStaffName` / `fulfilledByStaffId` / `fulfilledByStaffName` など、スタッフ操作欄を名前だけにしない
- order 側の `pending` / `pending_approval` / `approved` と、return 側の `pending_return` を混同しない

## customers

`customers` は貸出先・請求単位のマスタ。

`customerName` は表示名であり、長期的には `customerId` を正本にする。顧客名変更時に過去ログの表示 snapshot を一括で書き換えない。

ただし、最初の実装では `tanks.location` の意味を変えない。現行ポータルが `customerName` 文字列で現在貸出中タンクを検索しているため、`customerId` 正規化は依存整理後に行う。

## customerUsers

`customerUsers` は Firebase Auth user と `customers` の紐付けを扱う。

`status` は Firestore に保存せず、`setupCompleted` / `disabled` / `customerId` から派生する方針を維持する。顧客自身の setup から `customerId` / `customerName` / `disabled` を保存しない。

## staff

`staff` は操作主体のマスタ。

`staffName` は表示名であり、長期的には `staffId` を正本にする。`staffByEmail` / `staffByUid` は認証・lookup 用 mirror であり、staff 正本ではない。

## orders

`orders` は顧客のタンク発注ではなく、資材発注用。

顧客のタンク発注は `transactions(type="order")` として扱う。`orders` と `transactions(type="order")` を同じ業務として混ぜない。

## No Backfill First

このプロジェクトは実運用前のため、最終 schema へ寄せる段階で不要な legacy backfill は前提にしなくてよい。

ただし、現行コード依存を無視した一括変更は避ける。特に `tanks.location`, `logs.action`, `tanks.logNote`, `transactions.status` は既存 UI と集計に依存があるため、依存棚卸し、純粋関数化、workflow 境界整理の順で進める。
