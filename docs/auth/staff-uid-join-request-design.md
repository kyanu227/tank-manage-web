# Staff UID Join Request Design

更新日: 2026-05-06

## 目的

スタッフ認証を、現行の `staffByEmail` / email lookup 中心の構造から、将来的に Firebase Auth UID を正本に近い認証キーとして扱う構造へ移行するための設計を固定する。

この文書は docs-only の設計であり、実装、Security Rules 変更、Firestore data 変更、deploy は行わない。

## 現行課題

現行の staff / admin 認証は、Firebase Auth user の email を使って `findActiveStaffByEmail()` で active staff を探す構造である。

- `StaffAuthGuard` は Firebase Auth user の email を `findActiveStaffByEmail()` に渡し、見つかった profile から `localStorage.staffSession` を作る。
- `AdminAuthGuard` も Firebase Auth user の email から staff profile を探し、role と `settings/adminPermissions` で admin page access を判定する。
- `findActiveStaffByEmail()` は `staffByEmail/{emailKey}` を優先し、見つからない場合は `staff` collection を email query で fallback read する。
- PR #24 以降、fallback read 後の `staffByEmail` auto-repair write は削除済み。
- `staff-sync-service.saveStaffMembers()` は `staff` と `staffByEmail` mirror を batch で同期している。

この構造には Security Rules 本番化前の caution が残る。

- Firestore Rules は email lowercase 変換ができない。
- 現行 rules draft の `isStaff()` は `staffByEmail/{request.auth.token.email}` を参照する。
- 実装側の `staffEmailKey()` と mirror 同期は lowercase doc id を前提にしている。
- Firebase Auth email と `staffByEmail` doc id の casing がズレると、Rules 上の staff 判定に失敗する。
- passcode localStorage session は `request.auth` に出ないため、Rules 上の staff ではない。
- UID は Firebase Auth で本人がログインしたときに自然に取得できるが、管理者が事前に全スタッフの UID を知る運用は難しい。

## 採用する基本方針

長期的には `staffByUid/{uid}` を staff 認証用 mirror として導入する。

- `staff/{staffId}` はスタッフ情報の正本として維持する。
- `staffByUid/{uid}` は Rules / AuthGuard 用の認証 mirror として扱う。
- 未登録 Firebase Auth user は staff 権限を得ない。
- 未登録 user は `staffJoinRequests/{uid}` に申請を作る。
- 管理者が申請を確認し、既存 staff への紐付けまたは新規 staff 作成を承認する。
- 承認時に `staff.authUid` と `staffByUid/{uid}` を作る。
- `staffByEmail` は互換用に当面残す。
- UID 移行後、`staffByEmail` は fallback に下げ、完全撤去は別設計で判断する。
- 共通登録パスワードで誰でも staff を自動作成できる方式は採用しない。

共通登録パスワード方式を採用しない理由:

- staff role / rank / isActive を本人入力に委ねると権限昇格の余地が生まれる。
- 登録パスワードが漏れた場合、未承認 user が staff 権限を得るリスクがある。
- UID と既存 staff の紐付けは本人性だけでなく、管理者による業務上の確認が必要である。
- Firestore Rules 本番化では、client からの自己 staff 作成を安全に許可しづらい。

## データモデル案

### `staffJoinRequests/{uid}`

Firebase Auth user が staff 画面に来たが active staff として見つからない場合に、本人が作成する申請 document。

| field | type | 説明 |
|---|---|---|
| `uid` | string | Firebase Auth UID。document id と一致させる |
| `email` | string | `request.auth.token.email` 由来。本人入力を信用しない |
| `displayName` | string | Firebase Auth displayName 由来。空文字可 |
| `requestedName` | string | 申請者が入力する表示名候補 |
| `message` | string | 申請理由・補足 |
| `status` | `"pending" \| "approved" \| "rejected"` | 申請状態 |
| `createdAt` | timestamp | 作成日時 |
| `updatedAt` | timestamp | 更新日時 |
| `reviewedAt` | timestamp | 管理者レビュー日時 |
| `reviewedByStaffId` | string | レビューした管理者 staffId |
| `reviewedByStaffName` | string | レビューした管理者名 snapshot |
| `linkedStaffId` | string | 承認時に紐付けた staffId |

