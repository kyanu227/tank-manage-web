# Project Direction

## 1. Purpose

このプロジェクトの目的は、タンク管理業務を安全に拡張できる構成へ整理すること。

単に目の前の不具合を直すのではなく、Firestore のデータ責務とコード責務を整理し、将来の英語対応、共同作業者、報酬分割にも耐えられる基盤を作る。

判断基準は「今動くか」だけではなく、次の変更で壊れにくいか、影響範囲を追えるか、業務上の正本がどこか説明できるかに置く。

## 2. Current Focus

現在の重点は以下。

- `tanks` データ整理
- 返却フローの見直し
- `tanks` / `logs` / `transactions` の責務分離
- 返却タグ、`condition`、`logNote` の扱いの明確化
- 直接 Firestore 書き込み経路の整理準備

ただし、最初の実装で `tanks.customerId` を追加したり、`tanks.location` の意味を変えたりしない。現行ポータルは `tanks.location == customerName` に依存しているため、ここから正規化に入ると返却、顧客画面、請求系の読み込みを壊しやすい。

## 3. Long-Term Goals

- コード構造化を完成させる
- Firestore に保持するデータを簡素化する
- 状態遷移を一貫させる
- 返却フローを安定させる
- 日本語文字列や表示名に依存しない構成へ移行する
- 英語で基本操作できる多言語対応を実装する
- 共同作業者と報酬分割を実装する
- 操作履歴、売上、請求、スタッフ実績を安定して集計できるようにする

## 4. Non-Goals for the First Phase

最初のフェーズでは以下を行わない。

- `src` 配下の大規模リファクタリング
- Firestore schema の実変更
- `tanks.customerId` の追加
- `tanks.location` の意味変更
- `logs` / `transactions` の書き込み形式変更
- 多言語対応の実装コード追加
- 共同作業者・報酬分割の実装コード追加
- migration / backfill script の作成
- Security Rules や Firebase 設定の変更

このプロジェクトは実運用前のため、最終的な正しい schema に寄せる段階では不要な legacy backfill を前提にしなくてよい。ただし、既存コード依存を無視して一括変更してよいという意味ではない。現行依存を把握し、壊れやすい場所を避けて段階的に進める。

## 5. Data Design Principles

- `tanks` は現在状態のスナップショットを持つ
- `logs` は操作履歴の正本を持つ
- `transactions` は顧客起点の注文、返却申請、未充填報告などの業務フローを持つ
- `customers` は貸出先・請求単位のマスタとして扱う
- `staff` は操作主体のマスタとして扱う
- `staffName` / `customerName` は表示用 snapshot として扱う
- 長期的には `staffId` / `customerId` / action code / status code を業務ロジックの正本にする
- `location` 文字列、顧客名、スタッフ名、日本語ラベルを正本 identity として新規設計しない

正本と snapshot は分ける。snapshot は過去表示や監査には必要だが、検索、請求、権限、状態遷移の正本にはしない。

## 6. Code Architecture Principles

目標とする責務分担は以下。

| Layer | Responsibility |
|---|---|
| page | 表示とイベントハンドリング |
| hook | session / identity / UI state の取得 |
| workflow / use-case | 貸出、返却確定、受注貸出などの業務手順 |
| domain service | `tank` / `log` / `transaction` を一貫して更新する業務ロジック |
| repository | Firestore query / add / update helper |

repository に業務判断を入れない。page や hook から Firestore へ直接書き込む経路は、段階的に workflow / domain service へ寄せる。

ただし、すべての Firestore 書き込みを巨大な1つの service にまとめない。業務単位で責務を分け、`applyBulkTankOperations` のような atomicity が必要な境界は維持する。

## 7. Future Features

将来的に実装したい機能は以下。

- 英語での基本操作
  - `lend`
  - `return`
  - `fill`
  - `inhouse_use`
- 共同作業者
- 報酬分割
- 操作履歴・売上・請求・スタッフ実績の安定集計

これらは基盤整理後に実装する。多言語対応は単なる画面ラベル置換ではなく、業務ロジックから日本語文字列依存を外した後に進める。共同作業者と報酬分割は、actor / customer / action / status が安定してから設計する。

## 8. Implementation Order

順序は以下を原則にする。

1. 方針 docs を固定する
2. 返却タグと `condition` の変換を純粋関数へ集約する
3. 返却申請と返却確定の境界を明確にする
4. actor / customer / action / status の identity context を安定させる
5. `logs` / `transactions` の actor field を名前だけにしない
6. 内部ロジックを action code / status code へ寄せる
7. 英語対応を実装する
8. 共同作業者・報酬分割を設計する
9. 旧 field 依存や不要 helper を掃除する

この順序にする理由は、返却フローと identity が安定しないまま多言語化や報酬分割へ進むと、表示名・日本語ラベル・`location` 文字列に依存した設計が固定化されるため。

関連する詳細文書:

- `docs/firestore-data-model-policy.md`
- `docs/return-flow-policy.md`
- `docs/implementation-roadmap.md`
- `docs/design/data-model-source-of-truth.md`
- `docs/refactor/firestore-write-boundary-audit.md`
