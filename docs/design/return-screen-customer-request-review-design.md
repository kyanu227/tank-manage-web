# Return Screen Customer Request Review Design

作成日: 2026-05-12

対象 commit: `4aaf2adc022027c6cc03d90c81634c331beb4e3b`

対象 project: `okmarine-tankrental`

この document は、返却画面に顧客返却申請 / 顧客申請タグの確認導線を統合する UI/UX 設計を整理する。

今回の範囲:

- docs-only
- 実装変更なし
- `firestore.rules` 変更なし
- `firebase.json` 変更なし
- package files 変更なし
- Firestore data create/update/delete なし
- Security Rules deploy なし
- Hosting deploy なし
- `firebase deploy` なし
- Firestore Console / script direct edit なし
- tank update なし
- logs create/edit/void/delete なし
- billing / sales / reward 変更なし
- delete / void 操作なし

関連 document:

- [implementation-layer-architecture.md](./implementation-layer-architecture.md)
- [portal-unfilled-report-phase-2-minimum-spec.md](./portal-unfilled-report-phase-2-minimum-spec.md)
- [portal-unfilled-report-staff-handling-and-admin-visibility.md](./portal-unfilled-report-staff-handling-and-admin-visibility.md)

---

## 1. Policy Change

方針変更:

- 未充填報告を独立した staff handling workflow として扱う案は superseded とする。
- 新方針では、未充填報告を含む顧客申請タグを返却画面に統合する。
- 顧客側では、誤操作防止のため未充填報告を通常返却申請とは別導線に置いてよい。
- staff 側では、未充填 / 未使用 / 持ち越し / 未返却系の顧客申請を、返却画面の確認対象として扱う。
- staff は返却画面で顧客申請内容を確認し、必要ならタグを修正し、現在のタグ選択を確定値として承認する。

この document は、PR #79 で整理した「portal unfilled report の独立 staff handling workflow」を、返却画面統合型の顧客申請タグレビューに置き換える。

---

## 2. Purpose

目的:

- 返却画面で顧客申請タグを見落とさず確認できる UI を設計する。
- スマホ前提で、通常返却の速度と要確認申請の見落とし防止を両立する。
- 3エリアを常時縦並びにするのではなく、最初は件数だけを見せ、タップしたセグメントだけに集中できる構造にする。
- 既存 `BulkReturnByLocationPanel` の貸出先アコーディオン UI を活かし、大改修を避ける。
- carry-over / keep tag を正式に扱うための設計判断を残す。
- 顧客申請タグと staff 確定タグを分けて考え、承認前の staff 修正を明示できるようにする。
- 3カード式を fallback / 初回学習 UI として残しつつ、片手高速操作用の右側 vertical dots gesture launcher を prototype 候補として検討する。

---

## 3. Current Implementation Notes

現状:

- `BulkReturnByLocationPanel` は貸出先ごとのアコーディオン UI を持つ。
- `BulkReturnByLocationPanel` は貸出先ごとの一括返却ボタンを持つ。
- 展開時に各タンクへ `ReturnTagSelector` を表示している。
- `useBulkReturnByLocation` は `tanksRepository.getTanks({ statusIn: [LENT, UNRETURNED] })` から貸出中 / 未返却タンクを取得している。
- `useBulkReturnByLocation` は `logNote` の `[TAG:unused]` / `[TAG:uncharged]` からタグ状態を復元している。
- 一括返却時は `resolveReturnAction(tag, tank.status)` により返却アクションを決定している。
- `ReturnTagSelector` には `keep` / 持ち越しの表示定義がある。
- `ReturnTagProcessingScreen` は `keep` を表示し、`return-tag-processing-service` は `keep` を `ACTION.CARRY_OVER` に接続している。
- ただし `BulkTagType` は `normal / unused / uncharged` までで、`useBulkReturnByLocation` の一括返却フローに `keep` は正式接続されていない。

この設計では、既存の貸出先アコーディオン構造を活用し、前段に segment summary mode / focused segment mode を追加する。

---

## 4. UX Model

返却画面は 2 つの mode を持つ。

```text
segment summary mode
  -> focused segment mode
```

state:

```ts
type ActiveReturnSegment = null | "customer_requests" | "long_term" | "normal";
```

