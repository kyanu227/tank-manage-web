# Staff top menu と viewport policy の設計正本

- 作成日: 2026-08-03
- base SHA: `8eab4997e0126d820214fbcb9583e278f6eca135`（origin/main）
- branch: `feat/staff-top-menu-viewport-policy`
- 位置づけ: staff shell（header / menu / viewport / safe-area）の**設計正本**
- **視覚的正本**: Claude Design プロジェクト
  「Staff Top Menu デザイン案」/ `Staff Top Menu Visual Spec.dc.html`
  （projectId `f47a3a02-530b-4176-8147-46da058666eb`）。
  §7 の値はこの操作可能プロトタイプの実測から取っている。
  **文章と値が食い違う場合はプロトタイプが正**
- 対象外: admin / portal の chrome、業務ロジック、Firestore schema、billing、tank transition

---

## 0. なぜ変えるのか（現状の事実）

base SHA 時点の実測（ローカルブラウザーで計測。推測ではない）:

| # | 事実 | 証拠 |
|---|---|---|
| F1 | 320px 幅で受注バッジがあると header が **2行 94px** に折り返す | `header.getBoundingClientRect().height === 94.195…`（受注バッジ注入時） |
| F2 | header 下端が硬い 1px 線。方針バナー表示時は **1px 線が 122px の間に3本**積み上がる | header `1px #e8eaed` / banner `1px #fecaca` / tabs `1px #e2e8f0` |
| F3 | `theme-color` meta が**1つも出力されていない** | `document.querySelectorAll('meta[name="theme-color"]').length === 0` |
| F4 | manifest の `theme_color: #28C7D9`（シアン）はアプリのどの面とも一致しない | `src/app/manifest.ts` |
| F5 | 基底色が3つに分裂 | html/body `#f0f4f8` / staff shell `#f8f9fb` / 本文 `#f8fafc` |
| F6 | 装飾 radial-gradient が `html, body` にあり、overscroll・ブラウザーUI 側へ露出しうる | `globals.css:65-67` |
| F7 | staff の**全route**が viewport 拘束（`height:100dvh; overflow:hidden`）。かつ shell が常時 `padding-bottom: env(safe-area-inset-bottom)` を予約 | `src/app/staff/layout.tsx:127` |
| F8 | スクロール禁止の判断が**3系統に分散** | shell の `overflow:hidden` / `isInternalScrollPage` 配列 / 3ファイルの `document.body.style.overflow` |
| F9 | 下端 safe-area が二重に効く | shell の `padding-bottom` + 各固定バーの `max(12px, env(safe-area-inset-bottom))` |
| F10 | 自社管理が header と drawer の**2箇所**に重複 | `layout.tsx:186` と `SIDE_NAV[1]` |
| F11 | 横スワイプが3つのほぼ同一 hook に複製されている（縦方向の契約は存在しない） | `useOperationSwipe` / `useMaintenanceSwipe` / `useProcurementSwipe` |

F1〜F11 が、この設計が解く問題のすべてである。

---

## 1. 最終的なユーザー体験

方向性は **「静かな精度」**。既存の indigo `#6366F1` / slate 階調をそのまま継承する。
ヘッダーは硬い 1px 線を捨てて**半透明面 + 10px の gradient fade** だけで浮かせる。

メニューは**ヘッダーが右上から下へ伸びた面**として現れるが、その面は情報を直接載せる
キャンバスではなく**器**として扱う。器の上に **2 つの箱**を置いて情報を束ねる（§2.5）:
**箱A = 自分（名前・言語設定）／箱B = 行き先（navigation + 主要操作）**。

**箱の囲いは線ではなく影で示す。** border も divider も持たない。
カードは 2 枚まで。要素ごとにカードを増やさない。

1. 画面右上の Chevron を親指で押す、または header の余白／タブ帯／上部 A-OK 確定ブロックを**下へ払う**とメニューが上から降りてくる
2. **Chevron は開閉で位置が動かない**。sheet 上部 56px 行に同座標で再出現し、そのまま閉じるボタンになる
3. メニュー上部で「自分が誰としてログインしているか」と「表示言語」を確認・変更できる
4. メニュー中央に低頻度の遷移先（発注・メンテナンス・マイページ・ダッシュボード）が並ぶ
5. メニュー**下端**＝親指が最も届く位置に「貸出・返却・充填」と「自社管理」がある
6. どこかを選ぶ、上へ払う、backdrop を触る、Escape のいずれでも閉じる
7. header は本文の上にわずかに浮いているが、線では区切られていない
8. Dynamic Island の左右、上端、下端、Safari のバー付近まで、アプリは一枚の面として続いて見える

---

## 2. Menu information architecture

右寄せトップシート。階調は **account（弱） → navigation（中） → primary actions（強）の一方向だけ。**

