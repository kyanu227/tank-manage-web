# staff dashboard の最近のログ取得 — 設計note（F3）

- 作成日: 2026-07-29
- 対象commit: `ddb2e8fc81e92c0c0ef2c3ab591562c18ad5d0ce`
- 位置づけ: **設計note。実装は含まない。** 人間判断が必要な選択肢を提示する
- 関連: `docs/architecture/refactor-sequence.md`（PR-11 個別設計gate）、`docs/design/staff-dashboard-read-model-design.md`


## 0. 反証レビューによる訂正（2026-07-29）

独立 reviewer（Codex, read-only）が本note を検証し、次の訂正が必要と判定した。
**以降の本文は、この §0 の訂正を前提に読むこと。**

| # | 本文の記述 | 訂正 |
|---|---|---|
| 1 | 「今後欠落し得るのは有限な legacy のみ」 | **システム不変条件としては成立しない。** `firestore.rules:1776` は tank log に `timestamp` を要求するが、`order` / `procurement` log は `logKind` しか要求しない。staff client から `timestamp` なしで作成可能であり、欠落集合が増えないことは保証されていない。**現行アプリ writer が安全なだけ** |
| 2 | §6 Step 2(b) 「backfill 設計（L2）を別途起票」 | **記述が軽すぎる。** `logs` は追記型で、`docs/architecture/write-ownership.md` §3 が直接更新を禁止している。F10 note も「直接 backfill は append-only 原則違反」としており、**本note と矛盾していた**。<br>さらに現行 Rules では tank log への任意 backfill は通らない。<br>→ **専用の migration 設計（Rules の一時変更を含む）を前提とした独立課題**として書き直す必要がある |

reviewer が確認した事実（本文の主張どおりで訂正不要）:

- writer 棚卸しは完全。追加 writer は見つからなかった
  （`tank-operation.ts:622,960,1076` / `submitTankEntryBatch.ts:167` /
  `supply-order.ts:96` / `operation-review-service.ts:282`）
- void も既存 log の更新のみで新規作成しない

### 訂正後の推奨

Step 2 の分岐を次に置き換える。

```
(a) timestamp 欠落 0件 → 選択肢 A の step 3 のみ
(b) 欠落あり           → Rules の書き込み制約を含む専用 migration 設計を起票する。
                         「backfill する」だけでは実行できない。
                         append-only 原則との関係を先に決める必要がある
```

加えて、Rules 側で `order` / `procurement` log にも `timestamp` を要求するかを
論点に追加する（欠落集合が今後増えないようにするため）。

## 1. 現状（コードで確認した事実）

`src/features/staff-dashboard/queries/dashboard-query.ts`:

```ts
logsRepository.getActiveLogs({ orderBy: null })   // limit なし・orderBy なし
...
const dashboardLogs = entries.slice(0, 200);      // 取得後に client 側で slice
```

`src/lib/firebase/repositories/logs.ts` の `getActiveLogs` は `orderBy: null` のとき
制約が `where("logStatus","==","active")` だけになる。したがって:

1. **active log を全件ダウンロードする**（`limit` なし）
2. **先頭200件は Firestore の返却順**であり「最新200件」ではない
3. その200件だけを client 側で `originalAt ?? timestamp` により降順ソートする

`logs` コレクションは運用に伴い単調増加する。200件を超えた時点で、
dashboard の「最近のログ」は**最新のログを含む保証がなくなる**。
どの200件が選ばれるかは Firestore の返却順に依存し、時刻に対して非決定的である。

読み取りコストも件数に比例して線形に増加する。

### 同種の無制限read（本note の対象外だが記録）

| 呼び出し元 | 制約 |
|---|---|
| `src/hooks/useBillingInvoiceCandidates.ts:67` | `getActiveLogs()` — limit なし |
| `src/hooks/useStaffAnalyticsStats.ts:41` | `getActiveLogs()` — limit なし |
| `src/hooks/useSalesStats.ts:58` | `getActiveLogs({ limit: 3000 })` |
| `src/app/admin/page.tsx:52` | `getActiveLogs({ from: todayStart })` |

