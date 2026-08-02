# 設計原則（Design Principles）

- 第一稿: 2026-08-02（基準 `e19d8a6` — **古いlocal main。監査基準として無効**）
- **第二稿: 2026-08-02（基準 `6c1d4c5` = origin/main、PR #182まで。working tree clean）**
- **第三稿: 2026-08-02（独立レビュー3件を反映）**
- **確定版: 2026-08-02（ユーザー最終判断により正式正本化）**
- **第四稿: 2026-08-03（main `71c191c` で gap を再監査し、ADR-007 を反映）**
- **Status: Approved / Authoritative**
- 位置づけ: **architecture設計判断の規範正本**
- 注意: **設計の承認であって実装の完了ではない。** clean-break implementation は未着手（§0.3）

---

## 0. この文書の位置づけ

### 0.1 目的

このシステムの設計目的はひとつ:

> **将来の仕様変更・不具合修正・機能追加のときに、調査・修正・検証する範囲を小さく保つこと。**

「綺麗なコード」「流行のarchitecture」「ファイル数の最適化」は目的ではない。本文書の規則はすべてこの目的からの導出であり、導出できない規則は削除してよい。

### 0.2 効力

本文書は **architecture normative authority の最上位**である。正本順位は [document-authority.md](./document-authority.md) §1 に従う。

作業手順・禁止操作・deploy手順は `AGENTS.md` / `CLAUDE.md`（workflow / safety authority）が規定する。両者は競合しない — 前者は「何をどう設計するか」、後者は「誰がどの手順で作業するか」に答える。

### 0.3 承認範囲（重要）

```text
Architecture design:          approved
Clean-break implementation:   not started
Firestore reset:              not executed
Rules cutover:                not executed
Hosting deploy:               not executed
```

**本文書が承認されたことは、ここに書かれた target 設計が実装済みであることを意味しない。** 現在のコードの事実は §21.4 の違反一覧と [domain-map.md](./domain-map.md) §8 の gap 表を見ること。

### 0.4 第一稿からの主要な訂正

| # | 第一稿の記述 | 訂正 |
|---|---|---|
| 1 | 基準commit `e19d8a6` | **無効**。origin/main は `6c1d4c5` で25 commit先。PR #176〜#182（staff英語化stack）が未監査だった |
| 2 | 「architecture enforcement は0件」 | **誤り**。局所的enforcementは複数存在する（§21.1） |
| 3 | 「domain は React / browser API を import しない — 現行遵守」 | **誤り**。現行mainで違反が存在する（§21.4） |
| 4 | `place` code への単純置換を確定 | **ADR-002 で確定**（flat保存 + 上流union） |
| 5 | surrogate tank ID を REJECT | **ADR-001 で確定**（surrogate不採用） |
| 6 | `rentalCycleId` 不要と確定 | **ADR-003 で確定**（新設しない） |
| 7 | `tanks.pendingReturnTag` を採用 | **ADR-004 で確定**（UI local state） |
| 8 | 確定請求書を source of truth 化と確定 | **ADR-005 で確定**（原則確定・実装deferred） |

### 0.5 第二稿からの主要な訂正（独立レビュー3件による）

| # | 第二稿の記述 | 訂正 |
|---|---|---|
| 1 | `logKind` 欠落の推測処理を**削除対象**に列挙 | **撤回（最重要）**。当該コードは推測ではなく **fail-closed guard** であり、§2.2 が守れと定めた不変条件そのものだった。自らの規則を破る記述だった（§22.1） |
| 2 | 「`latestLogId` は充填・破損報告でも変わる」 | **事実誤り**。両者とも `lent` から遷移できない。実際の論点は `carry_over` と `inspection` の2つ、実質 `inspection` のみ（§8.3） |
| 3 | 「`tank-operation.ts` が唯一のwriter」 | **事実誤り**。`tanks` には3つのwriterがある。かつwriter内部でplaceとcustomerが独立に決まる（§8.5） |
| 4 | `schemaVersion` が `assertOfficialAggregationSchemaReady` を置き換える | **誤り**。同関数は5つの独立検査を持ち、versionは1つしか代替しない。**追加**であって置換ではない（§11.2） |
| 5 | V1/V2 を「locale依存」と記述 | **過小評価**。本体は domain が `window.confirm()` を呼んでいること。完了条件を「`window.` 参照0件」へ変更（§21.4） |
| 6 | dual read は発生しないと主張 | **誤り**。write/read切替の窓に加え、訂正・取消が pre-cutover snapshot を読めなくなる。**reset-first へ変更**（cutover plan §1） |
| 7 | 「唯一の例外は `submitTankEntryBatch`」 | **事実誤り**。`runTransaction` は6箇所以上。規則を tank lifecycle に限定して記述（§10.2） |
| 8 | source-of-truth 表を本文書にも持つ | **削除**。domain-map §5 に一本化（二重管理の再生産だった） |

---

## 1. System context

- ダイビングタンクのレンタル管理。**実運用開始前**。実顧客データなし
- Next.js 静的エクスポート + Firebase Auth + Firestore。**サーバーコードを持たない**
- 利用者は 3 系統: staff（現場操作）/ admin（管理）/ portal（顧客）
- **ja / en の2言語対応が staff 系に実装済み**（PR #176〜#182）
- 障害対応は少人数（実質ユーザー1名 + AI）。**人間が追跡・修復できることが要件**

### 1.1 この文脈が設計に課す制約

| 制約 | 帰結 |
|---|---|
| サーバーがない | ビジネスルールの最終防衛線は **Firestore Rules のみ**。application validation は UX であって security ではない |
| client が直接 Firestore を書く | atomicity は `runTransaction` に依存する。分散transaction / saga は選択肢にない |
| 実運用前 | **後方互換は要件ではない**（§22）。ただし業務不変条件は互換性ではない（§2） |
| 少人数保守 | 抽象化の予算が小さい。1つの間接参照は1つの調査コストとして課金される |
| 多言語 | **保存値と表示文字列の分離が構造要件になる**（§12） |

---

## 2. 互換性と業務不変条件の区別（最重要）

この区別を誤ると、「一新」が安全機構の破壊として実行される。

### 2.1 後方互換性 — 要件ではない。削除してよい

- 旧Firestore schemaとの互換 / 旧fieldのread fallback
- `location == customerName` 等の文字列fallback
- 旧日本語labelによる機械判定 / dual read / dual write
- legacy documentのbackfill / migration / 旧形式専用index
- deprecated fieldの型への残置 / 旧形式を受理するparser
- compatibility helper / 段階移行のためだけのadapter

**Rule**: これらは新設計の要件に含めない。既存コードが依存している場合、依存している側を新設計へ直す。

### 2.2 業務不変条件 — 互換性ではない。削除候補として扱わない

実装は変えてよいが、**必要性を業務要件から再評価した上でのみ**変更する。

| 不変条件 | なぜ必要か | 現行実装 |
|---|---|---|
| 複数document更新のatomicity | tanks と logs が食い違うと現在状態と履歴が永久に矛盾する | `runTransaction` |
| 一操作一監査event | 請求・実績の根拠が再現できなくなる | logs 1件 = 1操作 |
| stale操作の拒否 | 古い画面から現在cycleを壊す。二重返却・誤請求の原因 | `expectedCycle` / `StaleTankCycleError` |
| cycle binding | どの貸出に対する返却かが確定しないと請求が対応付かない | `customerId` + `latestLogId` |
| revision / void の監査可能性 | 訂正の事実自体が監査対象 | 追記型revisionチェーン |
| staff log correction の 72h 共通制限 | 直近の入力ミス訂正に限定し、role による監査期限の回避を許さない | UI・domain・Rules で同じ 72h 条件（[ADR-007](./adr/ADR-007-staff-log-correction-authority.md)） |
| actor identity の記録 | 実績・報酬・責任追跡の根拠 | `OperationContext.actor` |
| 部分成功の禁止 | 一括操作の途中失敗で在庫が不整合になる | 単一transaction + 件数上限 |
| 不明・欠損時のfail-closed | 推測writeは誤請求を生み事後検出できない | `assertOfficialAggregationSchemaReady` |
| 請求・売上・実績の再現可能性 | 請求根拠を後から説明できないと業務が成立しない | logs → projection |
| write ownerの一意性 | 同じfieldを複数経路が別意味で書くと原因特定が不能になる | write-ownership |
| **操作eventの当時snapshot** | 「その時どの顧客へ、どこへ出したか」は監査・請求の根拠 | logs の name / location snapshot |

**Rule**: §2.2 は clean-break の削除対象リストに入れない。単純で安全な代替があれば置き換えてよいが、**「互換性だから不要」という理由では落とさない**。

**特に注意（第一稿の危険な曖昧さを訂正）**: 現在状態から `location` を削除しても、**操作eventが持つ当時の場所・顧客名snapshotまで削除してはならない**。clean break はsnapshotを不要にすることではない（§8.5）。

---

## 3. Design goals / Non-goals

### Goals
1. 変更に必要な調査範囲を小さくする
2. 一箇所の変更が無関係な機能へ波及しない
3. 単独でテストできる境界を作る
4. 一度に理解すべき概念を減らす
5. 変わりやすい詳細に上位業務が依存しない
6. 人間が壊れた箇所を発見・修正・検証できる

