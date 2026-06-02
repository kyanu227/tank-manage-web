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

このプロジェクトはまだ実運用前で、既存データはない前提で進める。そのため、既存 Firestore データとの長期互換や legacy backfill は不要。

ただし、旧データ互換を優先しないことと、既存コード依存を無視して一括変更してよいことは別である。保存値を切り替える場合は、Firestore query、集計、表示、状態遷移、履歴編集を同時に確認しながら段階的に進める。

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
- staff ごとの locale 設定を正本にする方針を固定する
- 最初は `ja` default にする
- この Phase では実装しない

### Phase 15: Label Helper Application With Default Ja

- 1つの低リスク画面で label helper を使う
- locale はまだ固定 default `ja`
- 表示結果は変えない
- Firestore 保存値、query、集計には触らない

### Phase 16A: Staff Locale Setting Policy Docs

- staff ごとの locale 設定を正本にする方針へ docs を修正する
- localStorage を正本にしない
- 今回のタスクは docs-only とする

### Phase 16B: Read-Only Staff Settings / Auth Inspection

- staff profile の型を確認する
- `staffSession` の保存内容を確認する
- `StaffAuthGuard` / `AdminAuthGuard` を確認する
- staff settings 画面の有無を確認する
- staff document 更新経路を確認する
- `firestore.rules` の現在の制約を確認する
- `staffByEmail` / `staffByUid` mirror の扱いを確認する
- locale をどこに保存すべきか、settings UI をどこに置くべきかを決める
- この Phase ではコード変更しない

### Phase 17: Staff Locale Field and Helper

- 既存の `Locale` 型を使う
- staff profile に `locale?: Locale` を持てるようにする
- `staffSession` に locale を含める
- `getStaffLocale` / `useStaffLocale` などの helper を追加する
- default は `ja`
- UI 表示にはまだ広げすぎない

### Phase 18: Staff Settings UI

- staff が自身の locale を `ja` / `en` で変更できる UI を追加する
- 保存先は staff profile とする
- 成功時に `staffSession` も更新する
- まだ全画面の英語化はしない

### Phase 19: First Staff-Locale-Aware Label Application

- staff dashboard または portal history の action label に staff locale を適用する
- 未設定 staff は default `ja` のまま従来どおり日本語表示にする
- `en` を選んだ staff だけ英語表示になる
- Firestore 保存値は変更しない

### Phase 20: Minimum English Operation UI

- 貸出 / 返却 / 充填 / 自社使用 の操作ボタンや選択肢を locale 対応する
- ボタン、選択肢、確認文言を `ja` / `en` 対応する
- 業務ロジックは `TankActionCode` / legacy mapping helper を通す
- Firestore 保存値はまだ変更しない

### Phase 21: Firestore Action / Status Code Pivot

既存データはないため、この Phase で保存値を最終 code へ切り替えることを検討する。

候補:

- `tanks.status`: `TankStatusCode`
- `logs.action`: `TankActionCode`
- `logs.transitionAction`: `TankActionCode`
- `logs.prevStatus`: `TankStatusCode`
- `logs.newStatus`: `TankStatusCode`

ただし、以下を同時に確認する。

- `OP_RULES`
- `tank-operation.ts`
- `tanksRepository` query
- `tank-trace` query
- billing
- sales
- staff analytics
- staff mypage
- dashboard revision / void
- portal query

### Later Phase: CustomerId / Location Cleanup

- `tanks.customerId` を導入する
- `tanks.location` の意味を整理する
- portal の customerName query を廃止する
- customerId ベースの履歴、請求、貸出検索へ移行する

### Later Phase: Collaborators / Payout

- staff / customer / action / status が安定してから実装する

## 7. Locale Selection Policy

locale selection は、UI label を `ja` / `en` のどちらで表示するかを決めるための UI 状態である。Firestore 保存値、Firestore query、状態遷移、集計、請求、売上、スタッフ実績とは分離する。

Phase 13 時点の型と default は以下を前提にする。

```ts
type Locale = "ja" | "en";
const DEFAULT_LOCALE = "ja";
```

default は `ja` とする。原則の表示言語は日本語であり、特定スタッフが自身の設定で `ja` / `en` を変更できるようにする。

### Revised Premise

- 既存データはない。
- legacy backfill は不要。
- 旧データ互換を優先しない。
- ただしアプリを壊さないため、コード変更は段階的に行う。
- Firestore 保存値を切り替える場合は、query / 集計 / 表示 / 状態遷移を同時に確認する。

