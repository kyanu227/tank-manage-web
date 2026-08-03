# staff 操作系画面（貸出 / 返却 / 充填 / 返却一覧）— 視覚実装の照合資料

これはコードアーキテクチャの設計書ではない。Claude Design の視覚的正本と、
実装した画面を突き合わせるための照合資料である。
実装レビュー（Codex）は §12 のチェック項目を見ればよい。

- Design project: <https://claude.ai/design/p/f47a3a02-530b-4176-8147-46da058666eb>
- 対象ファイル: `Staff Operations Visual Spec.dc.html`（同 project 内）
  - `support.js` は Claude Design の描画ランタイム（`dc-runtime` の生成物）で、視覚仕様は持たない
  - 併読: 同 project の `staff-operations-screens.md`（正本の要約）
- 前提ノート: [staff-top-menu-and-viewport-policy.md](./staff-top-menu-and-viewport-policy.md)
  （ヘッダー・viewport policy はそちらが正本。本書はその下の操作領域だけを扱う）
- Primary Canonical: **手動貸出 / 送信リスト 5 件 / 貸出先選択済み / 390×844**

---

## 1. 方向性

「一枚の面の上に、優先順位だけを置く」。
区切りは線ではなく、**余白・面のわずかな沈み・文字サイズ**が担う。

- ベタ塗りの面を持たない。A-OK も送信も淡い面の ID ディスプレイ言語で揃える
- 送信は **送信リストの内側**に浮かせる（リスト外に浮かせて貸出先へ重ねない）
- 貸出先は 38px の 1 行に畳み、その分を送信リストの可視高さに回す
- DrumRoll は縦線ではなく内側影で区切り、選択は輪郭を持たないにじみで示す

## 2. ブロック配置（親が領域を配る）

```
Staff Operation Screen
├─ Header                     shell が所有（56px / 文字なし）
└─ Operations Area
   ├─ Section Switcher        StaffSectionTabs（既存・本 PR では触らない）
   └─ Input Workspace         flex:1（この中だけが伸縮する）
      ├─ Command Pane   flex:1
      │  ├─ Commit Display    66px 固定（ID のみ・面全体が hit）
      │  ├─ Operation Queue   flex:1 / 内部スクロール / 送信を内包
      │  └─ Operation Context 38px 固定（optional）
      └─ Input Method Pane    幅固定・全高・線なし（内側影）
```

- 配置と optional 領域の再配分は **親（`ManualOperationPanel`）だけ**が持つ。
  子コンポーネントは相手の寸法も存在も参照しない
- optional が消えた時（＝充填）: `Operation Queue` が `flex:1` のまま下端まで伸びる。
  空白帯は残さない。送信ボタンは Queue 内側の同じ位置に留まる
- 内部スクロールは `Operation Queue` のみ（＋DrumRoll の縦回転）。
  document scroll は既存 viewport policy（locked）のまま

## 3. variant

| variant | accent | Operation Context | 備考 |
|---|---|---|---|
| 手動貸出 | `#3b82f6` / `#2563eb` / `#1d4ed8` | 貸出先 1 行 | 送信「N件の貸出を実行」 |
| 手動返却 | `#10b981` / `#059669` / `#047857` | 返却タグ 3 連 | 戻る 44px を Commit 左へ / 行にタグチップ |
| 充填 | `#f59e0b` / `#d97706` / `#b45309` | なし | Queue が下端まで伸びる |
| 返却一覧 | `#10b981` 系 | — | 別レイアウト。Commit / Queue / Drum を持たない |

accent は既存 `MODE_CONFIG` の色をそのまま継承し、CSS 側では
`.workspace[data-mode="…"]` が `--ops-accent` / `--ops-accent-rgb` /
`--ops-accent-mid` / `--ops-accent-deep` を配る。

## 4. design tokens

正本は [`src/features/staff-operations/styles/OperationsTerminal.module.css`](../../src/features/staff-operations/styles/OperationsTerminal.module.css)。

