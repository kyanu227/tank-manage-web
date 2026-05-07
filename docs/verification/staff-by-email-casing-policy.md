# Staff By Email Casing Policy

作成日: 2026-05-08

対象:

- `staffByEmail`
- active `staff.email`
- active `staff.authEmail`
- `staffByUid`
- Security Rules deploy readiness

この document は、Security Rules deploy 前に `staffByEmail/{email}` doc id と Firebase Auth email の casing が一致するかを read-only aggregate で確認し、扱い方針を記録する。

---

## 1. Summary

- deploy blocker: resolved for current production data
- `staffByEmail` docs: 1
- lowercase `staffByEmail` doc id: 1
- non-lowercase `staffByEmail` doc id: 0
- active staff: 1
- active staff email lowercase: 1
- active staff `authEmail` lowercase: 1
- active staff `authEmail` exact mirror found: 1
- mismatch count: 0
- data cleanup required before Security Rules deploy: no
- `firestore.rules` casing workaround required: no

現行 production data では、active staff の Firebase Auth email snapshot と `staffByEmail` doc id が exact に一致している。現行 draft rules の `isStaff()` は `staffByEmail/{request.auth.token.email}` を参照するため、現在の active staff について casing mismatch blocker は発生しない。

---

## 2. Verification Metadata

| item | value |
|---|---|
| 検証日 | 2026-05-08 |
| 対象 commit | `1ac26f3b7974371eae0591cfa180ae86c631ae13` |
| 対象 project | `okmarine-tankrental` |
| 検証方法 | Firebase CLI OAuth credential + Firestore REST API `GET` read-only aggregate check |
| Security Rules deploy | 未実行 |
| Hosting deploy | この確認作業では未実行 |
| `firebase deploy` | 未実行 |
| Firestore data edit | 未実行 |
| Firestore Console / script direct edit | 未実行 |
| `firestore.rules` | 未変更 |
| `firebase.json` | 未変更 |
| `src/**` | 未変更 |
| package files | 未変更 |

---

## 3. Verification Method

repo 外の一時 script で Firestore REST API の `GET` のみを実行し、`staff` / `staffByEmail` / `staffByUid` を aggregate した。

実行コマンド:

```bash
node /private/tmp/staff-by-email-casing-aggregate.mjs
```

確認内容:

- `staffByEmail` docs 総数。
- `staffByEmail` doc id が lowercase か。
- `staffByEmail` doc id と doc 内 `email` が exact / lowercase で一致するか。
- active staff の `email` を lowercase 化した値と `staffByEmail` doc id が一致するか。
- active staff の `authEmail` が存在し、lowercase で、`staffByEmail` doc id と exact に一致するか。
- `staffByUid` mirror の email casing。

出力は aggregate count のみとし、staff name、email、UID、document id は docs に記録しない。

一時 script は検証後に削除した。repo 内には追加していない。

---

## 4. Read-Only Aggregate Result

### staffByEmail

| item | count |
|---|---:|
| `staffByEmail` docs total | 1 |
| lowercase doc id | 1 |
| non-lowercase doc id | 0 |
| doc id equals doc `email` exact | 1 |
| doc id equals lowercase doc `email` | 1 |
| missing doc `email` | 0 |
| missing `staffId` | 0 |
| `isActive == true` | 1 |
| inactive / missing `isActive` | 0 |

### active staff

| item | count |
|---|---:|
| staff docs total | 1 |
| active staff | 1 |
| active staff with `email` | 1 |
| active staff `email` lowercase | 1 |
| active staff `email` non-lowercase | 0 |
| active staff lowercase mirror found | 1 |
| active staff exact email mirror found | 1 |
| active staff mirror email lowercase match | 1 |
| active staff mirror email exact match | 1 |
| active staff with `authEmail` | 1 |
| active staff `authEmail` lowercase | 1 |
| active staff `authEmail` non-lowercase | 0 |
| active staff `authEmail` exact mirror found | 1 |
| active staff `authEmail` lowercase mirror found | 1 |
| active staff `authEmail` equals lowercase key | 1 |

### staffByUid

| item | count |
|---|---:|
| `staffByUid` docs total | 1 |
| mirror with `staffId` | 1 |
| mirror email lowercase | 1 |
| mirror email non-lowercase | 0 |

### mismatches

| check | count |
|---|---:|
| non-lowercase `staffByEmail` doc id | 0 |
| `staffByEmail` doc id / lowercase email mismatch | 0 |
| active staff missing lowercase mirror | 0 |
| active staff missing exact email mirror | 0 |
| active staff missing `authEmail` | 0 |
| active staff `authEmail` non-lowercase | 0 |
| active staff `authEmail` exact mirror missing | 0 |
| active staff `authEmail` lowercase key mismatch | 0 |

---

## 5. Rules Impact

現行 draft rules の `isStaff()` は以下の path を exact lookup する。

```text
staffByEmail/{request.auth.token.email}
```

Firestore Rules では email を lowercase 化できない。そのため、Firebase Auth email が mixed case のまま token に入る場合、`staffByEmail` doc id を lowercase 固定で作っていても exact lookup が失敗する。

今回の read-only aggregate では、active staff の `authEmail` は lowercase で、`staffByEmail` doc id と exact に一致していた。したがって、現在の active staff については Security Rules deploy 後も `isStaff()` の exact lookup は成立する。

---

## 6. Policy

方針:

- `staffByEmail` doc id は lowercase email key 固定とする。
- staff email / Firebase Auth email は lowercase 運用に寄せる。
- `staffEmailKey(email)` による lowercase mirror 作成方針を維持する。
- 新規 staff / UID link 時は email casing mismatch を許容せず、lowercase key と一致することを確認する。
- 現時点の production data では data cleanup は不要。
- 現時点で `firestore.rules` に casing workaround を追加する必要はない。

注意:

- 将来 Firebase Auth email が mixed case で作られると、Rules の exact lookup は失敗し得る。
- その場合は data cleanup だけではなく、Auth email の運用方針または staffByUid-first migration を含めて再検討する。

---

## 7. Deployment Judgment

判定:

- `staffByEmail` casing policy: ready
- Security Rules deploy readiness: still not ready

理由:

- active staff email / `authEmail` / `staffByEmail` doc id が exact に一致している。
- mismatch count は 0。
- deploy 前 data cleanup は不要。
- rules 側の暫定 casing workaround は不要。
- ただし self-link rule 方針、Security Rules deploy operation / rollback 手順、AuthGuard staffByUid-first migration はまだ残る。

---

## 8. Next Steps

1. self-link rule が必要かを決める。
2. Security Rules deploy operation / rollback 手順を別 PR で用意する。
3. AuthGuard staffByUid-first migration を別フェーズで検討する。
