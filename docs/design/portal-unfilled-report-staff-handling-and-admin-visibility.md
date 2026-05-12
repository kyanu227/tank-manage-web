# Portal Unfilled Report Staff Handling and Admin Visibility

作成日: 2026-05-12

対象 commit: `42c2a12a15501859a869db1c5bab00cf2ef7e775`

対象 project: `okmarine-tankrental`

この document は、顧客ポータルの未充填報告 `transactions.type == "uncharged_report"` の Phase 2 方針を、staff-side handling workflow と admin visibility / notification に訂正する。

今回の範囲:

- docs-only
- 実装変更なし
- `firestore.rules` 変更なし
- `firebase.json` 変更なし
- package files 変更なし
- Firestore data write なし
- tank update なし
- logs create/edit/void/delete なし
- billing / sales / reward 変更なし
- Security Rules deploy なし
- Hosting deploy なし
- `firebase deploy` なし
- Firestore Console / script direct edit なし
- delete / void 操作なし

---

## 1. Policy Correction

PR #75 / PR #76 では、portal unfilled report の Phase 2 を admin review metadata / admin-only update として整理した。

この前提は、今回の業務方針変更により superseded とする。

新しい正本方針:

- 顧客からの未充填報告などの報告系統は staff 側で処理・管理する。
- Admin は報告処理の owner ではない。
- Admin はスタッフ管理、貸出先管理、金銭管理、統計情報の閲覧に用いる。
- Admin 側には、事後把握・統計・通知管理として報告情報を表示するのは有用。
- Admin 側の「品質報告」count は統計・把握用として維持可能。
- 初期 Phase では admin 側に処理ボタンを置かない。
- 将来的な LINE 通知は「管理者・責任者への notification」として扱い、報告処理そのものとは分離する。

Superseded docs:

- [portal-unfilled-report-review-metadata.md](./portal-unfilled-report-review-metadata.md)
- [portal-unfilled-report-review-rules-plan.md](./portal-unfilled-report-review-rules-plan.md)

上記 documents は docs-only であり、実装変更・Rules 変更・Firestore data write・deploy は行っていない。そのため、コードや本番 data の rollback は不要。

今後これらを参照する場合は、admin review / admin-only update 前提が superseded であることを明記する。

---

## 2. Layer Model

未充填報告は 3 層に分けて扱う。

### 2.1 Customer Report Layer

顧客報告レイヤー。

- `/portal/unfilled` から作成される。
- Firestore document は `transactions.type == "uncharged_report"`。
- 顧客が「このタンクが未充填だった」と報告した事実を記録する。
- `transactions.status: "completed"` は「顧客報告 record 作成完了」を意味する。
- `transactions.status` は staff handling の状態を表さない。

### 2.2 Staff Handling Layer

現場対応レイヤー。

- 報告の処理 owner は staff。
- staff が未対応、確認済み、対応済み、対象外、重複などを管理する。
- Phase 2 の write path はこの層に置く。
- return tag processing とは混ぜない。
- Phase 2 では tank status / logs / billing / reward に副作用を出さない。

### 2.3 Admin Visibility / Notification Layer

管理・通知・統計レイヤー。

- Admin は報告を処理する担当者ではない。
- Admin は状況把握、統計、通知管理、金銭・請求判断の入口として情報を見る。
- 初期 Phase では read-only count / trend / notification status を中心にする。
- LINE 通知は将来の management notification として設計する。

---

## 3. Business Responsibility vs Implementation Layers

この document の Layer Model は business responsibility model であり、implementation layer そのものではない。

責務整理:

- Customer Report Layer は「顧客が報告した事実を誰の責務として扱うか」の整理。
- Staff Handling Layer は「現場 staff が報告をどう対応するか」の整理。
- Admin Visibility / Notification Layer は「管理者・責任者がどう把握し、通知を受けるか」の整理。

これらは実装上の階層名ではない。実装では、read/write separation を優先する。

### 3.1 Write Side

write side は service / command 層に集約する。

方針:

- page / hook から Firestore に直接 write しない。
- portal report create と staff handling update は用途別 service に分ける。
- portal write は portal unfilled report create service が担当する。
- staff write は staff handling service が担当する。
- staff handling service は `handlingStatus` / `handledBy...` / `handlingNote` などの handling metadata だけを更新する。
- tank update / logs create / billing / reward write は Phase 2 handling service に含めない。

### 3.2 Read Side

read side は repository / query 層に集約する。

方針:

- source of truth は `transactions.type == "uncharged_report"`。
- staff UI は staff 用 hook を介して report list を読む。
- 現状は `transactionsRepository.getUnchargedReports()` を使う。
- 将来は `useStaffUnfilledReports()` または `useStaffQualityReports()` のような hook を検討する。
- admin UI は raw reports を直接処理せず、quality report stats layer を介して読む。
- 将来は `useAdminQualityReportStats()` のような hook を検討する。

### 3.3 Future `uncharged_report` Structure

将来構成:

