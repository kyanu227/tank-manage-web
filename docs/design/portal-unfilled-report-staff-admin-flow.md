# Portal Unfilled Report Staff/Admin Flow Design

作成日: 2026-05-12

対象 commit: `9f6c9a6354ce2fdd215878916b400c37a7c71c14`

対象 project: `okmarine-tankrental`

この document は、顧客ポータルの未充填報告 `transactions.type == "uncharged_report"` を staff/admin 側でどう表示・処理するかの設計を固定する。

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

現行実装:

- `/portal/unfilled` は linked portal customer の貸出中 tank を表示する。
- 顧客が tank を選択して送信すると `createPortalUnfilledReports()` が `transactions` に document を作る。
- 作成 payload は `type: "uncharged_report"` / `status: "completed"` / `tankId` / `customerId` / `customerName` / `createdByUid` / `source`。
- `transactionsRepository.getUnchargedReports()` は存在するが未実装。
- `/staff/return` は `pending_return` の return tag processing と貸出中 tank の通常返却を扱う。
- `/staff/dashboard` は `logs` の active log を表示するため、`transactions` の uncharged report は専用行として出ない。
- `/admin` の要対応 count は既定で `pending`, `pending_approval`, `pending_return` を見るため、`completed` の uncharged report は要対応に入らない。

検証結果:

- [portal-unfilled-report-app-flow-result.md](../verification/portal-unfilled-report-app-flow-result.md) で、portal unfilled report create は `pass`。
- staff/admin 専用表示は現行 UI では未実装または未接続のため `partial`。
- [f12-cleanup-normal-return-after-unfilled-report.md](../verification/f12-cleanup-normal-return-after-unfilled-report.md) で、検証用 F12 は通常返却済み。

既存方針:

- `uncharged_report` は顧客からの品質報告であり、return tag processing の `condition: "uncharged"` と同じ flow に混ぜない。
- `uncharged_report` は tank lifecycle の状態ではない。
- 未充填はタンク破損ではなく、こちら側の充填ミスまたは準備ミスの記録である。
- 既存 docs では、`uncharged_report` は `completed` のまま記録として扱う方針がある。

---

## 2. Problem Statement

PR #70 の検証で、次が明確になった。

- 顧客は `/portal/unfilled` から未充填報告を作成できる。
- しかし staff/admin が業務上その報告を拾う専用導線がない。
- `transactions.status == "completed"` のため、既存の要対応 query には入らない。
- `logs` には作成されないため、staff dashboard の最近の操作ログにも出ない。
- 現場の `未充填` 返却タグ UI と portal の未充填報告は意味が違うが、名称が近いため誤操作リスクがある。

したがって、次の実装前に「どこに出すか」「誰が確認するか」「tank/logs/billing/reward にいつ影響させるか」を分けて決める必要がある。

---

## 3. Display Location Options

### Option A: Staff dashboard read-only panel

内容:

- `/staff/dashboard` に「未充填報告」または「品質報告」panel を追加する。
- `transactions.type == "uncharged_report"` の最近の報告を read-only 表示する。
- 表示項目は tankId, customerName, createdAt, source, review state。

利点:

- 現場スタッフが日常的に見る画面で気づきやすい。
- return tag processing と分けて表示できる。
- Phase 1 の read-only 実装に向いている。

懸念:

- 処理責任者が曖昧なままだと、見えるが対応されない可能性がある。
- staff が誤って返却タグ処理と混同しない文言が必要。

### Option B: Staff return に統合

内容:

- `/staff/return` に「顧客未充填報告」section を追加する。
- return tag processing とは別 section にする。

利点:

- 未充填は返却・回収業務と近いため、現場文脈で見つけやすい。
- 貸出中 tank の状態確認と隣接できる。

懸念:

- `return condition: "uncharged"` と `uncharged_report` を混同しやすい。
- `/staff/return` はすでに pending return tags と bulk return を持つため、操作面が混みやすい。
- read-only 表示から始めないと、誤って tank status を変える導線になりやすい。

### Option C: Admin dashboard / admin quality panel

内容:

- `/admin` に未確認の品質報告 count を表示する。
- さらに admin 側に「品質報告」一覧を追加する。

利点:

- 請求・品質管理・顧客対応の判断を admin に寄せられる。
- 誤報・重複・請求控除の判断に向いている。
- `completed` の報告記録を、別の review metadata で管理しやすい。

懸念:

- 現場スタッフが即時に気づきにくい。
- 専用 admin page を作る場合は navigation / permissions / rules / query まで範囲が広がる。

### Option D: Dedicated staff/admin page

内容:

- `/staff/unfilled-reports` または `/admin/quality-reports` の専用画面を作る。

利点:

- 業務意味が明確。
- 将来の review, duplicate, billing note, compensation note に拡張しやすい。

懸念:

- 初回実装としては大きい。
- page permissions / nav / smoke test が増える。

### Recommended start

最小実装は次を推奨する。