`pending` 作成時に client が書ける field は、`uid`, `email`, `displayName`, `requestedName`, `message`, `status`, `createdAt`, `updatedAt` に限定する想定。

### `staff/{staffId}`

既存 staff document を正本として維持し、UID 紐付け用 field を追加する。

| field | type | 説明 |
|---|---|---|
| 既存 fields | existing | `name`, `email`, `passcode`, `role`, `rank`, `isActive` など |
| `authUid` | string | 紐付け済み Firebase Auth UID |
| `authEmail` | string | 紐付け時の Firebase Auth email snapshot |
| `uidLinkedAt` | timestamp | UID 紐付け日時 |
| `isActive` | boolean | 既存 field。Rules 上の staff 有効判定にも使う |

`authUid` は同一 staff に複数 UID を許可しない前提で扱う。UID 付け替えは、通常承認とは別の管理者向け修正フローに分ける。

### `staffByUid/{uid}`

Rules / AuthGuard 用の mirror。

| field | type | 説明 |
|---|---|---|
| `staffId` | string | 参照先 staff document id |
| `name` | string | staff name snapshot |
| `email` | string | staff email snapshot |
| `role` | string | `一般` / `準管理者` / `管理者` |
| `rank` | string | staff rank |
| `isActive` | boolean | Rules 上の active staff 判定 |
| `updatedAt` | timestamp | mirror 更新日時 |

`staffByUid` は `staff` の正本ではない。role / rank / isActive の変更時は、`staff` と `staffByUid` を同一 batch / service で同期する。

### 既存 `staffByEmail`

当面は互換用に残す。

- 現行 `StaffAuthGuard` / `AdminAuthGuard` の fallback として維持する。
- 既存 staff 管理 UI / `staff-sync-service` との互換を壊さない。
- UID 移行後は lookup 優先順位を `staffByUid` → `staffByEmail` → `staff` query fallback に変える。
- 完全撤去は、AuthGuard / Rules / data migration / manual verification が揃った後に別設計で判断する。

## 申請フロー

未登録 Firebase Auth user が staff 画面に来た場合:

1. user は Firebase Auth で Google または Email/Password login 済み。
2. `StaffAuthGuard` は UID 優先 lookup を試す。
3. UID で staff が見つからない場合、email fallback を試す。
4. どちらでも active staff が見つからない場合、staff 権限は付与しない。
5. `localStorage.staffSession` は作らない。
6. staff operation 画面は表示せず、staff join request form を表示する。
7. form では `requestedName` と `message` だけを本人入力にする。
8. `uid`, `email`, `displayName` は Firebase Auth user から自動付与する。
9. `staffJoinRequests/{uid}` を `status: "pending"` で作成する。
10. 作成後は「承認待ち」表示にする。

申請者本人が変更できる範囲は、pending 中の `requestedName` / `message` 程度に限定する。role / rank / isActive / linkedStaffId は本人に入力させない。

## 管理者承認フロー

管理者画面で pending requests を扱う。

1. `staffJoinRequests` の pending 一覧を表示する。
2. 管理者は `uid`, `email`, `displayName`, `requestedName`, `createdAt`, `message` を確認する。
3. 既存 staff に紐付けるか、新規 staff を作成するか選ぶ。
4. 新規 staff の場合、`name`, `email`, `role`, `rank`, `isActive` を管理者が決める。
5. 既存 staff の場合、既に `authUid` がある staff へ別 UID を上書きしない。
6. 承認時に以下を同一 service / batch で更新する。
   - `staff/{staffId}.authUid`
   - `staff/{staffId}.authEmail`
   - `staff/{staffId}.uidLinkedAt`
   - `staffByUid/{uid}`
   - `staffJoinRequests/{uid}.status = "approved"`
   - `staffJoinRequests/{uid}.reviewedAt`
   - `staffJoinRequests/{uid}.reviewedByStaffId`
   - `staffJoinRequests/{uid}.reviewedByStaffName`
   - `staffJoinRequests/{uid}.linkedStaffId`
7. rejected の場合、`staffByUid` は作らず、staff 権限は付与しない。

