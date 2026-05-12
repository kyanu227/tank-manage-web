# Portal Unfilled Report Review Metadata Design

作成日: 2026-05-12

対象 commit: `38e1f9436157d20f13eb3716e3fcce9886e385fc`

対象 project: `okmarine-tankrental`

この document は、顧客ポータルの未充填報告 `transactions.type == "uncharged_report"` に対する Phase 2 admin review metadata の設計を固定する。

今回の範囲:

- docs-only
- 実装変更なし
- Firestore data write なし
- Security Rules deploy なし
- Hosting deploy なし
- `firebase deploy` なし
- Firestore Console / script direct edit なし
- delete / void / logs edit なし
- `firestore.rules` / `firebase.json` / package files 変更なし

---

## 1. Current State

完了済み:

- [portal-unfilled-report-staff-admin-flow.md](./portal-unfilled-report-staff-admin-flow.md) で、portal 未充填報告を return tag processing と混ぜない方針を整理済み。
- [portal-unfilled-report-app-flow-result.md](../verification/portal-unfilled-report-app-flow-result.md) で、`/portal/unfilled` から `uncharged_report` を作成できることを確認済み。
- PR #73 で Phase 1 read-only visibility を実装済み。
  - `transactionsRepository.getUnchargedReports()`
  - `/staff/dashboard` の `顧客未充填報告` read-only panel
  - `/admin` の `品質報告` count
- PR #73 の Hosting deploy は完了済み。
- [production-unfilled-report-readonly-smoke.md](../verification/production-unfilled-report-readonly-smoke.md) で、本番未ログイン smoke check を `partial` として記録済み。

未完了:

- 本番ログイン後の `/staff/dashboard` protected UI 目視確認。
- 本番ログイン後の `/admin` protected UI 目視確認。
- admin review metadata の schema / service / UI / Security Rules。
- `reviewStatus` を使った query / index 方針。

現行 persisted payload:

```text
type: "uncharged_report"
status: "completed"
tankId
customerId
customerName
createdByUid
createdAt
updatedAt
source: "customer_app"
```

現行 Security Rules の扱い:

- customer は `isPortalUnchargedReportCreate()` により own linked portal identity で create できる。
- staff/admin は `transactions` を read できる。
- `transactions` update は order approve / order fulfill / return completion / pending_link order update に限定されている。
- `uncharged_report` の review update は現行 Rules ではまだ許可されていない。

---

## 2. Design Goals

Phase 2 の目的:

- 顧客からの未充填報告を admin が確認済み / 却下 / 重複として整理できるようにする。
- 顧客報告 record 作成状態と admin review 状態を分離する。
- tank status / logs / billing / reward にはまだ副作用を出さない。
- Phase 1 の read-only visibility を維持しながら、admin-only update の最小 write path を追加できる状態にする。

Non-goals:

- tank status update しない。
- logs create しない。
- billing / sales / reward に自動反映しない。
- return tag processing queue に入れない。
- `transactions.status` を order / return lifecycle と混ぜない。
- Firestore data cleanup / migration をこの設計 PR で実行しない。

---

## 3. Review Metadata Schema

Phase 2 で追加する候補 field:

| field | type | required on update | memo |
|---|---|---:|---|
| `reviewStatus` | string | yes | review state。field missing は `unreviewed` とみなす |
| `reviewedAt` | server timestamp | yes except reset | admin review 実行時刻 |
| `reviewedByStaffId` | string | yes | reviewer の staff id |
| `reviewedByStaffName` | string | yes | reviewer display name |
| `reviewedByStaffEmail` | string | optional | Firebase Auth / staff email。空の場合は保存しない |
| `reviewNote` | string | optional | admin note。空文字を許容するかは service で決める |
| `duplicateOfTransactionId` | string | only duplicate | 重複元 transaction id |
| `updatedAt` | server timestamp | yes | repository / service 境界で更新 |

推奨:

- `reviewStatus` は `transactions.status` とは別 field として追加する。
- 既存 document に `reviewStatus` がない場合は `unreviewed` とみなす。
- 新規 portal create 時に `reviewStatus: "unreviewed"` を追加するかは、Phase 2 実装 PR で別途判断する。
- 後方互換を優先し、field missing document を壊さない。
- `updatedAt` は review update 時に更新する。

`reviewNote` の扱い:

- Phase 2 では free-form text とする。
- 請求控除・報酬取消の根拠として自動処理しない。
- 長文・個人情報を避ける UI helper text を付ける。
- 文字数上限を入れる場合は service 側で validation する。

`duplicateOfTransactionId` の扱い:

- `reviewStatus == "duplicate"` の時だけ保存する。
- 空文字ではなく field omit を推奨する。
- duplicate target が同じ `type == "uncharged_report"` かどうかの validation は Phase 2 実装前に決める。

---

## 4. Review Status Values

最小値:

| value | meaning | actor |
|---|---|---|
| field missing / `unreviewed` | 顧客報告 record は作成済み、admin 未確認 | portal create |
| `confirmed` | admin が報告内容を確認済みとして扱う | admin |
| `dismissed` | 誤報・対象外・対応不要として扱う | admin |
| `duplicate` | 既存報告と重複として扱う | admin |

方針:

- 値名を増やしすぎない。
- `pending`, `approved`, `completed`, `pending_return` は使わない。
- `transactions.status` の既存 lifecycle と衝突させない。
- `confirmed` は billing / reward 自動反映を意味しない。
- `dismissed` は delete / void ではなく、監査可能な review state として残す。
- `duplicate` は元報告への参照を残し、元 document を削除しない。

---

## 5. Relationship With Existing `status: "completed"`

現行の `status: "completed"` は維持する。

意味:

- `status: "completed"` は「顧客報告 record 作成完了」を表す。
- `status: "completed"` は「admin 確認済み」を表さない。
- `reviewStatus` は「admin review 状態」を表す。

禁止:

- `uncharged_report` の `transactions.status` を `pending_return` に変えない。
- return tag processing と混ぜない。
- order lifecycle の `pending` / `approved` / `completed` と同じ意味にしない。
- staff 操作で tank status を動かす queue に入れない。

表示方針:

- Phase 1 の `記録済み` 表示は `status: "completed"` の表示として維持してよい。
- Phase 2 では `reviewStatus` を別 chip として出す。
- `reviewStatus` field missing は UI で `未確認` と表示する。

---

## 6. Update Ownership

### Staff

Phase 2 でも staff は read-only を維持する。

理由:

- 未充填報告は品質クレームであり、請求・顧客対応・報酬に波及する可能性がある。
- 現場 staff の return tag processing と混ぜると tank/logs を誤って動かすリスクがある。
- `/staff/dashboard` は visibility のための表示に留める。

### Admin

Phase 2 の review update は admin-only を推奨する。

admin action:

- `confirmed`
- `dismissed`
- `duplicate`
- `reviewNote` update

準管理者:

- 初回 Phase 2 では review update を許可しない方針を推奨する。
- どうしても準管理者に許可する場合は `settings/adminPermissions` と UI permission を整理した専用 PR に分ける。

### Service Boundary

実装候補:

```text
src/lib/firebase/portal-unfilled-report-review-service.ts
```

public function 候補:

```text
reviewPortalUnfilledReport(input)
```

責務:

- actor が admin であることを UI / guard から渡す。
- target transaction を読む。
- `type == "uncharged_report"` を確認する。
- immutable fields が変わらない patch だけを作る。
- `reviewStatus` / reviewer fields / `reviewNote` / `duplicateOfTransactionId` / `updatedAt` だけを update する。
- tank update / logs create / billing update は行わない。

---

## 7. Security Rules Policy

現行 Rules は `uncharged_report` の review update を許可していないため、Phase 2 実装には dedicated Rules PR が必要になる可能性が高い。

目標:

- customer は create のみ。
- staff/admin は read。
- review metadata update は admin-only。
- immutable fields は変更不可。
- tank/logs/billing への副作用は Rules 上も許可しない。

review update で変更可能な field:

```text
reviewStatus
reviewedAt
reviewedByStaffId
reviewedByStaffName
reviewedByStaffEmail
reviewNote
duplicateOfTransactionId
updatedAt
```

変更不可にする field:

```text
type
status
tankId
customerId
customerName
createdByUid
createdAt
source
```

Rules design candidate:

- `resource.data.type == "uncharged_report"` を必須にする。
- `request.resource.data.type == resource.data.type` を必須にする。
- `request.resource.data.status == resource.data.status` を必須にする。
- `diff(resource.data).affectedKeys().hasOnly([...review fields...])` を使う。
- `reviewStatus in ["unreviewed", "confirmed", "dismissed", "duplicate"]` を使う。
- `duplicateOfTransactionId` は `reviewStatus == "duplicate"` の時だけ許可するか、service validation に寄せるかを Phase 2 実装前に決める。
- `isAdmin()` を使うか、`isAdminStaff()` + page permission を使うかは dedicated Rules PR で決める。

この docs-only PR では `firestore.rules` を変更しない。

---

## 8. Query / Index Policy

Phase 1:

- `type == "uncharged_report"` の全件 read。
- `createdAt` sort は client side。
- index 追加なし。

Phase 2 候補:

1. 最小継続案
   - `type == "uncharged_report"` の全件 read。
   - `reviewStatus ?? "unreviewed"` を client side で分類。
   - 件数が少ない間は index 追加なし。

2. query 強化案
   - `type == "uncharged_report"`
   - `reviewStatus == "unreviewed"`
   - `createdAt desc`
   - `limit`

注意:

- 既存 documents には `reviewStatus` がないため、`reviewStatus == "unreviewed"` query だけでは既存未確認 report を拾えない。
- field missing 互換を保つには、client side fallback か data backfill が必要。
- data backfill は Firestore data write なので、専用 migration / operation PR に分ける。
- composite index が必要になる場合は `firestore.indexes.json` をこの PR では追加しない。