### Non-goals（明示的に追わない）
- ファイル数の最小化、および最大化
- 重複行ゼロ
- 全moduleのinterface化 / 全関数のDI
- design pattern / DDD / Clean Architecture / CQRS / Event Sourcing の名称採用
- 将来要件の先回り抽象化
- microservices / plugin architecture / event bus
- サーバーレス関数への移行（現時点で必要性なし）

---

## 4. Architecture style

### 採用: **Feature-oriented layered architecture + typed event projection**

1. **Feature-oriented** — コードは業務feature単位で縦に分割する。層で横断的に分割しない
2. **Layered** — feature内部は Page → Component → Hook → Workflow → Domain/Repository の一方向依存
3. **Typed event projection** — 操作は immutable な typed event（`logs.transitionPlan`）を残し、請求・売上・実績はその projection として一方向に導出する

### 採用しないもの

| 候補 | 判定 | 理由 |
|---|---|---|
| 完全な Event Sourcing | **不採用** | 現在状態は `tanks` に持つ方が読み取りが単純でFirestore特性に合う。**ただし請求は既にevent projectionで導出しており、そこは維持**（部分採用） |
| CQRS（物理分離） | **限定採用** | read model（`queries/`）と write workflow（`services/`）を分けるまで。別DB・別プロセスにはしない |
| Hexagonal（全面） | **限定採用** | Firestoreは差し替え予定なし。portは§17の3箇所のみ |
| DDD戦術パターン一式 | **不採用** | 用語導入では調査範囲は縮まない。有用な実質（集約境界＝atomicity境界）は名前を借りずに採る |
| microservices / event bus / plugin | **不採用** | 単一client appに分散システムの故障モードを持ち込む |
| class継承階層 / BaseService / BaseRepository | **禁止** | §17 |

**TypeScript/Reactである。classを増やすことは設計目的ではない。** pure function / module / discriminated union / readonly type / workflow function / React component / hook を第一の道具とする。

---

## 5. Module boundaries

### 5.1 層の定義

| 層 | 所有する責務 | 所有してはいけない責務 | test方法 |
|---|---|---|---|
| **page** (`src/app/**/page.tsx`) | routeの受け口、featureの組み立て | 業務判断、Firestore query/write、計算 | 手動 / smoke |
| **component** (`features/**/components/`) | 表示、入力、controlled callback呼び出し | state複製、業務再計算、query/write、`Date.now()` | static render / contract test |
| **hook** (`features/**/hooks/`) | UI state、入力、session/identity取得、queue表示 | 業務validation、payload構築、write呼び出し | 必要時のみ |
| **workflow** (`features/**/services/`) | 1業務手順: validation → action/place決定 → payload構築 → domain呼び出し | Firestore SDK直呼び、UI state、請求計算 | **payload固定テスト（必須）** |
| **query / read model** (`features/**/queries/`) | 用途別のread整形・集計 | write、業務判断 | pure unit test |
| **domain** (`src/lib/tank-*.ts`) | 状態遷移、不変条件、純粋変換 | React、browser API、**locale/表示文言** | pure unit test |
| **repository / adapter** (`src/lib/firebase/`) | Firestore query / atomic write | 業務判断 | Emulator integration |
| **display boundary** (`i18n.ts` / `*-labels.ts` / `staff-display.ts`) | code → localized text | 業務判断、保存値の決定 | dictionary完全性test |

### 5.2 依存方向（一方向。逆流禁止）

```text
page → component → hook → workflow → domain
                              ↓         ↓
                          repository → Firestore

display boundary ← component / hook が呼ぶ（domainは呼ばない）
```

追加規則:

- **feature間の直接importは禁止**。組み合わせは composition 層（page / OperationsTerminal / layout）でのみ行う
- **domain は React / Next / browser API / locale を import しない**（§12.4。**現行違反あり** §21.4）
- **operation側は billing を import しない**（§13）
- **billing / sales / analytics は write service を import しない**（§13）

### 5.3 全機能に全層を強制しない

**Why**: 設定保存に workflow 層を強制すると、空のpass-through関数が増え、調査経路が1段深くなるだけで安全性が上がらない。

**Rule**: workflow service 境界を**必須**とするのは高リスク操作のみ — tank lifecycleへの書き込み / 複数collection更新 / identity解決を伴う操作 / 監査対象（訂正・取消）/ atomicityを持つ操作。

それ以外（settings保存・master保存）は `page → 保存service` の薄い経路でよい。

---

## 6. Public interface policy

- module は「業務的に意味のある操作」だけを export する。内部helperを export しない
- barrel export を無条件に増やさない
- 型は入出力contractのみ export する
- `logExtra` / `tankExtra` のような自由領域に正本fieldを入れない

**具体例（良い）**: `tank-operation.ts` は `applyTankOperation` / `applyBulkTankOperations` / `applyLogCorrection` / `voidLog` を公開し、`commitPlannedOperations` 等は非公開。

---

## 7. Naming / comments / immutability

- **名前だけで責務と意図が理解できること。** `Manager` / `Handler` / `Processor` / `Util` は責務を説明しない
- **コメントは「なぜ必要か」を書く。** 特に §2.2 の不変条件には理由を必ず残す
- コメントは日本語（既存規約）
- `readonly` / `Readonly<>` を既定とする
- discriminated union で「ありえない状態」を型で排除する（`TankIdValidationResult` が良い例）

---

## 8. Identity policy

### 8.1 正本は immutable ID。表示文字列は正本にしない

**Rule**: 機械判定・検索・集計・権限・請求では表示文字列を使わない。

| identity | 型 | 生成責任 | document IDとの関係 |
|---|---|---|---|
| `staffId` | string | staff master作成時 | `staff/{docId}` とは別field |
| `customerId` | string | customer master作成時 | `customers/{customerId}` |
| `tankId` | canonical string (`A-01`) | 現場（物理刻印） | `tanks/{canonicalTankId}`（§8.2） |
| `logId` | Firestore auto ID | logs追加時 | `logs/{logId}` |
| `eventId`（step単位） | `${logId}:${stepIndex}` | projection時に導出 | 永続化しない |
| `transactionId` | Firestore auto ID | transaction作成時 | `transactions/{id}` |
| `operationGroupId` | 一括操作のグループ識別 | workflow が生成 | §8.3 |
| `rentalCycleId` | **未決**（§8.3） | — | — |
| `invoiceId` | 確定請求書の識別 | §13.5（別ADR） | — |

### 8.2 tank identity — 推奨: tankIdをdocument IDとして継続。ただし根拠と残論点を明示

**現行コードの事実**:

| 事実 | 証拠 |
|---|---|
| `tanks/{canonicalTankId}` が document ID | `submitTankEntryBatch` |
| 表記ゆれは canonical化で吸収 | `tank-id.ts`（`A-1` / `Ａ-０１` / `A01` → `A-01`） |
| **logの tankId 訂正は存在する** | `LogCorrectionPatch.tankId`（tank-operation.ts:168）。`mergeTankLogContent` で新tankIdへ差し替え、新tank docを更新 |
| **tank document 自体の rename 経路は存在しない** | 全writeを走査して該当なし |

**この2つは別物である**（第一稿はここを混同していた）:

- **log-level tankId 訂正** = 「読み取り/入力を間違えて別タンクのログを作った」の訂正。**既に実装済み・必要**
- **tank document rename** = 物理タンクの識別子そのものの変更。**実装なし**

**推奨**: surrogate internal ID を**新設しない**。理由:

1. tankId は物理刻印であり、現場が読む唯一の識別子。surrogate を挟むと障害時の照合コストが上がる
2. 誤入力の訂正は**log側の訂正**で既に解決している。tank document の identity を変える必要がない
3. surrogate を入れると、全operation に `tankId → internalId` の解決が1段増える

**ただし最終確定には、次の業務確認が必要（§26 ADR候補）**:

- 物理タンクの刻印が打ち直されること（再刻印・番号訂正）はあるか
- タンク登録時に間違った番号で登録した場合、現在どう復旧しているか
- 番号体系の変更（prefix追加等）の予定はあるか

**いずれかがYESなら**: `tanks` document ID は surrogate にし、`tankId` を可変の業務属性（unique index付き）にする設計へ切り替える。この判断はADRに残す。

### 8.3 rental cycle identity — 4概念を分離してから判断（保留）

第一稿は「`customerId + latestLogId` で足りるので `rentalCycleId` 不要」と結論したが、**これは異なる4つの概念を1つに畳んでいた**。まず分離する。

| # | 概念 | 目的 | 寿命 | 現行の担い手 |
|---|---|---|---|---|
| 1 | **stale guard token** | 「読んだ後に状態が変わっていないか」の楽観的並行制御 | 1操作の間 | `customerId + latestLogId` |
| 2 | **rental cycle identity** | 「同一の貸出期間」を表す業務identity | 貸出開始〜返却 | **なし**（billing が event 列から都度再構成） |
| 3 | **idempotency key** | 同一申請の二重実行防止（portal返却申請等） | 申請の寿命 | **なし**（cycle bindingが間接的に代替） |
| 4 | **operationGroupId** | 一括操作のグループ識別 | 1操作 | logs の field |