承認 service は `staff-sync-service` と責務が近いが、申請 review と UID mirror 作成を含むため、最初は `staff-join-request-service.ts` のような専用 service に分ける方が安全。

## 退職・無効化フロー

退職または利用停止時は、Firebase Auth アカウント削除ではなく staff 側の active 判定を落とす。

- `staff/{staffId}.isActive = false`
- `staffByUid/{uid}.isActive = false`
- `staffByEmail/{emailKey}.isActive = false` または mirror 同期で inactive 反映
- `localStorage.staffSession` は次回 AuthGuard 検証時に破棄される
- Firestore Rules 上は `staffByUid/{request.auth.uid}.isActive == true` が false になり、staff write は deny される
- Firebase Auth user を削除しなくても staff 権限は落ちる
- 過去ログは `staffId` / `staffName` snapshot として残す

UID を解除する場合は、退職フローとは別に管理者専用の unlink 手順を設計する。誤 unlink は本人 login 不能に直結するため、通常の staff 編集とは分ける。

## AuthGuard 移行方針

### Phase 1: docs-only 設計

この文書で UID join request / staffByUid / Rules 方針を固定する。実装は行わない。

### Phase 2: staffJoinRequests 申請 UI

- `StaffAuthGuard` から未登録 Firebase Auth user を申請 UI に誘導する。
- `staffJoinRequests/{uid}` の own create / own read を Rules draft で許可する。
- 申請作成後は承認待ち表示にする。
- staff 権限や `staffSession` は付与しない。

### Phase 3: 管理者承認 UI

- admin に pending request 一覧を追加する。
- 既存 staff へ紐付けるか、新規 staff を作成するか選べるようにする。
- 承認 / 却下 service を作る。
- 承認時に `staff.authUid` と `staffByUid/{uid}` を作る。

### Phase 4: AuthGuard を staffByUid-first lookup に変更

- `StaffAuthGuard` は Firebase Auth UID で `staffByUid/{uid}` を先に読む。
- `AdminAuthGuard` も UID lookup を優先する。
- `staffByUid` がなければ、移行期間のみ `staffByEmail` fallback を使う。
- email fallback で見つかった場合も、勝手に `staffByUid` は作らない。UID 紐付けは管理者承認に限定する。

### Phase 5: Firestore Rules を staffByUid 優先へ変更

- `isStaff()` は `staffByUid/{request.auth.uid}.isActive == true` を見る。
- `staffRole()` は `staffByUid/{request.auth.uid}.role` を見る。
- 移行期間は `staffByEmail` fallback を残すか、Rules 上は UID のみにするかを別途判断する。
- `staffByEmail` fallback を Rules に残す場合、email casing caution は残る。
- UID のみに寄せる場合、全 active staff の `staffByUid` 作成確認が deploy 前 blocker になる。

### Phase 6: deploy readiness verification

- `docs/verification/security-rules-manual-verification.md` を UID 方式に合わせて更新する。
- `staffByUid` あり / なし、inactive、rejected request、passcode session を allow / deny で検証する。
- `firebase.json` 接続と Security Rules deploy 手順は別 PR / 別手順に分ける。

## Security Rules 方針案

この section は方針のみであり、`firestore.rules` は変更しない。

### `staffJoinRequests`

| operation | 方針 |
|---|---|
| create | signed in かつ `request.auth.uid == uid`。payload の `uid` / `email` は auth と一致 |
| get | owner または admin |
| list | admin |
| update | admin。owner 更新を許す場合は pending 中の `requestedName` / `message` のみに限定 |
| delete | admin または deny。運用合意が必要 |

owner create の必須条件:

- document id は `request.auth.uid`
- `request.resource.data.uid == request.auth.uid`
- `request.resource.data.email == request.auth.token.email`
- `status == "pending"`
- `role`, `rank`, `isActive`, `linkedStaffId`, `reviewedBy*` は本人 create payload に含めない

### `staffByUid`

| operation | 方針 |
|---|---|
| get | own uid または admin |
| list | admin |
| create | admin |
| update | admin |
| delete | admin または deny。無効化は `isActive: false` を優先 |