- `activeSegment === null` のときは、3つのセグメントカードだけを表示する。
- `activeSegment !== null` のときは、選択されたセグメント名を上部に表示し、その下に対象貸出先一覧だけを表示する。
- セグメント名部分、または戻るボタンをタップすると `activeSegment` を `null` に戻す。
- browser history は初期 Phase では増やさず、local state でよい。

local state 推奨理由:

- 返却作業は同一画面内の作業モード切り替えであり、URL で共有する必要が低い。
- スマホ作業ではブラウザ戻るより画面内戻る button の方が誤操作が少ない。
- existing staff operation UI に近い構造で始められる。

将来、セグメント別 URL や deep link が必要になった場合のみ、query param 化を検討する。

---

## 5. Segment Summary Mode

返却画面トップでは、3つのセグメントカードだけを表示する。

segments:

| segment | label | meaning |
|---|---|---|
| `customer_requests` | 顧客申請あり | 顧客がタグ付きで返却 / 報告 / 持ち越し系の申請をした貸出先 |
| `long_term` | 長期 / 持ち越し確認 | 長期貸出、未返却、持ち越し候補など、通常返却とは別に確認したい貸出先 |
| `normal` | 通常返却 | 顧客申請タグがなく、通常返却対象として扱える貸出先 |

カードに表示する件数:

- 顧客数
- タンク本数
- タグ付きタンク本数

表示例:

```text
顧客申請あり
4顧客 / 9本 / タグ付き6本

長期 / 持ち越し確認
2顧客 / 5本 / タグ付き2本

通常返却
11顧客 / 36本
```

件数の定義:

| count | definition |
|---|---|
| 顧客数 | セグメントに属する貸出先グループ数。現行 UI の `location` group に相当する |
| タンク本数 | セグメント内の返却候補 tank count |
| タグ付きタンク本数 | `customerRequestedTag` または staff working tag が `normal` 以外の tank count |

「顧客数」は現行実装では `location` group 数として扱う。将来 `customerId` が返却対象に安定して入る場合は、`customerId` ベースに寄せる。

---

## 6. Segment Ordering

比較対象:

- 件数順
- 要確認優先固定

### 6.1 Count Sort

内容:

- 顧客数またはタンク本数が多い順にカードを並べる。

利点:

- 今日の作業量が直感的に見える。
- 通常返却が多い日は通常返却をすぐ開ける。
- シンプルな sort で説明しやすい。

リスク:

- 顧客申請ありが少数の場合、通常返却の下に埋もれる。
- 要確認作業を先に拾う運用と相性が悪い。
- 件数が同程度のときに並びが変わり、スタッフの習慣化を妨げる。

### 6.2 Priority Fixed

内容:

```text
1. 顧客申請あり
2. 長期 / 持ち越し確認
3. 通常返却
```

利点:

- 顧客申請ありを見落としにくい。
- 返却画面で「まず確認が必要なもの」を上から処理できる。
- 毎回同じ場所に同じカードが出るため、スマホ操作で迷いにくい。
- 通常返却が大量にあっても、顧客申請ありが埋もれない。

リスク:

- 通常返却がほとんどの日でも、通常返却カードは下に出る。
- 作業量順の直感とは少しずれる。

### 6.3 Recommendation

推奨は要確認優先固定。

理由:

- 顧客申請ありが最も見落としたくない。
- 返却作業では、速度だけでなく誤処理防止が重要である。
- 件数はカード内で見えるため、並びを件数順にしなくても作業量は把握できる。
- スマホでは位置が固定されている方が操作を覚えやすい。

補足:

- `customer_requests` は常に上に固定する。
- `long_term` と `normal` だけを件数順に入れ替える案は将来検討可。
- 初期 Phase では固定順で始める。

---

## 7. Focused Segment Mode

スタッフがセグメントカードをタップすると、そのセグメントだけにフォーカスした一覧を表示する。

例:

```text
[戻る] 顧客申請あり
4顧客 / 9本 / タグ付き6本

貸出先A
貸出先B
貸出先C
```

表示ルール:

- 画面上部に selected segment header を表示する。
- header には label / 顧客数 / タンク本数 / タグ付きタンク本数を表示する。
- header または戻る button をタップすると segment summary mode に戻る。
- header 下には、その segment に該当する貸出先アコーディオン一覧だけを表示する。
- 既存 `BulkReturnByLocationPanel` の location accordion と bulk return button の構造を活用する。

### 7.1 Accordion Preview Chips

