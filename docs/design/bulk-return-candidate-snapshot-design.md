# 一括返却候補の read snapshot — 設計note（F4）

- 作成日: 2026-07-29
- 対象commit: `ddb2e8fc81e92c0c0ef2c3ab591562c18ad5d0ce`
- 位置づけ: **設計note。実装は含まない。** 仕様判断を人間に求める
- 関連: `docs/architecture/feature-boundaries.md` §4.1(d)


## 0. 反証レビューによる訂正（2026-07-29）— **重要**

独立 reviewer（Codex, read-only）が本note を検証し、
**§2.2 と §4 の安全性評価に誤りがある**と判定した。
**以降の本文は、この §0 の訂正を前提に読むこと。**

### 訂正 1（最重要）— 「transaction 内の再検証があるため誤 write にはならない」は**誤り**

本文 §4 は「候補から漏れても誤 write にはならない」と書いたが、**これは成立しない。**

| 根拠 | file:line |
|---|---|
| `currentStatus` は**明示的に UI 参考値**であり transaction 整合性に使われない | `tank-operation.ts:102` |
| transaction は最新 tank を read して**その状態から再 plan する** | `tank-operation.ts:442` |
| bulk return の context に**期待 customerId が無い** | `bulk-return-workflow.ts:31` |

したがって次が起こり得る:

```
1. 候補一覧を取得（tank A は顧客 X へ貸出中）
2. A が返却され、顧客 Y へ再貸出される
3. スタッフが古い候補一覧から一括返却を実行
4. transaction は「現在 Y へ貸出中の A を返却する」として成立してしまう
   → Y の現在の貸出 cycle を閉じる
```

**これは F6 note のシナリオ3と同じ不変条件違反であり、bulk return にも存在する。**
本note と F6 note は互いに矛盾していた。**コード上は F6 が正しい。**

### 訂正 2 — race semantics の記述が不正確

| 本文 | 訂正 |
|---|---|
| 「どちらの値が採用されるかが read 完了順に依存する」 | **依存しない。** `Promise.all` は呼び出し位置順に結果を返し、その後**必ず ① から Map を構築**し ② は未登録 ID だけ補う（`bulk-return-candidates.ts:176`）。**どちらが先に完了しても ① が勝つ** |
| 「① が画面を開いた瞬間、② が後の snapshot」 | **保証されない。** 独立 read なので ① の read-time が ② より後になることもある。正確には「**typed query の snapshot を時刻に関係なく優先**」 |
| 「read cost が半減」 | 全 tank 数 M、typed 候補数 K として現行 M+K → M。削減率は K/(M+K) で**最大 50%** |

### 訂正 3 — 論点の設定が誤っていた

本文 §3 は「① 優先は業務仕様か実装詳細か」を人間判断としたが、reviewer 判定:

> 人間判断が必要なのは **UI 上どの程度 stale 候補を残すか**であり、
> 現在の偶発的な ① 優先を仕様として残すかどうかではない。

「古い request で別顧客の cycle を閉じてはいけない」は**業務判断ではなく不変条件**である。

### 訂正 4 — 見落としていた選択肢

- 候補取得時の `latestLogId` または `customerId` を expected snapshot として保持し、
  **transaction 内で照合する**（CAS）
- status migration 完了後、typed status query 1本を正本にして全件 read を廃止する
- 選択後に対象 ID だけ再取得し、customer / `latestLogId` を再表示してから確定する

### 訂正後の推奨

**§4 の「解釈 Y を推奨」は維持するが、単独では不十分。**

```
Step 1  write 時の lifecycle 一致確認を入れる（F6 と共通の不変条件）
        bulk return workflow の context に expected customerId / latestLogId を持たせ、
        transaction 内で照合する
        → これは F6 のstaff確定側修正と同じ設計であり、まとめて扱うべき

Step 2  その後に single full snapshot 化（read model の簡素化）
```

**順序を逆にしてはいけない。** single snapshot 化だけを先に入れても
stale cycle 問題は残る。

## 1. 現状

`src/features/staff-operations/queries/bulk-return-candidates.ts:175-193`:

```ts
const [codeMatchedTanks, allTanks] = await Promise.all([
  tanksRepository.getTanks({ statusIn: ["lent", "unreturned"] }),   // ① filtered
  tanksRepository.getTanks(),                                        // ② 全件
]);
const tanksById = new Map(codeMatchedTanks.map((t) => [t.id, t as BulkTankDoc]));

allTanks.forEach((tank) => {
  const status = coerceTankStatusCode(tank.status);
  if (status !== "lent" && status !== "unreturned") return;
  if (!tanksById.has(tank.id)) tanksById.set(tank.id, tank as BulkTankDoc);   // ② は ① を上書きしない
});
```

`fetchBulkTanks()` は返却モードに入るたび、タグ更新失敗時、一括返却完了時に呼ばれる。

## 2. 当初の指摘と、その訂正

一次監査は「① は ② に完全に包含されるので機械的に削除できる」と結論したが、
**これは誤りである。** 二次検証で次が判明した。

### 2.1 静的な単一 snapshot では確かに包含される

`coerceTankStatusCode`（`tank-action-status-codes.ts:168`）は
`normalizeTankStatusCode(v) ?? tankStatusToCode(v)` であり、
code 文字列（`"lent"`）も legacy 文字列（`"貸出中"`）も受ける。

