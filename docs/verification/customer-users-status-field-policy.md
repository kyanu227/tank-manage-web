# Customer Users Status Field Policy

作成日: 2026-05-07

対象:

- `customerUsers`
- `customerUsers.status`
- Security Rules deploy readiness

この document は、Security Rules deploy 前に `customerUsers.status` 既存 field が owner update を阻害しないかを read-only aggregate で確認し、扱い方針を記録する。

---

## 1. Summary

- deploy blocker: resolved for current production data
- `customerUsers` docs: 1
- `status` field present: 0
- `status` field missing: 1
- data cleanup required before Security Rules deploy: no
- `firestore.rules` temporary status allow required: no
- service / app code change required: no

現行 production data には `customerUsers.status` field が残っていない。そのため、現行 draft rules の `customerUsers` owner update が `status` field の存在によって拒否される blocker は、現時点の本番 data では発生しない。

---

## 2. Verification Metadata

| item | value |
|---|---|
| 検証日 | 2026-05-07 |
| 対象 commit | `5ecfebd8cdd02b2f87970e8df0ec68e4e40c67c8` |
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

repo 外の一時 script で Firestore REST API の `GET` のみを実行し、`customerUsers` collection を aggregate した。

実行コマンド:

```bash
node /private/tmp/customer-users-status-aggregate.mjs
```

確認内容:

- `customerUsers` docs 総数。
- `status` field を持つ docs 件数。
- `status` field の値の種類と件数。
- `setupCompleted` / `disabled` / `customerId` / `customerName` の aggregate。
- 現行派生 status にした場合の内訳。

出力は aggregate count のみとし、email、UID、document id、customer name は docs に記録しない。

一時 script は検証後に削除した。repo 内には追加していない。

---

## 4. Read-Only Aggregate Result

| item | count |
|---|---:|
| `customerUsers` docs total | 1 |
| docs with `status` field | 0 |
| docs without `status` field | 1 |

`status` field values:

| value | count |
|---|---:|
| present values | 0 |

derived status:

| derived status | count |
|---|---:|
| `pending_setup` | 1 |

setup / link fields:

| field aggregate | count |
|---|---:|
| `setupCompleted == false` | 1 |
| `disabled == false` | 1 |
| `customerId == null` | 1 |
| `customerName == ""` | 1 |

---

## 5. Rules Impact

現行 draft rules の owner update は、`request.resource.data.keys().hasAny(["status"])` を拒否する。

Firestore Rules の update 判定では、`request.resource.data` は patch ではなく update 後の document 全体を表す。そのため、既存 document に `status` field が残っている場合、owner が `email` / `displayName` / `lastLoginAt` / `updatedAt` だけを更新しても、update 後 document 全体に `status` が含まれるため拒否される可能性がある。

今回の read-only aggregate では production `customerUsers` に `status` field が存在しなかった。したがって現時点では、この blocker による owner update 失敗は想定しない。

---

## 6. Policy

方針:

- `customerUsers.status` は Firestore に保存しない。
- UI / session 上の status は `disabled` / `setupCompleted` / `customerId` から派生する。
- 現行 draft rules の owner update における `status` field deny は維持する。
- 現時点の production data には `status` field がないため、deploy 前 data cleanup は不要。
- `firestore.rules` で `status` を暫定許可する必要はない。
- service / app code で `status` を削除するための変更は今回不要。

将来 `customerUsers.status` field が再混入した場合は、Security Rules deploy 前に read-only aggregate を再実行し、data cleanup operation を別手順として扱う。

---

## 7. Deployment Judgment

判定:

- `customerUsers.status` existing field policy: ready
- Security Rules deploy readiness: still not ready

理由:

- `customerUsers.status` は現行 production data に存在しない。
- data cleanup は不要。
- rules 側の暫定許可も不要。
- ただし `staffByEmail` casing policy、self-link rule 方針、Security Rules deploy operation / rollback 手順などはまだ残る。

---

## 8. Next Steps

1. `staffByEmail` casing policy を確認する。
2. self-link rule が必要かを決める。
3. Security Rules deploy operation / rollback 手順を別 PR で用意する。