**#1 と #2 が別概念である証拠**（第二稿の誤りを訂正）:

第二稿は「充填・破損報告でも `latestLogId` が変わる」と書いたが、**これは誤り**。`tank-rules.ts` の `CODE_OP_RULES` を確認すると:

- `fill.allowedPrev: ["empty"]` — `lent` から遷移**できない**
- `damage_report.allowedPrev: ["empty", "filled", "in_house"]` — `lent` から遷移**できない**
- `lent` から可能なのは `return` / `return_unused` / `return_uncharged`（いずれもcycleを閉じる）と `carry_over`（`lent → unreturned`）のみ

したがって貸出中に `latestLogId` を変える経路は、当初の想定より**はるかに狭い**。実際に残るのは2つだけ:

| 経路 | 扱い |
|---|---|
| `carry_over` | billing は既に**cycle境界として扱っている**（`source-logs.ts` の `carry_over` 分岐）。実質的に問題にならない |
| `inspection`（`allowedPrev: []` = **無制限**） | `lent` からも実行可能。実行すると customer projection が null になり、**返却logなしにrentalが終了する**。これが唯一の実質的な論点 |

**結論**: `latestLogId` が cycle identity と一致しない実例は `inspection` に絞られる。ADR-003 はこの狭い前提で再評価する必要があり、**答えが「`rentalCycleId` は不要」へ転ぶ可能性が高い**。

**先に確認すべきこと**: `inspection` が `lent` から実行できるのは業務上意図した仕様か、それとも `allowedPrev` の設定漏れか。後者なら `rentalCycleId` ではなく `allowedPrev` の修正が正しい解である。

**現状の帰結**: billing は `collectBillingSourceLogMatches` で、event列を時系列に走査して「rental_open → rental_close」を対にすることで cycle を**毎回再構成**している。これは動作しているが、cycle identity が永続化されていないため:

- correction / void で過去のevent列が変わると、cycle の対応付けが変わりうる
- 「この返却はどの貸出に対応するか」がクエリで直接引けない

**判断: 保留**。`rentalCycleId` の要否は次で決める（§26 ADR候補）:

- correction / void 後も cycle identity を維持する必要があるか（＝確定請求との突合に必要か）
- portal 返却申請に明示的な idempotency key が必要か（cross-device 二重送信の実害が観測されているか）

**確定していること**: #1 の stale guard は現行実装で正しく機能しており、**維持する**。#2 を導入する場合も #1 を置き換えない（別concern）。

### 8.4 表示snapshotの扱い

`staffName` / `customerName` / 翻訳label は**表示・監査snapshotとしてのみ**保持する。

- 保持してよい理由: 「その時点で何と呼ばれていたか」は監査に必要
- 保持してはいけない使い方: 検索キー、集計キー、権限判定、請求のgroupingキー、状態遷移の判定

### 8.5 custody model — 3案比較（第一稿の `place` 単純置換を撤回）

**診断（維持）**: `location` は2つの意味を1つのfieldで持つ。

- 物理的な場所: `"倉庫"` / `"自社"` / `"-"`（damage/repair/inspection/inhouse workflow が書く）
- 貸出先の顧客表示名: 貸出時に `customerName` が入る

判別は文脈依存で型では区別できない。これが `buildCustomerIdentityGroup` の location fallback → `legacy-location:` グループ → `resolvePricing` の名前一致検索という**すべてのlegacy文字列経路の根**になっている。この診断は現行mainでも変わらない（`customer-identity-read.ts` は未変更）。

**第一稿の誤り**: `place = warehouse | in_house | customer | none` への単純置換は、**無効な組合せを表現できてしまう**。

```text
place = warehouse かつ customerId = "customer-123"  ← 矛盾だが型が許す
```

#### 3案

**案A: flat fields + 明示不変条件**

```ts
type TankDoc = {
  custodyKind: "warehouse" | "in_house" | "customer";
  custodyCustomerId: string | null;
  custodyCustomerNameSnapshot: string | null;
};
// 不変条件:
//   custodyKind === "customer"  → customerId / nameSnapshot 必須
//   custodyKind !== "customer"  → 両方 null
```

**案B: nested discriminated custody object**

```ts
type TankCustody =
  | { kind: "warehouse" }
  | { kind: "in_house" }
  | { kind: "customer"; customerId: string; customerNameSnapshot: string };
```

**案C: `status` + `customerId` から導出。独立field を持たない**

#### 比較

| 項目 | A. flat | B. nested | C. 導出 |
|---|---|---|---|
| Firestore query（貸出中の顧客で絞る） | ○ `custodyCustomerId ==` で直接引ける | △ `custody.customerId ==` は可能だがnested indexが要る | ✗ statusとcustomerIdの複合。組合せが増える |
| Security Rules | ○ flat fieldの検証は書きやすい | △ nested の存在検査が冗長 | △ 導出ロジックをRulesに二重実装 |
| 無効な組合せの防止 | △ **application + Rules + test で強制が必要** | ◎ **型で表現できる** | ○ 元々2 fieldしかない |
| correction / void の snapshot 復元 | ○ 3 field を復元 | ○ 1 object を復元 | △ statusから再導出。過去の意味が変わると壊れる |
| billing | ○ customerIdを直接読む | ○ 同左 | △ 導出が必要 |
| portal current loan | ○ | ○ | △ |
| UI display | ○ | ○ | ○ |
| 将来の複数倉庫 | ○ `custodyKind` に追加 + 別field | ◎ union に variant 追加が自然 | ✗ statusの意味が膨張する |
| human repairability | ◎ Console で1 field ずつ読める | △ nested は Console で読みにくい | ✗ 「なぜこの場所か」がコードを読まないと分からない |

#### 推奨: **案A（flat）+ 型レベルの構築ヘルパー**

**Why**:

1. **Firestore は nested object の query / Rules / index が明確に不利**。custody は「貸出中の顧客で絞る」という主要queryを持つため、flat が実務的
2. **human repairability** — Firebase Console で直接読める形が、少人数保守では効く
3. 案Bの優位（型で無効状態を排除）は、**union を上流へ置けば得られる**。

**第二稿の誤りを訂正**: 第二稿は「`tank-operation.ts` が唯一のwriterだから、そこで union を受けて flat に落とせば安全」と書いたが、**両方とも誤り**だった。

| 誤り | 事実 |
|---|---|
| 「唯一のwriter」 | `tanks` には**3つのwriter**がある: `tank-operation.ts`、`submitTankEntryBatch`、`tank-tag-service.ts`（非transactional） |
| 「入口で union を受ければよい」 | writer の**内部で place と customer が別々に決まる**。place は `finalStep.location ?? input.location ?? "倉庫"`、customer は `resolveNextTankCustomerProjection()` という**独立した action-code 分岐**。末端の `toCustodyFields()` では上流2系統を統合できない |

**正しい設計**: union を**上流へ移す**。`TransitionStep` が `location: string` ではなく `custody: TankCustody` を持ち、`planTankTransition` がそれを生成する。すると `resolveNextTankCustomerProjection` は**その union の projection** になり、kind と customer を独立に組み立てる経路が消滅する。

つまり **「planで union、保存はflat」**。

**強制（3層すべて必要。application だけでは不十分）**:

| 層 | 内容 |
|---|---|
| plan | `TransitionStep.custody` を union にし、独立構築の経路をなくす |
| **Rules** | 組合せを検証する（**非バイパス層。これが本体**） |
| architecture test | flat field の直接構築を禁止 |

**未確定（§26 ADR候補）**: `custodyKind` の値域。`warehouse` / `in_house` / `customer` の3つで足りるか（修理業者への外注、検査機関への搬出などが別kindを要するか）。

#### snapshot の扱い（重要）

**現在状態の `location` を削除しても、logs が持つ当時の場所・顧客名snapshotは削除しない。** §2.2 の「操作eventの当時snapshot」に該当する業務不変条件である。logs 側は当時の custody を snapshot として保持し続ける。

### 8.6 customer identity resolver — 削除ではなく置換（第一稿の訂正）

第一稿は `customer-identity-read.ts` を「削除」としたが、**責務ごとに分ける**のが正しい。

| 責務 | 判定 | 理由 |
|---|---|---|
| `location` からの identity fallback | **削除** | legacy互換（§2.1） |
| `legacy-location:` group key の生成 | **削除** | 同上 |
| `isLegacy` フラグと「旧形式」警告UI | **削除** | 同上 |
| `customerId` による group key 生成 | **維持**（strict typed版へ置換） | 請求・dashboard・一括返却で必要 |
| current master name の解決 | **維持** | 表示に必要 |
| operation時のname snapshot | **維持** | §2.2 監査要件 |
| unknown / malformed 時の扱い | **維持し、fail-closedへ強化** | 現在は `"不明"` で続行。新設計では集計対象外として**明示的に検出**する |

つまり新設計では `customer-identity-read.ts` を消すのではなく、**legacy分岐を落とし、`customerId` 必須のstrict resolverへ置換**する。加えて、現在このファイルにあるハードコード日本語（`"不明な顧客"` / `"不明"`）は display boundary へ移す（§12）。

