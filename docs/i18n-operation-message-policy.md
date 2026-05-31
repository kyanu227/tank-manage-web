# I18n Operation Message Policy

## 1. Purpose

この文書は、操作 UI の確認文・成功文・エラー文を `staff.locale` に応じて `ja` / `en` 表示するための設計方針を固定する。

対象は単語 label ではなく、変数を含む文章 message である。対象例は以下。

- 操作確認文
- 操作成功文
- 操作失敗文
- 空状態メッセージ
- helper text
- validation message

このプロジェクトはまだ実運用前で既存データはないため、legacy backfill や旧データ互換は前提にしない。ただし、既存コード経路、状態遷移、Firestore query、集計、返却フローを壊さないように段階的に実装する。

## 2. Labels And Messages

label は短い表示名である。

例:

- 貸出 / Lend
- 返却 / Return
- 未使用 / Unused

既存 helper:

- `getTankActionLabel`
- `getLegacyTankActionLabel`
- `getReturnTagLabel`

message は文章または文脈付きの表示である。

例:

- 選択したタンクを貸出しますか？
- 3本のタンクを返却しました。
- Firebase認証でログインしているスタッフのみ変更できます。

message は件数、操作名、顧客名、タンク番号、返却タグ、エラー理由などの変数を持つ可能性がある。そのため、単純な label helper とは分けて扱う。

## 3. Message Categories

### confirmation

操作前の確認文。

例:

- 貸出を実行しますか？
- 選択したタンクを返却しますか？
- 返却タグ処理を確定しますか？

### success

操作成功後の文。

例:

- 貸出が完了しました。
- 返却が完了しました。
- 表示言語を保存しました。

### error

操作失敗時の文。

例:

- 操作に失敗しました。
- スタッフセッションが見つかりません。
- Firebase認証でログインしているスタッフのみ変更できます。

### helper

説明文・補助文。

例:

- 返却区分を選択してください。
- 表示言語はスタッフごとに保存されます。

### empty state

対象データがないときの文。

例:

- 貸出中のタンクはありません。
- 処理待ちの返却申請はありません。

## 4. Message Key Design

message key は英語の安定した識別子にする。日本語文そのものを key にしない。

候補例:

```ts
type OperationMessageKey =
  | "manualOperation.confirm"
  | "manualOperation.success"
  | "manualOperation.failure"
  | "returnProcessing.confirm"
  | "returnProcessing.success"
  | "returnProcessing.empty"
  | "staffLocale.saveSuccess"
  | "staffLocale.saveFailure";
```

方針:

- UI component 名ではなく、業務意味に寄せる。
- action ごとの差分は message key の乱立ではなく、`actionCode` や `actionLabel` の変数で扱う。
- Firestore 保存値を key にしない。
- 日本語文そのものを key にしない。
- key は保存値、query、状態遷移条件として使わない。

日本語文を key にすると、文言修正が key 変更になり、翻訳、テスト、呼び出し側が壊れやすくなる。

## 5. Message Builder Design

message helper は plain string を返す。React element や HTML は返さない。

候補A: generic dictionary

```ts
type Locale = "ja" | "en";
type MessageParams = Record<string, string | number>;

function getMessage(
  key: OperationMessageKey,
  locale: Locale,
  params?: MessageParams
): string;
```

メリット:

- 実装が小さい。
- 固定文や軽い message に使いやすい。

リスク:

- `params` の型安全性が弱い。
- 翻訳文が必要とする変数不足を TypeScript で検出しにくい。

候補B: typed message builders

```ts
function getManualOperationConfirmMessage(
  actionCode: TankActionCode,
  count: number,
  locale: Locale
): string;

function getBulkReturnSuccessMessage(
  count: number,
  locale: Locale
): string;

function getStaffLocaleSaveSuccessMessage(locale: Locale): string;
```

メリット:

- 型安全。
- 業務文脈が明確。
- 重要操作の message で必要な変数を固定できる。

リスク:

- 関数数が増える。
- 軽い固定文にはやや重い。

推奨は併用案とする。

- 重要操作、Firestore write に近い操作、件数や action を含む確認文・成功文は typed builder を優先する。
- 空状態や helper text のような軽い固定文は generic dictionary でもよい。

## 6. Variable Interpolation Policy

扱う可能性のある変数:

- `actionLabel`
- `returnTagLabel`
- `tankId`
- `tankCount`
- `customerName`
- `staffName`
- `errorMessage`

方針:

- action 名は `getTankActionLabel` / `getLegacyTankActionLabel` を通す。
- ReturnTag は `getReturnTagLabel` を通す。
- `customerName` / `staffName` は snapshot 表示名として扱う。
- unknown error は汎用 message に fallback する。
- `error.message` をそのまま翻訳 key として扱わない。
- HTML を組み立てない。
- message helper は React element を返さない。
- まずは plain string を返す。

message helper は UI 表示専用である。Firestore 保存値、Firestore query、状態遷移、集計条件には使わない。

## 7. First Implementation Scope

### Phase 25: Operation Message Helper Only

- message helper を追加する。
- UI にはまだ適用しない。
- confirmation / success / error の一部だけを辞書化する。
- Firestore 保存値は変えない。

### Phase 26: Manual Operation Messages

- staff manual operation の貸出 / 返却 / 充填の確認文・成功文だけを locale 対応する。
- エラー文は汎用 message のみから始める。
- 操作 value、`ACTION`、`STATUS`、保存値は変えない。

### Phase 27: Return Processing Messages

- ReturnTagSelector 周辺ではなく、返却確定・返却タグ処理の表示 message を段階対応する。
- 返却確定 service は変更しない。
- `condition` / `[TAG:*]` 保存仕様は変更しない。

### Phase 28: Staff Locale Setting Messages

- staff/mypage の locale 保存成功 / 失敗文を locale 対応する。
- `updateOwnStaffLocale` service は変更しない。

## 8. Do Not Touch Yet

- Firestore 保存値
- Firestore query
- `ACTION` / `STATUS` 保存値
- `tank-operation.ts`
- `OP_RULES`
- `applyTankOperation` / `applyBulkTankOperations`
- `return-tag-rules.ts`
- `return-tag-processing-service.ts`
- billing / sales / staff analytics
- `tank-trace.ts`
- `tanks.location`
- `tanks.customerId`
- payout / collaborators

## 9. Risks

- message と業務値を混同すると、保存値や状態遷移が壊れる。
- 日本語文そのものを key にすると、将来の文言変更に弱い。
- `params` の型が弱いと、翻訳文で必要な値が不足する。
- `error.message` をそのまま多言語化しようとすると不安定になる。
- return flow の message は業務処理に近いため、service 変更と混ぜない。
- Firestore 保存値 code 化と message 多言語化を同時にやると影響範囲が大きい。

## 10. Decision

- Phase 24 は docs-only とする。
- message dictionary / builder は label helper と分ける。
- 最初は plain string helper を使う。
- 重要操作は typed builder を優先する。
- UI 適用は次 Phase 以降に分ける。
- Firestore 保存値、状態遷移、返却処理は触らない。