```text
┌──────────────────────────────┐  ← 器。上端・右端に密着（上2角は角丸なし）
│  STAFF MENU              ⌃  │   header と同じ 56px 行。Chevron は同座標
│  ╭──────────────────────────╮ │
│  │ (木)  木村 慧             │ │
│  │       kimura@example.co.jp│ │  箱A = 自分
│  │ スタッフ · ランク A        │ │  名前・メール・role・rank + 言語設定
│  │     表示言語 [ 日本語 ▾ ]  │ │  角丸 18px / 線なし / 影で囲いを示す
│  │        保存中… / ✓ 保存    │ │
│  ╰──────────────────────────╯ │
│  ╭──────────────────────────╮ │
│  │    🛒  発注・タンク登録    │ │
│  │    🔧  メンテナンス        │ │  箱B = 行き先
│  │    👤  マイページ          │ │  navigation（44px 行 / scroll する側）
│  │    ▦   ダッシュボード      │ │
│  │  ┌──────────────────┐  │ │  ＋ 主要操作（同じ箱の中に入れる）
│  │  │ ✋ 貸出・返却・充填 ③│  │ │  56px 塗り潰し
│  │  └──────────────────┘  │ │
│  │  ┌──────────────────┐  │ │
│  │  │ 🏢 自社管理         │  │ │  50px 淡い塗り（線を持たない）
│  │  └──────────────────┘  │ │
│  ╰──────────────────────────╯ │
└──────────────────────────────┘  ← 角丸 bottom 24 / 24
```

### 2.1 zone ごとの視覚強度（意図的に3段）

| zone | 強度の作り方 | 使わないもの |
|---|---|---|
| 弱 account | 1日1回も触らない。**箱A** にまとめる。操作要素は言語 select だけ | アイコン枠、行ごとの装飾 |
| 中 navigation | **箱B** の上段。44px 行・行背景なし・アイコンは muted。active のみ**右へ向かう indigo gradient**（0% → 11%）で「右端＝現在地」を示す | 行ごとの枠、行の塗り分け |
| 強 primary | **箱B** の下段。**塗りの重さと寸法**（塗り潰し 56px > 淡い塗り 50px > 素の行 44px）。幅 196px・中央寄せ。影は 1 本だけ | glow、複数の影、border |

**箱は 2 つまで。**「要素ごとに白いカードで囲む」「全行にアイコン枠を付ける」は禁止する。
グルーピングは *情報のまとまり*（**自分は誰か／どこへ行けるか**）に対してだけ行い、
個々の行や操作に対しては行わない。navigation と主要操作は「行き先」という同じまとまりなので、
**同じ箱に入れる**。

### 2.5 器と箱の関係（承認済みの視覚改訂）

初版は sheet 1 枚の面に account / navigation / primary を直接載せていたが、
名前・言語・ナビが同じ平面で競合して読みにくいという判断により、器 + 箱2つへ改訂した。

**箱は塗りで分離しない。** 中と外で透過を変えず、分離は**光学**だけで作る（Liquid Glass 方向）:

1. 箱の中でだけ `backdrop-filter` を重ねがけし、奥をより拡散させる（屈折の代替）
2. 縁のスペキュラ = ガラスの厚みが光を拾った表現
3. 落ち影 = 器から浮いていること

border も divider も引かない。器の透過は初版のまま維持する。

| 層 | 役割 | 値 |
|---|---|---|
| 器（sheet） | 背面をぼかすだけ。情報を直接載せない | `rgba(255,255,255,0.30)` + `blur(32px) saturate(180%)` / 非対応時 `#F4F6FA` |
| 箱（account / menu） | 情報のまとまり。**塗りを持たず、光学だけで囲いを示す** | `background-color` なし（sheen `rgba(255,255,255,0.22)→0.08 38%→0.12` のみ）/ `blur(10px) saturate(150%)` の重ねがけ / radius 18 / border なし |
| 箱の縁と影 | 囲いの正体 | `inset 0 1px 0 rgba(255,255,255,0.85)`（上端スペキュラ）, `inset 0 0 0 1px rgba(255,255,255,0.30)`（ガラスの厚み）, `inset 0 -1px 0 rgba(15,23,42,0.07)`, `0 12px 24px -12px rgba(15,23,42,0.30)`, `0 2px 6px -3px rgba(15,23,42,0.12)` |

**制約（実測に基づく）**: 器が `rgba(255,255,255,0.80)` の時点で背面の情報量が少ないため、
重ねがけした blur による拡散差は肉眼ではほぼ判別できない。実際に分離を担っているのは
**縁のスペキュラと落ち影**である。真の屈折（`feDisplacementMap` を `backdrop-filter: url()` へ流す方法）は
iOS Safari で無言で失効し blur ごと消える危険があるため採用しない。
拡散差を見せたい場合は器の透過を下げる必要があり、それは「透過を維持する」方針との
トレードオフになる。

改訂に伴う削除:

- account と navigation の間の hairline（箱の境界が役割を引き継ぐため不要）
- primary zone の沈んだ面 gradient（箱と競合するため）
- 自社管理ボタンの `1px solid #E2E8F0`（箱の中で線を持たせない。`rgba(15,23,42,0.05)` の淡い塗りへ置換）