顧客申請あり segment では、アコーディオンが閉じた状態でもタグ付きタンクだけを preview chip として表示する。

例:

```text
F12 未充填
A03 未使用
B07 持ち越し
+3件
```

ルール:

- 通常タンクは閉じた状態では表示しない。
- タグ付きタンクだけを preview chip に出す。
- 3件程度まで表示し、それ以上は `+3件` のように省略する。
- 持ち越しタンクは必ず preview に含める。
- staff がタグを修正した場合は `スタッフ修正あり` を chip または sublabel で示す。

### 7.2 Bulk Button Behavior

顧客申請が未確認のまま残っている場合:

- その貸出先の一括返却 button は無効化する。
- または button label を `申請確認後に返却` にする。

初期推奨:

- 顧客申請あり segment では、未確認申請がある場合は `申請確認後に返却` と表示して disabled にする。
- 承認 / 対象外を完了した後に一括返却できる。

理由:

- 顧客申請タグを見落としたまま通常返却する事故を防げる。
- disabled label が理由を説明するため、スマホでも迷いにくい。

---

## 8. Customer Request Tags

顧客申請タグの扱い:

- 顧客側では、未充填報告を通常返却申請とは別導線に置いてよい。
- staff 側では、未充填報告も顧客の返却申請タグの一種として扱う。
- 顧客が未充填 / 未使用 / 持ち越し / 未返却などを申請した場合、返却画面の該当貸出先グループに反映する。
- 顧客がタグ付けしたタンクが1本でもある貸出先は `customer_requests` segment に入れる。
- 顧客は基本的に一括送信するため、タグ付きタンクは顧客申請内容として扱う。
- タグなしタンクは通常返却として取得する。
- staff が確認した後に一括返却できるようにする。

segment precedence:

```text
customer_requests > long_term > normal
```

同じ貸出先に顧客申請タグ付きタンクが1本でもある場合、その貸出先グループは `customer_requests` に入れる。長期 / 持ち越し候補も含む場合は、顧客申請確認を優先する。

---

## 9. Staff Review Operations

staff 操作は初期 Phase では 2 つに絞る。

| operation | meaning |
|---|---|
| 承認 | 現在画面上で選ばれている返却タグを staff 確定値として採用する |
| 対象外 | 顧客申請タグを返却処理に反映しない |

採用しない操作:

- `in_progress`
- `duplicate`
- admin review
- report delete
- report void

方針:

- 重複は作成 service / Rules 側で発生しないように寄せる。
- 万一重複が起きた場合は、対象外 + note で扱う。
- 承認は「顧客申請をそのまま承認」ではない。
- 承認は「現在のタグ選択を確定する」という意味である。

### 9.1 Staff Tag Modification Before Approval

顧客申請タグと staff 確定タグを分ける。

例:

```text
顧客申請: 未充填
staff 修正: 未使用
承認後: 未使用返却として処理
```

UI 表示:

- 顧客申請タグを表示する。
- staff が変更した現在タグを表示する。
- 顧客申請タグと現在タグが違う場合は `スタッフ修正あり` を表示する。

処理:

- staff がタグを変更した場合、変更後のタグを一括返却時に使う。
- 承認時に `staffConfirmedTag` を保存する。
- 一括返却時は `staffConfirmedTag` を優先する。
- `staffConfirmedTag` がない場合は、承認済みの `customerRequestedTag` を使う。

---

## 10. Carry-Over / Keep Tag

carry-over / keep tag は必須である。

現状:

- `ReturnTagSelector` は `keep` 表示を持つ。
- `ReturnTagProcessingScreen` は `keep` option を持つ。
- `return-tag-processing-service` は `keep` を `ACTION.CARRY_OVER` に接続している。
- `BulkTagType` は `normal / unused / uncharged` までで、`keep` は一括返却フローに正式接続されていない。
- `RETURN_TAG` は `normal / unused / uncharged` までで、`CARRY_OVER` tag はない。
- `ACTION.CARRY_OVER` は存在する。

### 10.1 Naming Options

候補:

| option | description |
|---|---|
| `keep` | UI / portal return condition と一致する |
| `RETURN_TAG.CARRY_OVER` | tank rules の tag 定数として明示できる |

推奨:

- UI / portal return condition では `keep` を維持する。
- tank operation へ接続する時点では `ACTION.CARRY_OVER` に変換する。
- `RETURN_TAG` へ含めるかは実装 PR で判断する。

理由:

- 既存 `ReturnTagSelector` / portal return condition は `keep` を使っている。
- `keep` は「返却しない」意味が UI 上わかりやすい。
- tank lifecycle では既に `ACTION.CARRY_OVER` が正本 action として存在する。

### 10.2 Processing Options

#### Option 1: Include keep in the same processing button

内容:

- 同じ確定操作で、`normal / unused / uncharged` は返却系 action にする。
- `keep` は `ACTION.CARRY_OVER` にする。
- button label は `選択内容を確定して処理` のようにし、単純な `一括返却` とは言わない。

利点:

- スマホでの操作回数が少ない。
- 顧客申請一括送信と staff 確認作業の単位が一致する。
- 既存 `return-tag-processing-service` の考え方と近い。

リスク:

- `一括返却` という既存 button label のままだと、持ち越しも返却されたように見える。
- carry-over が混ざる場合、確認文言を丁寧にしないと誤操作になる。

#### Option 2: Exclude keep from bulk return

内容:

- `keep` のタンクは一括返却対象から外す。
- 持ち越しは別 button / 別処理で扱う。

利点:

- `返却` と `持ち越し` の意味が混ざりにくい。
- 誤って倉庫返却扱いにするリスクが低い。

リスク:

- スマホでの操作回数が増える。
- staff が持ち越し処理を忘れる可能性がある。
- 同じ顧客申請内の完了条件が分かりにくい。

### 10.3 Recommendation

初期推奨は Option 1。

ただし、button label と confirm copy を変更する。

推奨 copy:

```text
選択内容を確定して処理
```

confirm 例:

```text
{customerName} の {count} 本を処理します。
返却: 7本 / 未使用返却: 1本 / 未充填返却: 1本 / 持ち越し: 2本
```

方針:

- `keep` は返却対象から消すのではなく、`ACTION.CARRY_OVER` 相当の操作に接続する。
- 持ち越しタンクは segment card または貸出先アコーディオンの閉じた状態でも必ず分かるようにする。
- 実装が大きくなる場合は、最初だけ Option 2 に倒してもよいが、UI には未処理 carry-over が残っていることを明示する。

---

## 11. Data Model Direction

顧客申請タグと staff 確定タグを分ける案を採用する。

候補 fields:

```text
customerRequestedTag
staffConfirmedTag
tagReviewStatus
tagReviewedAt
tagReviewedByStaffId
tagReviewedByStaffName
tagReviewNote
```

候補 status:

```text
pending
approved
excluded
```

意味:

| field | meaning |
|---|---|
| `customerRequestedTag` | 顧客が申請したタグ |
| `staffConfirmedTag` | staff が承認時に確定したタグ |
| `tagReviewStatus` | 顧客申請タグの確認状態 |
| `tagReviewedAt` | staff が承認 / 対象外にした時刻 |
| `tagReviewedByStaffId` | review staff id |
| `tagReviewedByStaffName` | review staff display name |
| `tagReviewNote` | 対象外理由や staff 修正理由 |

### 11.1 Existing `logNote` Relationship

既存:

- `logNote == "[TAG:unused]"` で未使用タグを復元している。
- `logNote == "[TAG:uncharged]"` で未充填タグを復元している。
- `logNote` は tank 側の現在 tag 的に使われている。

推奨:

- 顧客申請の source of truth は `logNote` にしない。
- 顧客申請用 metadata は transaction / request metadata として持つ。
- `logNote` は既存互換と staff working tag の表示補助として扱う。
- staff が承認した時点で、既存返却タグ処理へ反映する。

理由:

- `logNote` は文字列 convention であり、顧客申請、staff 修正、処理確定、履歴を区別しにくい。
- 顧客申請タグと staff 確定タグを分けるには structured field が必要。
- 将来の Security Rules / audit / stats では structured metadata の方が扱いやすい。

### 11.2 Reflection Timing

顧客申請を既存返却タグ処理へ反映するタイミング:

1. customer request 作成時:
   - `customerRequestedTag` を保存する。
   - `tagReviewStatus: "pending"` とする。
   - tank / logs / billing / reward には反映しない。
2. staff が画面でタグ確認 / 修正:
   - UI state として current selected tag を持つ。
   - 必要なら working tag を local state に保持する。