---

### 8.8 貸出中の耐圧検査を認めない（業務判断による確定）

**業務判断**: 貸出中のタンクに耐圧検査を実施する正規業務は**存在しない**。

**現行の問題**: `inspection.allowedPrev: []`（`tank-rules.ts`）は空配列＝**全status から実行可能**を意味する。`lent` / `unreturned` からも実行でき、実行すると customer projection が null になり、**返却logなしに rental が終了する**。

**Rule**:

- customer custody（`lent` / `unreturned`）から inspection を実行させない
- **実物が自社管理下にある状態だけ**を許可する
- この制約を transition policy test で固定する
- **この修正を `rentalCycleId` 導入の理由にしない**（ADR-003）

**target `allowedPrev`（最小集合）**: `["empty", "filled", "damaged", "defective"]`

| 除外 | 理由 |
|---|---|
| `lent` / `unreturned` | customer custody。業務判断により禁止 |
| `in_house` | 自社管理下ではあるが**使用中**。inspection の `nextStatus` は `empty` なので、`inhouse_return` を経ずに自社利用を終了させてしまう（`lent` の場合と同じ欠陥） |
| `disposed` | terminal status |

実装時に現行 status code を再監査し、この集合で過不足がないか確認すること。


## 9. Source-of-truth policy

**Rule**: 同じ意味のfieldを複数collectionで正本扱いしない。各データはちょうど1つの分類（source of truth / immutable event / current projection / display snapshot / audit snapshot / derived read model / cache / temporary UI state）を持つ。

**一覧は [domain-map.md §5](./domain-map.md) が正本。** 本節は表を持たない — 同じ表を2箇所に置くと必ず食い違い、それはこの文書群が解こうとしている問題そのものだから。

分類の判断基準:

| 分類 | 判定 |
|---|---|
| source of truth | 失うと復元できない |
| immutable event | 起きた事実。書き換えない |
| current projection | eventから再生成できる |
| audit snapshot | 当時の値。現在値で上書きしない |
| derived read model | 毎回導出する。永続化しない |
| cache | 失っても再生成できる。判断根拠にしない |
| temporary UI state | Firestoreに保存しない |

### 9.1 return tag の一時state — 4案比較（第一稿の即断を撤回）

**現状の問題**: 返却タグの一時stateを `tanks.logNote` に marker として書いている。`logNote` は operation の tankNote 反映にも使われ、**write ownerが2つある**（§14への既知の違反）。これは解消すべき。

**ただし置き場所は未決。** 第一稿は `tanks.pendingReturnTag` を即採用したが、それでは**タンクの現在状態とworkflow draftが再び混ざる**（問題の形を変えただけ）。

**現状はさらに悪い**（レビューで判明）:

| 事実 | 証拠 |
|---|---|
| 第2writerは**非transactional**で任意文字列を受ける | `tank-tag-service.ts:5-10` の `updateLogNote(tankId, logNote)` |
| tagは**無関係な操作で黙って消える** | 任意のtank操作が `tankLogNote = input.tankNote ?? ""` を `logNote` へ書く。選択済みtagが上書きされる |
| marker語彙が **Firestore Rules に埋まっている** | `firestore.rules:803-810` の `logNote in ["", "[TAG:unused]", "[TAG:uncharged]"]`。この値allowlistが、export された `updateLogNote` から任意文字列が入るのを防ぐ**唯一の砦** |

| 案 | cross-device | write owner | 失効 | 現在状態との分離 | concurrent | **stale guard参加** | **operationとのatomicity** |
|---|---|---|---|---|---|---|---|
| **A. UI local state** | ✗ | UIのみ | tab閉じたら消える | ◎ 完全 | 各端末独立 | **該当なし（不要）** | **該当なし（不要）** |
| **B. return transaction** | ○ | portal/staff service | transaction完了時 | △ 申請ではないものを申請collectionへ | transaction単位 | △ 別collection | △ |
| **C. 専用 `returnDrafts`** | ○ | draft service | TTL設計が必要 | ◎ 完全 | draft単位 | △ 別collection | △ |
| **D. `tanks.pendingReturnTag`** | ○ | 返却workflow | operation実行時 | ✗ draftが現在状態へ混入 | tank doc競合 | **✗ 迂回する** | **✗ 部分成功しうる** |
| （現状 `tanks.logNote`） | ○ | **2 owner** | 無関係操作で消える | ✗ | tank doc競合 | **✗ 迂回（V6）** | **✗ 部分成功（V6）** |

**推奨: 案A**（cross-device共有が不要と確認できた場合）。

**Why**: 案Aだけが **P3-B を純粋な削除にする** — `tank-tag-service.ts` と2つの呼び出し元を消し、Rules から `isReturnTagMarkerOnlyUpdate` と `logNote` の項目を削るだけで済む。他案は新しい write owner・TTL・cleanup を**増やす**。§18 の「先回りしない」に照らしても、共有要件が実証されていない段階で collection を増やすのは過剰。

**案D は採らない** — 現在状態とdraftの混在を再生産し、さらに stale guard と atomicity の両方を迂回する（上表）。

**重要（PR設計への影響）**: どの案でも **Rules変更を伴う**（marker語彙がRulesにあるため）。したがって P3-B は application-only PR にできず、**Rules-only PR とペア**になる。§6 の「Rules変更とapplication変更を混ぜない」を守るには、この2本立てを明示的に計画する必要がある。

**確認が必要な業務情報**（ADR-004）: 返却タグの選択は端末をまたぐか / 複数スタッフの同時処理があるか / 放置draftを誰が消すか。

---

## 10. Command / write model

### 10.1 1業務操作 = 1 workflow

操作ごとに独立した workflow service を持つ。`action` を引数で受け取る巨大な汎用serviceを作らない。

現行workflow（この粒度を維持）: manual-operation（lend/return/fill）、order-fulfillment、bulk-return-by-location、return-tag-processing、damage、repair、inspection、inhouse-use、inhouse-return、log-correction/void、procurement

**禁止**: `UniversalTankOperationService` / `OperationManager` / `TankService.execute(action, payload)`

### 10.2 共通不変条件は domain core に集約

各workflowが独自にFirestore writeを実装することは禁止。次は `src/lib/tank-operation.ts` が唯一の実装を持つ:

transition validation / cycle binding / atomic transaction / log作成 / current projection更新 / idempotency / revision・correction・void / aggregation revision / audit actor / 件数上限

**workflowが持つもの**: 業務validation、action決定、custody決定、note生成、関連transaction更新、payload構築。

**正確な規則**（第二稿の「唯一の例外」という表現は事実として誤りだったため訂正）:

> **`tanks` / `logs` を書く `runTransaction` は `tank-operation.ts` と `submitTankEntryBatch` のみ。**

リポジトリ全体には `runTransaction` が6箇所以上ある（`tank-operation-policy-service` / `staff-join-request-review-service` / `operation-review-service` / `staff-uid-link-service` / `staff-join-requests`）。これらは settings / staff 系であり、**この規則の対象外**。規則は tank lifecycle に限定される。architecture test もこの限定された形で書く。

**この例外を増やさない。**

### 10.3 `tank-operation.ts` の扱い

**判断**: 分解を目的化しない。ただし現状維持でもない。

中身は「1つの変更理由」（tank状態遷移の安全な永続化）で凝集している。ファイル分割は調査範囲を縮めず、transaction境界が散ると atomicity の追跡が難しくなる。

**Rule**: 次を**すべて**満たす場合のみ分割してよい。

1. 抽出対象が pure function（transaction handleを受け取らない）
2. 抽出後、呼び出しが一方向
3. 抽出単独で unit test が書ける
4. transaction 境界を跨がない

**優先的に抽出すべきもの**: **locale/表示文言への依存**（§21.4 の違反解消）。これは上記4条件を満たし、かつ依存方向の是正になる。

---

## 11. Event / read model

### 11.1 logs を event contract として使う（明示的contract付き）

**判断**: 別collectionの event store を新設**しない**。`logs` を event の正本とする。ただし **`logs` doc をそのまま event contract として扱わない。**

**Rule**: consumer は `logs` の生fieldを直接読まない。**projection関数を経由する**。

```text
logs.transitionPlan （永続化された typed event）
  → projectStateTransitions / projectRentalCycleEvents / projectOfficialAggregationEvent
    → billing / sales / staff-performance
```

実装済み（`tank-transition-projections.ts`）。**維持する**。

### 11.2 event schema version

**Rule**: `transitionPlan` に `schemaVersion` を持たせ、projection は既知versionのみ処理し、**未知versionは fail-closed**（0円として続行しない）。

**Rule**: `schemaVersion` は `assertOfficialAggregationSchemaReady` を**置き換えない。追加チェックとして足す。**

**Why**: 同関数は**5つの独立した検査**を行っており、versionチェックが代替できるのは1つだけである。

| # | 検査内容 |
|---|---|
| 1 | `logKind` の存在（欠落を「非tank」と推測しない） |
| 2 | `normalizeTransitionPlan` の成功 |
| 3 | `isTransitionReviewStatusConsistent(plan, transitionReviewStatus, hasUnknownAffectedCustomer)` |
| 4 | `policyMode ∈ {strict, advisory}` かつ `policyRevision` が safe integer |
| 5 | `affectedCustomerIds` が配列かつ `hasUnknownAffectedCustomer` が boolean |