| concern | candidate |
|---|---|
| source of truth | `transactions.type == "uncharged_report"` |
| portal write | portal unfilled report create service |
| staff write | staff handling service |
| staff read | `transactionsRepository.getUnchargedReports()` / future staff report hook |
| admin read | quality report stats layer / future admin stats hook |
| notification | future notification service |

admin stats layer の候補:

- count
- trend
- customer aggregation
- tank aggregation
- handlingStatus 別 count
- notification state

notification は `handlingStatus` とは分離する。LINE 通知は future notification service として扱う。

### 3.4 Current Gap

現状:

- `tanks` / `logs` / `transactions` の読み取り repository 化は既にかなり進んでいる。
- write service 化も order / return / customer / settings 系では一部進んでいる。
- ただし admin stats layer と report 系の hook / stats architecture はまだ未整理。

この PR では、上記の実装レイヤー整理そのものには入らない。次の大きな設計タスクとして残す。

Future task:

- `implementation-layer-architecture.md` のような docs を作る。
- write side / read side / hooks / admin stats layer を整理する。
- shared / feature components の境界を整理する。
- service / repository / domain operation service の境界を整理する。

---

## 4. Terminology Changes

admin review 前提の用語を staff handling 前提に置き換える。

| superseded term | new preferred term | memo |
|---|---|---|
| `reviewStatus` | `handlingStatus` | staff 側の対応状態 |
| `reviewedAt` | `handledAt` | staff が対応状態を更新した時刻 |
| `reviewedByStaffId` | `handledByStaffId` | handler staff id |
| `reviewedByStaffName` | `handledByStaffName` | handler display name |
| `reviewedByStaffEmail` | `handledByStaffEmail` | handler email |
| `reviewNote` | `handlingNote` | staff 対応メモ |
| `duplicateOfTransactionId` | `duplicateOfTransactionId` | 維持候補 |

Admin / management notification 用の将来候補:

```text
notificationStatus
managementNotifiedAt
notifiedChannels
notificationError
lastNotificationAttemptAt
```

方針:

- handling metadata と notification metadata は分離する。
- notification metadata は「誰が報告を処理したか」を表さない。
- admin / management notification は staff handling の代替にしない。

---

## 5. `handlingStatus` Values

候補:

| value | meaning | actor |
|---|---|---|
| field missing / `open` | 未対応 | portal create / legacy document |
| `acknowledged` | staff が確認済み | staff |
| `resolved` | staff が対応済み | staff |
| `dismissed` | 誤報・対象外 | staff |
| `duplicate` | 重複報告 | staff |

方針:

- 既存 document の field missing は read/UI 側で `open` とみなす。
- `transactions.status: "completed"` は「顧客報告 record 作成完了」として維持する。
- `transactions.status` と `handlingStatus` は分離する。
- `pending`, `approved`, `completed`, `pending_return` を handling status として再利用しない。
- `resolved` は billing / reward 自動反映を意味しない。
- `dismissed` は delete / void ではなく、監査可能な handling state として残す。

---

## 6. Staff UI Policy

現状:

- PR #73 で `/staff/dashboard` に「顧客未充填報告」read-only panel を追加済み。
- 本番ログイン後 protected UI smoke check は未完了。

Phase 2 方針:

- staff 側に handling 操作を追加する。
- `/staff/dashboard` は最小開始地点として維持できる。
- 将来的には `/staff/reports` または `/staff/quality-reports` の専用画面も候補。

操作候補:

- 確認済みにする。
- 対応済みにする。
- 対象外にする。
- 重複として扱う。
- `handlingNote` を残す。

禁止 / 非目標:

- return tag processing とは混ぜない。
- `/staff/return` の返却タグ処理 queue に入れない。
- tank status update しない。
- logs create しない。
- billing / sales / reward に自動反映しない。
- delete / void を handling の代替にしない。

UI 文言:

- 「未充填返却タグ」と混同しないように、「顧客未充填報告」または「顧客品質報告」とする。
- 「返却処理」ではなく「報告対応」として扱う。
- handling 操作ボタンを置く場合は、tank 状態が変わらないことを UI 上でも明確にする。

---

## 7. Admin UI Policy

Admin は報告処理の owner ではない。

維持してよいもの:

- `/admin` の「品質報告」count。
- 未対応報告数の read-only 表示。
- 今月の未充填報告数。
- 顧客別報告数。
- タンク別報告数。
- handlingStatus 別 count。
- LINE 通知済み / 未通知の状態表示。

初期 Phase で避けるもの:

- admin 側の処理ボタン。
- admin-only handling update。
- billing / reward への自動反映。
- admin 操作で tank status / logs を動かす導線。

理由:

- 報告処理は現場 staff の業務。
- Admin は管理・金銭・統計・通知の観点で状況を把握する。
- Admin action を先に入れると、現場対応と管理判断の責務が混ざる。

将来候補:

- `/admin` で未対応件数と傾向を表示。
- `/admin/quality-reports` で read-only analytics を表示。
- billing / compensation に接続する場合は、staff handling 完了後の別 Phase として設計する。

---

