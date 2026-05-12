# Portal Unfilled Report Phase 2 Minimum Spec

作成日: 2026-05-12

対象 commit: `01a1f5b422661ca8c1874ed9c0587283ff31e937`

対象 project: `okmarine-tankrental`

この document は、顧客ポータルの未充填報告 `transactions.type == "uncharged_report"` について、Phase 2 の最小実装範囲を確定する。

今回の範囲:

- docs-only
- 実装変更なし
- `firestore.rules` 変更なし
- `firebase.json` 変更なし
- package files 変更なし
- Firestore data create/update/delete なし
- Security Rules deploy なし
- Hosting deploy なし
- `firebase deploy` なし
- Firestore Console / script direct edit なし
- tank update なし
- logs create/edit/void/delete なし
- billing / sales / reward 変更なし
- delete / void 操作なし

関連 document:

- [implementation-layer-architecture.md](./implementation-layer-architecture.md)
- [portal-unfilled-report-staff-handling-and-admin-visibility.md](./portal-unfilled-report-staff-handling-and-admin-visibility.md)
- [portal-unfilled-report-staff-admin-flow.md](./portal-unfilled-report-staff-admin-flow.md)

---

## 1. Purpose

目的:

- 未充填報告 Phase 2 の最小実装範囲を確定する。
- staff が報告を処理できる導線を作る前に、metadata と責務を明確にする。
- admin は処理 owner ではなく、統計・可視化・将来通知のために見る位置付けにする。
- 既存 `transactions.status`、tank status、logs、billing、reward と混同しない。
- PR #78 の implementation layer architecture に沿って、固定テンプレートではなく状況に応じた最小構造を選ぶ。

Phase 2 minimum spec は実装前の正本仕様であり、この document 自体では code / Rules / data / deploy を変更しない。

---

## 2. Fixed Premises

固定する前提:

- source of truth は `transactions.type == "uncharged_report"`。
- `transactions.status == "completed"` は「報告 record 作成完了」を意味する。
- `transactions.status` は staff handling lifecycle には使わない。
- staff が handling owner。
- admin は初期 Phase では handling owner ではない。
- admin は read-only visibility / statistics / future notification surface として扱う。
- admin-owned management writes と report handling は混同しない。
- tank update / logs create / billing / reward への自動連動は初期 Phase ではしない。
- notification metadata は handling metadata と分ける。
- handling は delete / void の代替ではない。

---

## 3. Handling Metadata

Phase 2 で追加する handling metadata の候補:

```text
handlingStatus
handledAt
handledByStaffId
handledByStaffName
handledByStaffEmail
handlingNote
duplicateOfTransactionId
```

### 3.1 Field Meanings

| field | meaning | required in Phase 2 write |
|---|---|---|
| `handlingStatus` | staff handling lifecycle | yes |
| `handledAt` | staff が handling state を最後に更新した時刻 | yes when status changes |
| `handledByStaffId` | 最後に handling state を更新した staff id | yes when available |
| `handledByStaffName` | 最後に handling state を更新した staff display name | yes |
| `handledByStaffEmail` | 最後に handling state を更新した staff email | yes when available |
| `handlingNote` | staff の対応メモ | optional |
| `duplicateOfTransactionId` | 重複先の transaction id | allowed only for `duplicate`, optional in Phase 2 |

方針:

- `handlingStatus` が missing の既存 document は read/UI 側で `open` とみなす。
- `handledAt` / `handledBy...` は「最後に handling metadata を更新した時刻・staff snapshot」を表す。
- `handlingNote` は staff handling の補足であり、admin notification の結果を書かない。
- `duplicateOfTransactionId` は `handlingStatus == "duplicate"` のときだけ許可する field とする。
- ただし、初期 Phase では duplicate target selection UI を必須にしないため、`duplicateOfTransactionId` は必須 field にはしない。
- `transactions.status` は更新しない。

### 3.2 Last Handling Update Metadata

`handledAt` / `handledByStaffId` / `handledByStaffName` / `handledByStaffEmail` は、必ずしも「resolved にした時刻・対応完了者」だけを意味しない。

Phase 2 minimum では、次のような staff handling metadata の最終更新を表す。

- `open -> in_progress`
- `in_progress -> resolved`
- `open -> duplicate`
- `open -> rejected`
- `resolved -> in_progress`
- `duplicate -> in_progress`
- `rejected -> in_progress`
- `handlingNote` の更新を status update と同時に行う場合

つまり `handledAt` は completion-only timestamp ではなく、last handling update timestamp である。`handledBy...` も completion-only actor ではなく、last handling update staff snapshot として扱う。

将来的に completion-only metadata が必要になった場合は、`resolvedAt` / `resolvedBy...` のような別 field を追加する。より厳密な命名へ寄せる場合は、`handlingUpdatedAt` / `handlingUpdatedBy...` も検討できる。ただし Phase 2 minimum では既存方針との整合を優先し、`handledAt` / `handledBy...` を last handling update metadata として扱う。

### 3.3 Duplicate Target Policy

