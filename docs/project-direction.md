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
- 管理画面を業務領域ごとに再編し、画面定義の重複を減らす
- Firebase Auth の永続認証を前提に、認証復元と権限確認を安全かつ高速にする
- 現場アプリを App Shell と共有 read model により高速表示する
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

## 8. Post-Structure Product Goals

以下は、`docs/architecture/refactor-sequence.md` が定める現在進行中の構造化 sequence（PR-01〜PR-12）完了後に着手する長期目標とする。現在の sequence へ実装を混ぜず、着手時に個別設計と影響範囲を確定する。

### 8.1 Admin UI Reorganization

- 管理画面のページを、顧客、タンク、受注、請求、売上、スタッフ、設定などの業務領域で分類する
- Route、Feature、Navigation が同じ業務領域定義を共有できる構成にする
- サイドバー、ページ権限、ページタイトルなどに重複している定義を減らす
- 開発者向け・診断向け画面は、通常の業務メニューから分離する
- 基本オペレート以外の画面も、構造化完了後に業務領域と利用動線を確認して UI を再設計する

### 8.2 Authentication Performance

- Firebase Auth の永続認証を通常の前提とし、不要な再ログインを求めない
- 認証済み UID からスタッフ情報を1件取得する経路を通常経路とする
- メール検索や UID の紐付け処理は、初回設定または復旧時の経路に限定する
- 認証復元中も、安全に表示できる範囲で App Shell を先に表示する
- 権限確認が完了するまでは、業務データへの書き込みを許可しない

### 8.3 Fast Field-App Rendering

- 現場アプリは App Shell を先に表示し、操作可能になるまでの体感待ち時間を短くする
- キャッシュ済み read model を先に表示し、その後 Firestore の最新値へ同期する
- `tanks` など複数画面で使う共通データは staff layout 配下で共有し、画面遷移ごとの全件再取得を避ける
- 表示用キャッシュと、書き込み直前に行う最新状態の検証を分離する
- `logs` や `transactions` は、画面に必要な条件、期間、件数へ絞って取得する

### 8.4 Code and Data Simplification

- 1つの業務操作につき、書き込み経路を1本にする
- 業務上の正本、監査用 snapshot、派生値、UI 一時状態を明確に区別する
- Firestore には、業務上の正本と必要な監査用 snapshot のみを保存する
- caller が存在しないことを検索・型検査・テストなどで機械的に確認できたコードだけを削除する
- 不要な legacy fallback や旧 field は、read 側の移行完了と依存解消を確認した後に削除する
- 巨大な汎用 service は作らず、業務別 workflow の境界を維持する

### 8.5 Delivery Boundaries

- 管理画面 UI、認証、read model、schema 整理は、それぞれ独立した PR として設計・実装する
- 各 PR は、表示、認証、読み取り、書き込み、データ保持のどの責務を変更するかを明示する
- この長期目標の記録を理由に、現在の PR-01〜PR-12 の順序、責務境界、挙動不変条件を変更しない
- 長期目標の実装開始前に、現行依存、移行条件、rollback 境界、検証方法を個別に確定する

## 9. Implementation Order

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

この実装順序と、`docs/architecture/refactor-sequence.md` の構造化 sequence は役割が異なる。構造化 sequence の PR-01〜PR-12 を完了した後、§8 の長期目標を個別 PR へ分解して着手する。UI 変更、認証変更、read model 変更、schema 整理を同一 PR にまとめない。

関連する詳細文書:

- `docs/firestore-data-model-policy.md`
- `docs/return-flow-policy.md`
- `docs/implementation-roadmap.md`
- `docs/design/data-model-source-of-truth.md`
- `docs/refactor/firestore-write-boundary-audit.md`
