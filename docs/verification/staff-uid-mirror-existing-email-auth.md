# Staff UID Mirror Existing Email Auth

作成日: 2026-05-07

対象:

- existing `staffByEmail` staff auth
- `staff.authUid`
- `staffByUid`
- `StaffAuthGuard`
- `staff-uid-link-service`

この document は、既存 `staffByEmail` 登録済み staff が Firebase Auth で本人メール認証に成功した場合の UID link / bootstrap 経路を記録する。

---

## 1. Purpose

PR #53 の `staffByUid` mirror readiness では以下の状態を確認した。

- active staff: 1
- active staff with `authUid`: 0
- `staffByUid` docs: 0
- `staffByEmail` docs: 1
- `staffJoinRequests` docs: 0

この状態では、既存 active staff の email はすでに `staffByEmail` に登録されている。そのため、本人 Firebase Auth account で staff login すると現行 `StaffAuthGuard` は `staffByEmail` ベース互換認証で成功し、`staffJoinRequests` 画面には進まない。

この PR では、`staffByEmail` に存在する本人メール認証済み staff を `staffJoinRequests` ではなく UID link / bootstrap 経路で処理する。

---

## 2. Implementation

追加 service:

- `src/lib/firebase/staff-uid-link-service.ts`

public function:

- `linkStaffUidByEmailAuth(input)`

service の責務:

- Firebase Auth `uid` / `email` / `emailVerified` を検証する。
- `staffEmailKey(email)` で lowercase email key を作る。
- transaction 内で `staffByEmail/{emailKey}` / `staff/{staffId}` / `staffByUid/{uid}` を読む。
- `staffByEmail` mirror と `staff` doc が有効 staff を指していることを確認する。
- `staff.email` と Firebase Auth email の lowercase key が一致することを確認する。
- `staff.authUid` が未設定、または同じ UID であることを確認する。
- `staffByUid/{uid}` が存在する場合、同じ `staffId` を指している場合だけ許容する。
- `staff/{staffId}` の `authUid` / `authEmail` / `uidLinkedAt` / `updatedAt` を更新する。
- `setStaffUidAuthMirrorInTransaction()` で `staffByUid/{uid}` mirror を作成または更新する。

`StaffAuthGuard.tsx` の責務:

- `findActiveStaffByEmail(userEmail)` が成功した後、session 作成前に `linkStaffUidByEmailAuth()` を呼ぶ。
- user が存在し、`user.uid` と `user.email` がある場合だけ UID link を試行する。
- `allowedRoles` が指定された page では、権限確認に成功した後だけ UID link を試行する。
- passcode / localStorage session / dev auth bypass では UID link を実行しない。
- UID link が失敗した場合は認証失敗として扱い、session を作らない。
- Firestore transaction の詳細は `StaffAuthGuard.tsx` に置かない。

email/password Firebase Auth account で `emailVerified === false` の場合、UID link は失敗し staff session も作らない。Google login では通常 verified email として扱われるが、未確認メールを許可する場合は別途方針変更が必要。

`staffJoinRequests` は、`staffByEmail` に未登録のユーザーがスタッフ利用を申請する経路として維持する。

---

## 3. Security Rules Scope

- Security Rules deploy は未実行。
- Hosting deploy は未実行。
- `firebase deploy` は未実行。
- `firebase deploy --only firestore:rules` は未実行。
- `firebase.json` は未変更。
- `firestore.rules` は未変更。

現行 draft `firestore.rules` では `staffByUid` create / update は admin に限定されている。そのため、将来 Security Rules deploy 後も一般 staff の self-link を許可する場合は、Rules 側に別途 self-link rule が必要になる。

この PR では Rules は変更しない。UID link / bootstrap のアプリ実装を分離して追加するだけに留める。

---

## 4. Data Handling

- Firestore Console による `staff.authUid` 手作業更新は未実行。
- Firestore Console による `staffByUid` 手作業作成は未実行。
- 一時 script による本番 Firestore data の create / update / delete は未実行。
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS=true` はコミットしていない。
- `.env.local` はコミットしていない。

アプリ経由 write を実施した場合の write 範囲:

- `staff/{staffId}.authUid`
- `staff/{staffId}.authEmail`
- `staff/{staffId}.uidLinkedAt`
- `staff/{staffId}.updatedAt`
- `staffByUid/{uid}` mirror

この UID link 経路では `staffJoinRequests` は作成・更新しない。

---

## 5. Verification Status

Codex in-app browser では Google login が `auth/popup-blocked` になるため、本人 Firebase Auth account による login は通常ブラウザで実施した。

app-flow verification:

- 実施日: 2026-05-07
- 実施環境: PR #54 branch の local dev server (`http://127.0.0.1:3000/staff`)
- login method: Firebase Auth email/password
- result: pass
- staff 画面への login に成功した。
- `linkStaffUidByEmailAuth()` 経由で `staff.authUid` と `staffByUid` mirror が作成された。
- `staffJoinRequests` は作成されていない。
- Firestore Console / script による直接 create / update / delete は実行していない。

実装検証:

- `npx tsc --noEmit --pretty false`: pass
- `npm run build`: pass

補足:

- 初回 `npm run build` は Google Fonts fetch 失敗で停止した。
- ネットワーク許可付きで同じ `npm run build` を再実行し、pass を確認した。

---

## 6. Before / After Aggregate

before:

| item | result |
|---|---:|
| active staff | 1 |
| active staff with `authUid` | 0 |
| `staffByUid` docs | 0 |
| `staffByEmail` docs | 1 |
| `staffJoinRequests` docs | 0 |

after:

| item | result |
|---|---:|
| active staff | 1 |
| active staff with `authUid` | 1 |
| `staffByUid` docs | 1 |
| `staffByEmail` docs | 1 |
| `staffJoinRequests` docs | 0 |

after detail:

- `staffByUid` mirror exists: true
- `staffByUid.staffId` matches active staff: true
- `staffByUid.email` / `role` / `rank` match active staff aggregate expectation.
- target `staffJoinRequests/{uid}` exists: false

readiness:

- active staff の UID mirror readiness は ready。
- Security Rules deploy readiness 全体は、他の manual verification / Rules self-link 方針が残るためまだ ready ではない。

---

## 7. Remaining Blockers

- Security Rules deploy 後に一般 staff self-link を許可するかは未決定。
- self-link を許可する場合、`firestore.rules` の追加 hardening / manual verification が別途必要。
- portal / `customerUsers` / `transactions` / `tanks` / `logs` の manual verification が未実行。
- AuthGuard staffByUid-first migration は未実施。
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` は本番有効化していない。

---

## 8. Next Steps

1. Security Rules deploy 前に、self-link rule が必要かを別 PR で判断する。
2. self-link rule を追加する場合は、Rules manual verification を追加する。
3. portal / `customerUsers` / `transactions` / `tanks` / `logs` manual verification を継続する。
4. AuthGuard staffByUid-first migration を別 PR で検討する。