`schemaVersion` だけに置き換えると、**review status が plan と矛盾する log を通してしまう**（検査3の喪失）。上記5つは §2.2 の不変条件として個別に維持する。

### 11.3 projectionの再生成

read model（請求候補・売上・実績・dashboard集計）は logs から毎回導出する。永続化しない。例外は `monthly_stats`（cache、条件は §22）。

### 11.4 correction / void の反映

- `logStatus: "superseded"` / `"voided"` の log は projection の入力から除外
- 訂正は新revisionを作るため projection は自動的に新内容を反映
- **二重計上の防止**: projection は `eventId`（`logId:stepIndex`）で冪等に扱う

---

## 12. i18n / display boundary（第二稿で新設）

現行mainには staff系 ja/en 対応が実装済み。この設計は本文書の原則と直接関係する。

### 12.1 保存値・業務code は locale-independent

**Rule**: Firestore に保存する値、業務判定に使う code、enum は**言語に依存しない**。

- action / status は code（`lend` / `return` / `in_use`）
- custody kind は code（§8.5）
- error は code（`tank_not_found`）

**違反例**: `action === "貸出"`（現行0件。維持）

### 12.2 translation は display boundary でのみ行う

**Rule**: code → localized text の変換は、**display boundary module に閉じる**。

現行の display boundary: `src/features/*/i18n.ts` / `src/lib/staff-display.ts` / `tank-action-status-labels.ts` / `return-tag-labels.ts` / `tank-recovery-confirmation-message.ts` / `operation-messages.ts`

### 12.3 error は code + params を正本とする

**Rule**: domain error は `code` と `params` を保持し、localized message は表示時に生成する。**error message 文字列を解析して分岐しない。**

現行の `StaffOperationError`（`code` + `params` + locale別catalog）は**この原則の正しい実装**であり、維持する。

**ただし現行実装に2つの設計上の観察がある**:

1. `StaffOperationError` の constructor は `Error.message` を **"ja" 固定**でレンダリングする（staff-operation-error.ts:126）。`message` は開発者向けlog用と割り切るなら妥当だが、表示に使われると ja が漏れる
2. `getStaffOperationErrorMessage` は `locale === "ja"` のときだけ生の `error.message` を優先する非対称な経路を持つ（同:153,159）。これは互換のための分岐であり、**clean-breakの削除候補**（catalog一本化）

### 12.4 domain は locale を知らない

**Rule**: domain / atomic writer は `Locale`、browser locale、`localStorage`、React hook に依存しない。表示に必要な情報は**呼び出し側が渡す**か、**codeのまま返して表示層が解決する**。

**現行違反あり** — §21.4 参照。

### 12.5 unknown error と actionable domain error を区別する

**Rule**:

- **actionable domain error** — 業務上の既知の失敗。code を持ち、ユーザーが取るべき行動を示せる（`tank_not_found` → 番号を確認）
- **unknown error** — 想定外。汎用メッセージにフォールバックし、**詳細をlogへ出す**

両者を同じ扱いにしない。現行の `isStaffOperationError` / `getStaffGenericErrorMessage` はこの区別を実装している。**維持する**。

### 12.6 i18n dictionary と domain enum を混同しない

**Rule**: 翻訳辞書のキー集合と、domain の enum は**別物**。辞書にキーがあることは、そのcodeが業務的に有効であることを意味しない。逆も同様。

domain enum の網羅性は TypeScript の exhaustive check で、辞書の完全性は dictionary test で、**別々に**保証する。

---

### 12.7 role code（確定）

Staff dashboard のログ訂正・取消については、role を code 化して分岐を残すのではなく、**権限次元としての role 自体を廃止する**。全 active staff に同じ 72 時間制限と訂正・取消条件を適用し、`StaffCorrectionRole` は削除する（[ADR-007](./adr/ADR-007-staff-log-correction-authority.md)）。staff log correction には role 次元が存在しない。

一方、admin アクセス制御・`settings/adminPermissions`・`operation-review-service` には role が必要である。現行はこれらの permission code に日本語文字列を使っている。

```text
operation-review-service.ts:212,231   role !== "管理者"   ← runTransaction 内
firestore.rules:44,48   staffRole() == "管理者" / "準管理者"
```

値は `staff.role` / `staffByEmail.role` に**永続化**され、`settings/adminPermissions` の role 配列にも使われる。admin 側の role code 化は**schema 問題なので data reset 前に解消が必要**。

**admin access control の target code**:

```ts
type StaffRole = "admin" | "assistant_admin" | "staff";
```

**Rule**:

- 日本語 role 文字列を permission code として使用しない
- 表示は ja/en dictionary で行う
- admin access control・`settings/adminPermissions`・`operation-review-service`・Rules・tests が**最終的に同じ role code**（`admin` / `assistant_admin` / `staff`）を使う
- staff log correction / void に role 判定を再導入しない
- admin operation review（`/admin/operation-reviews`）の管理者制限は維持する

### 12.8 保存する機械判定値は locale 非依存 code のみ（確定）

**対象**: `action` / `transitionAction` / `status` / `role` / `custodyKind` / `returnCondition` / `workflow` / `source` / `logKind` / review status / permission code

**禁止**: 次を**機械判定の正本 code として保存・比較する**こと。

```text
"貸出" "返却" "受注貸出" "倉庫" "管理者" "準管理者" "一般"
```

**区別すること**: 名前や自由入力値は別である。次は実在の表示・監査データとして保存**可能**。

```text
staffName / customerNameSnapshot / memo / note
```

判定基準は「**コードがこの値で分岐するか**」。分岐するなら code、しないなら自由文字列でよい。

## 13. Operation と Billing の分離

### 13.1 依存方向

```text
operation command → domain transition → immutable typed event
                                            ↓
                                    current-state projection (tanks)
                                            ↓
                        billing / sales / staff-performance projection
```

**逆方向の依存は禁止。**

### 13.2 規則

| 項目 | 規則 |
|---|---|
| operationが保存するもの | 状態遷移の事実、actor、customerId、transitionPlan、occurredAt。**金額は保存しない** |
| billingの入力 | logs の projection + settings + priceMaster のみ |
| operation側 | `src/lib/billing` を import しない |
| billing側 | `tanks` を書き換えない。write service を import しない |
| billing rule変更 | operation write に影響しない |
| operation failure | billing module を壊さない |
| billing failure | **operation write を止めない**（§16） |

### 13.3 fail-closed

event schema が不正なら**0円として続行せず、集計を停止する**。0円で続行すると誤った請求書が「正常に」発行され、検出できない。

### 13.4 pending review による印刷停止

未レビューの例外操作がある顧客は請求書を印刷できない（実装済み）。**維持する。**

### 13.5 確定請求書 — 別ADR候補（第一稿の即断を撤回）

**論点**: 確定後に根拠logが訂正されると、送付済み請求書の金額が変わりうる。

**第一稿の誤り**: これを design-principles の必須設計として確定した。しかし**確定請求書workflow自体が製品要件として固まっていない**段階でschemaを決めるのは、YAGNI に反する。

**判断**: `docs/architecture/adr/` の **billing finalization ADR 候補**として分離する。clean-break campaign の必須経路に含めない。

**ADRで決めること**: 請求確定という業務イベントが存在するか / 確定後の訂正をどう扱うか（警告 / 禁止 / 訂正伝票）/ 確定snapshotのschema。

**現時点で design-principles が定めるのは原則のみ**: 「業務上不可逆なイベントの結果を、可変なderived read modelとして扱わない」。実装形式はADRで決める。

---

## 14. Write ownership

1. page / hook / component から Firestore write SDK を呼ばない
2. 1つの field / collection / 業務操作に、**原則1つの write owner**
3. 新しいwrite経路は、実装前に write-ownership 表へ追記する
4. 複数機能が同じfieldを**異なる意味で**書く構造を作らない

現行一覧は [write-ownership.md](./write-ownership.md) が正本。

**既知の違反**: `tanks.logNote`（2 owner）→ §9.1 で解消する。**grandfather しない。**

---

## 15. Atomicity / idempotency / concurrency

| 項目 | 規則 |
|---|---|
| transaction境界 | tanks + logs + aggregationRevision（+ transactionId link）を単一 `runTransaction` |
| all-or-nothing | tank operation、log訂正・取消、受注完了、返却確定、procurement |
| partial success | tank操作では許さない。件数上限で分割を防ぐ |
| stale write防止 | `expectedCycle` を transaction 内の現在値と照合。不一致は `StaleTankCycleError` |
| optimistic concurrency | 上記 cycle 照合が実質のOCC。version fieldは追加しない |
| idempotency key | §8.3 #3 で要否を判断（保留） |
| server timestamp | `serverTimestamp()` を使う。**client clockは表示・当日判定にのみ使い、順序付けや請求期間の確定には使わない** |
| retry可能 | ネットワーク・transaction contention |
| retry不可 | `StaleTankCycleError`、transition validation失敗、権限不足 → 再取得してやり直す |