`duplicateOfTransactionId` は `handlingStatus == "duplicate"` のときだけ許可される field とする。

ただし Phase 2 minimum では、duplicate target selection UI を必須にしない。したがって、`handlingStatus == "duplicate"` でも `duplicateOfTransactionId` missing を許容する。

理由:

- `duplicate` state は delete / void せず重複報告を閉じるために必要。
- 重複先 transaction の厳密な選択 UI は初期実装を大きくする。
- 初期 Phase で `duplicateOfTransactionId` を required にすると、重複先選択 UI なしでは `duplicate` にできなくなる。

将来、重複先選択 UI を追加する場合は、`duplicateOfTransactionId` を required に寄せる余地を残す。

---

## 4. `handlingStatus` Minimum Set

検討候補:

- `open`
- `in_progress`
- `resolved`
- `duplicate`
- `rejected`

### 4.1 Adopted Phase 2 Set

Phase 2 minimum では、以下の 5 値を採用する。

| value | meaning | actor | notes |
|---|---|---|---|
| field missing / `open` | 未対応 | portal create / legacy document | 既存 document 互換のため missing を `open` と読む |
| `in_progress` | staff が対応中 | staff | staff が拾ったことを示す。必須経由 state ではない |
| `resolved` | staff が対応済みにした | staff | billing / reward 自動反映を意味しない |
| `duplicate` | 重複報告として閉じた | staff | delete ではなく監査可能な handling state |
| `rejected` | 誤報・対象外として閉じた | staff | void ではなく監査可能な handling state |

採用理由:

- `open` は既存 document 互換と未対応 count に必要。
- `in_progress` は「誰かが拾った」状態を表し、現場対応の二重処理を減らす。
- `resolved` は通常の対応完了に必要。
- `duplicate` は同じ tank / customer からの重複報告を delete せず閉じるために必要。
- `rejected` は誤報・対象外を delete / void せず閉じるために必要。

過剰に増やさない値:

- `acknowledged`
- `confirmed`
- `dismissed`
- `cancelled`
- `pending`
- `approved`
- `completed`
- `pending_return`

`in_progress` は必須経由 state ではない。staff は、報告内容が明確なら `open` から直接 `resolved` / `duplicate` / `rejected` に更新してよい。

### 4.2 Status Transition Policy

最小 transition:

```text
open -> in_progress
open -> resolved
open -> duplicate
open -> rejected
in_progress -> resolved
in_progress -> duplicate
in_progress -> rejected
resolved -> in_progress
duplicate -> in_progress
rejected -> in_progress
```

reopen の扱い:

- `resolved` / `duplicate` / `rejected` から `in_progress` へ戻すことは許容する。
- `open` へ戻す操作は初期 UI では用意しない。未対応に戻したい場合は `in_progress` を使う。
- reopen しても `transactions.status` は変更しない。
- reopen は tank / logs / billing / reward に副作用を出さない。

---

## 5. Staff Operations

staff ができる最小操作:

- 未対応報告を見る。
- `in_progress` にする。
- `resolved` にする。
- `duplicate` として閉じる。
- `rejected` として閉じる。
- `handlingNote` を残す。
- 既存 `handlingNote` を更新する。

### 5.1 Staff UI Minimum

最小 UI:

- staff が報告 list を見る。
- tankId / customerName / createdAt / source / handlingStatus / handlingNote を確認できる。
- status 更新 button または selector を使える。
- note 入力欄を使える。
- 更新後に refetch する。
- update error を画面上で確認できる。

初期 Phase では、`duplicateOfTransactionId` の厳密な選択 UI は optional とする。

理由:

- duplicate state 自体は必要だが、重複先 transaction を厳密に紐付ける UI は初期実装を大きくする。
- `duplicateOfTransactionId` は service / schema 上の将来拡張点として残す。

### 5.2 Staff Non-Goals

初期 Phase で staff がしない操作:

- tank status update
- logs create
- logs edit
- logs void
- billing 反映
- reward 反映
- sales 反映
- report delete
- report void
- return tag processing queue への投入
- admin review
- notification status update

未充填報告 handling は、return tag processing とは別 workflow とする。`condition: "uncharged"` の返却タグ処理と `transactions.type == "uncharged_report"` を混ぜない。

---

## 6. Admin Read / Stats

admin は初期 Phase では handling owner ではない。

admin の位置付け:

- read-only visibility
- statistics
- future notification surface

admin に表示してよい read-only stats:

- 未対応報告数
- 月次件数
- 顧客別件数
- タンク別件数
- `handlingStatus` 別 count
- 将来 `notificationStatus` 別 count

admin page に初期 Phase で置かないもの:

- `handlingStatus` 更新 button
- `handlingNote` 更新 form
- `duplicate` / `rejected` などの handling 操作
- staff の代わりに報告を処理する workflow

Admin-owned management writes は別物である。

- staff 登録、staff 情報更新、顧客設定、単価設定、order master、admin permissions、portal / notification settings は admin-owned write UI として扱える。
- しかし unfilled report handling は staff owner であり、admin management settings の write と混同しない。

---

## 7. Notification