1. `/staff/dashboard` に read-only の「顧客未充填報告」panel を追加する。
2. `/admin` に read-only count を追加する。
3. 詳細一覧は Phase 2 以降で admin 側に寄せる。

理由:

- PR #70 の gap は「作成された報告が見えない」ことなので、最初は read-only visibility を解消する。
- staff return に混ぜると返却タグ処理と混同するため、初回は避ける。
- tank/logs/billing/reward へ自動反映しないことで、誤報・重複時の副作用を抑える。

---

## 4. Status Lifecycle

### Current persisted status

現行:

```text
type: "uncharged_report"
status: "completed"
```

これは既存 docs の方針と一致している。

意味:

- `completed` は「顧客からの報告記録は作成完了」を表す。
- `completed` は「staff/admin が内容確認済み」を表さない。
- `completed` を既存の pending queue に混ぜない。

### Recommended review lifecycle

`transactions.status` をすぐ変更するのではなく、Phase 2 で review metadata を追加する案を推奨する。

候補 field:

```text
reviewStatus: "unreviewed" | "confirmed" | "dismissed" | "duplicate"
reviewedAt
reviewedByStaffId
reviewedByStaffName
reviewedByStaffEmail
reviewNote
duplicateOfTransactionId
```

初期値:

- Phase 1 では既存 data 互換のため field なしを `unreviewed` とみなす。
- 新規作成時に `reviewStatus: "unreviewed"` を追加するかは、Phase 2 の schema PR で決める。

状態の意味:

| state | meaning | actor |
|---|---|---|
| field missing / `unreviewed` | 顧客報告は作成済み、staff/admin 未確認 | portal create |
| `confirmed` | 管理側が報告内容を確認した | admin or authorized staff |
| `dismissed` | 誤報・対象外として扱う | admin preferred |
| `duplicate` | 重複報告として既存報告へ寄せる | admin preferred |

避けること:

- `transactions.status` を `pending_return` にしない。
- return tag processing の queue に入れない。
- `pending` / `approved` / `completed` の order lifecycle と混ぜない。
- `completed` を「対応不要」と断定しない。あくまで「報告記録作成済み」である。

---

## 5. Processing Ownership

### Staff can see

staff は read-only で見えるべき。

理由:

- 現場で顧客から問い合わせを受ける可能性がある。
- 該当 tank がまだ貸出中か、返却済みかを現場で確認できる。

### Staff can process

初回では staff processing を入れない。

理由:

- 未充填報告は請求・品質・報酬に影響する。
- 誤報や重複の判断が必要。
- 現場の返却タグ処理と混ぜると、tank status を誤って動かすリスクがある。

### Admin can review

Phase 2 以降で admin review を推奨する。

admin action:

- `confirmed`
- `dismissed`
- `duplicate`
- `reviewNote` 保存

準管理者や worker の権限:

- Phase 1: read-only
- Phase 2: admin or configured permission のみ review update

---

## 6. Tanks / Logs Impact

### Tank status

Portal unfilled report create では tank status を変更しない。

理由:

- 顧客の報告だけでは、物理 tank が返却されたとは限らない。
- 未充填は tank 破損ではない。
- `貸出中` のまま顧客が保持している可能性がある。
- 状態変更は staff が実際に回収・返却処理した時点で行う。

### Logs

Phase 1 では logs create しない。

理由:

- 現行 portal service は `transactions` のみ作成する。
- `logs` は物理 tank operation の履歴として扱う。
- 顧客報告だけで operation log を作ると、実際の tank 状態変更と誤解される。

Phase 3 で検討する logging:

- `quality_event` 的な logKind を追加する。
- または `transactions` に review fields を持たせ、logs には接続しない。
- logs へ出すなら actor は customerUser と admin reviewer を分ける必要がある。

### tank.logNote

Portal unfilled report create では `tanks.logNote` を更新しない。

理由:

- `logNote` は返却タグなど現場処理用の一時 marker として使われている。
- Portal report が入っただけで返却タグを付けると、staff bulk return で誤った return action になる恐れがある。

---

## 7. Billing / Compensation / Quality

### Initial policy

最初は請求・報酬へ自動反映しない。

理由:

- 顧客報告は事実確認前の品質クレームである。
- 誤報・重複・操作ミスがあり得る。
- 請求控除や報酬取消は admin review 後に扱うべき。

### Later policy candidates

Phase 4 で検討する。

- `confirmed` の uncharged report を billing review に表示する。
- 関連する貸出 log / 充填 log を trace し、報酬取消候補を出す。
- 自動控除ではなく、admin に候補として提示する。
- 顧客ごとの quality report history を監査用に残す。

### Audit requirement

品質クレームとして監査可能にするため、最低限次を残す。

- tankId
- customerId / customerName
- createdByUid
- createdAt
- source
- reviewStatus / reviewedAt / reviewer
- reviewNote

---

## 8. Difference From Return Tag Processing