### 15.1 Rules と application validation の責務分担

- **Firestore Rules** = security boundary。バイパス不能な唯一の防衛線
- **application validation** = UX とデータ品質

**application validation は security ではない。** client code は改変可能。「applicationで検証しているからRulesは緩くてよい」は誤り。

---

## 16. Failure isolation

| 故障 | 影響範囲 | 意図 |
|---|---|---|
| billing UI / 計算が壊れる | 請求画面のみ。**operation write は継続** | 現場作業を止めない |
| projection生成に失敗 | 請求確定は **fail-closed** | 誤請求より停止を選ぶ |
| notification失敗 | tank operation を **rollbackしない** | 通知は業務の完了条件ではない |
| audit event保存失敗 | **operation全体を失敗させる** | 監査なき操作を残さない |
| cache不整合 | 表示のみ。write直前に最新値を再検証 | cacheを判断根拠にしない |
| **locale解決失敗** | **既定localeで表示継続。operationを止めない** | 表示都合で業務を止めない（§12.4の根拠） |
| Firestore Rules 拒否 | 該当操作のみ失敗。partial write なし | transactionが保証 |

---

## 17. Abstraction / interface / DI

**Rule**: interface は**交換・テスト・外部境界**のいずれかに実益がある場合のみ導入する。

### port を置く箇所（これだけ）

| 対象 | 理由 |
|---|---|
| **clock**（`now()`） | 時刻依存ロジックを決定的にテストする |
| **ID generator** | log ID / transaction ID を固定してテストする |
| **notification送信** | 外部サービス境界 |
| **locale解決** | §12.4。domainが必要とする場合は**引数で受ける**（importしない） |

### port を置かない箇所

| 対象 | 理由 |
|---|---|
| Firestore transaction | `runTransaction` のセマンティクスは抽象化すると失われる |
| repository全般 | 差し替え予定がない |
| React hooks | testはrenderで行う |
| auth | Firebase Auth に固定 |

**禁止**: 全moduleへのinterface / 全関数へのDI / generic CRUD repository / `BaseService` / `BaseRepository` / `DomainManager` / 1実装しかないinterface / brand型の大量導入

**依存性逆転を「全てinterface化」と混同しない。**

---

## 18. Commonization policy

**Rule**: 共通化は先回りしない。次を**すべて**満たしてから行う。

1. 実装が **3箇所以上**
2. **同一責務**
3. **同一契約**
4. **同一の変更理由**

**duplicationを許容する期間**: 上記が実証されるまで。

**shared moduleへ移してよい**: pure変換、identity解決、ID正規化、共通入出力型、汎用UI部品、display boundary
**featureに残す**: 業務validation、action決定、custody決定、note生成、関連transaction更新

**dumping ground防止**: `common.ts` / `utils.ts` / `helpers.ts` / `manager.ts` / `controller.ts` を**新規に作らない**。名前が責務を説明できないなら共通化ではなく寄せ集めである。

---

## 19. Testing strategy

| 層 | 何を証明するか | 何を証明できないか |
|---|---|---|
| **pure unit test** | 遷移policy、projection、ID正規化、集計関数 | Firestoreの実挙動、Rules、atomicity |
| **workflow contract test（payload固定）** | workflowがdomainへ渡すpayload | 実際に保存されるか |
| **component contract test（AST）** | 禁止import、禁止call、props契約 | 実行時の正しさ |
| **dictionary / residual scan** | 辞書の完全性、未管理文言の不在 | 訳文の正しさ |
| **repository / adapter test** | query形状、変換 | 業務的な正しさ |
| **Firestore Emulator integration** | atomicity、transaction、cycle binding | 本番のindex・課金・遅延 |
| **Security Rules test** | 権限境界、書き手の限定 | application側の業務ルール |
| **architecture test** | 依存方向、禁止import、write owner | 実行時の正しさ |
| **E2E smoke** | 主要フローが通ること | 例外系 |
| **production read-only verification** | 本番データの実態 | 変更後の挙動 |

**mutation test候補**: 請求計算と遷移policy。**clean-break完了後に検討**（現時点では優先しない）。

**必須**: workflow を新設・変更するPRは payload固定テストを必須とする。

---

## 20. Performance exception policy

**Rule**: 性能・UXのために原則を破る場合、次を**すべて**満たす。推測だけで cache / projection / denormalization を増やさない。

1. **実測された** performance problem（体感ではなく計測値）
2. before / after の measurement
3. 影響範囲の明示
4. **正本と cache の区別**
5. **再生成方法**
6. 失敗時の fallback
7. ADR記録
8. regression test

**現在認められている例外**:

| 例外 | 正本 | 再生成 |
|---|---|---|
| `tanks` が current state を持つ | logs | event列を再生 |
| `tanks.customerId` / custody projection | customers + logs | operation時に更新 |
| `monthly_stats` | logs | 期間指定で再集計 |
| `staffByEmail` / `staffByUid` index | staff | staff同期時に再構築 |
| `staffSession` localStorage の locale cache | `staff` | 再ログイン / 再取得 |

---

## 21. Architecture enforcement

### 21.1 既に存在する局所的enforcement（第一稿の「0件」を訂正）

| 機構 | 場所 | 何を守るか |
|---|---|---|
| **dashboard component contract test** | `features/staff-dashboard/components/dashboard-components.test.ts` | TypeScript AST走査で、componentからの**禁止import**（`repositories` / `dashboard-query` / `log-correction-workflow` / session hook 等）、**禁止call**、**`Date.now()` 禁止**、props契約を固定 |
| **staff i18n residual scan** | `scripts/staff-i18n-scan.ts` + `staff-i18n.test.ts` + `staff-i18n-baseline.json` | staff配下の**未管理日本語文言の検出**、baselineのstrict維持、対象root/共有ファイルの列挙 |
| **i18n dictionary完全性test** | `features/*/i18n.test.ts` / `staff-display.test.ts` / `staff-operation-error.test.ts` | ja/en辞書のキー網羅 |
| **payload固定テスト** | 各 `services/*.test.ts` | workflow→domain のpayload不変 |
| **遷移回帰スイート** | `test:transition-policy` / `test:transition-projections` | 遷移policy・projectionの挙動固定 |
| **Rules test** | `test:rules:transition` ほか | 権限境界 |
| **Emulator smoke** | `test:emulator:tank-cycle-binding` | cycle binding の実挙動 |
| **cutover test群** | `scripts/cutover/*.test.ts` | snapshot / reset / 検証 |

**Rule**: これらを**再実装しない**。新しい全体enforcementは、既存機構を**一般化する**形で追加する。

### 21.2 不足している全体横断enforcement

| 規則 | 現状 | 手段 |
|---|---|---|
| write SDK を `src/app/**` / component / hook から禁止 | dashboard配下のみ局所的に検査 | **ESLint `no-restricted-imports`（全体）** |
| domain → React / Next / browser API 禁止 | **なし。現行違反あり（§21.4）** | ESLint zone + architecture test |
| domain → locale / display boundary 禁止 | **なし。現行違反あり** | 同上 |
| operation → billing 禁止 | なし | ESLint |
| billing / analytics → write service 禁止 | なし | ESLint |
| feature間の直接import禁止 | なし（現行違反0） | ESLint zone |
| write owner表との整合 | なし | architecture test |
| public export surface の肥大化検出 | なし | architecture test |

**実現可能性**: ESLint は `no-restricted-imports` の zone 設定で大半を表現できる。残りは **既存の `dashboard-components.test.ts` と同じ TypeScript AST 走査の手法**をリポジトリ全体へ一般化すればよい（追加package不要。手法は実証済み）。

### 21.3 Rule: 規則と強制はセットで追加する

新しい architecture 規則を文書に追加するときは、**同じPRで強制手段（lint / test）も追加する**。強制手段のない規則は、規則ではなく願望として扱う。

### 21.4 現行mainで検出した設計 gap

2026-08-03 に main `71c191c` を再監査した。V1〜V6 / G2 / G3 / G10 の未解消箇所は次のとおり。

