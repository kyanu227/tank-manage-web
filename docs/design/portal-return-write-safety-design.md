# portal 返却申請の write safety — 設計note（F6-B / F6-C / F6-D）

- 作成日: 2026-07-29
- 対象commit: `ddb2e8fc81e92c0c0ef2c3ab591562c18ad5d0ce`
- 位置づけ: **設計note。実装は含まない。**
- 前提 PR: F6-A（timer cleanup）— 別 PR で対応済み
- 関連: `docs/architecture/write-ownership.md` §4 / §7、`firestore.rules`

## 0. 本note の3課題は、それぞれ別 PR で実装する

| ID | 課題 | 独立性 |
|---|---|---|
| **F6-B** | multi-document atomicity | C の ID 設計に依存する |
| **F6-C** | cross-device idempotency | 独立に設計できるが、B の実装形を決める |
| **F6-D** | client clock 依存 | B / C とは独立 |

**1つの PR にまとめない。** 特に B と C は Firestore Rules の変更を伴う可能性があり、
app 変更と Rules 変更も分離する。


## 0. 反証レビューによる訂正（2026-07-29）— **本note は UNSOUND 判定。推奨順序を差し替える**

独立 reviewer（Codex, read-only）が本note を **UNSOUND** と判定した。
**§6 の推奨順序と §4.1 の occurrence ID 案は採用しないこと。**

### 訂正 1 — シナリオ3は**確認された**。しかも本文より深刻

reviewer が `file:line` で成立を確認した:

| step | 根拠 |
|---|---|
| staff 確定 context に request group の customer A が入る | `return-tag-processing-service.ts:97` |
| preflight で現在 tank を読むが **customerId を A と比較しない** | `return-tag-processing-service.ts:122` |
| transaction 再 plan では**現在 tank の customer** を読む | `tank-operation.ts:474` |
| return step の customer に **request の A ではなく現在 holder B** が使われる | `tank-transition-policy.ts:621` |
| そのまま**古い A の transaction を completed へ更新**する | `return-tag-processing-service.ts:182` |
| Rules にも customer / cycle 結合はない（`pending_return → completed` と field 形のみ検査） | `firestore.rules:1475` |

**「A の古い申請を処理して B の現在 cycle を閉じる」が実際に可能。**

**同じ問題が bulk return にも存在する**（F4 note §0 参照）。
これは業務判断ではなく**不変条件違反**である。

### 訂正 2 — §4.1 の occurrence ID 案は**危険**。採用しない

`customerId + localDate + tankId + auto/manual` は:

- **同一顧客・同一タンクが同日に2回貸出/返却された正当な cycle を衝突させる**
- `auto` と `manual` が別 kind なので、**同一 cycle に2件作ることを防げない**
- portal update を許すと、staff 完了後の document を上書きしない厳格な条件が必要

**正しい方向は日付ではなく貸出 cycle への binding**:

- portal read は既に `latestLogId` を返している（`tanks.ts:38`）が、
  **現在 page が捨てている**（`portal/return/page.tsx:64`）
- occurrence ID を `customerId + tankId + latestLogId`（= loan cycle）にする
- 確定 transaction で `current customerId` と `request customerId`、
  可能なら `latestLogId` を一致検査する
- 既存 legacy pending には customer 一致必須＋期限/明示確認という別 policy を設ける

### 訂正 3 — 事実誤認

| 本文 | 訂正 |
|---|---|
| 「`addDoc` は commit 時に auto ID 採番」 | **誤り。** Web SDK は `doc(collectionRef)` 呼び出し時に auto ID 付き ref を生成でき、backend 応答前に ID が存在する。→ batch 化は本文より容易 |
| §4.2 (a) 「`create` のみ許可し `!exists()` を検査」 | **不要かつ不正確。** `allow create` は元々 document 非存在時にだけ適用される。既存時は一般的な `permission-denied` になり、「duplicate なので成功」と他の Rules 失敗を安全に区別できない。batch 内で既存と未作成が混在すると**全体が失敗し未作成分も作られない** |
| §3.2 「500 writes 上限」 | 不十分。request size 10MiB、Rules document access call にも batch 全体上限がある。**下流の tank operation には既に100本上限がある**（`tank-operation-limits.ts:1`） |
| §5 client clock | `createdAt` / `updatedAt` には**既に server timestamp がある**（`transactions.ts:77`）。Rules で時刻検証しても「早すぎる発火の拒否」しかできず、client が画面を開かない場合に発火させることはできない |

