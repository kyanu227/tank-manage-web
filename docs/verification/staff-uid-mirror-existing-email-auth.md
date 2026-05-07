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
- passcode / localStorage session / dev auth bypass では UID link を実行しない。
- UID link が失敗した場合は認証失敗として扱い、session を作らない。
- Firestore transaction の詳細は `StaffAuthGuard.tsx` に置かない。

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

Codex in-app browser では Google login が `auth/popup-blocked` になるため、本人 Firebase Auth account による app login write はこの PR 作成時点では未実施。

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
|---|---|
| active staff | 未実行 |
| active staff with `authUid` | 未実行 |
| `staffByUid` docs | 未実行 |
| `staffByEmail` docs | 未実行 |
| `staffJoinRequests` docs | 未実行 |

app login write は未実施のため、readiness はこの PR 作成時点ではまだ not ready。

本人 Firebase Auth account で通常 login し、UID link が成功した場合の expected:

| item | expected |
|---|---:|
| active staff | 1 |
| active staff with `authUid` | 1 |
| `staffByUid` docs | 1 |
| `staffByEmail` docs | 1 |
| `staffJoinRequests` docs | 0 |

---

## 7. Remaining Blockers

- 本人 Firebase Auth account での staff login による UID link 実行確認が未完了。
- UID link 実行後の read-only aggregate 確認が未完了。
- Security Rules deploy 後に一般 staff self-link を許可するかは未決定。
- self-link を許可する場合、`firestore.rules` の追加 hardening / manual verification が別途必要。
- portal / `customerUsers` / `transactions` / `tanks` / `logs` の manual verification が未実行。
- AuthGuard staffByUid-first migration は未実施。
- `NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS` は本番有効化していない。

---

## 8. Next Steps

1. 通常ブラウザで、既存 active staff 本人の Firebase Auth account を使って staff login する。
2. `linkStaffUidByEmailAuth()` 経由の app write が成功することを確認する。
3. read-only aggregate で `active staff with authUid: 1` と `staffByUid docs: 1` を確認する。
4. Security Rules deploy 前に、self-link rule が必要かを別 PR で判断する。
5. portal / `customerUsers` / `transactions` / `tanks` / `logs` manual verification を継続する。