| # | 違反 / gap | 証拠 | 影響 / 是正方針 |
|---|---|---|---|
| **V1** | **domain/atomic writer が React hook module と browser API に依存** | `src/lib/tank-operation.ts:63` `import { getStaffLocale } from "@/hooks/useStaffSession"`、同 `:789` `window.confirm(buildTankRecoveryConfirmationMessage(...))` | §5.2 / §12.4 違反。domain から hook / locale / `window` を排除し、ADR-006 の confirmation resolver port へ移す |
| **V2** | domain が locale を暗黙に読む | `src/lib/tank-operation.ts:776` `const locale = getStaffLocale()` | 表示都合が atomic writer 内部に入り、pure test 性を下げる |
| **V3** | domain module にハードコード日本語（表示文言） | base `ac88da6` の `src/lib/customer-identity-read.ts:40,53` に加え、`src/lib/tank-operation.ts` の raw `Error` 17箇所（`:829,850,856,884,888,891,895,898,901,985,989,1145,1207,1312,1325,1601,1618`）。PR-10 の解消範囲と残件は後記 | PR-10 で当該19箇所を display boundary / coded error へ移した。template error・診断labelの残件は引き続きV3 |
| **V4-a** | **Staff dashboard correction role** | `src/app/staff/dashboard/page.tsx:7,78-79,188-190,195,205,222,240,267,336,368,470,473,767,783,787,802` / `src/features/staff-dashboard/services/log-correction-workflow.ts:8,23,30,39,46,63,75,86,93,107,123,141,151` / `firestore.rules:110-116` | ADR-007 により**削除する。code 化しない**。page から可否判定を pure policy へ移し、Rules の role bypass は別 PR で削除する |
| **V4-b** | **admin role の日本語文字列が permission code として機能** | `src/lib/firebase/operation-review-service.ts:212,231` `role !== "管理者"`、`staff.role` / `staffByEmail.role` の永続値、`settings/adminPermissions`、`firestore.rules:44,48` `staffRole() == "管理者"` / `"準管理者"` | §8.1 違反。admin access control に必要な role は code 化する。schema 問題なので data reset 前に解消する |
| **V5** | **保存値が日本語文字列** | `src/features/maintenance/services/damage-workflow.ts:26` `location: "倉庫"` ほか | §12.1 違反。表示ではなく保存 schema の問題 |
| **V6** | **`tanks` への非transactional write が stale guard を迂回** | `src/lib/firebase/tank-tag-service.ts` が `runTransaction` 外で `updateDoc`。caller は `src/features/staff-operations/services/bulk-return-workflow.ts:1` / `src/features/inhouse/services/inhouse-return-workflow.ts:3` | §2.2 の stale 操作拒否と §15 の partial success 禁止を迂回する |
| **G2** | legacy customer identity fallback | `src/features/staff-dashboard/queries/dashboard-read-model.ts:74,83,182,210` / `src/features/staff-operations/types.ts:70` / `src/features/staff-operations/queries/bulk-return-candidates.ts:98` | `isLegacy` / `legacy-location:` が残る。clean-break 後に strict resolver へ置換する |
| **G3** | 顧客名による単価解決 fallback | 根本: `src/lib/billing/invoice-candidate.ts:83,110,254,257` の `customersByName` / `resolvePricing`。表示への伝播先: `src/app/admin/billing/page.tsx:323` | `customerId` を持たない log に対する名前一致 fallback を削除する。ただし legacy log が存在する間は請求額を変えうるため、**P3-B（data reset）完了後の P4-B で実施する** |
| **G10** | error message の ja 優先経路 | `src/lib/staff-operation-error.ts:153,159` `locale === "ja"` | error catalog を display boundary へ移し、ja 優先経路を削除する |

**V1/V2 の是正方針**: [ADR-006](./adr/ADR-006-recovery-confirmation-port.md) のとおり confirmation resolver port を採用する。`getStaffLocale()` と `window.confirm()` を domain から排除し、resolver 未注入時は fail-closed とする。

**V3 PR-10（base `ac88da6`）**:

- 解消: `customer-identity-read.ts:40,53` の既定日本語2箇所を削除し、staff read-model の display boundary から既存ja labelを注入する形へ変更。`key`（`customer:${customerId}` / `legacy-location:${...}` / `__unknown__`）と `isLegacy` は不変
- 解消: `tank-operation.ts:829,850,856,884,888,891,895,898,901,985,989,1145,1207,1312,1325,1601,1618` の raw `Error` 17箇所を、locale非依存の `StaffOperationError` 16 code（`:1312,1325` は同一code）へ変更。ja表示は移動前と完全一致
- 未解消: `tank-operation.ts:565,595,862,873,900,921,954,961-963,981-982,1046,1083,1093,1097,1151,1204,1215,1240,1243-1244,1267,1271,1281,1286,1343,1354,1367,1414-1415,1422-1423,1458,1484,1497-1498,1505,1534,1536,1539,1542,1640,1663,1670,1744,1758,1775,1784` の template error / `message` / 診断label。PR-10の発注対象17箇所には含めず、条件式・validation helperの責務を変えないため残した
- scan: `scripts/staff-i18n-scan.ts` の明示対象に `tank-operation.ts` を追加し、文字列内の comment marker を維持したまま行・block comment token を検査前に除外する。再生成したbaselineは250件→111件（コメント由来189件を削除、上記V3残件47件とV5保存値 `"倉庫"` 3件を追加、net -139）。削除189件はcomment除去後の行に日本語が残らないことを機械確認済み

**V4 の是正方針**: Staff dashboard correction role は廃止する（V4-a、[ADR-007](./adr/ADR-007-staff-log-correction-authority.md)）。admin access control に必要な role だけを code 化する（V4-b）。admin operation review の管理者制限は維持する。

### 21.4.1 再監査 2026-08-03（main `71c191c`）

計測対象 SHA は `71c191c`。ベースラインは `npx tsc --noEmit` PASS、`npm test` は 88 files passed / 1 skipped、858 tests passed / 1 skipped。次の「解消済み」は**再実装しない**。

#### 解消済み（再実装不要）

| 項目 | 実測 |
|---|---|
| feature 間の直接 import | **0件** |
| operation → billing 依存 | **0件** |
| billing / analytics → write service 依存 | **0件** |
| `src/app/**` / `src/components/**` / `src/hooks/**` からの Firestore write SDK（`setDoc` / `updateDoc` / `addDoc` / `deleteDoc` / `runTransaction` / `writeBatch`） | **0件**。`src/components/StaffAuthGuard.tsx:14` は `collection, getDocs, query, where` の **read のみ**。`src/app/staff/mypage/page.tsx:5` は `import type { Timestamp }` の型のみ |
| action / status の code 化 | 済 |

#### 未解消（clean-break 実装は1つも着手されていない）

| Gap | 実測証拠（file:line） |
|---|---|
| P0-B enforcement | `eslint.config.mjs` は `nextVitals` + `nextTs` + `globalIgnores` のみ。`no-restricted-imports` 設定 **0件** |
| P0-C dev/prod 分離 | `.firebaserc` は `{"projects":{"default":"okmarine-tankrental"}}` のみ。`src/lib/firebase/config.ts` に emulator 接続（`connectFirestoreEmulator` 等）**なし** → **dev が本番 Firestore 直結** |
| P0-D supersede banner | `docs/**` の `.md` は 98件。うち約30件が冒頭6行に正本/supersede/historical 表記を持たない |
| V1 | `src/lib/tank-operation.ts:63` `import { getStaffLocale } from "@/hooks/useStaffSession"` |
| V2 | `src/lib/tank-operation.ts:776` `const locale = getStaffLocale()` |
| V1 本体 | `src/lib/tank-operation.ts:789` `window.confirm(buildTankRecoveryConfirmationMessage(...))` |
| V3 | base `ac88da6` の `src/lib/customer-identity-read.ts:40,53` と `src/lib/tank-operation.ts:829,850,856,884,888,891,895,898,901,985,989,1145,1207,1312,1325,1601,1618`（raw `Error` 17箇所）。PR-10で当該19箇所を解消し、template error・診断labelの残件は§21.4「V3 PR-10」に記録 |
| V4 | `StaffCorrectionRole = "管理者" \| "準管理者" \| "一般"`。参照: `src/app/staff/dashboard/page.tsx:7,78-79,188-190,195,205,222,240,267,336,368,470,473,767,783,787,802` / `src/features/staff-dashboard/services/log-correction-workflow.ts:8,23,30,39,46,63,75,86,93,107,123,141,151`。Rules: `firestore.rules:110-116` `correctionWindowAllows()` が `isAdminStaff()` を or 条件に持つ（＝管理者・準管理者は 72h 制限を bypass） |
| V5 | `src/features/maintenance/services/damage-workflow.ts:26` `location: "倉庫"` ほか |
| V6 | `src/lib/firebase/tank-tag-service.ts` が `runTransaction` 外 `updateDoc`。caller: `src/features/staff-operations/services/bulk-return-workflow.ts:1` / `src/features/inhouse/services/inhouse-return-workflow.ts:3` |
| G2 | `isLegacy` / `legacy-location:` が `src/features/staff-dashboard/queries/dashboard-read-model.ts:74,83,182,210` / `src/features/staff-operations/types.ts:70` / `src/features/staff-operations/queries/bulk-return-candidates.ts:98` に残存 |
| G3 | `src/lib/billing/invoice-candidate.ts:83` `const customersByName = buildCustomerNameIndex(customers);` / `:110` `resolvePricing(..., customersByName)` / `:254` `customersByName: Map<string, BillingCustomerMaster[]>` / `:257` `customersByName.get(displayName)` に名前一致の単価 fallback が残存。`src/app/admin/billing/page.tsx:323` は `bill.isLegacy` の表示への伝播先 |
| G10 | `src/lib/staff-operation-error.ts:153,159` `locale === "ja"` 優先経路 |
| custody model | `grep -rn "custody\|TankCustody" src/` = **0件**（未着手） |
| schemaVersion | `grep -rn "schemaVersion" src/` = **0件**（未着手）。`assertOfficialAggregationSchemaReady` は `src/lib/tank-transition-projections.ts:46` に存在 |
| P1-D inspection 制限 | `src/lib/tank-rules.ts` の `OP_RULES[ACTION.INSPECTION].allowedPrev = []`（コメント「リストから選択するため制限なし」）。`CODE_OP_RULES.inspection.allowedPrev = []` も同様で、**貸出中タンクへの耐圧検査が通る** |