| 種別 | 値 |
|---|---|
| 面（base） | **白 `#ffffff`**。`--staff-base` / html / body / `theme-color` が同じ白を共有し、上端 safe-area（ダイナミックアイランド裏）から下端・overscroll まで途切れない。操作画面は独自の背景色を敷かない |
| 沈み | 下端に帯を作らない（footer 帯として読めてしまうため）。沈みは Queue の内側と DrumRoll だけが持つ |
| 面の階層 | **面の塗り分けをしない**（Queue の内側も DrumRoll も行も白）。まとまりは 1px アウトラインと legend、DrumRoll の境界はごく弱い内側影だけが示す |
| 状態色 | 注意 `#f0a93b` / `#b45309` ・ 無効 `#ef6b6b` / `#b91c1c` ・ 追加直後 `#e6f7ef → #cdeedf` |
| 文字 | primary `#0f172a` / body `#475569` / sub `#8494ab` / muted `#a8b2c1` / faint `#cbd2dc` |
| typography | ID・件数は monospace（ID 34 / 行 17 / 件数 12）。UI は既存フォント（見出し 11.5–13.5/800、本文 10.5–13/600–800） |
| spacing | 3 / 6 / 8 / 12 / 16（外周のみ 320:12・430:20 に 1 段変える） |
| radius | 同一値を全面に使わない: Queue 16 / Commit 16 / 送信 13 / 行 11 / Context 11 / chip 4–5 / pill 999 |
| outline | 構造 1px `rgba(15,23,42,.085)` / 操作可能 inset 1px accent 26% / 入力中 inset 1.5px accent 34% |
| shadow | 全領域に付けない。送信・Commit とも `0 12px 22px -20px` / Drum は inset のみ |
| gradient | Workspace 下部 / Commit 168deg / 送信 180deg / 注意・無効行の横 90deg / fade（Drum 上端 36px・送信上 22px） |
| motion | 既存の `queue-anim` / spinner を踏襲。新規の派手な motion は足さない |

## 5. 固定寸法と可変

- 固定: Commit 66 / Context 38 / 送信 48 / 行 46 / Drum 68 / 削除 hit 44 / 全削除 hit 44
- 可変: `Operation Queue` の高さのみ（`flex:1; min-height:0`）。
  項目数と Context の有無で伸縮する

### 320 / 390 / 430

| | 320 | 390（基準） | 430 |
|---|---|---|---|
| 外周 | 12 | 16 | 20 |
| Drum 幅 | 60 | 68 | 76 |
| ID | 30 | 34 | 36 |
| 行 | 42 | 46 | 46（**1 行組み**） |
| Context | 36 | 38 | 40 |
| 送信 | 44 | 48 | 48 |
| 件数の単位「件 / tanks」 | 省略 | 表示 | 表示 |
| 返却タグ 3 連 | アイコンを上へ（縦積み） | 横並び | 横並び |

## 6. 主要ブロック

### Commit Display（A-OK 表示兼確定）

66px 固定・ID のみ。ラベルも追加ボタンも持たない。面全体が hit。
6 状態すべてで寸法と ID の位置は不変で、変わるのは面のトーンと inset だけ。

| `data-state` | 条件 | 面 |
|---|---|---|
| `idle` | prefix 未選択 | 中立 `#fff → #f0f3f9`／`disabled` |
| `ready` | prefix 選択済み・番号未入力 | accent 7% → 16%。`A – OK` |
| `typing` | 1 桁入力中 | accent 11% → 24% ＋ inset 1.5px accent 34%。`A – 3_` |
| `armed` | 2 桁到達 | accent 9% → 20% ＋ 落ち影 |
| `added` | リスト追加直後 | 緑面 ＋ ID の後ろにチェック |
| `disabled` | マスタ取得中 / 送信中 | 灰面。取得中のみ文言を持つ（`role="status"`） |

- prefix と番号は **同じ色**（`#0f172a`）。mode の accent は面のトーンだけが持つ
  （正本は prefix を accent-deep にしていたが、2 色に割れて読みにくいため利用者判断で統一）