Phase 2 初回実装の推奨:

- 既存互換を優先し、最初は Phase 1 query を維持する。
- UI 側で `reviewStatus ?? "unreviewed"` として表示・filter する。
- 件数が増えた段階で index / backfill を専用 PR に分ける。

---

## 9. UI Policy

### Staff UI

`/staff/dashboard` は read-only 継続。

表示:

- tankId
- customerName
- createdAt
- source
- `transactions.status` chip
- `reviewStatus` chip

禁止:

- review action button を置かない。
- tank status を変える導線を置かない。
- logs create 導線を置かない。
- return tag processing と同じ list に混ぜない。

### Admin UI

Phase 2 では admin 側に review action を置く。

初回実装候補:

- `/admin` dashboard に count を維持。
- count は `未確認件数 / 総件数` のどちらかを明示する。
- 可能なら dedicated section で最近の未確認 report を数件表示する。
- action は `confirmed`, `dismissed`, `duplicate` のみ。

Dedicated page 候補:

```text
/admin/quality-reports
```

Dedicated page は初回 Phase 2 に必須ではない。

最小 Phase 2 実装:

- `/admin` 上の small panel で未確認 report を表示。
- 各 row に review action を置く。
- 詳細 page / billing 連携 / reward 連携は後回し。

---

## 10. Logs / Tanks / Billing / Reward

Phase 2 では変更しない。

| area | Phase 2 policy |
|---|---|
| tanks | update しない |
| logs | create / edit / void / delete しない |
| billing | 自動控除しない |
| sales | 自動反映しない |
| reward | 自動取消・減算しない |

理由:

- `confirmed` は「admin が報告を確認した」だけで、請求控除や報酬変更の確定ではない。
- 顧客報告は誤報・重複・後日確認があり得る。
- tank/logs は物理操作履歴として残すべきで、品質報告 record とは分離する。

将来候補:

- Phase 3: quality event / audit event の設計。
- Phase 4: billing / compensation review candidate の設計。

---

## 11. App-Flow Verification Policy

Phase 2 実装時に必要な検証:

1. admin confirmed update
   - expected: allow
   - actual app-flow write: `transactions/{id}` review metadata update only

2. admin dismissed update
   - expected: allow
   - actual app-flow write: `transactions/{id}` review metadata update only

3. admin duplicate update
   - expected: allow
   - `duplicateOfTransactionId` が保存されること

4. staff read-only
   - expected: staff dashboard で見える
   - expected: review action は出ない

5. non-admin review update
   - expected: deny
   - emulator / rules-unit-test で確認する

6. immutable field tamper
   - expected: deny
   - `type`, `status`, `tankId`, `customerId`, `createdByUid`, `source` 変更を拒否する

7. no side effects
   - tank update なし
   - logs create なし
   - billing / reward update なし

検証方針:

- Firestore Console / script direct edit は使わない。
- app-flow write は admin UI / service 経由に限定する。
- Security Rules 変更が入る場合は emulator / rules-unit-test を先に通す。
- rollback / cleanup は review metadata を元に戻す必要がある場合のみ、専用手順で扱う。

---

## 12. Implementation Blockers

実装前に確認すること:

- 本番ログイン後の `/staff/dashboard` protected UI smoke check が未完了。
- 本番ログイン後の `/admin` protected UI smoke check が未完了。
- current `transactions.type == "uncharged_report"` payload の実データ確認。
- `reviewStatus` field missing を `unreviewed` として扱う UI / service helper。
- existing Rules に `uncharged_report` review update がないため、Rules draft が必要。
- admin-only の定義を `isAdmin()` にするか、admin permissions と接続するか。
- index / query 方針。
- review UI を `/admin` dashboard に置くか dedicated page に分けるか。
- duplicate target validation を service に寄せるか Rules に寄せるか。

---

## 13. Recommended PR Split

推奨順:

A. `docs-only` review metadata design

- この PR。
- 実装なし。

B. Phase 2 implementation draft

- review metadata types / helpers。
- admin read/action UI。
- service function。
- no Rules deploy。
- no tank/logs/billing/reward.

C. Security Rules review update draft

- admin-only review metadata update rule。
- emulator / rules-unit-test。
- no deploy until reviewed.

D. App-flow verification result docs

- admin confirmed / dismissed / duplicate。
- non-admin deny。
- immutable field deny。

E. Hosting deploy if UI changed

- Hosting only。

F. Later phases

- quality event / logs integration。
- billing / reward candidate flow。
- dedicated admin page if needed。

---

## 14. Non-Goals

この docs PR では以下を行わない。

- implementation changes
- Firestore data create/update/delete
- tank update
- logs create/edit/void/delete
- billing / sales / reward changes
- Security Rules deploy
- Hosting deploy
- `firebase deploy`
- Firestore Console / script direct edit
- delete / void operations
- `firestore.rules` / `firebase.json` / package files changes