`STAFF MENU` ラベルは `rgba(15,23,42,0.34)`。

### 2.2 各要素の出所

| 要素 | 出所 | 新規 Firestore read |
|---|---|---|
| 氏名 / メール / role / rank | 既存 `staffSession`（`useStaffSession`） | **なし** |
| イニシャル | 氏名の先頭1文字から導出 | なし |
| 表示言語 | `SUPPORTED_LOCALES` + `updateOwnStaffLocale`（既存 service） | 既存経路のみ |
| navigation / primary | 静的定義 + `usePathname()` | なし |
| 受注件数 | 既存 `usePendingOrderCount` | 既存経路のみ |

**メニュー表示のためだけの Firestore read を追加しない。** locale 保存は既存 `updateOwnStaffLocale` のみを使い、別 service を作らない。

### 2.3 言語設定

- `SUPPORTED_LOCALES` を列挙する `<select>`。**将来 locale が増えても要素を増やさない**（2ボタン方式にしない）
- **選択時保存**（保存ボタンなし）。理由: 一過性のシートに確定ボタンを置くと、押し損ねと誤タップの両方を招く
- 保存中は `disabled` + `aria-busy` で二重送信を防ぐ
- 状態は select の下に中央寄せで出す: `保存中…` / `✓ 表示言語を保存しました` / エラー文
- 保存成功後は `updateStoredStaffSessionLocale` 経由で `staffSession` が更新され、`useStaffLocale` を購読している画面全体が追随する（既存の仕組み。新規経路を作らない）
- select 起点の操作を menu の開閉ジェスチャーと誤認しない（§4.3）

### 2.4 受注件数の置き場所（役割重複を作らない）

受注件数は **menu の「貸出・返却・充填」ボタン内の chip** を正位置として維持する。

header 側の chip は、貸出画面では**操作スタイルの切替**、貸出以外では**貸出画面への導線**を担う:

| 画面 / 状態 | header chip | 意味 |
|---|---|---|
| 貸出・手動モード・未処理受注あり | 琥珀色 `受注 N` | 押すと受注モードへ切り替わる（通知と入口を兼ねる） |
| 貸出・受注モード | indigo `手動` | 押すと手動モードへ戻る |
| 貸出・手動モード・受注なし | なし | 出すものがない |
| 貸出以外・未処理受注あり | 琥珀色 `受注 N` | 貸出画面への Link。受注の存在を知らせ、処理入口を維持する |
| 貸出以外・未処理受注なし | なし | 出すものがない |

承認済みの現行実装どおり、貸出以外でも未処理受注があれば header chip を表示する。
menu 内の件数 chip も残し、どの画面からでも通知と貸出画面への入口を失わない。

---

## 3. Header の不変条件

**変えてはならないもの**:

| # | 不変条件 |
|---|---|
| H1 | コンテンツ行の高さは **56px ちょうど**（現行 main と同じ）。総高は `env(safe-area-inset-top) + 56px` |
| H2 | **320px でも折り返さない**（`flex-wrap: nowrap`）。専用行・プル領域・追加の縦スペースを設けない |
| H3 | 受注通知を維持する（§2.4） |
| H4 | 貸出画面の 手動／受注 切替を維持する |
| H5 | 硬い 1px の境界線を持たない |
| H6 | 影・fade でレイアウト上の高さを増やさない |
| H7 | Chevron は右端。visible な枠・カード背景・常時表示の円形背景を持たない |
| H8 | **Chevron は開閉で位置が動かない**（sheet 上部 56px 行に同座標で再出現する） |

**構成**（左→右）:

```text
[ 余白（下スワイプの起点。操作要素を置かない） ]  [受注 N / 手動]  [ ⌄ ]
                                             受注:全画面／切替:貸出  常時
```

ハンバーガーは廃止。自社管理リンクは header から削除し、menu の primary zone へ移す（F10 の解消）。
同じ遷移先を2箇所に出さない。

### 3.1 Chevron

| 項目 | 値 |
|---|---|
| icon | lucide-react `ChevronDown` |
| visible size | 20px |
| hit area | **44 × 44 px**（radius 12） |
| 光学位置 | header padding-right 4px + 44px ボタン → icon 右端が画面右端から **16px** |
| 枠 / 背景 | **なし**（開状態でも付けない） |
| 開状態 | `rotate(180deg)` 200ms、色 `#64748B` → `#334155` |
| a11y | `aria-expanded` / `aria-controls` / ja・en の `aria-label` |

### 3.2 Elevation（F2 の解消）

線を **10px の gradient fade 1枚**に置き換える。box-shadow は使わない。

| 状態 | fade の opacity |
|---|---|
| 静止 | 0.55 |
| scroll 中 | 1.0（160ms linear） |

- fade は `margin-bottom: -10px` でレイアウト高さ 0
- fade は shell 直下（`z-index: 19`）に 1 枚だけ置く
- StaffSectionTabs は `z-index: 20` の同一面なので、タブがある画面では**タブ面が fade を覆う**。
  結果としてヘッダーとタブ帯の間に線も fade も出ず、fade はタブ帯の下にだけ現れる（二重表現にならない）