最終形の `isStaff()` 案:

```text
signedIn()
&& exists(staffByUid/{request.auth.uid})
&& staffByUid/{request.auth.uid}.isActive == true
```

最終形の `staffRole()` 案:

```text
get(staffByUid/{request.auth.uid}).role
```

## 脆弱性と対策

| risk | 対策 |
|---|---|
| 未登録 user が勝手に staff になる | 未登録 user は `staffJoinRequests` しか作れず、`staffByUid` は管理者だけが作る |
| 本人が role / rank を入力する | 申請 payload に role / rank / isActive を許可しない |
| uid / email のなりすまし | `uid` / `email` は auth 由来と一致することを Rules で検証する |
| 同じ UID を複数 staff に紐付ける | `staffByUid/{uid}` を一意 key とし、承認 service で既存紐付けを拒否する |
| authUid あり staff へ別 UID を上書きする | 承認時に既存 `authUid` を確認し、通常承認では上書きしない |
| rejected user が再申請を乱発する | rejected から pending に戻せる条件を管理者操作に限定する。spam 対策は future scope |
| inactive staff が再ログインする | `staff.isActive` と `staffByUid.isActive` を false に同期し、Rules で deny する |
| passcode-only session が staff write する | Rules は localStorage を見られないため deny 前提。passcode 復活は別認証設計 |
| 共通登録パスワード漏洩 | 共通登録パスワード方式を採用しない |

## 最小 PR 分割案

| PR | 目的 | 触る主な範囲 | deploy |
|---|---|---|---|
| PR A | docs-only UID join request design | `docs/auth/staff-uid-join-request-design.md` | しない |
| PR B | staffJoinRequests create UI / pending screen | `StaffAuthGuard`, join request service | しない |
| PR C | admin staff join requests list | admin page / read service | Hosting only if UI reflect |
| PR D | approve/reject service and staffByUid mirror | staff join request service, staff sync boundary | しない |
| PR E | StaffAuthGuard / AdminAuthGuard staffByUid-first lookup | AuthGuards, staff auth helper | Hosting only after validation |
| PR F | firestore.rules staffByUid draft | `firestore.rules` | Security Rules deploy はしない |
| PR G | overview page update | `securityRulesOverview.ts`, page if needed | Hosting only |
| PR H | deploy readiness verification | docs / manual verification | しない |

PR B 以降は、Firestore write boundary と Security Rules readiness を分ける。`firebase.json` 接続や Security Rules deploy 手順は最後に回す。

## 実装前に確認すること

- `staffJoinRequests` を既存 admin staff page に入れるか、別 admin page に分けるか。
- 既存 staff への UID 紐付けと新規 staff 作成を同じ承認 UI に入れるか。
- `staffByUid` mirror の同期を `staff-sync-service` に含めるか、UID 承認 service に閉じるか。
- `staffByEmail` fallback を AuthGuard だけに残すか、Rules にも移行期間 fallback を残すか。
- `passcode` login feature flag を本番で完全 disabled 前提にするか。
- Auth email 変更時に `staff.authEmail` / `staffByUid.email` / `staffByEmail` をどう同期するか。
- rejected request の再申請可否と保持期間。

## Non-goals

今回やらないこと:

- 実装。
- `firestore.rules` 変更。
- Security Rules deploy。
- Hosting deploy。
- Firestore data migration。
- Auth user 一覧取得 API。
- Cloud Functions / Admin SDK 導入。
- `staffByEmail` 削除。
- passcode policy 変更。
- `customerUsers.status` 修正。
- logs / tanks hardening。
- `AdminAuthGuard` / `StaffAuthGuard` 変更。
- `staffByUid` / `staffJoinRequests` collection 作成。

## 結論

UID ベース staff 認証は、email casing 問題と passcode localStorage session の Rules 表現不能問題を長期的に解消する方向として妥当である。

ただし、UID は本人 login 後にしか自然に得られないため、管理者が事前登録する方式ではなく、本人申請と管理者承認を挟む必要がある。次に進む場合は、まず `staffJoinRequests` の create UI / pending screen を小さく切り、その後に admin 承認と `staffByUid` mirror を段階的に追加する。