3. staff が承認:
   - `staffConfirmedTag` に current selected tag を保存する。
   - `tagReviewStatus: "approved"` にする。
4. staff が一括処理:
   - `staffConfirmedTag` を優先して返却 / 未使用返却 / 未充填返却 / 持ち越しに接続する。
   - tank / logs update は既存 operation boundary を使う。

対象外:

- `tagReviewStatus: "excluded"` にする。
- `staffConfirmedTag` は保存しない、または `normal` と混同しない。
- 一括返却時には顧客申請タグを反映しない。
- note に理由を残せるようにする。

---

## 12. Option E: Right Side Vertical Dots Gesture Launcher

E案は、返却画面の右側に小さな縦三点 launcher を置き、片手で active segment を切り替える高速操作案である。

この app の基本思想は「タップを少なく、片手で簡単に操作できること」である。3セグメントカード一覧は分かりやすいが、毎回カード一覧へ戻ってタップする操作が必要になる。E案はその操作を減らすための enhancement として扱う。

### 12.1 Launcher Display

表示位置:

- 返却画面の右側に小さな縦三点を表示する。
- 親指が届きやすい位置に置く。
- 既存の3セグメントカード一覧や貸出先アコーディオンとは干渉しない位置に置く。
- 点は常時表示してよいが、小さく控えめにする。

3つの点:

| dot | segment | badge example |
|---|---|---|
| 1 | 顧客申請あり | `申請 4` |
| 2 | 長期 / 持ち越し確認 | `長期 2` |
| 3 | 通常返却 | `通常 11` |

縦三点の役割:

- 状態表示
- 件数の小さな glance
- launcher 起点

縦三点そのものを軽く tap して即 segment を切り替える仕様は採用しない。

### 12.2 Trigger Policy

採用する trigger:

- long press
- long press 成立後の slide selection

採用しない trigger:

- 軽い tap による segment switch
- pressure / 強押し検知

理由:

- 軽い tap は、スクロール操作、貸出先アコーディオン展開、返却 button、タグ変更と混戦する可能性がある。
- pressure / 強押しは Web / mobile browser では端末依存が大きい。
- pressure / 強押し検知は prototype でも採用しない。

prototype 初期値:

| setting | initial candidate |
|---|---|
| long press duration | 300ms |
| acceptable range | 250-350ms |
| pre-long-press movement tolerance | 8-12px |

初期推奨:

- long press は 300ms 程度から試す。
- 実機確認で 250-350ms の範囲で調整する。
- pointerdown 後、long press 成立前に縦方向へ 8-12px 程度以上動いた場合は scroll とみなして cancel する。
- pointerdown 後、long press 成立前に横方向へ大きく動いた場合も launcher を展開しない。
- scroll を吸わないことを最優先にする。

### 12.3 Scroll Safety

scroll 操作を吸わないための方針:

- long press 成立前は `preventDefault` しない。
- long press 成立前は pointer capture しない。
- long press 成立前に縦方向 movement threshold を超えたら cancel する。
- long press 成立後、または launcher 展開後に限って pointer capture / `preventDefault` を検討する。
- page scroll と判断した場合は launcher を展開しない。
- launcher target area は小さくしすぎず、ただし画面上の他操作と重ならない位置に置く。

既存 `useOperationSwipe` は横 swipe 判定に 10px 程度の slop と dx/dy 比較を使っている。E案ではこの考え方を参考にできるが、返却画面全体の global swipe ではなく、右側 launcher 起点の local pointer interaction として prototype する。

### 12.4 Expanded Half-Radial Menu

long press 成立後、小さな半円状 menu を右側から展開する。

表示項目:

- 顧客申請あり
- 長期 / 持ち越し確認
- 通常返却
- 手動返却

操作:

- long press 成立で menu を展開する。
- 指を slide して対象項目上で離すと選択確定する。
- 選択確定後、`activeSegment` を切り替える。
- 選択せずに指を離した場合は cancel する。
- menu は大きすぎないようにする。
- 画面右側から親指で操作する前提にする。

menu は mode switcher であり、返却処理やタグ確定処理には接続しない。

### 12.5 Manual Return Safety

手動返却は他の3セグメントより誤操作リスクが高い。

方針:

- 半円 menu 内には置くが、他の3セグメントより選びにくくする。
- 通常の3セグメント移動は滑らかにする。
- 手動返却だけは意図的に入りにくくする。