したがって**同一時点の DB 状態**であれば、① がヒットする document は
必ず ② のループでもヒットする。この意味で ① は冗長。

| status の形 | ① filtered | ② 全件 + coerce |
|---|---|---|
| `"lent"` / `"unreturned"`（typed） | ✅ | ✅ |
| `"貸出中"` / `"未返却"`（legacy） | ❌ | ✅ |
| 前後空白付き typed | ❌ | ✅（trim される） |
| その他・不正値 | ❌ | ❌（除外） |

### 2.2 しかし2本の read は同一 read-time ではない

`Promise.all` で並列に投げているが、**2本の独立した `getDocs()`** であり、
Firestore の同一 transaction / 同一 read-time ではない。

反例:

```
t0  ① が tank A を status="lent" として読む
t1  A が返却されて status="empty" になる（別スタッフの操作）
t2  ② が更新後の A を読む → coerce で除外される
t3  現行実装は ① 由来の古い A を候補に残す
```

**現行は「① 優先」という race semantics を持っている。**
② のみにすると、この場合 A は候補から消える。

### 2.3 既存 test がこの semantics を固定している

`src/features/staff-operations/queries/bulk-return-candidates.test.ts:80-124`:

```
① の返却値: B-02 (customerId:"query-b", logNote:"[TAG:unused]"), A-01
② の返却値: B-02 (status:"貸出中", customerId:"fallback-b", logNote:"[TAG:uncharged]"),
            D-04, C-03, E-05(empty), F-06(filled), G-07(空), H-08(充填済み), I-09(invalid)

assertion: groupKeys に "today_lent::customer:query-a" と "...query-b"
           → B-02 は ① 側の snapshot が勝つ
           → A-01 は ① にしか存在しないが候補に含まれる
```

**① を削除すると A-01 が消え、B-02 のグルーピングが変わり、この test は落ちる。**

## 3. 論点

**この「① 優先」は業務仕様か、それとも偶発的な実装詳細か。**

### 解釈 X — 仕様として維持すべき

「スタッフが画面を開いた瞬間に貸出中だったタンクは、その後に返却されても
候補に残す。現場で手元にあるタンクを見落とさないほうが安全」

- 一括返却は「目の前にある実物を処理する」操作であり、候補が多いほうが安全側
- ただし、既に返却済みのタンクを再度返却しようとすると
  `applyBulkTankOperations` が transaction 内の再検証で弾く（fail-closed）
  → 誤った write にはならず、エラーメッセージが出るだけ

### 解釈 Y — 単一 snapshot を正とすべき

「read は1回にして、そのときの状態をそのまま見せる。
2本の read の時間差に依存する挙動は、説明できない不整合を生む」

- グループの表示名・日付pool・tag が ① と ② で食い違い得る
  （現に test fixture では B-02 の customerId と logNote が両者で異なる）
- どちらの値が採用されるかが read 完了順に依存する
- read cost が実質2倍

## 4. 推奨

**解釈 Y（single full snapshot を正とする）を推奨する。** 理由:

1. 「① 優先」が意図的に設計された形跡が docs にもコメントにも無い。
   `feature-boundaries.md` §4.1(d) は read/grouping の分離のみを記述しており、
   2本 read の意味づけは記載されていない
2. ① が拾えるのは typed status のみで、legacy status のタンクには
   そもそも同じ保護が働かない。**保護として一貫していない**
3. 「候補に残す」保護が本当に必要なら、それは
   「read 時刻を UI に出す」「明示的に refresh させる」といった
   説明可能な形で実装すべきで、read の時間差に暗黙依存すべきでない
4. transaction 内の再検証があるため、候補から漏れても誤 write にはならない

**ただしこれは業務判断であり、Claude だけで決めない。**

## 5. 決定後の実装（決定してから着手）

### 解釈 Y を採る場合

| | |
|---|---|
| 変更 | `getBulkReturnCandidateTanks()` を `getTanks()` 1本にする |
| behavior change | **あり**（race 時のみ）。静的状態では不変 |
| test | 上記 fixture を「① にしか無い tank」が存在しない形へ更新。<br>duplicate ID の優先規則 test は削除（read が1本になり概念が消えるため） |
| 検証 level | L0（read 回数が減るのみ） |
| read cost | 半減 |
| 停止条件 | 現場運用上「候補に残す」保護が必要と判明したら中止 |

### 解釈 X を採る場合

| | |
|---|---|
| 変更 | **コードは変更しない。** `bulk-return-candidates.ts` に意図を説明するコメントを追加 |
| 追記先 | `docs/architecture/feature-boundaries.md` §4.1(d) に read semantics を明記 |
| 判定 | `NO_CHANGE`（冗長さは意図的な保護として受容） |

## 6. 人間判断が必要な事項

**唯一の判断: 一括返却の候補一覧は、「画面を開いた瞬間に貸出中だったタンク」を
その後返却されても残すべきか。**

- YES → 解釈 X。コード変更なし。意図を docs とコメントに明記
- NO → 解釈 Y。query を1本にし、test を更新

## 7. 禁止事項（決定前）

- **仕様決定前に query を削除しない**
- read の削減だけを目的に test fixture を書き換えない
- write 側（`bulk-return-workflow.ts`）を同じ PR で触らない