### 訂正後の推奨順序（§6 を差し替え）

```
Step 1  staff 確定側の cycle / customer 整合性を修正する  ← 最優先
        return-tag-processing-service の preflight と transaction で
        current customerId == request customerId を検査する
        （可能なら latestLogId も）
        → 同じ不変条件を bulk return にも適用する（F4 note と共通）

Step 2  cycle-bound occurrence ID の設計
        customerId + tankId + latestLogId。日付は使わない
        portal page が捨てている latestLogId を request に保存する

Step 3  batch atomicity（Step 2 の ID 設計が前提）
        app PR と Rules PR を分ける
```

**本文 §6 の順序（read-only 監査 → time authority → occurrence ID → atomicity）は誤り。**
lifecycle binding が無いまま atomic 化すると、
**誤った request を確実にまとめて作るだけ**になる。

なお F6-A（timer cleanup）は本note の base には含まれていない（別 PR）。

## 1. 現状（コードで確認した事実）

### 1.1 write 経路

`src/lib/firebase/portal-transaction-service.ts:73-83`:

```ts
export async function createPortalReturnRequests(input) {
  const items = normalizePortalReturnRequestItems(input.items);
  if (items.length === 0) throw new Error("Portal return requires at least one tank.");
  return Promise.all(items.map((item) => createPendingPortalReturnRequest(input, item)));
}
```

`createPendingPortalReturnRequest`（同:148-163）は
`transactionsRepository.createTransaction({ type:"return", status:"pending_return", ... })` を呼ぶ。
repository 側は `addDoc` であり、**commit 時に auto ID が採番される**。

つまり **N 件の独立した `addDoc`** であり、transaction でも batch でもない。

`createPortalUnfilledReports`（同:85-106）も同じ構造。

### 1.2 呼び出し側

`src/app/portal/return/page.tsx:112-140`:

```ts
const submitReturn = async (auto = false, autoKey?: string) => {
  ...
  try {
    await createPortalReturnRequests({ identity, items, source });
    if (autoKey) localStorage.setItem(autoKey, "1");   // ← 全件成功時のみ
    setIsSuccess(true);
  } catch (err) {
    alert("送信に失敗しました。再度お試しください。");
    ...
  }
};
```

### 1.3 自動返却の発火条件（同:88-106）

```ts
const now = new Date();                                          // ← client clock
const todayKey = `autoReturn_${identity.customerId}_${now.toDateString()}`;
const alreadyDone = localStorage.getItem(todayKey) === "1";      // ← localStorage のみ
if (alreadyDone) return;
const scheduled = new Date(now);
scheduled.setHours(h, m, 0, 0);
if (now >= scheduled) { ... }
```

### 1.4 Rules が検査していること / いないこと

`firestore.rules` の `transactions` create（portal 経路）は次を検査する:

- `request.auth.uid` と `createdByUid` の一致
- linked customer であること
- `type` / `status` / `source` / `condition` / 許可 key set

**検査していないこと**:

- tank の存在
- その tank の現在の貸出先
- **同一 tank の既存 pending request の有無**
- auto schedule 時刻
- customer / day / tank の一意性

### 1.5 staff 確定側

`src/lib/firebase/return-tag-processing-service.ts` は
**同一 bulk 内の duplicate tank ID を write 前に拒否**する。
しかし片方だけ処理された場合、**もう片方は pending のまま残る**。

## 2. 障害シナリオ（推定を含む。実運用での発生は未確認）

### シナリオ 1 — 部分成功 → 再送で重複