具体案:

- 他の3項目より上側・遠い位置に置く。
- 他の3項目より長い drag distance を要求する。
- 一定時間 hover / hold しないと選択確定しない。
- 色やラベルで明確に区別する。
- `手動` と明示する。
- 必要なら confirm を追加する。

prototype では、手動返却を disabled 表示または confirm 必須にしてもよい。誤操作防止を優先する。

### 12.6 Relationship with 3-Card UI

3セグメントカード一覧は fallback / 初回学習 UI として残す。

右側 gesture launcher は高速操作用 enhancement として扱う。

併用方針:

- 3カード式は分かりやすい入口として残す。
- E案は慣れた staff が片手で segment を切り替えるための shortcut とする。
- 小さな縦三点表示であれば、リスト表示や3カード式と干渉しにくい。
- UI が過密になる場合は、setting / feature flag / prototype flag で gesture launcher を試験的に出す。

### 12.7 Prototype Policy

PR #80 では実装しない。

次の実装 PR で試す場合は UI-only prototype とする。

prototype scope:

- active segment の切替だけを行う。
- Firestore write はしない。
- `firestore.rules` は変更しない。
- tank operation は変更しない。
- return operation は変更しない。
- 返却処理やタグ確定処理には接続しない。
- 片手操作と scroll 干渉を実機確認する。

prototype の success criteria:

- 右手片手で `customer_requests` / `long_term` / `normal` を切り替えられる。
- 縦 scroll が launcher に吸われない。
- 貸出先 accordion 展開や tag selector 操作と干渉しない。
- 手動返却が誤って選ばれにくい。

---

## 13. Alternative Comparison

| option | summary | smartphone scroll | normal return speed | request visibility | error prevention | implementation size | BulkReturn compatibility | back clarity | count awareness |
|---|---|---|---|---|---|---|---|---|---|
| A | 3セグメントカード一覧 -> focused segment | low | high | high | high | medium | high | high | high |
| B | 単一リスト + priority sort + preview chips | medium | high | medium | medium | low-medium | high | n/a | medium |
| C | 条件セクションアコーディオン + 貸出先アコーディオン | high | medium | high | medium | medium-high | medium | medium | high |
| D | 上部 filter chips + 単一リスト | medium | high | medium | medium | medium | high | medium | medium |
| E | 右側 vertical dots gesture launcher | low | very high | medium-high | medium | medium | high | medium | high |
| A + E | 3カード fallback + gesture enhancement | low | very high | high | high | medium-high | high | high | high |

追加比較軸:

- tap 数: A は分かりやすいが戻る + 再選択の tap が増える。E は慣れると tap を減らせる。
- 片手操作性: E / A+E が最も高い。
- scroll 操作との衝突: E は long press threshold / movement tolerance / pointer capture timing の調整が必須。
- 初見での分かりやすさ: A が最も強い。E 単独は弱いため fallback が必要。
- 誤操作リスク: A は低い。E は手動返却を遠くする、長い drag distance を要求する、confirm を置くなどの対策が必要。
- 実装規模: A は既存 accordion に segment filter を足す規模。E は gesture prototype が必要。
- 既存 `BulkReturnByLocationPanel` との相性: A / E / A+E とも高い。E は `activeSegment` 切替入口だけを追加できる。
- 既存 `useOperationSwipe` のような gesture 実装資産との相性: E は threshold / dx-dy 判定の考え方を参考にできる。ただし global swipe ではなく launcher 起点の local pointer interaction として扱う。
- prototype しやすさ: E は UI-only prototype で active segment 切替だけを試せる。
- fallback の必要性: E 単独では必要。A+E なら3カード式が fallback になる。

### 13.1 A: Segment Drill-Down

内容:

- 最初に3つの segment card を表示する。
- タップした segment だけにフォーカスする。
- focused mode では既存貸出先アコーディオンを使う。

評価:

- スマホのスクロール量が少ない。
- 顧客申請ありを通常返却に埋もれさせない。
- 件数把握と作業集中を両立できる。
- `activeSegment` state 追加で設計でき、既存構造と相性が良い。

リスク:

- segment summary に戻る操作を明確にしないと迷う。
- 1画面で全部見たい staff には一手増える。

### 13.2 B: Single List + Priority Sort

内容:

- 貸出先一覧を1本の list にし、顧客申請ありを上に sort する。
- 閉じた状態で preview chips を出す。

評価:

- 実装規模は比較的小さい。
- 既存 accordion をそのまま使いやすい。
- ただし通常返却が多いと、顧客申請確認後に長い list をスクロールし続ける。

### 13.3 C: Segment Accordion + Location Accordion

内容:

- 顧客申請あり / 長期 / 通常返却の section accordion を置く。
- 各 section 内に貸出先 accordion を置く。

評価:

- 画面上で3 segment を同時に見られる。
- ただし accordion が2段になり、スマホでは操作対象が多い。
- section と location の開閉状態が混ざりやすい。

### 13.4 D: Filter Chips + Single List

内容:

- 上部に filter chips を置き、単一 list を切り替える。

評価:

- Web app として一般的。
- ただし件数カードほど作業量が目に入らない。
- filter active state が小さいとスマホで見落としやすい。

### 13.5 E: Right Side Vertical Dots Gesture Launcher

内容:

- 画面右側に小さな縦三点 launcher を置く。
- long press で半円 menu を展開する。
- slide release で segment を選択する。
- 軽 tap switch は採用しない。

評価:

- タップ数を減らせる。
- 片手操作性が高い。
- 3カード一覧に戻らず segment を切り替えられる。
- ただし scroll と干渉しない gesture tuning が必要。
- 初見では分かりにくいため、fallback UI が必要。

### 13.6 A + E: Fallback plus Gesture Enhancement

内容:

- 3セグメントカードで件数が見える。
- 3カード式は fallback / 初回学習 UI として残す。
- 右側 vertical dots gesture launcher を高速操作 enhancement として併用する。

評価:

- 初見でも分かる。
- 慣れた staff は gesture で高速に切り替えられる。
- UI が少し増えるため、密度調整が必要。
- prototype flag で段階導入しやすい。

### 13.7 Recommendation

推奨は A + E 併用案。

理由:

- 3カード式は分かりやすい fallback になる。
- 右側 vertical dots gesture launcher は片手高速操作に向く。
- A案だけより tap 数を減らせる。
- E案だけより初見の分かりやすさと fallback が強い。
- 既存 `BulkReturnByLocationPanel` の貸出先アコーディオンを活用しつつ、`activeSegment` 切替の入口を2つ持てる。
- prototype では E案だけを UI-only で軽く実装し、使い勝手と scroll 干渉を確認する余地がある。

---

## 14. Implementation Boundary

今回の PR では実装しない。

初期実装に進む場合の候補:

- `BulkReturnByLocationPanel` の前段に segment summary mode を追加する。
- `useBulkReturnByLocation` に `activeSegment` と segment stats/read model を追加する。
- `BulkTagType` / return tag model に `keep` を正式接続する。
- 顧客申請 metadata を query/read model に取り込む。
- staff 承認 / 対象外 service を設計する。
- Rules 変更が必要なら別 PR に分ける。
- 右側 vertical dots gesture launcher は UI-only prototype として試す候補にする。
- prototype では active segment の切替だけを行い、返却処理やタグ確定処理には接続しない。
- prototype では Firestore write / Rules / tank operation / return operation は変更しない。

PR #78 の implementation layer architecture に従い、固定テンプレート化せず、リスクと複雑さに応じて最小構造を選ぶ。

---

## 15. Non-Goals

今回やらないこと:

- implementation code 変更
- `firestore.rules` 変更
- `firebase.json` 変更
- package files 変更
- Firestore data create/update/delete
- Security Rules deploy
- Hosting deploy
- `firebase deploy`
- Firestore Console / script direct edit
- tank update
- logs create/edit/void/delete
- billing / sales / reward 変更
- delete / void 操作
- `BulkReturnByLocationPanel` 実装変更
- `BulkTagType` 実装変更
- `RETURN_TAG` / `ACTION` 実装変更
- customer request metadata 実装
- right side gesture launcher 実装
- active segment prototype 実装

tsc / build を実行しない理由:

- 今回の差分は docs-only であり、TypeScript / Next.js の実装 artifact を変更しない。
- package files、source files、Firebase config、Rules を変更しない。
- 検証は Markdown 差分の whitespace / conflict marker 確認に限定する。

docs-only 検証として実行するもの:

```bash
git diff --check
git diff --cached --check
```
