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

## 未実装 / 未deploy

- `firestore.rules` は下書き扱いで未deploy。
- `firebase.json` に `firestore.rules` を接続しない。
- `firebase deploy --only firestore:rules` は実行しない。
- `customerUsers` のセキュリティ制御は、現時点では本番 Rules として正式レビュー・deploy していない。
- `customerUsers.customerId` / `customerUsers.customerName` / `disabled` の管理者運用と Rules 制御は次フェーズでレビューする。

## Firestore Rules 方針

- 通常 deploy は `firebase deploy --only hosting` のみ。
- Rules 本番化は、スタッフのパスコードログイン、portal Auth、customerUsers、管理者権限の設計をまとめてレビューしてから行う。
- 現行のまま厳格な Rules を有効化すると、Firebase Auth を通らないスタッフ/顧客フローが permission-denied になる可能性がある。
- Rules 案を docs や下書きとして管理する場合も、deploy 済みと書かない。

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

1. `firestore.rules` の正式レビューと本番 deploy 手順を確定する。
2. `customerUsers.customerId` / `customerUsers.customerName` / `disabled` の管理者更新権限を Rules と service 境界で設計する。
3. 管理画面で `staff` と `staffByEmail` の同期を安定させる。
4. スタッフのパスコードログインを残す範囲を決める。
5. Rules 本番化前に `firebase.json` の接続方針と deploy 手順をレビューする。