billing は期間の完全性が必要なため単純な limit を付けられない。
analytics は集計・archive 設計が別途必要。**本note では扱わない。**

## 2. なぜ `orderBy: null` になっているか（経緯）

`progress.md` の「Phase 2-B-10a リグレッション修正」に記録がある。

- `getActiveLogs()` が `orderBy("timestamp","desc")` を必須付与していた
- Firestore は **orderBy 指定 field を持たない document を結果から除外する**
- そのため `timestamp` を持たない active log が dashboard から消えた
- 対策として `orderBy?: "timestamp" | null` を追加し、dashboard は `null` を渡すようにした

PR-11 はこの挙動を characterization として固定した。
**つまり現状は「取りこぼし修正の副作用」が仕様として固定された状態である。**

## 3. 決定的な調査結果 — 現行 writer は全て `timestamp` を書いている

`logs` への write owner をすべて確認した。

| logKind | writer | `timestamp` | `originalAt` |
|---|---|---|---|
| `tank`（新規） | `tank-operation.ts:650-651` | ✅ `serverTimestamp()` | ✅ `serverTimestamp()` |
| `tank`（訂正revision） | `tank-operation.ts:1010-1011` | ✅ 旧logから継承 | ✅ 旧logから継承 |
| `procurement` | `submitTankEntryBatch.ts:183` | ✅ `serverTimestamp()` | ❌ なし |
| `supply_order` | `supply-order.ts:38,47` | ✅ `serverTimestamp()` | ❌ なし |
| recovery review | `operation-review-service.ts` | 既存logを更新（新規作成しない） | — |

**現行コードが作成する log はすべて `timestamp` を持つ。**

訂正時は `timestamp = oldLog.timestamp ?? oldLog.originalAt`、
`originalAt = oldLog.originalAt ?? oldLog.timestamp` と相互に fallback するため、
**tank log では実質 `originalAt === timestamp`** になる。

→ したがって `orderBy("timestamp")` で除外され得るのは
**現行 schema 以前に書かれた legacy document のみ**である。
これは無限に増える集合ではなく、**有限で backfill 可能**。

また、client 側の `originalAt ?? timestamp` ソートは、現行データに対しては
ほぼ no-op（両者が同値）であり、legacy document に対してのみ意味を持つ。

### 未確認（人間または Firestore 接続が必要）

- **本番の active log 実件数**。`docs/deploy/transition-cutover-summary-2026-07-18.md` には
  cutover 時点で「旧 tank operation logs: 38件」を Reset した記録がある。
  2026-07-19 の advisory smoke で作成した test log は void 済み。
  **現在 200件を超えているかは未確認。**
- **`timestamp` を持たない active document が実際に何件あるか。**
  0件であれば選択肢 A が即座に成立する。

**この2点の確認が、以降の設計判断の前提になる。**

## 4. 設計選択肢

### 選択肢 A — legacy を backfill してから `orderBy("timestamp") + limit`

1. `timestamp` を持たない active log を洗い出す（read-only 監査 script）
2. 0件なら何もしない。存在すれば `originalAt` または `createdAt` から backfill
3. `getActiveLogs({ orderBy: "timestamp", limit: 200 })` へ切り替え
4. client 側の `originalAt ?? timestamp` ソートは**維持**（表示順の互換のため）

| | |
|---|---|
| 正確性 | ✅ 真の最新200件 |
| read cost | ✅ 200件固定 |
| 必要 index | `logs(logStatus Asc, timestamp Desc, __name__ Desc)` |
| 必要な migration | legacy backfill（**L2 = business-data write**） |
| リスク | backfill 対象を取りこぼすと再びログが消える |
| 前提 | §3 の未確認2点の確定 |

**backfill が 0件で済むなら、これが最も単純で正しい。**

### 選択肢 B — `originalAt` を全 logKind で必須化する

`procurement` / `supply_order` の writer にも `originalAt` を追加し、
`orderBy("originalAt")` を正本にする。

| | |
|---|---|
| 正確性 | ✅ |
| 欠点 | writer 変更 = **保存payload変更**。既存 log の backfill も必要 |
| 判定 | 選択肢 A より migration が大きく、得るものが無い。**非推奨** |

