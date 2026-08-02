# Admin情報設計

- Status: **Authoritative for Admin navigation and screen grouping**
- Updated: 2026-08-02
- Permission authority: [admin-capability-permissions.md](./admin-capability-permissions.md)
- Settings authority: [admin-settings-source-of-truth.md](./admin-settings-source-of-truth.md)

## 1. 目的別のトップレベル構造

管理者が画面を開く目的を、次の4種類に分ける。

| 目的 | UI上の配置 | 内容 |
|---|---|---|
| 現在を確認する | ダッシュボード | 要対応、現場対応待ち、今日の状況、分析入口 |
| 溜まった処理に対応する | 対応 | レビュー、請求 |
| 期間・履歴を分析する | 分析 | 売上、スタッフ実績 |
| マスタを登録・変更する | 管理 | 取引先、スタッフ、発注品目 |

設定と開発者ツールは日常ナビに重複表示せず、サイドバー下部の設定launcherから開く。

## 2. サイドバーの正本

ページ、表示名、icon、group、順序、route、active判定、capability、visibility、badgeの正本は
`src/lib/admin/adminPagesRegistry.ts` とする。desktopとmobileは同じ
`AdminSidebarContent`を利用し、別のナビ配列を持たない。

表示順:

```text
ダッシュボード

対応
  レビュー
  請求

分析
  売上
  スタッフ実績

管理
  取引先
  スタッフ
  発注品目
```

サイドバー下部の常設操作は、アプリ切替、設定、ログアウトの3 iconだけとする。
氏名、メール、avatar、initial、role、rankなどのログイン情報は表示しない。

## 3. 統合管理領域

- 取引先: `顧客` と `ポータル利用者` を別tableのまま同じtab領域に置く。
- スタッフ: `担当者`、`権限`、`報酬・ランク` を同じtab領域に置く。
- 各tabは対応するview capabilityで絞る。一つだけならtab barを省略する。
- 全tabが利用不可の場合は説明付きfallbackを表示し、白紙にしない。
- 旧routeは維持する。統合サイドバー項目は、利用可能な先頭tabへ解決する。

顧客固有料金は顧客マスタの属性であり、システム設定へ移動しない。
スタッフ報酬・操作単価・rank条件は請求設定ではなく、スタッフ領域で扱う。

## 4. ダッシュボード

ダッシュボードは詳細分析を再実装せず、信頼できる既存readの状況値と入口を示す。

- 要対応: 例外操作レビュー、請求
- 現場対応待ち: 受注・返却処理、未充填報告（現場アプリを別tabで開く）
- 今日の状況: 本日の操作、貸出中、稼働スタッフ
- 分析サマリー: 売上、スタッフ実績への入口

存在しない請求件数などは作らない。個別readの失敗は `—` とし、他sectionを壊さない。
保存済みの状態遷移modeが既定の `strict` でない場合は警告を表示する。

## 5. 設定と開発者ツール

- システム設定は`業務ルール`、`通知`、`運用制御`の3 tabに統合する。
- 開発者ツールは`状態遷移図`と`Security Rules`のtab領域とし、日常sidebarへ置かない。
- tabはview capabilityで絞り、一つだけならtab barを省略する。
- Security Rulesは専用capabilityがない利用者に存在自体を表示しない。
- 詳細な分類、write権限、耐圧検査設定の正本は[Admin設定と正本](./admin-settings-source-of-truth.md)に従う。

## 6. レスポンシブとaccessibility

- desktop: 244px、縮小時72pxの固定sidebar。
- mobile: 固定top barとdrawer。`main`内にhamburgerを置かない。
- drawerはoverlay、Escape、route変更で閉じる。明示操作で閉じた後はtriggerへfocusを戻す。
- icon buttonは44px以上、`aria-label`、tooltip、focus-visibleを持つ。
- popoverはEscapeと外側clickで閉じ、triggerへfocusを戻す。
- logoutはdestructive confirmation後だけ実行する。

## 7. 変更境界

この情報設計は、既存のFirestore read/write、billing計算、Firebase Auth、状態遷移、
operation logの業務意味を変更しない。view capabilityしか持たない画面ではwrite controlを
表示または有効化せず、管理capabilityを持つ利用者だけが既存serviceを呼ぶ。
