# タンクID利用箇所と正本モデル監査

## 1. 目的

このドキュメントは、タンクIDの source of truth を決める前段階として、現行コードで `tankId` がどこで入力・生成・加工・保存・検索・表示・ソート・履歴化されているかを棚卸しする docs-only audit である。

今回は設計決定や実装変更はしない。特に、Firestore data migration、`tank-operation.ts` の挙動変更、`logs` / `tanks` / `transactions` schema 変更、billing / sales / reward の挙動変更は行わない。

この監査では、次の前提で評価する。

- log は現在状態の source of truth にしない。
- `logs` に持たせる tank ID 情報は、正本参照に必要な canonical ID と、監査・履歴表示に必要な当時 snapshot に限定する方向で検討する。
- 現在状態・検索・正規化・ソートに必要な情報は、`tanks` または helper / service 側に寄せる。
- 既存本番データがある可能性があるため、migration は提案に留める。

## 2. 現行の大枠

現行 docs では、タンクは `tanks/{tankId}` で管理し、タンクIDは `A-01` のような大文字・ハイフン形式に正規化する方針になっている。

実装上も、`tanks` の Firestore document id が事実上のタンクID正本として使われている。

| 層 | 現行の扱い |
|---|---|
| `tanks` | document id が tank ID。`TankDoc.id` は `snap.id` |
| `logs` | tank lifecycle log では `logs.tankId` に対象 tank id を保存 |
| `transactions` | portal return / unfilled report で `transactions.tankId` に対象 tank id を保存 |
| UI 入力 | 主に prefix + 2桁 number で `A-01` 形式を生成 |
| 表示 | 多くの画面で `tank.id` / `log.tankId` / `transaction.tankId` をそのまま表示 |
| ソート | 多くは `localeCompare` または取得順。自然順 sort helper はない |

重要なのは、`tanks/{tankId}` が正本に近い一方で、正規化処理は一箇所に集約されていないことである。

## 3. tankId の入力箇所

| 箇所 | 入力方法 | 生成される形式 | 備考 |
|---|---|---|---|
| `src/components/TankIdInput.tsx` | DrumRoll prefix + 数字入力 + OK入力 | `${prefix}-${number}` または `${prefix}-OK` | 数字は `digits` 既定 2 桁。OK は数字未入力時の特別入力 |
| `src/features/staff-operations/hooks/useManualTankOperation.ts` | staff manual 操作の prefix + 2桁入力 / OK | `${activePrefix}-${val}` / `${activePrefix}-${payload}` | 貸出 / 返却 / 充填 queue に入る |
| `src/features/staff-operations/hooks/useOrderFulfillment.ts` | order fulfillment の prefix + 2桁入力 / OK | `${orderActivePrefix}-${val}` / `${orderActivePrefix}-${payload}` | 受注貸出対象として scannedTanks に入る |
| `src/app/staff/damage/page.tsx` | `TankIdInput` | `A-01` / `A-OK` | queue に追加後、破損報告 operation へ渡す |
| `src/app/staff/inhouse/page.tsx` | `TankIdInput` | `A-01` / `A-OK` | 正規表現で `^[A-Z]+-(\d{2}|OK)$` を許可 |
| `src/features/procurement/components/TankEntryScreen.tsx` | text input | `A-01` | 入力時に normalize、保存前に `^[A-Z]+-\d{2}$` を必須化 |
| `src/app/staff/dashboard/page.tsx` | `PrefixNumberPicker` | 既存 `tanks` の ID から選択 | log correction の tankId 変更で使う |
| `src/app/portal/unfilled/page.tsx` | `PrefixNumberPicker` | 顧客に貸出中の既存 tankId から選択 | free input ではなく選択式 |
| `src/app/portal/return/page.tsx` | 既存貸出中 tank list | `tank.id` | 顧客が条件を選択して return transaction を作る |

現行 UI は、登録系では `A-01` を強制し、staff operation 系では `A-OK` も扱える。`A1` / `A01` / `A001` のような入力揺れを受け入れて正規化する UI は現状ない。