- blur 非対応環境では `@supports` で不透明色にフォールバックし、面の色だけで成立させる

---

## 4. Gesture

### 4.1 StaffSectionTabs を共通契約にする

下スワイプ起動を貸出・返却・充填の個別実装にしない。**`StaffSectionTabs` を利用する全画面**（現在および将来）へ同じ契約を適用する。

| グループ | wrapper | 対象route |
|---|---|---|
| operations | `OperationModeTabs` | `/staff/lend` `/staff/return` `/staff/fill` |
| maintenance | `MaintenanceTabs` | `/staff/damage` `/staff/repair` `/staff/inspection` |
| procurement | `ProcurementTabs` | `/staff/supply-order` `/staff/tank-purchase` `/staff/tank-register` |

実装契約: 各 wrapper へ touch handler を複製しない。`StaffSectionTabs` が
`data-staff-swipe-surface="tabs"` を出力し、**単一の gesture coordinator** がそれを起点として扱う。
open surface は次の3種類とする。

- header の非操作領域: `data-staff-swipe-surface="header"`
- StaffSectionTabs のタブ帯: `data-staff-swipe-surface="tabs"`
- 上部 A-OK 確定ブロック（button と周囲の padding を含む wrapper）:
  `data-staff-swipe-surface="confirm"`

送信リスト・スキャン済みリスト・queue 等の scrollable 領域は confirm の sibling とし、
open surface に含めない。confirm 内の通常の A-OK `button` から始めた下スワイプも許可する。

タブ帯上の操作:

| 入力 | 結果 |
|---|---|
| 短いタップ | 対象タブへ遷移（従来どおり） |
| 横スワイプ | 同一グループ内の画面切替（従来どおり。インジケーターの追従アニメーションを維持） |
| 下スワイプ | staff メニューを開く |

### 4.2 Gesture arbitration（調停）

単一の分類器が全ジェスチャーを裁く。既存の横スワイプ・DrumRoll・新しい縦スワイプを独立した競合実装にしない。

```text
touchstart
  └─ 除外判定（§4.3）に該当 → 何もしない（以後このタッチを無視）
touchmove
  ├─ |dx| < 10 かつ |dy| < 10        → 何もしない（tap のまま）
  └─ どちらかが 10 を超えた瞬間に axis を lock
        |dx| >  |dy| → axis = "x"
        |dy| >= |dx| → axis = "y"
  ※ 一度 lock した axis は touchend まで変更しない
touchend
  ├─ axis = "x" かつ |dx| >= 40  → section switch を commit
  ├─ axis = "y" かつ  dy >= 40   → menu open を commit（閉じている時のみ）
  ├─ axis = "y" かつ -dy >= 40   → menu close を commit（開いている時のみ）
  └─ それ以外                     → commit なし（tap は従来どおり link として動く）
```

**規則**:

- 1つの gesture で 2つの操作を commit しない（axis lock により構造的に不可能）
- 明示 surface 内の `a` / `button` から始まった swipe が commit したら、直後の `click` を1回だけ抑止する
- 閾値は既存定数を再利用する: axis lock 10px、commit 40px（`STAFF_SECTION_SWIPE_COMMIT_DISTANCE_PX`）
- 右端 80px の edge guard（`STAFF_SECTION_SWIPE_EDGE_GUARD_PX`）は横方向にのみ適用する

### 4.3 除外契約（DrumRoll ほか）

touchstart の target から祖先を辿り、次の優先順位で判定する。

1. `[data-swipe-ignore="true"]` / `[data-drum-roll-option="true"]` は常に除外する。
   明示 surface の内側でも ignore が優先する
2. `select` / `input` / `textarea` / `[role="listbox"]` / 独自 touch UI は常に除外する。
   QuickSelect は既存の `data-swipe-ignore="true"` 契約を使う
3. `[data-staff-swipe-surface]` に到達したら、その surface として許可する。
   内部 target が通常の `a` / `button` でも一律除外しない
4. どれにも一致しなければ menu open / close gesture の対象外とする

明示 surface 内の `a` / `button` から始めた gesture が commit した場合だけ、
直後に生成される click を capture phase で1回抑止する。short tap と commit 閾値未満では抑止しない。

この起点判定に加え、上スワイプ時は**その方向へまだスクロールできる**領域を
scroll chaining 規則で優先する。

既存の `isSwipeIgnoredTarget` / `STAFF_SECTION_SWIPE_IGNORE_SELECTOR`
（`components/staff-section-tabs-events.ts`）を**再利用する**。新しい除外語彙を作らない。

**DrumRoll 操作中に staff メニューが開くことを許可しない。**

scroll chaining 規則の帰結:

| 起点 | 上スワイプ |
|---|---|
| backdrop | 閉じる |
| primary zone / account zone | 閉じる |
| navigation の scroll 領域（スクロール余地あり） | **スクロールする。閉じない** |
| navigation の scroll 領域（余地なし＝内容が収まっている） | 閉じる |

