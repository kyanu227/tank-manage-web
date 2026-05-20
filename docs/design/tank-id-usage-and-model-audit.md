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

`TankIdInput` と一部 staff workflow は `A-OK` を許容するが、procurement registration は `A-OK` を登録できない。既存データや旧運用に `A-OK` が存在するなら、canonical model で明示的に扱う必要がある。

## 13. あるべき tankId model の初期案

初期案としては、次の責務分解が安全である。

| 概念 | 推奨 | 理由 |
|---|---|---|
| canonical ID | 正規化済み `canonicalTankId` | 保存・検索・参照・document id に使う |
| document id | 現行互換では `canonicalTankId` と同一 | 現行の `tanks/{tankId}` と相性がよい |
| display label | 原則 canonical から formatter で生成 | log に現在表示用派生値を増やしすぎない |
| input value | parser が受け取る生入力 | UIごとの入力揺れを吸収 |
| sort model | `prefix`, `number`, optional `variant`, `sortKey` | 自然順 sort と特殊 ID を扱う |
| log reference | `logs.tankId` = canonical ID | tank lifecycle log の参照キー |
| log display snapshot | 必要なら `tankLabelSnapshot` | 当時表示を固定したい場合だけ |

現行互換を優先するなら、`canonicalTankId` は Firestore document id と同一にするのが最小である。ただし、将来的にタンクID変更を頻繁に行う正式機能にするなら、document id と業務IDを分ける設計も検討対象になる。

## 14. 正規化 helper / parser / formatter / sorter の必要性

必要である。少なくとも以下を一箇所に集約した方がよい。

- `parseTankId(input: string)`
- `normalizeTankId(input: string): string`
- `formatTankId(canonicalTankId: string): string`
- `compareTankIds(a: string, b: string): number`
- `extractTankIdParts(canonicalTankId: string)`

helper が必要な理由:

- procurement と operation で normalize 規則が違う
- repository query の呼び出し値が normalize されない
- `PrefixNumberPicker` が 2桁固定で非該当 ID を無視する
- ID sort が `localeCompare` に分散している
- 将来 `A1` / `A01` / `A001` の扱いを決める場所が必要

## 15. helper を置くならどこが自然か

候補は `src/lib/tank-id.ts` または `src/lib/tank-id-utils.ts`。

推奨は `src/lib/tank-id.ts` である。理由は、UI component、repository、operation、procurement、portal service の全てから参照される domain helper であり、Firebase や React に依存しない純粋関数として置けるためである。

想定責務:

- tank ID の parse / normalize / validate
- display label の生成
- sort key / compare function
- `A-OK` など特殊 ID の扱い

置くべきでない場所:

- `components` 配下: UI helper に閉じないため
- `firebase/repositories` 配下: Firestore 専用ではないため
- `tank-operation.ts` 内部: registration / portal / display / sort でも使うため

## 16. docs-only PR にする場合の変更対象 doc file 案

今回の監査ファイルとして、以下を新規作成するのが自然である。

- `docs/design/tank-id-usage-and-model-audit.md`

次フェーズで設計決定まで進める場合は、別途以下のような設計ファイルへ分離するとよい。

- `docs/design/tank-id-canonical-model.md`
- `docs/design/tank-id-migration-and-compatibility-plan.md`

## 17. 最初に決めるべき論点

1. `tanks` document id を今後も canonical tank ID として扱うか。
2. `canonicalTankId` field を document id とは別に持つ必要があるか。
3. `A1` / `A01` / `A001` を同一 ID とみなすか、現行どおり `A-01` だけを正とするか。
4. `A-OK` を正式な tank ID 形式として残すか、旧互換扱いにするか。
5. display label を canonical から生成するか、別 snapshot として持つか。
6. sort 用に `prefix` / `number` / `tankSortKey` を `tanks` に保存するか、helper で都度導出するか。
7. `logs` に `tankLabelSnapshot` を追加する必要があるか。
8. `logs` には `prefix` / `number` / `sortKey` を持たせない方針でよいか。
9. ID correction は dashboard log correction の延長でよいか、別の ID correction flow に分けるか。
10. 既存本番データの非標準 ID をどう検出し、どう移行するか。

## 18. 次フェーズの推奨順

1. 既存 Firestore data を変更せず、現行 tank ID の形式分布を読むだけの調査手順を設計する。
2. `canonicalTankId` の仕様を docs で確定する。
3. `src/lib/tank-id.ts` の helper API を docs で決める。
4. helper 導入は小さい PR で行い、まず既存挙動を維持する。
5. 入力 UI / procurement / operation / repository / portal service の normalize を helper に寄せる。
6. sort 表示を `compareTankIds` に寄せる。
7. 必要なら `tanks` に sort projection field を追加するか判断する。
8. ID correction / migration は最後に別 PR として扱う。

この順であれば、log に過剰な派生情報を持たせず、`tanks` と helper を中心に tank ID の正本性を整理できる。