## 4. tankId の生成・正規化・加工箇所

| 箇所 | 処理 | 評価 |
|---|---|---|
| `src/features/procurement/components/TankEntryScreen.tsx` | `toUpperCase()`, ハイフン類を `-` に統一、空白削除、`^[A-Z]+-\d{2}$` validation | 最も厳格。登録時の正規化に近い |
| `src/features/procurement/lib/submitTankEntryBatch.ts` | UI と同様に uppercase / hyphen normalize / whitespace remove。重複排除 | 保存直前にも正規化するため比較的安全 |
| `src/lib/tank-operation.ts` | `trim().toUpperCase()` のみ | operation 側の正規化としては弱い。ハイフン類・空白・桁揺れは吸収しない |
| `src/lib/tank-operation.ts` bulk duplicate check | `normalizeTankId(input.tankId)` で重複判定 | 同じ弱い normalize に依存 |
| `src/lib/firebase/portal-transaction-service.ts` | portal return / unfilled で `trim()` のみ | 既存 tank list 由来なら問題は小さいが、helper としては弱い |
| `src/lib/firebase/repositories/logs.ts` | identity field query で `value.trim()` | `tankId` query も uppercase しない |
| `src/lib/firebase/repositories/tanks.ts` | `getTank(tankId)` はそのまま `doc(db, "tanks", tankId)` | repository 境界では正規化しない |
| `src/components/PrefixNumberPicker.tsx` | `^([A-Z]+)-(\d{2})$` の ID だけ parse | 非該当 ID は選択肢から消える |
| `src/hooks/useTanks.ts` | prefix 抽出は `^([A-Z]+)` | `A-01` なら `A`。非標準 ID でも先頭英字だけ拾う |

正規化は現状、登録系と操作系で強さが違う。`A-01` を正本形式にするなら、helper を一箇所に集約し、入力・repository・operation・transaction で同じ規則を使う必要がある。

## 5. tankId の保存箇所

| 保存先 | field / doc id | 保存内容 | 注意 |
|---|---|---|---|
| `tanks/{tankId}` | document id | 現在状態のタンクID正本 | 現行では業務IDと document id が同一 |
| `logs` tank operation | `tankId` | 操作対象 tank id | `tank-operation.ts` で normalize 後に保存 |
| `logs` procurement | `tankId` | `summarizeTankIds(tankIds)` | 複数登録時は `A-01 他N本` であり、単一 canonical ID ではない |
| `logs` supply order | `tankId` | `"-"` | tank lifecycle log ではない |
| `transactions` return | `tankId` | portal return 申請対象 | trim のみ。既存 tank list 由来 |
| `transactions` uncharged_report | `tankId` | portal 未充填報告対象 | trim のみ。既存 tank list 由来 |
| `tankProcurements` | `tankIds` | 登録 / 購入した tank ID 配列 | procurement 側 normalize 済み |

`logs.tankId` は常に単一 canonical tank ID ではない。`logKind="tank"` の tank lifecycle log に限れば参照キーとして扱いやすいが、`logKind="procurement"` などでは summary 文字列になる。

## 6. Firestore document id として使っている箇所

| 箇所 | 用途 |
|---|---|
| `src/lib/firebase/repositories/tanks.ts` | `getTank(tankId)` が `doc(db, "tanks", tankId)` を読む |
| `src/lib/tank-operation.ts` | `applyTankOperation` / `applyBulkTankOperations` / correction / void が `doc(db, "tanks", tankId)` を読む・更新する |
| `src/features/procurement/lib/submitTankEntryBatch.ts` | 登録時に `doc(db, "tanks", tankId)` を作成する |
| `src/lib/firebase/tank-tag-service.ts` | `doc(db, "tanks", tankId)` の `logNote` を更新する |
| 各 UI | `TankDoc.id` を tankId として扱う |

現行では `tanks` document id が canonical ID の役割を持つ。document id と業務 ID が同一であるため、ID 変更を正式機能化する場合は rename ではなく correction flow / migration flow の設計が必要になる。

## 7. tankId を検索条件として使っている箇所