### 4.4 スワイプは唯一の手段ではない

開く: Chevron タップ / header 下スワイプ / タブ帯 下スワイプ / A-OK 確定ブロック 下スワイプ
閉じる: 同座標の Chevron / backdrop タップ / Escape / ナビゲーション選択 / 上スワイプ

---

## 5. Viewport policy（F7・F8・F9 の解消）

### 5.1 用語

ここでいう「ページスクロール」は **document / body / staff main による通常の縦スクロール**を指す。
横スワイプやメニュー開閉ジェスチャーは含まない。

### 5.2 単一 policy

route ごとに scroll lock / 100dvh / overflow / bottom padding を**個別判断しない**。宣言は 1 値だけ。

```ts
type StaffViewportMode = "allowed" | "locked";
```

```text
locked  => viewport constrained
        => shell が 100dvh に固定し、shell が下端 safe-area を所有する
        => document scroll は禁止
        => 必要なスクロールは画面内の限定領域のみ

allowed => viewport 非拘束（既定）
        => 通常の document scroll
        => shell は env(safe-area-inset-bottom) の恒久的な空白帯を予約しない
        => 背景は下端まで連続
        => 固定子要素があれば、それ自身が表示中だけ safe-area を持つ
```

### 5.3 route 分類

| mode | route | 理由 |
|---|---|---|
| `locked` | `/staff/lend` `/staff/return` `/staff/fill` | DrumRoll + 画面内固定の送信バー |
| `locked` | `/staff/inhouse` `/staff/damage` | DrumRoll / TankIdInput + footer 固定 |
| `locked` | `/staff/repair` `/staff/inspection` | `position:absolute; bottom:0` の送信バーが拘束された箱を前提にしている |
| `allowed` | `/staff/dashboard` `/staff/mypage` | 長い一覧。下端まで自然に読み切れること |
| `allowed` | `/staff/supply-order` `/staff/tank-purchase` `/staff/tank-register` | 同上 |

判定は**1つの純粋モジュール**（pathname → mode）に閉じ、shell がそれを読む。
page 側の個別 `document.body.style.overflow` 変更（`inhouse` / `damage` / `OperationsTerminal` の3箇所）は
**削除して policy へ集約する**。

### 5.4 固定子要素の safe-area

`allowed` route に下部固定操作がある場合:

- shell は下端を制限しない
- 固定操作**自身**が `padding-bottom: max(X, env(safe-area-inset-bottom))` を持つ
- 表示中だけ、最終コンテンツが隠れないよう scroll padding を与える
- 非表示のときは余分な空白を残さない

これにより F9 の二重 inset が消える。

---

## 6. 面・safe-area・theme-color（F3〜F6 の解消）

**原則: 背景は端まで伸ばし、操作要素だけを safe-area 内へ置く。**
現在の safe-area 保護を単純に削除してはならない。

### 6.1 基底色の統一

| 対象 | before | after |
|---|---|---|
| `--bg-primary`（html / body / shell / 上下 safe-area / overscroll） | `#f0f4f8` | **`#F4F6FA`** |
| `viewport.themeColor` | **未出力** | **`#FAFBFD`**（ヘッダー背面と一致する不透明色） |
| `manifest.background_color` | `#F8FBFF` | **`#F4F6FA`** |
| `manifest.theme_color` | `#28C7D9` | **`#FAFBFD`** |
| html/body の装飾 radial-gradient | html/body | **`.page-wrapper`（アプリ内コンテンツ層）へ移す** |

- `themeColor` は透明色にしない
- 装飾を `.page-wrapper` へ移すことで、overscroll 領域とブラウザーUI へ装飾が露出しなくなる。アプリ内の見えは変わらない
- 上部 safe-area は**独立した spacer をやめ、header 自身の `padding-top` に統合する**（面が2つに割れないことを構造的に保証する）
- `viewportFit="cover"` は維持する
- `appleWebApp.statusBarStyle` は機械的に変更しない。通常 Safari と standalone PWA の双方を実機で見てから判断する（本 PR では**変更しない**）

### 6.2 到達目標

- Dynamic Island の左右に別の灰色が露出しない
- 上端が header から連続して見える
- Safari 下部UI付近に別色の帯が残らない
- `allowed` route の下端に恒久的な空白帯がない
- PWA 起動時に別色の flash が起きにくい
- overscroll 時にアプリ外のような灰色が出ない

### 6.3 制御できないことの明示

Safari のブラウザークローム自体はアプリから完全制御できない。
**実機未確認の状態で「完全に制御した」と報告しない。**

---

## 7. Design tokens（視覚的正本の実測値）

§7.1 は**視覚的に不変**。§7.2 は実機確認で調整してよい。

### 7.1 視覚的に不変（Codex が独自判断で変えてはならない）