`originalAt` の設計意図は「訂正 revision 前後で不変の元操作時刻」であり、
tank log 固有の概念である。他 logKind へ広げると意味が薄まる。

### 選択肢 C — union query（`orderBy("timestamp")` + `timestamp` 欠落分の別 query）

| | |
|---|---|
| 正確性 | ⚠️ **厳密な top-N にならない**。両方から N 件ずつ取ると、片方が他方を押し出す |
| read cost | 最大 2N 以上 |
| 判定 | compatibility bridge にはなるが正確性を犠牲にする。**非推奨** |

### 選択肢 D — repository に `getRecentActiveLogs()` を新設

semantics を API 名で明示する。ただし **canonical field と backfill の問題自体は解決しない**。
選択肢 A と組み合わせる形なら有用（A の実装形として検討）。

## 5. index-as-code（`firestore.indexes.json` 新設の是非）

**現在このファイルはリポジトリに存在しない**（git 履歴にも無い）。
`firebase.json` も Rules のみを管理している。つまり **index は Firebase Console の手動運用**。

docs に記録されている手動 index は1件のみ:

```
logs: logStatus Asc / location Asc / timestamp Desc / __name__ Desc
```

これは portal 履歴向けで、本note が必要とする
`logs(logStatus Asc, timestamp Desc, __name__ Desc)` とは別物。

### 論点

| | 新設する | しない |
|---|---|---|
| 利点 | index が review 可能・再現可能になる。必要 index の記録漏れが無くなる | 現状維持。運用変更なし |
| 欠点 | **`firebase deploy` の対象が増える**。既存の Console 側 index との差分で意図しない削除が起き得る | index 変更が review を通らない状態が続く |

**重要**: `firebase deploy --only firestore:indexes` は、
定義ファイルに無い既存 index を削除し得る。
Console 側に手動で作られた index の完全な棚卸しを先に行わないと危険。

### 推奨

**本note の範囲では新設しない。** 別課題として:
1. Console の既存 index を全件棚卸しする（read-only）
2. それを完全に反映した `firestore.indexes.json` を作る
3. deploy 手順（`--only firestore:indexes` の扱い）を `deployment-and-firestore-change-rules.md` に追記

必要 index は当面 docs に記録し、Console で手動作成する現行運用を維持する。

## 6. 推奨する進め方

```
Step 1 (L0)  read-only 監査 script で次を確定する
             - active log の総件数
             - timestamp を持たない active log の件数と id
             → 200件未満かつ timestamp 欠落 0件なら、緊急性は無い

Step 2       Step 1 の結果で分岐
             (a) timestamp 欠落 0件 → 選択肢 A の step 3 のみ（index 作成 + query 変更）
             (b) 欠落あり         → backfill 設計（L2）を別途起票

Step 3 (L1)  index を Console に作成し、query を
             getActiveLogs({ orderBy: "timestamp", limit: 200 }) へ変更
             client 側の originalAt ?? timestamp ソートは維持

Step 4       dashboard-query.test.ts / dashboard-read-model.test.ts の
             該当 characterization を更新
```

**単純な `limit: 200` の追加は行わない。** `orderBy: null` のまま limit を付けると、
「任意の200件」から「任意の200件」に変わるだけで正確性は改善せず、
read cost だけが下がる（それ自体は有用だが、根本解決ではない）。

逆に `orderBy: "timestamp"` を先に付けると、backfill 前は
**Phase 2-B-10a のリグレッションが再発する**。順序を守ること。

## 7. 人間判断が必要な事項

1. **Step 1 の read-only 監査を実施してよいか**（本番 Firestore への read 接続を伴う）
2. **backfill が必要になった場合、L2 write を実施してよいか**
3. **`firestore.indexes.json` を新設するか**（§5 の deploy リスクを踏まえて）
4. 200件という表示上限自体を見直すか（pagination の導入など）

## 8. 本note で扱わないこと

- billing / analytics / sales の無制限read（別設計）
- `logs` の archive / 世代管理
- pagination UI
- `originalAt` semantics 自体の変更
