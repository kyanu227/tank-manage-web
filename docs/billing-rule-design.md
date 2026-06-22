# Billing Rule Design

## 目的

請求管理は、Firestore に保存された操作履歴から月次の請求候補を作り、顧客別単価・返却タグ・税率・端数処理・請求書文言を管理画面設定で反映する。

今回の実装は請求確定ではない。`monthlyInvoices` への保存、請求書番号の永続採番、入金管理は後続フェーズで扱う。

## 顧客正本

顧客の正本は `customers/{customerId}` とする。

- `customerId`: 請求単価・将来の請求単位の参照正本
- `customerName`: 表示 snapshot
- `location`: 旧データや表示用の貸出先名 fallback

請求候補はまず `customerId` で顧客マスタを解決し、`customerId` がない legacy log は `customerName` / `location` の一致で単価を補助解決する。曖昧な場合は単価未設定 warning として 0 円候補にする。

## 請求対象 action

月次請求の source は active な貸出ログだけに限定する。

- `lend`
- `order_lend`
- legacy `貸出` / `受注貸出`

返却系ログは請求 source ではなく、貸出後の補助情報として紐付ける。

## 対象外 action

以下は請求 source にしない。

- `return`
- `return_unused`
- `return_uncharged`
- `carry_over`
- `fill`
- inhouse 系
- damage / repair / inspection / dispose
- procurement / supply_order
- `superseded` / `voided` log

## 返却タグ請求ルール

請求候補は同一 tank の貸出後最初の返却系ログを参照する。

- `return`: 通常請求
- `return_unused`: `unusedReturnBillingMode` に従う
- `return_uncharged`: `unchargedReturnBillingMode` に従う
- `carry_over`: 貸出自体は通常請求し、持ち越し追加請求は別 line item として扱う

返却タグの請求モード:

- `charge`: 通常請求
- `free`: 請求額を 0 円にする
- `discount`: 設定された割引率を適用する

## 持ち越し請求ルール

`carryOverBillingMode` は以下を持つ。

- `no_extra`: 追加なし
- `monthly_extra`: `carryOverMonthlyExtraPrice` を持ち越しごとに追加
- `daily_extra`: 日数計算の正本が未確定のため、現時点では warning として未適用

日額追加の厳密な計算は、持ち越し期間の正本を決めてから実装する。

## 顧客別単価

単価は `customers` collection の以下を使う。

- `price10`
- `price12`
- `priceAluminum`

現時点ではタンク種別 field が正本化されていないため、請求候補の category は全件 `steel10` とする。型と明細は `steel10` / `steel12` / `aluminum` に分けられる形で保持し、将来 `tanks.capacity` や `tanks.material` を導入できるようにする。

## 税・端数処理

税設定は `settings/billingInvoice` に保存する。

- `taxMode`: `exclusive` / `inclusive` / `none`
- `taxRate`: 0 から 1
- `roundingMode`: `floor` / `round` / `ceil`

請求計算 helper は `taxBreakdown[]` を返す。現時点では 10% の単一税率だが、将来複数税率に拡張できる形を維持する。

## インボイス表示

請求書には以下を表示する。

- 宛先
- 発行者名
- 登録番号
- 発行日または対象月末日
- 取引内容
- 税率ごとの対価額
- 税率ごとの消費税額
- 合計

登録番号が空で `showRegistrationNumberWarning` が true の場合は、設定画面と請求書 preview に warning を出す。表示ラベルは `登録番号` とし、`TT番号` とは表示しない。

## Invoice Candidate

請求画面の中間モデルとして `InvoiceCandidate` を使う。

- `sourceLogIds`
- `lineItems`
- `subtotal`
- `discountTotal`
- `taxBreakdown`
- `tax`
- `total`
- `warnings`

これは将来 `monthlyInvoices` に保存する snapshot の元になる。ただし今回のフェーズでは保存しない。

## Legacy fallback

既存表示が消えないよう、`customerId` がない log は `customerName` / `location` で fallback する。ただし、顧客マスタを一意に解決できない場合は 0 円候補と warning にする。

## Out of Scope

今回やらないこと:

- `monthlyInvoices` collection への保存
- 請求確定ボタン
- 請求書番号の永続採番
- paid / unpaid 管理
- PDF ライブラリ追加
- メール送信
- LINE 送信
- tank type からの完全な 10L / 12L / aluminum 自動分類
- Firestore Rules 変更
- Firestore index 変更
- Firestore direct edit
- migration / backfill
- package 変更
- `firebase.json` 変更