- 既存の下スワイプ契約（`data-staff-swipe-surface="confirm"`）は wrapper に維持。
  戻るボタンは `data-swipe-ignore="true"` のままで、確定と競合しない

### Operation Queue（送信リスト）

- まとまりは 1px アウトライン ＋ 上辺 legend（面と同色で枠を切り欠く）。重い白カードにしない
- legend: タイトル 11.5px/800 ・件数 monospace accent ・単位 muted ・右に「全削除」
- 行 46px / gap 3 / radius 11 / 白 72%。左の 5×26px ピルが区分（正常 accent・注意・無効）
- 無効行は ID 打ち消し線 ＋「送信対象外」チップ ＋ 理由 1 行。送信件数からは従来どおり除外
- 注意行は「要復旧」チップ。長い説明（`自動補完確認が必要`）は状態行が引き続き持つ
- 返却では **タグなし（通常）も含めて全行にチップ**を出し、意味を色だけに負わせない
- 送信は枠の内側下辺 8px・48px・radius 16。上に 22px の fade、リストは下端 padding 70px。
  **0 件では送信ごと存在しない**（そのぶん下端 padding も 16px に戻す）。
  面は A-OK と同じ言語（白 → accent 11% → 26%、文字は accent-deep）でベタ塗りにしない

### 全削除

- Queue 0 件では非表示。`submitting` 中は `disabled`
- 2 段階（1 タップ目で「全削除する？」＋赤系文字 → 2 タップ目で実行）。
  4 秒で自動解除し、件数が変われば確認は無効になる。モーダルは足さない
- `clearQueue()` は Queue を空にするだけ。prefix・貸出先・返却タグは触らない。
  Firestore へも業務ログへも書かない
- 全削除後もレイアウト（枠・legend・送信位置）は維持される

### Operation Context

- 貸出: `[building icon][貸出先][名称][chevron]` の 1 行。
  **初期状態は未選択**（先頭の貸出先を自動で選ばない）。
  未選択は muted で「貸出先を選択してください」/ “Please select a destination”。
  **エラー色は使わない**。未選択時はラベルを畳み、文が切れないようにする
- 返却: 同じ 38px に返却タグ 3 連。色＋アイコン＋文字の 3 重指定。
  選択中のみ淡い塗り ＋ inset 1.5px、非選択は白 62% ＋ 1px
- 充填: 領域ごと存在しない

### Input Method Pane（DrumRoll / `variant="soft"`）

- 縦線を廃止し、面 `rgba(255,255,255,.24)` ＋ `inset 18px 0 28px -24px rgba(15,23,42,.16)` のみ。
  正本の `.42` / `.30` は境界としてはっきり読めてしまうため、利用者判断で一段弱めた
- 選択枠を廃止。pane 外へ 10px はみ出す楕円 radial-gradient（accent 26% → 13% → 4% → 0%）
- 未選択時は accent ではなく中立 `rgba(15,23,42,.07)` でにじませる
- 文字は選択 27px/800（accent を一段深くした色）、非選択 21px/700。**scale 変形は使わない**
- 階調 `#a8b2c1 → #cbd2dc`（選択から離れるほど淡い）
- 上端 36px の fade で「まだ続く＝回せる」を線なしで示す
- 維持: 選択位置 bottom inset 16 / 3 周描画 / snap / タップ選択 / `data-swipe-ignore="true"`

### 返却一覧

- 横並び 3 ボタン（通常返却 / 返却タグ処理待ち / 長期貸出）を**廃止**
- タブ帯の直下 2px から「手動返却」42px 行が始まり、上部に空白帯を作らない
- 区分は見出し（12.5px ＋ 顧客数・本数）だけで表され、切替 UI としては現れない
- **対象ゼロの区分は見出しごと非表示**。ただし読み込み中・失敗中は状態を伝えるため残す。
  ジェスチャーで明示的に選ばれた区分も（対象ゼロでも）その区分の表示を残す
