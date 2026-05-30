# I18n UI Display Policy

## 1. Purpose

この文書は、多言語 UI 表示の設計方針を固定する。

このプロジェクトの多言語対応は、単なる日本語文言の英訳ではない。目的は、業務ロジックから表示文言依存を外し、Firestore 保存値、内部 code、UI label の責務を分けること。

最低限、英語で以下の基本操作ができる状態を目指す。

- 貸出
- 返却
- 充填
- 自社使用

ただし、最初から Firestore 保存値や状態遷移を英語 code 化しない。まず UI label と `TankActionCode` / `TankStatusCode` / legacy 日本語保存値を分離する。

## 2. Current State

現状では、以下の値が日本語保存値を実質的な正本として使っている。

- `tanks.status`
- `logs.action`
- `logs.transitionAction`
- `logs.prevStatus`
- `logs.newStatus`

`tanks.status` は Firestore query にも使われている。`logs.action` は trace、請求、売上、スタッフ実績などの集計・検索にも使われている。

一方で、以下はすでに英語 code 化されている。

- `transactions.type`
- `transactions.status`
- `ReturnTag` (`normal` / `unused` / `uncharged` / `keep`)
- `OperationSource`
- `OperationWorkflow`

現在の補助 helper は以下の責務を持つ。

- `src/lib/tank-action-status-codes.ts`
  - legacy 日本語 ACTION / STATUS と将来の `TankActionCode` / `TankStatusCode` の mapping を持つ
  - action / status の分類 helper を持つ
- `src/lib/tank-action-status-display.ts`
  - action badge tone の表示専用 helper を持つ
  - Firestore 保存値、query、集計、label 翻訳は扱わない

## 3. Core Principle

- Firestore 保存値と UI label を混同しない。
- 業務ロジックで表示文言を正本にしない。
- UI 表示は label dictionary を通す。
- 内部判定は `TankActionCode` / `TankStatusCode` を使う方向へ寄せる。
- legacy 日本語保存値は mapping helper で code へ変換して扱う。
- 多言語 UI は Firestore 保存 schema 変更とは別 Phase で進める。
- 英語表示を追加しても、既存の日本語保存値や query を壊さない。
- `tanks.location` / `customerName` 依存は多言語 UI とは別問題として扱う。

実運用前のため、不要な legacy backfill は前提にしない。ただし、既存コード依存を無視した一括変更は避ける。

## 4. Label Dictionary Design

将来的には、`TankActionCode` / `TankStatusCode` を key にした label dictionary を置く。

設計案:

```ts
type Locale = "ja" | "en";

type TankActionLabelDictionary = Record<TankActionCode, Record<Locale, string>>;
type TankStatusLabelDictionary = Record<TankStatusCode, Record<Locale, string>>;
```

label 例:

```ts
const actionLabels = {
  lend: {
    ja: "貸出",
    en: "Lend",
  },
  return: {
    ja: "返却",
    en: "Return",
  },
  fill: {
    ja: "充填",
    en: "Fill",
  },
  inhouse_use: {
    ja: "自社使用",
    en: "In-house use",
  },
};
```

この dictionary は UI 表示専用とする。Firestore 保存値、Firestore query、集計条件、状態遷移条件には使わない。

今回の Phase 12 では label dictionary を実装しない。UI に英語も表示しない。

## 5. Minimum English Operation Scope

最初に英語対応したい範囲は、基本操作と表示専用 label に限定する。

最低対応対象:

- staff manual operation の基本操作
  - `lend`
  - `return`
  - `fill`
  - `inhouse_use`
- portal 履歴の action label 表示
- staff dashboard の action label 表示
- 操作ボタンや確認メッセージの基本文言

初期英語対応から外す候補:

- billing
- sales
- staff analytics
- tank trace
- admin state diagram
- dashboard revision / void
- procurement
- supply-order
- report / export
- Firestore query
- Firestore 保存値

これらは保存値、query、集計、業務監査に近いため、label helper の導入だけで触らない。

## 6. Recommended Implementation Order

### Phase 12: Docs Only

- i18n UI display policy を作る
- label dictionary の設計案を固定する
- 最初の英語対応対象画面を決める

今回のタスクはここまで。

### Phase 13: Label Dictionary Helper Only

- `TankActionCode` / `TankStatusCode` の label dictionary を追加する
- `ja` / `en` の label を返す pure helper を作る
- まだ UI には適用しない
- Firestore 保存値は変えない

### Phase 14: Locale Selection Design

- locale をどこで持つか決める
- browser setting / localStorage / account setting / React context の候補を比較する
- 最初は `ja` default にする
- この Phase では実装しない

### Phase 15: Label Helper Application With Default Ja

- 1つの低リスク画面で label helper を使う
- locale はまだ固定 default `ja`
- 表示結果は変えない
- Firestore 保存値、query、集計には触らない

### Phase 16: Local Locale State Helper

- localStorage ベースの locale helper を追加する
- `DEFAULT_LOCALE` は `ja`
- SSR / browser 外で落ちないようにする
- まだ全画面には広げない

### Phase 17: Locale Selector UI

- 低リスク画面に `ja` / `en` 切り替え UI を追加する
- まず staff または portal の一部だけで試す
- 英語表示対象は action / status label に限定する

### Phase 18: Minimum English Operation UI