notification は future notification service として扱う。

方針:

- LINE 通知などは management notification である。
- `handlingStatus` と `notificationStatus` は分ける。
- 通知済みは staff handled を意味しない。
- staff handled は管理者通知済みを意味しない。
- notification metadata は handling metadata と混ぜない。

将来候補:

```text
notificationStatus
managementNotifiedAt
notifiedChannels
notificationError
lastNotificationAttemptAt
```

初期 Phase では notification write は行わない。Admin には将来 notification surface のために read-only stats を置く可能性があるが、handling 操作とは別に設計する。

---

## 8. Implementation Layer Mapping

PR #78 の implementation layer architecture に従う。ただし、固定テンプレート化せず、初期 Phase では過剰設計しない。

### 8.1 Staff Write

候補 flow:

```text
staff page
  -> staff hook
    -> staff handling service
      -> transactions repository / Firestore adapter
```

責務:

- page は UI composition を担当する。
- hook は UI state、selected report、note input、service call、refetch、alert を担当する。
- staff handling service は staff identity、allowed status、payload、Timestamp、write を担当する。
- repository は Firestore adapter として document update helper を持つ。

service を厚めにする理由:

- staff identity resolution が必要。
- permission-sensitive write である。
- future audit / edit_history insertion point になりうる。
- `transactions.status` と `handlingStatus` を混同しない validation が必要。

### 8.2 Staff Read

候補 flow:

```text
transactionsRepository / report query
  -> staff report hook
    -> staff page / component
```

責務:

- repository / query は `transactions.type == "uncharged_report"` を読む。
- missing `handlingStatus` を `open` とみなす read model を作る。
- hook は loading / error / refetch / UI state を持つ。
- page / component は表示と操作 UI に閉じる。

### 8.3 Admin Read

候補 flow:

```text
transactionsRepository / report query
  -> unfilled report stats layer
    -> admin stats hook
      -> admin dashboard / future stats view
```

責務:

- stats layer は count / monthly / byCustomer / byTank / byHandlingStatus を作る。
- admin hook は read model と loading / error を UI に接続する。
- admin page は read-only stats を表示する。
- admin page は handling button を持たない。

### 8.4 Repository

repository は Firestore adapter である。

持ってよいもの:

- `getUnchargedReports()` のような read helper
- handling metadata update helper
- Timestamp / nullable field の正規化
- service から呼ぶ document update helper

持たないもの:

- staff handling lifecycle の業務判断
- admin handling owner 判断
- notification lifecycle
- tank / logs lifecycle

### 8.5 Minimality Rule

初期 Phase では、必要最小限の構造にする。

- 小さい read-only panel は page-local component でもよい。
- staff handling write は service boundary を置く。
- admin stats は再利用が見込まれるため stats layer を検討する。
- 実装 PR では UI refactor、write schema、Rules、deploy を混ぜない。

---

## 9. Security Rules Consideration

Phase 2 実装時には Security Rules の確認が必要である。

設計上の要件:

- staff は `transactions.type == "uncharged_report"` の handling metadata だけを更新できる必要がある。
- staff が `transactions.status`、customer fields、items、billing-related fields、tank/logs fields を変更できないようにする必要がある。
- admin は初期 Phase では handling metadata を更新しない前提にする。
- customer は handling metadata を更新できない。
- notification metadata を追加する場合は handling metadata とは別 rules とする。

今回の PR では `firestore.rules` を変更しない。deploy もしない。

Rules 変更が必要な場合は、future implementation task として別 PR に分ける。Security Rules deploy は docs-only PR や UI-only PR と混ぜない。

### 9.1 Future Rules Task

future task:

- 現行 Rules で staff が handling metadata を安全に update できるか確認する。
- 必要なら `uncharged_report` handling metadata 専用の update rule を設計する。
- allowed fields を `handlingStatus` / `handledAt` / `handledBy...` / `handlingNote` / `duplicateOfTransactionId` に限定する。
- `duplicateOfTransactionId` は `handlingStatus == "duplicate"` のときだけ許可する。ただし初期 Phase では `duplicate` でも missing を許容する可能性がある。
- `transactions.status` を handling update で変更できないことを確認する。
- Rules deploy は別途 review 後に行う。

---

## 10. Non-Goals

今回やらないこと:

- implementation code
- `firestore.rules` 変更
- `firebase.json` 変更
- package files 変更
- Firestore data create/update/delete
- Security Rules deploy
- Hosting deploy
- `firebase deploy`
- Firestore Console / script direct edit
- tank update
- logs create/edit/void/delete
- billing / sales / reward 変更
- delete / void 操作
- staff handling UI 実装
- admin stats UI 実装
- repository / service 実装
- notification 実装

tsc / build を実行しない理由:

- 今回の差分は docs-only であり、TypeScript / Next.js の実装 artifact を変更しない。
- package files、source files、Firebase config、Rules を変更しない。
- 検証は Markdown 差分の whitespace / conflict marker 確認に限定する。

docs-only 検証として実行するもの:

```bash
git diff --check
git diff --cached --check
```