| 項目 | 規則 |
|---|---|
| sheet の接続 | 画面**上端と右端に密着**（隙間 0）。角丸は**下2辺のみ** |
| Chevron | 開閉で**位置が動かない**。sheet 上部 56px 行に同座標で再出現する |
| 階層 | account < navigation < primary の一方向 |
| elevation | **下向きのみ**。線を引かない |
| motion | 上→下（開）／下→上（閉）。閉は開より速い |
| header 高さ | コンテンツ行 56px 固定（全幅で不変） |
| spacing scale | 4 / 8 / 12 / 14 / 18 / 24 |
| radius | **同一値を全面に使わない**: sheet 24 / primary 14 / nav 10 / chip 999 / select 10 / avatar 50% |

### 7.2 実機で調整可

sheet width（250–330 の範囲）、backdrop opacity、fade strength、blur 半径、animation duration。

### 7.3 Color / surface

| token | 値 | 用途 |
|---|---|---|
| app base | `#F4F6FA` | html / body / shell / 上下 safe-area / overscroll / manifest `background_color` |
| chrome surface | `rgba(252,253,255,0.78)` + `blur(20px) saturate(180%)` | header / StaffSectionTabs（同一面） |
| chrome fallback | `#FAFBFD` | blur 非対応時 / `theme-color` |
| sheet surface（器） | `rgba(255,255,255,0.30)` + `blur(32px) saturate(180%)` | menu sheet。薄くして背面を残す |
| sheet fallback | `#F4F6FA` | blur 非対応時 |
| 箱 surface | `background-color` なし + sheen `rgba(255,255,255,0.22)→0.08 38%→0.12` / `blur(10px) saturate(150%)` 重ねがけ / radius 18 / border なし | 箱A（account）/ 箱B（menu）。§2.5 |
| 箱 edge | `inset 0 1px 0 rgba(255,255,255,0.85)` + `inset 0 0 0 1px rgba(255,255,255,0.30)` + `inset 0 -1px 0 rgba(15,23,42,0.07)` | ガラスの縁。囲いの主役 |
| 箱 shadow | `0 12px 24px -12px rgba(15,23,42,0.30), 0 2px 6px -3px rgba(15,23,42,0.12)` | 器から浮かせる |
| backdrop | `#0F172A` @ **0.32** / fade 200ms linear / **blur なし** | menu backdrop |
| text | primary `#0F172A` / body `#475569` / sub `#64748B` / muted `#94A3B8` / icon idle `#9AA5B5` | |
| accent | `#4F46E5`（文字）/ `#6366F1`（塗り）/ `#EEF2FF`（淡塗り）/ `#C7CBF7`（枠） | |

> **実装注意**: `backdrop-filter` の値を CSS custom property にしない。
> Lightning CSS が `backdrop-filter: var(…)` / `-webkit-backdrop-filter: var(…)` の組を落とし、
> blur が無効化される（実測で確認済み）。使用箇所に literal で書く。

### 7.4 Elevation

| 対象 | 値 |
|---|---|
| header fade | 高さ 10px / `linear-gradient(rgba(15,23,42,0.055), rgba(15,23,42,0))` / `margin-bottom:-10px` / `z-index:19` / 静止 `opacity .55` → scroll `1.0`（160ms linear） |
| sheet shadow | `0 26px 50px -22px rgba(15,23,42,.34), 0 2px 6px rgba(15,23,42,.05), inset 1px 0 0 rgba(15,23,42,.05)` |
| primary（塗り） | `0 8px 18px -10px rgba(79,70,229,0.75)`（影は 1 本だけ） |
| タブ indicator | `0 1px 3px rgba(15,23,42,0.10)` |
| header / タブ帯 | **box-shadow を持たない** |

### 7.5 寸法

| 要素 | 値 |
|---|---|
| header | `min-height:56px` / `padding: 6px 4px 6px 16px`（上下 6px で 44px hit area を 56px に収める）/ `padding-top: calc(6px + env(safe-area-inset-top))` |
| header chip | hit 44px / 本体 h32 `padding 0 12px` radius 999 / 12.5px 800 / icon 14 / gap 5 |
| Chevron | visible 20 / hit 44×44 / radius 12 |
| StaffSectionTabs | `padding: 10px 16px 12px` / track `rgba(15,23,42,0.043)` radius 12 padding 4 / tab `padding 8px 4px` radius 10 |
| sheet | `width: min(280px, calc(100% - 20px))`（≥430px は 260px）/ `max-height: calc(100dvh - 24px)` / radius `0 0 24px 24px` / `transform-origin: right top` |
| sheet 上部行 | header と同一（`min-height:56px` / `padding: 6px 4px 6px 16px`） |
| account | `padding: 2px 16px 14px` / avatar 40 circle `#EEF2FF`・`#4F46E5` 16px 800 / gap 12 |
| account text | name 15px 700 `-0.01em` / email 11.5px 500 `#94A3B8` / meta 11px 700 `#64748B` + 3px dot `#CBD5E1` |
| locale | 中央寄せ gap 9 / label 11px 700 / select w152 h36 radius 10 `#F1F5F9` 13px 700 `text-align:center` / chevron 14 |
| locale status | `margin-top: 7px` 中央 11px 700（saving `#64748B` / saved `#047857` / error `#DC2626`） |
| divider | h1 `margin: 0 16px` / `linear-gradient(90deg, rgba(15,23,42,.10), rgba(15,23,42,0))` |
| nav | `padding: 8px` / 行 h44（≥430px は 46）radius 10 / 内側の列 min-width 138 gap 9 / label 13.5px（idle 600 `#475569` / active 700 `#4F46E5`）/ icon 16 |
| nav active | `linear-gradient(90deg, rgba(99,102,241,0) 0%, rgba(99,102,241,0.11) 100%)` |
| primary zone | `padding: 12px 14px 6px` / `linear-gradient(180deg, rgba(15,23,42,0.015), rgba(15,23,42,0.05))` |
| primary 塗り | h56 / 基準幅 196（折り返さない範囲で内容ぶん拡張）/ radius 14 / `#6366F1` / icon 19 / label 15px 600 / count chip h21 `padding 0 7px` radius 999 `rgba(255,255,255,0.24)` 11.5px 800 |
| primary 輪郭 | h50 / `margin-top: 8px` / radius 14 / `#fff` + `1px solid #E2E8F0` / `#334155` 14.5px 600 / icon 18 `#64748B`。active は `#EEF2FF` + `1px solid #C7CBF7` + `#4F46E5` 700 |