### Locale Source Of Truth

locale の正本は staff profile とする。

設計案:

```ts
type Locale = "ja" | "en";

type StaffProfile = {
  id: string;
  name: string;
  email?: string;
  role?: string;
  rank?: string;
  locale?: Locale;
};
```

方針:

- default locale は `ja`
- `staff.locale` がない場合は `ja`
- staff ごとに設定可能にする
- localStorage は正本ではない
- localStorage を使う場合は、読み込み体験改善用の補助キャッシュに限定する
- customer / portal locale は後続 Phase で検討する

### Staff Setting Requirement

- staff settings 画面で自身の locale を変更できるようにする
- 変更対象は自分自身の staff profile とする
- 通常 staff が他スタッフの locale を変更できないようにする
- admin が他スタッフの locale を管理できるかは後続判断とする
- 保存値は `"ja" | "en"` のみとする
- 不明値や未設定は `ja` に fallback する

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

localStorage に locale を保存する。

メリット:

- Firestore schema 変更が不要
- 実装が小さい
- 補助キャッシュとして使う場合は読み込み体験を改善できる

リスク:

- 端末ごとの設定になる
- ユーザーアカウント単位の設定ではない
- staff ごとの設定にならないため正本にはできない
- SSR / browser 外で localStorage に触らない注意が必要

#### C案: Staff Profile Setting

staff document に locale を保存する。

メリット:

- staff ごとの設定として安定する
- 複数端末で共有できる
- 権限と settings UI の設計に乗せられる

リスク:

- Firestore schema 変更が必要
- auth / session / settings / rules の整合が必要
- 実装前に read-only 調査が必要

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

正本は C案の staff profile setting とする。ただし、Phase 16A では実装しない。次に Phase 16B で staff profile、staffSession、auth guard、settings UI、rules を read-only で確認する。

- 初期 default は `ja`
- `staff.locale` がない場合は `ja`
- locale selector UI は staff settings の設計後に追加する
- label helper 適用時は Firestore 保存値や query と分ける
- localStorage は正本ではなく、使うとしても補助キャッシュに限定する

### Scope By Area

staff では、staff profile の `locale` を正本にし、staff settings 画面で自身の locale を変更できるようにする。最初に適用する UI 候補は、staff dashboard の action label 表示と、manual operation の基本操作 (`lend` / `return` / `fill` / `inhouse_use`) とする。

portal では、customer / portal locale を後続 Phase で検討する。portal history の action label 表示と、portal return / order / unfilled の基本案内文は候補だが、portal の tanks query は触らない。

admin は初期英語対応から外す。billing、sales、staff analytics、state diagram、revision / void、settings は集計・管理・状態遷移に近く、影響範囲が大きい。

## 8. Do Not Touch Yet

- Firestore 保存値の code 化
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
- 既存データ互換は不要だが、コード依存を無視するとアプリが壊れる。
- locale を localStorage 正本にすると、スタッフごとの設定にならない。
- staff profile に保存する場合、auth / session / settings / rules の整合が必要。
- status は query / filter / write に近いため、action より慎重に扱う必要がある。
- portal の `STATUS.LENT + location == customerName` は多言語対応とは別問題。
- 早すぎる i18n ライブラリ導入は、現状の構造整理を複雑にする可能性がある。
- browser setting を自動採用すると、業務画面が意図せず英語になる可能性がある。
- locale selector UI を早く入れすぎると、未対応画面との表示差が目立つ。
- 多言語 UI 対応と Firestore 保存値 code 化を同時にやると影響範囲が大きすぎる。

## 10. Decision

- Phase 12 は docs-only とする。
- Phase 13 は label dictionary helper only とする。
- Phase 14 は locale selection design docs のみとする。
- Phase 16A は staff locale setting policy docs のみとする。
- 初期 default locale は `ja` とする。
- locale の正本は staff profile の `staff.locale` とする。
- `staff.locale` がない場合は `ja` に fallback する。
- localStorage は正本ではなく、使うとしても補助キャッシュに限定する。
- staff.locale 実装前に、staff profile / staffSession / auth guard / settings UI / rules を read-only で確認する。
- Firestore 保存値 code 化はまだしない。
- 多言語 UI の最初の対象は、基本操作と表示専用 label に限定する。
- status query / filter / write 周辺は後回しにする。