| 箇所 | 検索対象 | 正規化 |
|---|---|---|
| `tanksRepository.getTank(tankId)` | `tanks/{tankId}` | なし |
| `logsRepository.getActiveLogsByTank(tankId)` | `logs.logStatus == active` + `logs.tankId == tankId` | `trim()` のみ |
| `tank-trace.ts` | `logs.tankId == triggerLog.tankId` / `tankId` | 呼び出し値依存 |
| `return-tag-processing-service.ts` | `tanksRepository.getTank(item.tankId)` | なし |
| staff manual / order fulfillment | `allTanks[tankId]` / `tankMap[tankId]` | UI 生成値依存 |
| portal return / unfilled | `tanksRepository.getTanks({ location, status })` の結果から `id` を使用 | free text search ではない |
| dashboard correction | `PrefixNumberPicker` で既存 `tankIds` から選択 | 既存 ID 依存 |

検索キーとしての tankId は、基本的に `tanks` document id または `logs.tankId` に一致する文字列である。中央 helper がないため、呼び出し側が非標準 ID を渡すと検索漏れが起きる。

## 8. tankId を表示している箇所

| 箇所 | 表示値 |
|---|---|
| staff manual operation panel | queue item の `tankId` |
| bulk return panel | `tank.id` |
| return tag processing screen / list | transaction item の `tankId` |
| portal home | `tank.id`, `log.tankId` |
| portal return | `tank.id` |
| portal unfilled | selected `tank.tankId` |
| staff dashboard | `log.tankId`, unfilled report の `tankId` |
| staff mypage | `log.tankId` |
| maintenance / repair / inspection | `tank.id` |
| procurement | 入力済み `tankIds` |

表示用の `displayTankId` helper はなく、保存されている文字列をそのまま表示している。これは現行の `A-01` 固定運用では単純だが、`canonicalTankId` と表示形式を分ける場合は影響範囲が広い。

## 9. tankId をソートしている箇所

| 箇所 | sort 方法 | リスク |
|---|---|---|
| `tanksRepository.getTanks` | `a.id.localeCompare(b.id)` | 文字列 sort |
| `useBulkReturnByLocation` | group 内で `a.id.localeCompare(b.id)` | 文字列 sort |
| `portal/page.tsx` | `tanks.sort()` | 文字列 sort |
| `PrefixNumberPicker` | prefix と number を文字列 sort | 2桁固定なら概ね問題ない |
| repair / inspection | ID ではなく status / date 等で sort | ID自然順の問題は小さい |

現行の登録 validation が `A-01` の 2桁固定なら、`A-01`, `A-02`, `A-10` は文字列 sort でも大きく崩れにくい。一方で、`A-1`, `A-001`, `A-100`、複数 prefix、旧データ、`A-OK` を含むと自然順の定義が必要になる。

## 10. logs に tankId または tank 関連情報を保存している箇所

| 経路 | 保存内容 | 評価 |
|---|---|---|
| `applyTankOperation` / `applyBulkTankOperations` | `logs.tankId`, `prevStatus`, `newStatus`, `prevTankSnapshot`, `nextTankSnapshot` | tank lifecycle log。`tankId` は正本参照キー |
| `applyLogCorrection` | 新 revision の `tankId` を更新可能 | latest active log の対象 tank を変更できる。ID rename ではなく log correction |
| `voidLog` | `logs.tankId` の tank を prev snapshot に戻す | `tankId` が現在 tank lookup key |
| procurement | `logs.tankId` に summary 文字列 | audit summary。単一 tank 参照ではない |
| supply order | `tankId: "-"` | non-tank log |

`logs` に `prefix` / `number` / `sortKey` などの派生値を毎回持たせる必要性は現状薄い。必要なのは、tank lifecycle log では canonical tank ID、必要なら当時表示名 snapshot である。

## 11. tankId の役割分類