## 8. Notification Policy

将来的に、未充填報告が作成された時に LINE 通知を送るのは有用。

ただし通知は「報告の処理」ではなく「管理者・責任者への notification」として扱う。

初期 Phase:

- LINE 通知は実装しない。
- notification metadata は handling metadata と分離する。
- notification failure / retry は専用設計に分ける。

将来候補:

- `uncharged_report` 作成時に管理者 LINE へ通知する。
- `handlingStatus == "open"` のまま一定時間経過したら通知する。
- `resolved` / `dismissed` 時に通知するかは別途判断する。
- 通知先は admin / owner / manager role などを別途設計する。

metadata 候補:

```text
notificationStatus
managementNotifiedAt
notifiedChannels
notificationError
lastNotificationAttemptAt
```

注意:

- LINE 通知は外部連携・秘密情報・失敗時 retry が絡むため、専用設計 PR に分ける。
- 通知状態を `handlingStatus` に混ぜない。
- 通知済みでも現場対応済みとは限らない。

---

## 9. Security Rules Policy Correction

PR #76 の admin-only update 方針は superseded。

新しい Phase 2 Rules 方針:

- Phase 2 では staff-side handling update を検討する。
- update actor は `isStaff()` を基本候補にする。
- ただし全 staff に許可するか、role / rank / operation permission で制限するかは別途決める。
- admin は read-only / statistics 用 read は可。
- create は customer portal flow に限定する。
- delete は許可しない。
- update は handling metadata のみに限定する。

変更可能 field 候補:

```text
handlingStatus
handledAt
handledByStaffId
handledByStaffName
handledByStaffEmail
handlingNote
duplicateOfTransactionId
updatedAt
```

変更不可 field:

```text
type
status
tankId
customerId
customerName
createdByUid
createdAt
source
items
condition
deliveryType
deliveryTargetName
order/return lifecycle fields
billing/sales/reward fields
```

Rules design notes:

- `resource.data.type == "uncharged_report"` の既存 document のみ。
- `request.resource.data.type == resource.data.type`。
- `request.resource.data.status == resource.data.status`。
- `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...handling fields...])`。
- `handlingStatus` は `open` / `acknowledged` / `resolved` / `dismissed` / `duplicate` に限定する。
- tank/logs/billing/reward への side effect は別 collection write として許可しない。

未決事項:

- `isStaff()` だけで十分か。
- `role`, `rank`, `settings/adminPermissions`, operation permission のどれかを使うべきか。
- 準管理者 / 管理者も staff handling 操作をできるか。
- `duplicateOfTransactionId` の validation を Rules に入れるか service に寄せるか。

---

## 10. Phase 2 Implementation Blockers

実装前 blocker:

- current `uncharged_report` payload の read-only 確認。
- 本番ログイン後の protected UI smoke check。
- staff-side handling permission の決定。
- `handlingStatus` naming の確定。
- notification metadata を Phase 2 に入れるか後回しにするか。
- rules-unit-test 方針の再作成。
- PR #75 / #76 を参照する時は superseded と明記する。
- `transactionsRepository.getUnchargedReports()` の取得範囲 / sort / limit / index 方針。
- Phase 2 でも tank/logs/billing/reward に副作用を出さないことの検証方針。

---

## 11. Recommended PR Split

推奨順:

A. Correction docs-only

- この PR。
- PR #75 / #76 の admin review 前提を superseded として整理する。
- 実装なし。

B. Current uncharged_report payload read-only inspection docs

- 本番 data は read-only。
- payload / count / existing field missing を確認。
- Firestore Console / script direct edit はしない。

C. Staff handling metadata / rules plan docs

- `handlingStatus` / handler fields / Rules allow-deny cases を具体化。
- admin visibility / notification metadata とは分ける。

D. Staff-side handling UI / service implementation

- staff dashboard or dedicated staff report UI。
- handling metadata update service。
- tank/logs/billing/reward 変更なし。

E. `firestore.rules` + rules-unit-test

- staff-side handling update rule。
- immutable field deny。
- non-staff deny。
- no deploy。

F. App-flow verification docs

- staff acknowledged / resolved / dismissed / duplicate。
- immutable tamper deny。
- tank/logs/billing/reward side effect なし。

G. Admin statistics / notification design

- admin read-only analytics。
- LINE notification design。
- notification metadata。

H. LINE notification implementation, if needed

- external integration。
- secret / retry / failure handling。
- dedicated verification。

Deploy separation:

- Hosting deploy は UI 変更時のみ明示的に分離する。
- Security Rules deploy は tests / review / explicit approval 後に分離する。
- 無指定 `firebase deploy` は使わない。

---

## 12. Non-Goals

この docs PR では以下を行わない。

- implementation changes
- `firestore.rules` changes
- `firebase.json` changes
- package files changes
- Firestore data create/update/delete
- tank update
- logs create/edit/void/delete
- billing / sales / reward changes
- Security Rules deploy
- Hosting deploy
- `firebase deploy`
- Firestore Console / script direct edit
- delete / void operations
