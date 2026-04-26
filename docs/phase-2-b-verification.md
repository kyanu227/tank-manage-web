# Phase 2-B 本番確認メモ

## 確認日
2026-04-26

## 確認画面
- staff/dashboard:
- staff/orders:
- portal:
- admin:
- admin/billing:
- admin/sales:

## 見つかった問題
- なし / あり

## 対応方針
-

---

## 補助情報（確認時の参考）

本番URL: https://okmarine-tankrental.web.app

Phase 2-B 完了範囲: Phase 2-B-1 〜 2-B-12（21 箇所の読み取りを repository 経由に集約）。書き込みロジックは原則無変更（Phase 2-B-12 のみ書き込み参照先表記が `d.ref` → `doc(db, "transactions", item.id)` に変わっている）。

### 確認の観点
1. **表示データ**: 件数・並び順・内容が従来と同じか
2. **ローディング表示**: 表示崩れがないか
3. **エラーメッセージ**: 文言が変わっていないか（「タンクが存在しません」「履歴取得エラー」「保存エラー」など）
4. **書き込み処理の完走**: 受注承認・返却承認・一括返却・顧客紐付け確定が最後まで通るか

### 画面と確認 path

#### staff/dashboard（重要）
- URL: `/staff/dashboard`
- 重点: ログ一覧（active logs を `originalAt ?? timestamp` 降順で 50 件）、履歴ドリルダウン（rootLogId 単位）、KPI（受注/返却待ち件数）、貸出先候補（一括変更モーダル）
- 関連: Phase 2-B-10a（fetchData）, 2-B-10b（toggleHistory）

#### staff/orders（重要）
- URL: `/staff/orders`
- 重点:
  - 受注タブ: pending / pending_approval / approved の 3 並列取得 → createdAt desc
  - 返却承認タブ: type=return + status=pending_approval、customerId 単位グルーピング
  - 一括返却タブ: status in [貸出中, 未返却]、location 単位グルーピング
- 関連: Phase 2-B-7（getOrders）, 2-B-8a/8b（getReturns + getTank）, 2-B-11（statusIn）

#### portal
- URL: `/portal`, `/portal/return`, `/portal/unfilled`
- 重点: 自分の貸出中タンク一覧（location マッチ）、返却対象選択（lentAt 昇順）、未充填報告
- 関連: Phase 2-B-6（portal 3画面の tanks 重複クエリ統一）

#### admin（管理ダッシュボード）
- URL: `/admin`
- 重点: 4 KPI カード（本日の操作・貸出中・稼働スタッフ・要対応）
- 関連: Phase 2-B-9（getActiveLogs + getTanks + getPendingTransactions）

#### admin/billing
- URL: `/admin/billing`
- 重点: 月次貸出件数集計（active logs ベース）
- 関連: Phase 2-B-2

#### admin/sales
- URL: `/admin/sales`
- 重点: 売上集計（limit 3000、月次集計）、過去の月間実績タブ（monthly_stats、Phase 2-B 対象外）
- 関連: Phase 2-B-4

### サブで確認しておくと安心な画面

| 画面 | URL | フェーズ |
|---|---|---|
| staff/mypage | `/staff/mypage` | 2-B-3（自分の操作履歴 100 件） |
| admin/staff-analytics | `/admin/staff-analytics` | 2-B-5（スタッフ実績ランキング） |
| admin/settings ポータル利用者タブ | `/admin/settings` | 2-B-12（顧客紐付け確定 + pending_link → pending_approval 昇格） |

### 不具合発生時の特定手順

1. 画面と挙動を記録
2. ブラウザ DevTools の Console / Network タブで Firestore リクエストを確認
3. クエリ条件（where 句）が想定と一致するか確認
4. このメモに「見つかった問題」として記録
5. 該当フェーズ（コミットハッシュ）を `progress.md` で確認
6. ロールバックが必要なら `git revert <commit>` で個別フェーズだけ戻せる

### Phase 2-B コミット一覧（ロールバック用）

```
250d54d docs: add customer data model redesign guide for S-2 phase
4233c8b docs: reorganize data layer migration plan after phase 2-b completion
d97b63b refactor: complete phase 2-b read migration
110df60 refactor: migrate pending link transaction reads to repository       ← Phase 2-B-12
fefcb5f refactor: migrate bulk return reads to tanks repository              ← Phase 2-B-11
1f186ae refactor: migrate staff dashboard history reads to repositories       ← Phase 2-B-10b
e3bfd37 refactor: migrate staff dashboard summary reads to repositories       ← Phase 2-B-10a
9730838 refactor: migrate admin dashboard reads to repositories               ← Phase 2-B-9
1015c37 refactor: migrate return approval reads to repositories               ← Phase 2-B-8
b8f5843 refactor: migrate order reads to transactions repository              ← Phase 2-B-7
b6d82d2 データレイヤー Firestore 直接アクセスを repository 層へ移行 (Phase 1〜2-B-6) ← Phase 2-B-1〜6
```