| 役割 | 現行で該当するもの | コメント |
|---|---|---|
| 正本ID | `tanks/{tankId}`, `TankDoc.id` | 現行の中心 |
| 表示ラベル | `tank.id`, `log.tankId`, `transaction.tankId` | 正本IDと同じ文字列をそのまま表示 |
| 入力値 | `TankIdInput`, procurement input | UI ごとに規則が違う |
| 検索キー | `tanks` doc id, `logs.tankId`, `transactions.tankId` | repository / service 側に normalize が不足 |
| 履歴 snapshot | `logs.tankId`, procurement summary | `logKind` によって意味が違う |
| ソートキー | 明示 field なし | `localeCompare` に依存 |

現行では `tankId` という一つの文字列が、正本ID・表示ラベル・入力値・検索キー・履歴 snapshot を兼ねている。

## 12. 現状のリスク

### A1 / A01 / A001 の表記揺れ

現行 UI の多くは `A-01` を生成または要求しているため、通常操作では `A1` / `A01` / `A001` は入りにくい。ただし、helper が中央集約されていないため、将来別入口が増えたときに同一物理タンクを別 ID として保存するリスクがある。

### ハイフン・空白・全角記号の揺れ

procurement 系はハイフン類と空白を吸収するが、`tank-operation.ts` は `trim().toUpperCase()` のみである。`Aー01` や `A 01` の扱いが入口で変わる。

### 文字列ソートによる自然順崩れ

現行は `localeCompare` が中心である。2桁固定の範囲では問題が見えにくいが、3桁化、旧データ混在、`A-OK` 混在時に `A-1`, `A-10`, `A-2` 問題が再発し得る。

### UI入力値と保存値の不一致

procurement UI / service は強く正規化する。一方、manual operation は UI が生成した値を前提にし、operation 側は弱い正規化で保存する。入口が増えるほど差分がバグになる。

### logs に情報を持たせすぎるリスク

`logs` は履歴・監査の正本になり得るが、現在状態やソートのために `displayTankId`, `prefix`, `number`, `sortKey` などを広く保存し始めると同期対象が増える。log 側は canonical ID と必要な表示 snapshot に抑える方が安全である。

### document id と表示名が混ざるリスク

現行は document id と表示ラベルが同じである。この単純さは利点だが、ID 表記変更や誤登録修正を「表示名の変更」として扱えない。document id を業務 ID にするなら、ID correction / migration flow は別設計にする必要がある。

### `logs.tankId` が常に単一 tank 参照ではない

procurement log では `A-01 他N本`、supply order log では `"-"` が入る。`logs.tankId` を検索キーとして使う場合は `logKind="tank"` の前提を明示する必要がある。

### `A-OK` の扱い

`TankIdInput` と一部 staff workflow は `A-OK` を許容している。今後の canonical model では、`A-OK` を legacy anomaly ではなく valid tankId として扱う。ただし、これは自由な suffix model ではない。`OK` は唯一の reserved nonnumeric exception であり、`A-NG` / `A-TEST` / `A-SPARE` のような任意 suffix は invalid とする。

## 13. Structured tank id model

今後の設計では、`tankId` を自由文字列ではなく、原則 `prefix` と numeric `number` から成る構造化 ID として扱う案が自然である。ただし、`OK` だけは予約済みの非 numeric 例外として許容する。

UI 入力では `A1` / `A01` / `A-01` / `A001` のような表記揺れを受け付けてもよい。ただし、domain model ではこれらをすべて同じ値として扱う。

```ts
type TankIdParts =
  | { prefix: string; kind: "numeric"; number: number }
  | { prefix: string; kind: "ok" };

type TankIdModel = {
  prefix: string;
  kind: "numeric" | "ok";
  number?: number;
  canonicalTankId: string;
  displayTankId: string;
  sortKey?: string;
};
```

この設計では、numeric tankId の保存上の正本は `"01"` のような数字文字列ではなく、`prefix: "A"` と `number: 1` の組み合わせに寄せる。`OK` は `kind: "ok"` として表し、任意文字列 suffix は model に入れない。表示・document id・検索キーとして必要な文字列表現は helper で決定的に生成する。