- 貸出 / 返却 / 充填 / 自社使用 の操作ボタンや選択肢を locale 対応する
- 業務ロジックは `TankActionCode` / legacy mapping helper を通す
- Firestore 保存値はまだ変更しない

### Later Phase: Account-Level Locale

- staff / customer user settings に locale を保存するか検討する
- Firestore schema / rules / settings UI が必要なため後回しにする

### Later Phase: Firestore 保存値 code 化検討

以下を本当に英語 code へ切り替えるかは、別途判断する。

- `tanks.status`
- `logs.action`
- `logs.transitionAction`
- `logs.prevStatus`
- `logs.newStatus`

今すぐ行わない。

## 7. Locale Selection Policy

locale selection は、UI label を `ja` / `en` のどちらで表示するかを決めるための UI 状態である。Firestore 保存値、Firestore query、状態遷移、集計、請求、売上、スタッフ実績とは分離する。

Phase 13 時点の型と default は以下を前提にする。

```ts
type Locale = "ja" | "en";
const DEFAULT_LOCALE = "ja";
```

default は `ja` とする。現在の既存 UI、業務運用、Firestore legacy 保存値は日本語中心であり、いきなり英語 default にすると既存確認作業が難しくなるため。英語対応は段階導入し、最初は表示結果を変えない。

### Storage Options

#### A案: Browser Setting

`navigator.language` などを見て初期 locale を決める。

メリット:

- 追加保存が不要
- 顧客向け portal では自然に見える

リスク:

- スタッフ業務画面で意図せず英語になる可能性がある
- テストや運用確認が不安定になる
- 日本語 default 方針と衝突しやすい

#### B案: localStorage

最初は localStorage に locale を保存する。

メリット:

- Firestore schema 変更が不要
- 実装が小さい
- staff / portal / admin を横断しやすい
- 実運用前の段階的導入に向く

リスク:

- 端末ごとの設定になる
- ユーザーアカウント単位の設定ではない
- SSR / browser 外で localStorage に触らない注意が必要

#### C案: Staff / Customer User Setting

staff や customer user の document に locale を保存する。

メリット:

- アカウントごとに安定する
- 複数端末で共有できる

リスク:

- Firestore schema 変更が必要
- rules / settings UI / default 処理が必要
- 今の段階では早い

#### D案: React Context Only

アプリ起動中だけ React context で locale を持つ。

メリット:

- 実装が小さい
- Firestore が不要

リスク:

- reload で戻る
- localStorage なしでは実用性が低い
- App Router / client 境界の設計が必要

### Recommended Initial Approach

将来の最小実装候補は B案の localStorage とする。ただし Phase 14 では実装しない。

- 初期 default は `ja`
- 最初は locale selector UI を作らない
- label helper 適用時も locale 未指定で `ja` を使い、表示結果を変えない
- locale 切り替え UI は、低リスク画面で label 適用が成功してから入れる
- Firestore に locale field を追加するのは後回しにする

### Scope By Area

staff では、staff dashboard の action label 表示と、manual operation の基本操作 (`lend` / `return` / `fill` / `inhouse_use`) を最初の候補にする。ただし実装は Phase 15 以降。

portal では、portal history の action label 表示と、portal return / order / unfilled の基本案内文を候補にする。ただし portal の tanks query は触らない。

admin は初期英語対応から外す。billing、sales、staff analytics、state diagram、revision / void、settings は集計・管理・状態遷移に近く、影響範囲が大きい。

## 8. Do Not Touch Yet

- Firestore 保存値
- Firestore query
- `OP_RULES`
- `tank-operation.ts`
- `tanksRepository.getTanks({ status })`
- portal の `STATUS.LENT` / `location` query
- billing / sales / staff analytics
- staff mypage 集計
- `tank-trace.ts`
- `tanks.location`
- `tanks.customerId`
- return flow
- procurement
- supply-order
- payout / collaborators

## 9. Risks

- UI label と Firestore 保存値を混ぜると、query や集計が壊れる。
- `ACTION.LEND` などの日本語保存値を直接英語表示に置換すると、ログ、請求、売上、スタッフ実績が壊れる。
- status は query / filter / write に近いため、action より慎重に扱う必要がある。
- portal の `STATUS.LENT + location == customerName` は多言語対応とは別問題。
- 早すぎる i18n ライブラリ導入は、現状の構造整理を複雑にする可能性がある。
- browser setting を自動採用すると、業務画面が意図せず英語になる可能性がある。
- locale を Firestore に保存すると、schema / rules / settings UI が増える。
- locale selector UI を早く入れすぎると、未対応画面との表示差が目立つ。
- 多言語 UI 対応と Firestore 保存値 code 化を同時にやると影響範囲が大きすぎる。

## 10. Decision

- Phase 12 は docs-only とする。
- Phase 13 は label dictionary helper only とする。
- Phase 14 は locale selection design docs のみとする。
- 初期 default locale は `ja` とする。
- 最初の実装では label helper を default `ja` で適用し、表示結果を変えない。
- locale 保存は localStorage を将来の最小候補とする。ただし実装は後続 Phase に回す。
- account-level locale は後回しにする。
- Firestore 保存値 code 化はまだしない。
- 多言語 UI の最初の対象は、基本操作と表示専用 label に限定する。
- status query / filter / write 周辺は後回しにする。