```
1. 自動返却が 5 本分の addDoc を並列発行
2. 3 件成功、2 件がネットワークエラー
3. Promise.all が reject → localStorage フラグは立たない
4. 顧客が画面を開き直す → alreadyDone === false
5. 再び 5 本分を発行 → 成功済みの 3 本が重複する
```

### シナリオ 2 — 応答喪失

commit は成功したが応答が届かなかった場合も、
random ID の `addDoc` では**成功したか判別できない**。再試行は必ず重複を生む。

### シナリオ 3 — 古い pending が別 cycle へ適用される（最も重い）

```
1. tank A について pending_return が重複作成される（2件）
2. staff が 1件目を確定 → A は返却され、倉庫へ戻る
3. A が別の顧客 B へ再貸出される
4. staff が 2件目の古い pending を処理する
   → B への貸出 cycle を返却してしまう
```

作成時点で tanks / logs を触らない設計は正しいが、
**pending request が tank の lifecycle にバインドされていない**ため、
時間が経った pending が別 cycle に適用され得る。

### シナリオ 4 — 複数端末 / 複数タブ

localStorage は端末・ブラウザ・プロファイル単位。
同じ顧客が2端末で画面を開けば、両方が自動返却を発火する。

### シナリオ 5 — client clock

顧客端末の時計が進んでいれば設定時刻前に発火し、
遅れていれば当日発火しない。timezone 設定の差でも同様。

## 3. F6-B — multi-document atomicity

### 3.1 `writeBatch` 化は技術的に可能

現行の `addDoc` は commit 時採番のため batch に参加できないが、
ref を事前生成すれば可能:

```ts
const ref = doc(collection(db, "transactions"));   // ID をローカルで採番
batch.set(ref, payload);
// commit 後に ref.id を返す
```

### 3.2 決めるべきこと

| 論点 | 選択肢 |
|---|---|
| **500 writes 上限** | (a) 500 超を明示的に拒否する<br>(b) chunk 分割する（**全体 atomicity を失う**）<br>(c) 1 request = 1 document へ schema 変更（items を配列で持つ） |
| **ID 生成** | (a) random ID のまま（**retry で重複**）<br>(b) deterministic ID（§4 参照） |
| **失敗時の UX** | 現行は「送信に失敗しました」のみ。部分成功が無くなるので文言を見直すか |

### 3.3 (c) schema 変更案の検討

現行は 1 tank = 1 transaction document。
これを「1 返却申請 = 1 document、items を配列で保持」に変えると:

- atomicity が自明になる（単一 document）
- 500 上限が消える
- しかし **staff 確定側 / billing / Rules / 既存 document との互換**がすべて影響を受ける
- **大きな schema 変更**であり、本note の範囲を超える

→ **短期は (a) 500 超を拒否 + deterministic ID を推奨。**
(c) は長期課題として別途起票する。

### 3.4 検証 level

app のみの変更なら **L1**。実際の返却フロー確認は **L2**。

## 4. F6-C — cross-device idempotency

### 4.1 occurrence ID（deterministic document ID）案

```
returnRequestId = `${customerId}_${localDateKey}_${tankId}_${occurrenceKind}`
```

- `occurrenceKind`: `auto` / `manual`
- 同一 customer・同一日・同一 tank・同一種別なら**同じ document ID** になる
- `batch.set(ref, payload)` を retry しても同じ document を上書きするだけ

### 4.2 問題点 — Rules との衝突

現行 Rules は portal からの `transactions` **update を許可していない**。
deterministic ID への `set` は、document が既存なら update 扱いになるため**拒否される**。

対応の選択肢:

| 選択肢 | 内容 | 影響 |
|---|---|---|
| (a) `create` のみ許可し、重複時のエラーを成功として扱う | app 側で "already exists" を握り潰す | Rules 変更不要。ただし Firestore は `create` 専用 API を持たないため、Rules で `!exists(...)` を検査する必要がある |
| (b) 自分の pending request に限り update を許可する | Rules 変更 | 権限面の検討が必要。`status` の書き換えを防ぐ制約が要る |
| (c) marker document を別コレクションに置く | `portalAutoReturnMarkers/{customerId}_{date}` | 新コレクション + Rules。transaction 本体は触らない |
| (d) 送信前に既存 pending を read して重複を弾く | app のみ | **race に弱い**。2端末同時では両方が「無し」と読む |