再監査により、[clean-break-cutover-plan.md](./clean-break-cutover-plan.md) の Status ブロック（`Clean-break implementation: not started` 等）は main `71c191c` でも正しいことを確認した。

---

### 21.5 Firestore Rules の write 境界（target 設計）

**現行の問題**: `isValidTankUpdate` は `!isTankProjectionChanged()` を許可条件に含む。`isTankProjectionChanged()` は9個の hardcoded key を見るだけなので、**そのどれも変えない update は staff が無制限に通せる**（log なし・transaction なし・stale guard なし）。

これは **ESLint / architecture test では検出できない**種類の欠陥である。新しい field を追加したとき、Rules 側の list を更新しなければその field は恒久的に無防備になる。

**Rule（clean-break の target 設計）**:

- writable field を**明示列挙**する
- field set を Rules で検査する（`hasOnly()` による **deny-by-default**）
- custody の invalid combination を Rules で拒否する
- lifecycle projection field を operation transaction 以外から書けないようにする
- draft marker 用の例外（`isReturnTagMarkerOnlyUpdate`）を**削除**する（ADR-004）
- **application validation だけに依存しない**
- Rules と application の**両方**で invariant を守る

**Rule（運用）**: schema に field を追加する PR は、**同じ PR で Rules の field list を更新する**。分けると窓が開く。これは §6「Rules変更とapplication変更を混ぜない」に対する意図的な例外であり、cutover plan Phase 2 に記録している。


## 22. Clean-break data policy

**設計・実装しないもの**: 旧fieldのread/write、旧文字列検索、旧label→code変換fallback、dual read/write、migration/backfill、compatibility helper、deprecated fieldの型残置、旧形式parser、旧形式専用index

**実施すること**: Firestore を reset し新schemaで seed。test fixture も新schemaだけにする。

**削除対象として確定した legacy 経路**:

| 対象 | 場所 | 内容 |
|---|---|---|
| `location` → customer identity fallback | `customer-identity-read.ts` | `isLegacy` 分岐と `legacy-location:` グループ |
| 顧客名による単価解決 | `src/lib/billing/invoice-candidate.ts:83,110,254,257`（`customersByName` / `resolvePricing`） | `customerId` を持たない legacy log の名前一致検索。削除は請求額に影響しうるため、P3-B（data reset）完了後の P4-B で実施 |
| `isLegacy` の伝播 | `invoice-candidate.ts` / `dashboard-read-model.ts` / `bulk-return-candidates.ts` / `admin/billing/page.tsx` | 「旧形式」警告表示を含む |
| error message の ja 優先経路 | `staff-operation-error.ts:153,159` | catalog一本化（§12.3） |
| `location` field 自体 | schema全体 | custody model へ置換（§8.5） |
| Japanese な保存値 | `logAction: "受注貸出"` / `location: "倉庫"` 等 | code化（§12.1）。**表示ではなく保存値である点に注意** |
| Japanese な admin role 値 | `staff.role` / `staffByEmail.role` / `settings/adminPermissions` | code化（§12.7 V4-b）。staff log correction role は code 化せず削除（ADR-007） |

### 22.1 削除対象**ではない**もの（誤削除の防止）

次は legacy 互換に見えるが、**fail-closed の業務不変条件**である（§2.2）。clean-break で削除しない。

| 対象 | 誤解されやすい理由 | 実際の役割 |
|---|---|---|
| `assertOfficialAggregationSchemaReady`（`tank-transition-projections.ts:46`） | 「legacy log を扱う分岐」に見える | **逆**。`logKind` が欠落した log を「非tankだろう」と**推測せず**、invalid として集計を停止する。空請求書を作らないための fail-closed guard |
| `logKind !== "tank"` → invalid 判定（同:50） | legacy 判定に見える | 同上。schema必須化**後も**、欠落を invalid として拒否する分岐は維持する |

**Rule**: schema を必須化することと、欠落時の検査を削除することは**別**である。必須化しても検査は残す。

**§2.2 の業務不変条件は削除対象に入れない。特に logs の当時snapshot は維持する。**

---

## 23. PR design checklist

- [ ] このPRが変更する責務は1つか（表示 / 認証 / read / write / schema / 環境 / docs）
- [ ] 変更するfieldの write owner は表に載っているか
- [ ] atomicity 境界を跨いでいないか
- [ ] §2.2 の不変条件に触れるか。触れるなら業務要件から再評価したか
- [ ] 新しい抽象を導入したか。したなら現存する具体的な問題を説明できるか
- [ ] 共通化したか。したなら §18 の4条件を満たすか
- [ ] 新しい architecture 規則を足したか。足したなら強制手段も足したか
- [ ] 保存値に locale 依存が混入していないか（§12.1）
- [ ] test は §19 のどの層か。何を証明し、何を証明しないか
- [ ] rollback 単位として単独 revert 可能か

---

## 24. Forbidden patterns

- `action === "貸出"` のような日本語文字列による業務判定（現行0件。維持）
- error message 文字列の解析による分岐（§12.3）
- `staffName` / `customerName` / `location` を identity として使う
- **domain から React / Next / browser API / locale を import する**（現行違反 V1/V2）
- `tanks` に履歴や申請情報を詰め込む
- `logs` と `transactions` の責務を混ぜる
- 返却申請の時点で `tanks` / `logs` を動かす
- すべてのFirestore書き込みを1つの巨大serviceにまとめる
- page / component / hook からの write SDK 直呼び
- feature間の直接import
- `UniversalOperationService` / `BaseService` / `BaseRepository` / `DomainManager`
- 全moduleへのinterface / 全関数へのDI
- 1ファイル1関数という機械的ルール
- `common` / `utils` / `helper` / `manager` / `controller` という新規モジュール名
- 空のdomain directory / 形式だけのREADME / 中身のないinterface
- 先にファイルを移動し、後から責務を考えるリファクタ

---

## 25. Intentional exceptions

| 例外 | 理由 | 解消条件 |
|---|---|---|
| `submitTankEntryBatch` が独自に `runTransaction` | 新規tank作成は状態遷移ではない | 恒久的 |
| `tank-operation.ts` が大きい | 1つの変更理由で凝集 | §10.3 の4条件を満たすpure functionのみ抽出 |
| settings / master が薄い経路 | 高リスク操作ではない | 恒久的 |
| `tanks` が current state を持つ | 性能例外（§20） | 恒久的 |
| **domain が locale を読む（V1/V2）** | recovery確認ダイアログがdomain途中でユーザーへ問い合わせるため | **暫定**。§21.4 の方針で是正する |
| dev環境が本番Firestoreへ接続 | DB分離が未実施 | cutover campaign で分離 |

---

## 26. ADR / decision process

**Rule**: 次の変更は ADR を残す。

- architecture style の変更 / source of truth の変更 / write owner の変更
- atomicity 境界の変更 / §2.2 の不変条件の変更・削除
- §20 の性能例外の追加 / §25 の例外の追加・解消

**形式**: `docs/architecture/adr/NNNN-<slug>.md`。Context / Decision / Consequences / Alternatives considered。

**現在のADR候補**:

| # | 論点 | 節 |
|---|---|---|
| ADR-001 | tank identity（surrogate要否） | §8.2 |
| ADR-002 | custody model（flat / nested / 導出） | §8.5 |
| ADR-003 | rental cycle identity と idempotency key | §8.3 |
| ADR-004 | return tag draft の置き場所 | §9.1 |
| ADR-005 | billing finalization | §13.5 |
| ADR-006 | domain の locale 依存の是正方法 | §21.4 |

---

## 27. この設計で答えられること

| 質問 | 答え |
|---|---|
| 新しい貸出機能はどこへ追加するか | `features/staff-operations/services/` に workflow を新設 |
| 新しい返却条件はどこへ追加するか | 該当 return workflow + `tank-transition-policy.ts` |
| 新しいbillingルールはどこへ追加するか | `src/lib/billing/` + `settings/billingInvoice` |
| 新しい表示文言はどこへ追加するか | display boundary（`features/*/i18n.ts` 等）。domainには置かない |
| customer identityはどこにあるか | `customers/{customerId}` |
| staff identityはどこにあるか | `staff`（`staffByEmail`/`staffByUid` は index） |
| current tank stateはどこにあるか | `tanks`（projection。正本は logs） |
| historical operation eventはどこにあるか | `logs`。読むときは projection 経由 |
| portal requestはどこにあるか | `transactions` |
| どのmoduleがFirestoreへwriteできるか | [write-ownership.md](./write-ownership.md) |
| operationとbillingの境界はどこか | `logs` の projection（§13） |
| 一括操作のatomicityはどこで守るか | `tank-operation.ts` の単一 `runTransaction` |
| stale cycleはどこで拒否するか | `tank-operation.ts` の `expectedCycle` 照合 |
| errorはどう表現するか | code + params（§12.3） |
| どこを単体テストし、どこをEmulatorで確認するか | §19 |
| 文書とコードが矛盾したら何を正とするか | [document-authority.md](./document-authority.md) |