- 全区分ゼロのときだけ、淡い円 ＋ 2 行の空状態（エラー色なし・次の一手を残す）
- 右端の既存ジェスチャー（`ReturnSegmentGestureLauncher`）は**一切触っていない**

## 7. 状態の補完（視覚正本に無かったもの）

正本は正常系だけを持つため、以下は既存実装の意味を保ったまま面の設計に合わせた。

| 状態 | 実装 |
|---|---|
| loading | 帯を足さず、A-OK が `disabled` ディスプレイになり `role="status"` で文言を持つ |
| error | 面の上に淡い赤の 1 行（`role="alert"`）＋ 再試行。カード枠は持たない |
| disabled（送信中） | A-OK は灰面のまま ID を残す。送信ボタンは spinner ＋ `aria-busy` |
| Queue 空 | 枠・legend・送信位置を維持し、既存の 2 行ガイドを中央に置く |
| 返却一覧 全ゼロ | §6 の空状態 |

## 8. 用語の正本（`持ち越し`）

- 日本語 UI は **`預かり` を使わず、必ず `持ち越し`**。英語は `Carry over`
- リポジトリ側の正本は `src/lib/return-tag-labels.ts` の `keep: { ja: "持ち越し", en: "Carry over" }` で、
  **本 PR 以前からこの表記になっている**。新しい Operations UI もこの 1 経路だけを通す
- Claude Design の視覚正本は行内サンプルに `預かり` を使っているが、**採用しない**（§9）
- 内部 enum / 保存値 / action code（`keep` / `RETURN_TAG.KEEP`）は変更しない

## 9. 視覚正本から調整した点と理由

| 調整 | 理由 |
|---|---|
| **画面全体のパステル配色を採用しない**。mode ごとの緑・暖色の色被せもしない | 利用者の明示指示。正本の「面は 1 枚 / 白帯・灰帯を作らない」意図は、色を足さずに満たせる。accent は送信・ドラム選択・チップなど小面積だけが持つ |
| **基底面を白（`#ffffff`）にし、背景 gradient を持たせない** | 利用者の明示指示（ダイナミックアイランドや Safari の上下UIの裏まで白で統一したい）。`--staff-base` / html / body / `theme-color` を同じ白に揃え、staff 画面だけに適用する（`html:has([data-staff-shell])`）。白基調では「白を重ねる」階層が成立しないため、面の階層を沈み／浮きへ反転した |
| 下端の沈み（`rgba(15,23,42,.032)`）を廃止 | 白基調では下端の帯として読めてしまい、「上端から下端までシームレス」と矛盾するため |
| 送信リストの内側・DrumRoll の面の塗り分けも廃止（すべて白） | 利用者判断。境界をなるべく明示したくないため。DrumRoll の区切りは内側影だけが大まかに示す |
| **0 件では送信ボタンを描かない**（正本は 0 件でも位置を維持） | 利用者判断。リストにタンクが入るまで実行操作を出さない |
| 送信ボタンをベタ塗りから A-OK と同じ淡い面へ | 利用者判断。正本の「塗りは送信だけ」は満たさなくなるが、上下（A-OK / 送信）が同じ言語で揃い、白基調の画面で浮かなくなる。可読性は文字を accent-deep にして確保する |
| メニューの暗幕を白のベール＋弱い blur に変更 | 暗い fixed 面が viewport 全面を覆うと Safari がアドレスバーの色をそこから拾い、上下が黒く沈むため（利用者報告）。器（sheet）は 0.62 まで上げて読めるようにした |
| 行の「要復旧 / 送信対象外」をチップ＋既存文言の 2 段構成にした | 正本のチップ（`要復旧`）を採り入れつつ、既存の説明文（`自動補完確認が必要` 等）を落とさないため。既存の i18n キーをそのまま使う |
| 返却の行チップを「タグあり」だけでなく**全行**に出した | 正本の「タグなしも明示し、意味を色だけに負わせない」を、既存ラベル（`通常` / `Normal`）で満たすため |
| 320 で返却タグをアイコン縦積みにした | 横並びのままだと `持ち越し` / `Carry over` / `Uncharged` が省略される。文字切れ回避の許容範囲内での調整 |
| 返却タグの文字を 11.5px → 11px、gap 6 → 4 | 同上（320 で 3 連が収まる密度） |
| DrumRoll の item 高さは既存の 48px を維持（正本は 46px） | 正本の「維持」項目に snap 動作が含まれるため。既存 gesture の metrics を変えない方を優先した |
| Section Switcher の直下 fade を残した | 既に top-menu PR で 1px 線 → 10px fade に置き換え済み。`StaffSectionTabs` は保守・調達など他画面と共有のため、本 PR では触らない |
| DrumRoll の新しい見た目を `variant="soft"` の opt-in にした | `TankIdInput`（破損 / 自社 / タンク登録）も同じコンポーネントを使う。今回の対象外画面の見た目を巻き込まないため。**将来「ドラムロール ID 入力」を共通コンポーネントへ抽出する前提で、それまでは触らない**（利用者判断）。現状の組み方は 3 系統: `ManualOperationPanel`（2 カラム）/ `TankIdInput`（1 カラム）/ `OrderFulfillmentScreen`（受注） |
| 返却一覧の行を 56px の 1 行カードへ作り替えていない | 一括返却ボタン・展開・タグ選択・cycle 警告を持つ既存の業務 UI で、指示された範囲（3 ボタン削除後の一覧配置と区分の視覚表現）を超えるため。面のトーン・見出し・文字サイズのみ正本に寄せた |
| 全削除の確認をダイアログではなくインライン 2 段階にした | 「過剰なモーダルを追加しない」指示に沿うため。破壊性はアイコン・文言・色で担保する |