| 入力 | parse 結果 | canonical / display |
|---|---|---|
| `A1` | `{ prefix: "A", kind: "numeric", number: 1 }` | `A-01` |
| `A01` | `{ prefix: "A", kind: "numeric", number: 1 }` | `A-01` |
| `A-01` | `{ prefix: "A", kind: "numeric", number: 1 }` | `A-01` |
| `A001` | `{ prefix: "A", kind: "numeric", number: 1 }` | `A-01` |
| `A100` | `{ prefix: "A", kind: "numeric", number: 100 }` | `A-100` |
| `AOK` | `{ prefix: "A", kind: "ok" }` | `A-OK` |
| `A-OK` | `{ prefix: "A", kind: "ok" }` | `A-OK` |

2桁は domain 上の上限ではなく、表示時の最低ゼロ埋め桁数として扱う。現行 UI では数字2桁入力で確定するが、これは current UI limitation であり、domain model の制約ではない。

## 14. Prefix + number as source data

`prefix` と numeric `number` を source data の主軸として扱う場合、次のルールを基本にする。

| 項目 | 方針 |
|---|---|
| `prefix` | trim / uppercase 後の英字列。表記揺れは parser で吸収する |
| `number` | integer。原則 `number >= 1` |
| `OK` | 唯一の reserved nonnumeric exception。`kind: "ok"` として扱う |
| 任意 suffix | `NG`, `TEST`, `SPARE` などは invalid |
| `00` | 現場運用で必要がない限り invalid |
| `number <= 99` | domain validation には入れない |
| `displayTankId` | `formatTankId(prefix, number)` で生成 |
| `canonicalTankId` | 短期案では `displayTankId` と同じ `A-01` 形式 |

入力中の UI state は `numberInput: "01"` のような文字列で保持してよい。重要なのは、確定時・保存時・検索時・重複チェック時に parse / normalize を通して `number: 1` に変換することである。

`A001` を `A-001` として扱うのではなく `A-01` として扱うかは、今回の初期案では「leading zero は意味を持たない」という前提に寄せる。この場合、`A001` と `A1` は同一タンクになる。

## 15. Canonical id and display id

`formatTankId("A", 1)` は `A-01` を返す。数字部分は最低2桁ゼロ埋めにするが、3桁以上はそのまま表示する。`kind: "ok"` は uppercase の `A-OK` に正規化する。

| prefix | number | display / canonical |
|---|---:|---|
| `A` | 1 | `A-01` |
| `A` | 9 | `A-09` |
| `A` | 10 | `A-10` |
| `A` | 100 | `A-100` |
| `B` | 1 | `B-01` |

| prefix | kind | display / canonical |
|---|---|---|
| `A` | `ok` | `A-OK` |
| `B` | `ok` | `B-OK` |

短期的には `canonicalTankId` と `displayTankId` を同じ文字列にしてよい。現行の `tanks/{tankId}` と最も相性がよく、既存 UI も大きく崩れない。

ただし、概念としては分けておく。

- `prefix` / `number`: domain source data
- `kind: "ok"`: 唯一の reserved nonnumeric exception
- `canonicalTankId`: 保存・検索・document id に使う決定的文字列
- `displayTankId`: 画面表示用文字列
- `sortKey`: Firestore query や安定 sort が必要な場合の projection

## 16. Two-digit UI input vs domain number

現行の `TankIdInput` や manual operation hook は、数字2桁で入力完了する設計になっている。これは現在の現場 UI としては成立しているが、domain model に `number <= 99` を焼き込むべきではない。

今後の分離案は以下。

| 層 | 扱い |
|---|---|
| UI 入力中 | `numberInput` は文字列。`"0"`, `"01"`, `"100"` などを一時保持してよい |
| UI 確定時 | parser で `prefix` / `number` に変換 |
| 保存時 | `canonicalTankId` を helper で生成 |
| 検索時 | raw input ではなく normalize 後の canonical ID を使う |
| 重複チェック | raw input ではなく canonical ID で行う |

これにより、現在は2桁入力 UI を維持しつつ、将来 `A-100` 以降が必要になった場合でも helper と domain model を壊さずに済む。