### 7.6 Motion

| 対象 | duration / easing |
|---|---|
| sheet open | **220ms** `cubic-bezier(.22,1,.36,1)` — `translateY(-14px)→0` + `scale(.985)→1` + `opacity 0→1`、origin `top right` |
| sheet close | **150ms** `cubic-bezier(.4,0,1,1)`（開より速い） |
| backdrop | opacity のみ 200ms linear |
| Chevron rotate | 200ms、sheet と同時開始 |
| header fade | opacity 160ms linear |

`prefers-reduced-motion: reduce`: **transform を無効化し opacity 100ms のみ**。Chevron も回転しない。
StaffSectionTabs 既存の reduced 分岐はそのまま維持する。

### 7.7 Breakpoint ごとの差

| 幅 | 差分 |
|---|---|
| 320px | header / sheet 上部行の左 padding 16→12。受注 chip は**数字のみ**（読み上げは `aria-label` が担保）。sheet は `100% − 20px` |
| 375 / 390px | 標準。sheet 280px |
| 430px | sheet 260px、nav 行 46px。header 高さ 56px は不変 |

---

## 8. Accessibility

| 項目 | 要件 |
|---|---|
| trigger | `aria-expanded` / `aria-controls` / ja・en の `aria-label` |
| sheet | `role="dialog"` / `aria-modal` / `aria-label` |
| 閉時 | `aria-hidden` + `inert` |
| Escape | 閉じる |
| focus | 開いたら sheet 自体（`tabindex=-1` / `outline:none`）へ移動して trap する。閉じたときは **Escape のときだけ** Chevron へ返す（§8.1） |
| active | `aria-current="page"` |
| header chip | `aria-pressed` + 切替先を述べる `aria-label`（受注件数を含める） |
| キーボード | Tab / Shift+Tab / Enter / Space で全操作が可能 |
| focus-visible | `outline: 2px solid rgba(15,23,42,0.32); outline-offset: 2px`。menu 開閉に伴うプログラム的 focus ではリングを出さない（§8.1） |
| hit area | 主要操作は 44px 以上 |
| locale 保存状態 | `role="status"`、エラーは `role="alert"` |
| reduced motion | §7.6 |

### 8.1 フォーカスリングの出し方

menu の開閉ではフォーカスを機械的に動かすため、そのままだと
`element.focus()` が `:focus-visible` を立て、ポインター操作なのに Chevron へ
リングが出てしまう。次の2点でこれを避けつつキーボード利用者の文脈は保つ。

- 開いたときは最初の操作要素ではなく **sheet 自体**（`tabindex="-1"` / `outline:none`）へ移す。
  Tab を押した時点で通常どおり内部の先頭要素へ入る
- 閉じたときに Chevron へ戻すのは **Escape で閉じた場合だけ**。
  backdrop タップ・ジェスチャー・ナビゲーション選択では focus を動かさない

リング自体は残す（色は accent ではなく `rgba(15,23,42,0.32)`）。

**スワイプを唯一の操作方法にしない。**

---

## 9. MyPage

削除するもの: 言語設定カード / 言語選択 state / 保存中 state / 成功 message state / error state /
保存 handler / 不要になった locale 関連 import / 本当に未使用になった表示文言。

維持するもの: プロフィール、role・rank、メール、月次表示、統計、最近の作業履歴。

i18n キーは**全リポジトリ検索後**、本当に未使用になったものだけ削除する。
`getLocaleOptionLabel` / `getStaffRoleDisplayLabel` は menu でも必要になるため、
共有 display boundary（`src/lib/staff-display.ts`）へ移し、feature 側に重複定義を残さない。

---

## 10. 回帰禁止（変えてはならない振る舞い）

