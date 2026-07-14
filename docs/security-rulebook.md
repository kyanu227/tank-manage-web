# 認証・権限ルールブック

この文書は認証・Firestore Rules の方針書。現行mainの実装状態と、未実装/未deployの予定を分けて記録する。

## 現行main

- 管理画面は `AdminAuthGuard` で保護する。
- スタッフ画面は `StaffAuthGuard` で保護する。
- スタッフはパスコードログインを継続している。
- スタッフ/管理者の権限情報は `staff` と `staffByEmail` を基準にする。
- 顧客ポータルは Firebase Auth + `customerUsers/{uid}` を基準にする。画面内の互換 session として localStorage `customerSession` も保存する。
- Email/Password provider は Firebase Console で有効化済み。
- `portal/order` は旧 `customerSession` 方式のまま、`deliveryType` / `deliveryTargetName` / `note` などの delivery metadata を `transactions` に保存する。
- `customerUsers` の create/read/update は 2026-04-29 の本番確認で通過済み。

## Rules deploy状態

- `firebase.json`は`firestore.rules`へ接続済み。
- 現在の本番Rulesは2026-06-02 release（commit
  `b7e853c8f38071937951b871cbe0e3281dd22876`）としてRules APIでread-only確認済み。
- 2026-05-08のdeploy結果は履歴記録であり、現在のrollback正本ではない。
- 2026-06-02 release以後の状態遷移Rules差分は未deployであり、別のRules-only operationが必要。
- 通常Hosting deployへRulesを混ぜない。
- `customerUsers.customerId` / `customerUsers.customerName` / `disabled` の管理者運用と Rules 制御は次フェーズでレビューする。

## Firestore Rules 方針

- 通常 deploy は `firebase deploy --only hosting` のみ。
- Rules変更はstaff、portal、customerUsers、管理者権限のEmulator testと専用deploy手順をセットでレビューする。
- code上のRulesと本番releaseを同一視せず、deploy日時・commit・smoke結果を記録する。
- transition cutoverではdedicated freeze Rulesを一時利用するが、server/Admin/REST writerはIAMで別停止する。

## 2026-04-29 本番確認メモ

- `a2c2f0d feat: migrate portal auth to firebase auth and customerUsers` は Hosting deploy 済み。
- Email/Password 新規登録は成功。
- `customerUsers/{uid}` の作成、読み取り、setup 更新は現行本番環境で成功。
- setup 保存は `selfCompanyName` / `selfName` / `lineName` / `setupCompleted` / `updatedAt` のみを更新する。
- `status` は保存せず、`computeCustomerUserStatus` による派生値として扱う。
- 顧客自身の setup から `customerId` / `customerName` / `disabled` は保存しない。
- 旧 `customers.passcode` 経路は Phase 0 で廃止済み。
- 確認用 Auth user と `customerUsers` doc は Firebase Console から手動削除済み。
- `firestore.rules` はこの確認では deploy していない。

## 次に必要な作業

1. 2026-06-02本番release以後の`firestore.rules`差分を正式レビューし、Rules-only deploy手順を確定する。
2. `customerUsers.customerId` / `customerUsers.customerName` / `disabled` の管理者更新権限を Rules と service 境界で設計する。
3. 管理画面で `staff` と `staffByEmail` の同期を安定させる。
4. スタッフのパスコードログインを残す範囲を決める。
5. transition cutoverは`docs/cutover/transition-plan-v1-runbook.md`に従い、freeze/normal RulesとHostingを分離する。