## 17. 正規化 helper / parser / formatter / sorter の必要性

必要である。少なくとも以下を `src/lib/tank-id.ts` のような純粋 helper に集約した方がよい。今回は実装しない。

```ts
parseTankId(input: string): TankIdParts
normalizeTankId(input: string): string
formatTankId(prefix: string, number: number): string
buildTankSortKey(prefix: string, number: number): string
compareTankIdNatural(a: string, b: string): number
validateTankId(input: string): ValidationResult
```

helper が必要な理由:

- procurement と operation で normalize 規則が違う
- repository query の呼び出し値が normalize されない
- `PrefixNumberPicker` が2桁固定で非該当 ID を無視する
- ID sort が `localeCompare` に分散している
- 将来 `A1` / `A01` / `A001` の扱いを決める場所が必要
- `A-100` 以降を許容する場合に UI limitation と domain validation を分離する必要がある
- `A-OK` を valid reserved exception として扱いつつ、`A-NG` などの arbitrary suffix を明確に invalid にする必要がある

helper の置き場所は `src/lib/tank-id.ts` が自然である。UI component、repository、operation、procurement、portal service の全てから参照される domain helper であり、Firebase や React に依存しない純粋関数として置けるためである。

置くべきでない場所:

- `components` 配下: UI helper に閉じないため
- `firebase/repositories` 配下: Firestore 専用ではないため
- `tank-operation.ts` 内部: registration / portal / display / sort でも使うため

## 18. Firestore document id options

### 案A: `tanks/{canonicalTankId}` を維持する

`canonicalTankId` を helper で `prefix + number` から生成し、現行どおり `tanks/{canonicalTankId}` を document id とする。

利点:

- 既存構造と相性がよい
- `tanksRepository.getTank(canonicalTankId)` が単純
- `logs.tankId` / `transactions.tankId` から `tanks/{tankId}` を直接読める
- Firestore data migration なしで helper 導入を始めやすい

リスク:

- 将来タンクID変更や誤入力修正を正式機能にする場合、document id rename / migration が必要になる
- `logs.tankId` / `transactions.tankId` / `tankProcurements.tankIds` との整合設計が必要になる

### 案B: `tanks/{internalId}` と業務ID field を分ける

`tanks/{internalId}` のような内部 ID を document id にし、業務上の ID は field として `prefix`, `number`, `canonicalTankId` を持つ。

利点:

- 将来の ID 変更・誤入力修正に強い
- 物理タンク identity と表示 ID を分けられる
- canonical ID の再採番や表示変更を field update として扱える

リスク:

- 既存コードの参照構造変更が大きい
- `doc(db, "tanks", tankId)` 前提の operation / repository / service を大きく変える必要がある
- `logs` / `transactions` から tank を辿る参照 field の再設計が必要になる

現段階の推奨は案Aである。短期的には `tanks/{canonicalTankId}` を維持し、`canonicalTankId` を helper で一元生成する方針を基本線にする。ただし、ID変更を正式機能にする場合は、案Bへの移行可能性も残す。

## 19. Logs and snapshot policy

log は現在状態の source of truth にしない。

`logs` に `prefix` / `number` / `sortKey` を重複保存しすぎると、現在状態・検索・ソートの責務が log に混ざる。これは revision / void / correction とも絡み、同期対象が増えるため避ける。

推奨方針:

- tank lifecycle log には原則 `canonicalTankId` を持たせる
- 現行 field 名を維持するなら `logs.tankId` を canonical ID として扱う
- 当時の表示を監査目的で固定する必要がある場合だけ `tankLabelSnapshot` を検討する
- `logs.prefix` / `logs.number` / `logs.sortKey` は原則追加しない
- procurement のような summary log は `logKind` で tank lifecycle log と区別する

この方針なら、log は過去操作の記録に集中でき、現在状態・検索・自然順ソートは `tanks` と helper 側に寄せられる。

## 20. Sorting policy

文字列ソートでは、ID 形式が揺れた瞬間に `A-01`, `A-10`, `A-02` や `A-1`, `A-10`, `A-2` のような問題が起きる。

