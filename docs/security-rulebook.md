# 認証・権限ルールブック

この文書は認証・Firestore Rules の方針書。現行mainの実装状態と、未実装/未deployの予定を分けて記録する。

## 現行main

- 管理画面は `AdminAuthGuard` で保護する。
- スタッフ画面は `StaffAuthGuard` で保護する。
- スタッフはパスコードログインを継続している。
- スタッフ/管理者の権限情報は `staff` と `staffByEmail` を基準にする。
- 顧客ポータルは localStorage `customerSession` を使う既存方式を継続している。
- `portal/order` は旧 `customerSession` 方式のまま、`deliveryType` / `deliveryTargetName` / `note` などの delivery metadata を `transactions` に保存する。
- `customerUsers` は既存コレクションとして扱うが、portal login/register/setup の Firebase Auth + `customerUsers` 完全移行は未実装・未commit。

## 未実装 / 未deploy

- `src/lib/firebase/customer-user.ts` は portal Auth / customerUsers 移行用の未commit WIP が存在する場合がある。現行mainの本番実装として扱わない。
- 顧客ポータルの Firebase Auth 本番化は未完了。
- 旧 `customers.passcode` / passcode 方式の廃止は未完了。
- `firestore.rules` は下書き扱いで未deploy。
- `firebase.json` に `firestore.rules` を接続しない。
- `firebase deploy --only firestore:rules` は実行しない。

## Firestore Rules 方針

- 通常 deploy は `firebase deploy --only hosting` のみ。
- Rules 本番化は、スタッフのパスコードログイン、portal Auth、customerUsers、管理者権限の設計をまとめてレビューしてから行う。
- 現行のまま厳格な Rules を有効化すると、Firebase Auth を通らないスタッフ/顧客フローが permission-denied になる可能性がある。
- Rules 案を docs や下書きとして管理する場合も、deploy 済みと書かない。

## 次に必要な作業

1. portal Auth / customerUsers 移行を本番化するか判断する。
2. 移行する場合は、旧 `customerSession` / `customers.passcode` 互換、`customerUsers` 作成、Firestore Rules を一括で設計する。
3. 管理画面で `staff` と `staffByEmail` の同期を安定させる。
4. スタッフのパスコードログインを残す範囲を決める。
5. Rules 本番化前に `firebase.json` の接続方針と deploy 手順をレビューする。
