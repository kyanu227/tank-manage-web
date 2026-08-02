# Admin capability権限モデル

- Status: **Authoritative for Admin UI authorization**
- 適用日: 2026-08-02
- 実装正本: `src/lib/admin/adminCapabilities.ts` / `src/lib/admin/adminPagesRegistry.ts`
- 保存正本: `settings/adminPermissions.capabilities`

## 1. 原則

Adminの機能概念とURLを分離する。URLはrouteの場所であり、権限の意味ではない。
認証後のroute、ナビ、タブ、セクション、操作は、型付きcapabilityで判定する。

- 管理者は全capabilityを持つ。
- 準管理者は`settings/adminPermissions.capabilities`で明示されたcapabilityだけを持つ。
- document不在、malformed、未知capability、registry未登録routeはfail-closedとする。
- Admin registryがpage ID、表示名、icon、group、順序、URL、active判定、必要capability、visibility、sidebar表示、admin/developer属性、badge種別の正本である。
- UI capabilityはFirestore Rulesを上書きしない。Rules上管理者限定のwriteは、manage capabilityのUI制御に加えて既存service/Rulesでも拒否する。

## 2. 保存schema

```text
settings/adminPermissions
  capabilities: {
    "dashboard.view": ["管理者", "準管理者"],
    "analytics.sales.view": ["管理者", "準管理者"],
    ...
  }
  updatedAt: ISO-8601 string
```

新規保存は`capabilities`だけを書き、旧`pages`との二重writeをしない。

## 3. 旧path権限との互換

旧documentが`pages`だけを持つ場合、read時に
`LEGACY_ADMIN_PATH_CAPABILITY_MAP`で決定的にcapabilityへ変換する。

- 旧pathはruntime正本にしない。
- 未登録pathは無視して権限へ変換せず、設定画面で件数を表示する。
- 旧adminOnly/developerOnly pathは準管理者capabilityへ変換しない。
- `/admin/customers`は、従来child routeも通したため`customers.view`と
  `customerPortalUsers.view`へ変換する。
- 次回保存時はcapability schemaだけになり、明示的一括migrationや本番データ自動削除は行わない。

## 4. 機密機能とread-only

権限設定とSecurity Rulesは存在自体が機密である。対応するview capabilityがない利用者には
ナビ、launcher、route内容を表示しない。

現在の運用モードや耐圧検査値は業務上参照する意味があるため、view capabilityとmanage
capabilityを分離し、必要に応じてread-only表示する。manage capabilityがあっても、既存Rulesが
管理者限定にしているwriteを準管理者へ拡張しない。

## 5. Firebase影響

`adminPermissions`はAdmin UI gateの設定であり、Firestore Rulesはこのdocumentのpage/capability
内容を参照しない。本移行ではRules、indexes、Functionsを変更しない。既存collectionごとの
write制約が最終防衛線のままである。