自然順ソートは文字列ではなく、`prefix` と `number` に分解して行う。同一 prefix では numeric を先に自然順で並べ、reserved `OK` 例外は最後に置く。

```text
A-01
A-02
A-10
A-99
A-100
A-OK
B-01
B-OK
```

Firestore query で安定ソートが必要な場合は、`tanks` 側に projection として `sortKey` を持つ案を検討する。

| prefix | number | sortKey |
|---|---:|---|
| `A` | 1 | `A:000001` |
| `A` | 10 | `A:000010` |
| `A` | 100 | `A:000100` |
| `B` | 1 | `B:000001` |

| prefix | kind | sortKey |
|---|---|---|
| `A` | `ok` | `A:999999:OK` |

`sortKey` は現在一覧・検索・Firestore query 最適化のための projection であり、`logs` に持たせる必要は原則ない。

## 21. 重複チェック

重複チェックは raw input ではなく normalize 後の `canonicalTankId` で行う。

例:

| 入力 | canonical | 既存 `A-01` がある場合 |
|---|---|---|
| `A1` | `A-01` | 重複 |
| `A01` | `A-01` | 重複 |
| `A-01` | `A-01` | 重複 |
| `A001` | `A-01` | 重複 |
| `AOK` | `A-OK` | 既存 `A-OK` があれば重複 |

これにより、表記揺れによる重複登録を防げる。procurement、manual operation、portal transaction、dashboard correction など、入口が違っても同じ helper を通すことが重要である。

## 22. docs-only PR にする場合の変更対象 doc file 案

今回の監査ファイルとして、以下を新規作成するのが自然である。

- `docs/design/tank-id-usage-and-model-audit.md`

次フェーズで設計決定まで進める場合は、別途以下のような設計ファイルへ分離するとよい。

- `docs/design/tank-id-canonical-model.md`
- `docs/design/tank-id-migration-and-compatibility-plan.md`

## 23. 最初に決めるべき論点

1. `tanks` document id を今後も canonical tank ID として扱うか。
2. `canonicalTankId` field を document id とは別に持つ必要があるか。
3. `A1` / `A01` / `A001` を同一 ID とみなすか。
4. `A-01` を canonical / display の標準形式にするか。
5. 2桁は最低表示桁数であり、domain 上限ではないという方針でよいか。
6. `A-OK` を唯一の reserved nonnumeric exception として扱い、その他 suffix を invalid とする方針でよいか。
7. display label を canonical から生成するか、別 snapshot として持つか。
8. sort 用に `prefix` / `number` / `tankSortKey` を `tanks` に保存するか、helper で都度導出するか。
9. `logs` に `tankLabelSnapshot` を追加する必要があるか。
10. `logs` には `prefix` / `number` / `sortKey` を持たせない方針でよいか。
11. ID correction は dashboard log correction の延長でよいか、別の ID correction flow に分けるか。
12. 既存本番データの非標準 ID をどう検出し、どう移行するか。

## 24. Suggested next implementation scope

次 PR で実装するなら、まずは純粋 helper の追加に限定するのが安全である。

候補:

1. `src/lib/tank-id.ts` に parse / normalize / format / compare helper を追加する。
2. その時点では Firestore data migration はしない。
3. procurement と operation の正規化差分を helper に寄せる。
4. UI 入力中は文字列、確定後は parsed model に変換する。
5. `tanksRepository.getTank` や `logsRepository.getActiveLogsByTank` の呼び出し側で canonical ID を渡す方針を整理する。
6. `logs` への `prefix` / `number` / `sortKey` 重複保存は行わない。
7. 既存 data の migration は別 PR・別設計に分ける。

実装順は、helper 導入、既存挙動維持のテスト、入力 UI の helper 参照、operation / procurement の helper 統一、自然順 sort の置換、必要なら `tanks.sortKey` projection 検討、ID correction / migration 設計、の順がよい。

この順であれば、log に過剰な派生情報を持たせず、`tanks` と helper を中心に tank ID の正本性を整理できる。