## 10. 視覚的に不変な条件（実装で戻してはいけない）

1. 上端から下端まで単一の白（safe-area・overscroll・`theme-color` まで含めて塗り分けない）
2. A-OK は ID のみ。ラベルと追加ボタンを足さない
3. 送信は Operation Queue の内側
4. DrumRoll に縦線と選択枠を戻さない
5. ベタ塗りの面を増やさない（送信も A-OK と同じ淡い面）
6. 全削除を赤い大ボタンにしない
7. 主要ブロックの順序（Commit → Queue → Context / 右に DrumRoll）
8. 返却一覧の区分切替は右端の既存ジェスチャーが持つ（横並びボタンを戻さない）

## 11. 触っていない契約

- 業務ロジック / 状態遷移 / Firestore の read・write semantics
- `data-staff-swipe-surface="confirm"` と `data-swipe-ignore="true"` の付与位置
- `ReturnSegmentGestureLauncher`（右端ジェスチャー）
- action / status code、`RETURN_TAG`、保存値
- `StaffShell` / `StaffHeader` / `StaffSectionTabs`

## 12. Codex が確認すべき項目

1. 変更ファイルが UI 境界（`features/**/components`, `features/**/styles`, 汎用 presentational）に収まっているか
2. `clearQueue()` が Queue 以外（prefix / 貸出先 / 返却タグ / Firestore）へ副作用を持たないか
3. `handleSubmit` の呼び出し形（`skipConfirm` の渡し方）が変わっていないか
4. 送信件数が従来どおり `validCount`（無効行を除外）であること
5. `data-staff-swipe-surface="confirm"` / `data-swipe-ignore` の契約が保たれているか
6. DrumRoll の `variant="soft"` が gesture metrics（snap / 3 周 / bottom inset）を変えていないか
7. 返却一覧で、対象ゼロの区分を隠す判定が読み込み中・失敗中を潰していないか
   （`resolveVisibleReturnSegments` に単体テストあり）
8. 変更ファイル内に `預かり` が残っていないこと
9. `docs/architecture/design-principles.md` に反する構造が入っていないこと