| item | portal unfilled report | return tag processing `condition: "uncharged"` |
|---|---|---|
| trigger | 顧客が貸出中 tank について報告する | 顧客 return request または staff return 時に返却 condition を処理する |
| collection | `transactions` | `transactions` + `tanks` + `logs` |
| type/status | `type: "uncharged_report"`, `status: "completed"` | `type: "return"`, `status: "pending_return"` -> completed |
| tank state change | create 時点ではしない | staff processing 時に実行する |
| logs create | create 時点ではしない | staff processing 時に作る |
| meaning | 品質報告 / クレーム記録 | 返却時の物理状態処理 |
| owner | admin review 寄り | staff operation |

混ぜる場合のリスク:

- 顧客報告だけで tank を返却済み扱いにしてしまう。
- `未充填` tag が付いたまま bulk return され、意図しない `返却(未充填)` log が作られる。
- admin review 前に請求・報酬へ影響する。

分ける場合のリスク:

- staff/admin が報告を見落とす。
- 顧客対応が遅れる。

結論:

- UI は分ける。
- staff/admin dashboard で visibility を持たせる。
- tank/logs の状態変更は return tag processing または別の明示 operation に限定する。

---

## 9. Implementation Blockers

実装前に確認すること:

- Production data に既存 `uncharged_report` が何件あるか。
- `transactions` の actual payload に `createdAt`, `updatedAt`, `source`, `tankId`, `customerId`, `customerName`, `createdByUid` が揃っているか。
- `getUnchargedReports()` を実装する場合の query と index 要否。
- `status == "completed"` のまま read-only 表示するか、`reviewStatus` field を追加するか。
- Security Rules が staff/admin の read と review update を許可できるか。
- repository / service 境界をどう置くか。
- admin permissions に専用 page を追加するか。
- billing / sales / reward に触れるかどうか。
- app-flow verification 手順。
- cleanup / rollback 方針。

Index candidates:

- Phase 1 read-only:
  - `transactions`: `type == "uncharged_report"`
  - client sort if small volume
- Phase 2 review:
  - `transactions`: `type == "uncharged_report"`, `reviewStatus == "unreviewed"`
  - optional `createdAt desc`

Rules candidates:

- Staff/admin read of `uncharged_report`.
- Admin-only review update.
- Customer create remains limited to own linked portal identity and current allowed payload.

---

## 10. Recommended Phases

### Phase 1: Read-only visibility

Goal:

- staff/admin が portal unfilled report を見落とさない。

Scope:

- Implement `transactionsRepository.getUnchargedReports()`.
- Add staff dashboard read-only panel.
- Add admin dashboard read-only count or panel.
- No transaction update.
- No tank update.
- No logs create.
- No billing/reward changes.

Files candidates:

- `src/lib/firebase/repositories/transactions.ts`
- `src/lib/firebase/repositories/types.ts`
- `src/app/staff/dashboard/page.tsx`
- `src/app/admin/page.tsx`
- possibly a shared display component under `src/features/`

Do not touch:

- `tank-operation.ts`
- `tank-trace.ts`
- billing / reward logic
- `firestore.rules` unless a dedicated rules PR is required after design review

Verification:

- Existing PR #70 generated report should appear.
- staff/admin screens should show report without permission-denied.
- No app-flow write should occur in read-only phase.

### Phase 2: Admin review status

Goal:

- admin が report を confirmed / dismissed / duplicate にできる。

Scope:

- Add review metadata fields.
- Add service function for review update.
- Add admin UI action.
- Keep tank/logs unchanged.

Files candidates:

- `src/lib/firebase/portal-unfilled-report-review-service.ts`
- `src/lib/firebase/repositories/transactions.ts`
- `src/app/admin/...` dedicated or dashboard section

Rules:

- Admin-only review update needs Security Rules review.

Verification:

- app-flow review update with admin account.
- deny non-admin update if rules are changed.

### Phase 3: Quality event / logs integration

Goal:

- confirmed reports can be traced in operational history without pretending a physical return happened.

Options:

- Keep all quality history in `transactions`.
- Or create a separate quality event logKind.
- Do not reuse physical return logs unless a physical return action happened.

Blockers:

- log schema and report/revision semantics.
- audit and display requirements.

### Phase 4: Billing / compensation integration

Goal:

- confirmed report can inform billing adjustment or compensation review.

Policy:

- Do not auto-refund or auto-cancel compensation at first.
- Present candidates for admin review.
- Keep billing and incentive changes in dedicated PRs.

---

## 11. Non-Goals

This design PR does not:

- implement staff/admin UI
- change `transactions` schema
- update Firestore data
- create or edit logs
- change tank state
- change billing / reward logic
- change Security Rules
- deploy anything
- modify package files

---

## 12. Recommended Next PR

Recommended next PR:

```text
[codex] Add read-only portal unfilled report visibility
```

Suggested scope:

- Implement `getUnchargedReports()` with a small query.
- Add read-only panel to `/staff/dashboard`.
- Add read-only count or panel to `/admin`.
- Use existing report data only.
- No review update.
- No tank/logs/billing/reward changes.

This keeps the first implementation aligned with the actual gap found in PR #70: report creation works, but staff/admin visibility is missing.