| # | 契約 |
|---|---|
| R1 | 既存 route |
| R2 | タブ選択（短いタップでの遷移） |
| R3 | 横スワイプによるグループ内切替とインジケーターの追従アニメーション（220ms） |
| R4 | DrumRoll の縦回転・タップ選択 |
| R5 | QuickSelect |
| R6 | 受注通知（§2.4 の置き場所変更を伴う） |
| R7 | 手動／受注切替（`opStyleChange` イベント契約を含む） |
| R8 | 言語設定の永続化（`updateOwnStaffLocale` のまま。reload 後も維持される） |
| R9 | 認証 |
| R10 | キーボード操作 |
| R11 | tank operation の意味 / 状態遷移 / recovery の意味 / billing / customerId・staffId identity |
| R12 | Firestore schema / Rules / indexes / transaction の意味 / 受注処理 / ログ訂正条件 |
| R13 | package 依存 / `firebase.json` |

新しい Firestore read・write 経路を作らない。UI component / UI hook へ Firebase SDK write を追加しない。

---

## 11. 実装所有権

| 層 | 所有者 |
|---|---|
| visual direction / design tokens / presentational DOM / CSS / spacing / typography / surface / shadow / blur / radius / responsive visual / motion の視覚仕様 / 実装後の polish | **Claude** |
| menu open-close state / gesture classifier / axis lock / gesture coordination / StaffSectionTabs 接続 / viewport policy / document scroll lock / bottom constraint / focus management / Escape / inert / locale service 接続 / a11y 挙動 / tests / build・lint・回帰検証 / composition | **Codex** |

Claude が先に presentational component と props contract を確定し、Codex がそこへ state と behavior を接続する。
**同じファイルを同時に変更しない。** Codex は Claude の visual layer を一般的なカードUIへ置き換えてはならない。
視覚仕様と実装制約が衝突する場合は、独自変更ではなく理由と影響を Claude へ返す。

`src/app/staff/layout.tsx` に menu UI / account UI / locale save state / gesture classifier /
viewport policy / focus management / visual styles を**すべて直接詰め込まない**。

---

## 12. Acceptance criteria

### 12.1 構造

- [ ] 左側ハンバーガーが存在しない
- [ ] header 右端に枠なし・背景なしの Chevron がある
- [ ] header コンテンツ行が **56px ちょうど**
- [ ] Chevron が開閉で同座標に留まる
- [ ] 320px + 受注 chip で header が折り返さない
- [ ] header に硬い 1px 境界線がない
- [ ] header と タブ帯 の間に二重線・二重 fade がない
- [ ] 自社管理が header から消え、menu primary zone にある（重複なし）
- [ ] MyPage に言語設定が存在しない
- [ ] locale 保存経路が1つだけ（`updateOwnStaffLocale`）

### 12.2 Gesture

- [ ] 10px 未満の移動では何も起きない
- [ ] 下方向優勢で menu open、横方向優勢で section switch
- [ ] 斜めでも二重 commit しない / lock 後に axis が変わらない
- [ ] 下スワイプ後に タブリンクの click が発火しない
- [ ] A-OK button / wrapper の下スワイプで menu が開き、commit 後に A-OK の click が発火しない
- [ ] A-OK の short tap と commit 閾値未満の移動では従来どおり A-OK が実行される
- [ ] 短いタップは従来どおり link として動く
- [ ] operations / maintenance / procurement すべてで下スワイプが効く
- [ ] DrumRoll / `data-swipe-ignore` / QuickSelect / select / input 起点では開閉しない
- [ ] 開状態の上スワイプで閉じる。ただしスクロール余地のある領域では閉じない

### 12.3 Viewport

- [ ] `locked` route では shell が下端を保護する
- [ ] `allowed` route では shell が下端を予約しない
- [ ] `allowed` route の最下部に恒久的な空白帯がない
- [ ] 固定子要素だけが表示中に safe-area を持つ
- [ ] 固定操作表示時に最終コンテンツが隠れない / 非表示時に余分な空白がない
- [ ] ID 入力画面の操作要素が画面外へ隠れない

### 12.4 面

- [ ] html / body / shell / themeColor / manifest が §6.1 の色を指す
- [ ] 装飾 gradient がブラウザーUI・overscroll 領域へ露出しない
- [ ] `backdrop-filter` が実際に効いている（computed style で `none` でないこと）

### 12.5 検証

- [ ] `git diff --check`
- [ ] `npx tsc --noEmit --pretty false`
- [ ] 変更ファイルの eslint（今回追加した error 0件）
- [ ] gesture / viewport policy の新規テスト
- [ ] `npm run test`（staff i18n baseline を含む）
- [ ] `npm run build`

---

## 13. 非対象

- admin / portal の chrome
- 業務ロジック、Firestore schema / Rules / indexes、billing、tank transition、identity
- `appleWebApp.statusBarStyle` の変更（実機確認後の別判断）
- 翻訳の全面整理（本 PR で未使用になったキーの削除のみ）
- `src/domains/` への移行（design-principles により禁止）
- タブ帯を sticky にすること（現行の static 挙動を維持する）