**(a) または (c) を推奨。** (d) は単独では不十分。

### 4.3 「同じ日」の定義

client の `toDateString()` に依存している。
F6-D の time authority と**同じ判断**になるため、C と D は設計を揃える必要がある。

### 4.4 古い pending の失効（シナリオ3 対策）

occurrence ID だけでは、シナリオ3（別 cycle への適用）は防げない。
別途、次のいずれかが要る:

| 案 | 内容 |
|---|---|
| 有効期限 | pending に `expiresAt` を持たせ、staff 確定側で期限切れを弾く |
| lifecycle binding | 作成時の `latestLogId` を保持し、確定時に一致を検証する |
| staff 側の再検証 | 確定時に「この tank の現在の貸出先 == request の customerId」を検証する |

**staff 側の再検証が最も影響範囲が小さい**（portal 側の schema を変えない）。
`return-tag-processing-service.ts` の preflight に検査を追加する形。
ただしこれは **F6 とは別の課題**として起票すべき（確定側の仕様変更）。

## 5. F6-D — client clock 依存 / time authority

### 5.1 現状の性質

自動返却は「**顧客が返却画面を開いたとき**に、client の時計が設定時刻を過ぎていれば発火」
という pull 型である。scheduler が push しているわけではない。

つまり:

- 顧客が画面を開かなければ発火しない（現行仕様）
- 発火判定は完全に client 依存

### 5.2 選択肢

| 選択肢 | 内容 | コスト |
|---|---|---|
| (a) 現状維持 + 明示 | client 時計依存であることを UI と docs に明記 | 最小 |
| (b) server timestamp で検証 | 送信 payload に `serverTimestamp()` を入れ、Rules で「設定時刻以降」を検証 | Rules が `settings/portal` を `get()` する必要がある（read コストと結合が増える） |
| (c) 真の scheduler | Cloud Functions / Scheduler で server 側から実行 | **静的エクスポート構成では Functions が現在未使用**。インフラ追加。最大 |

### 5.3 判断

**現行の pull 型仕様を維持するか、push 型に変えるかは業務判断。**

pull 型のままなら (a) が妥当。
「顧客が開かなくても自動返却されるべき」なら (c) が必要で、
これは**機能追加**であり本note の範囲外。

`docs/project-direction.md` / `docs/return-flow-policy.md` との整合を先に確認すること。

## 6. 推奨する進め方

```
Step 0  F6-A（timer cleanup）を merge  ← 済（Draft PR）

Step 1  L0  現状把握（read-only）
            - portal 由来の pending_return に重複が実際に存在するか
            - 未処理のまま残っている古い pending があるか
            → 実害が確認できれば優先度が上がる

Step 2      F6-D の業務判断（pull 型を維持するか）
            → 維持なら (a)。変更なら別トラック

Step 3      F6-C の設計確定（occurrence ID の形と Rules 方式）
            → §4.2 の (a)/(c) を選ぶ

Step 4      F6-B の実装（Step 3 の ID 設計が前提）
            app PR と Rules PR を分ける

Step 5      古い pending の失効（別課題として起票）
```

## 7. 人間判断が必要な事項

1. **Step 1 の read-only 監査を実施してよいか**（本番 Firestore への read）
2. **自動返却は pull 型（顧客が開いたとき）のままでよいか**
3. **1 返却申請 = N document を維持するか、1 document + items 配列へ変えるか**
   （後者は大きな schema 変更）
4. **portal から `transactions` への update / deterministic set を許可するか**（Rules 変更）
5. 500 件を超える返却申請を拒否してよいか

## 8. 本note で扱わないこと

- F6-A（timer cleanup）— 別 PR で対応済み
- write 開始後の cancel
- staff 確定側の仕様変更（古い pending の失効は別課題として起票）
- `createPortalUnfilledReports` — 同じ `Promise.all` 構造だが別 flow。
  本note の結論が出た後に**同じ方針を適用するか**を判断する
