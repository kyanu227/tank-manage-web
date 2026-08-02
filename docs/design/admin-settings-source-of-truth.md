# Admin設定と正本

- Status: **Authoritative for Admin settings classification and inspection settings source of truth**
- 適用日: 2026-08-02
- 権限正本: [admin-capability-permissions.md](./admin-capability-permissions.md)
- 情報設計正本: [admin-information-architecture.md](./admin-information-architecture.md)

## 1. 設定の分類

設定launcherから開く日常設定は、次の3 tabに固定する。

| tab | route | 内容 | write権限 |
|---|---|---|---|
| 業務ルール | `/admin/settings` | ポータル自動返却時刻、耐圧検査有効年数、耐圧検査告知月数 | 管理者のみ |
| 通知 | `/admin/notifications` | メール通知先、LINE設定、通知対象 | 管理者のみ |
| 運用制御 | `/admin/settings/tank-operations` | タンク状態遷移モード | 有効な管理者のみ |

各tabは対応するview capabilityを持つ準管理者にも参照専用で表示できる。manage
capabilityを誤って持っていても、roleが`管理者`でなければUIからwriteしない。Firestore
serviceとRulesの既存admin検証を最終防衛線として維持する。

旧`/admin/settings/portal`と`/admin/settings/inspection`は互換routeとして残し、
`/admin/settings`へredirectする。

## 2. 耐圧検査設定の唯一の正本

Firestore上の唯一の正本は`settings/inspection`である。

| field | default | validation |
|---|---:|---|
| `validityYears` | 5 | 1〜20の整数 |
| `alertMonths` | 6 | 1〜24の整数 |

型、既定値、範囲、normalize、validationのコード正本は
`src/lib/inspection-settings.ts`とする。管理画面、`admin-settings.ts`、
`useInspectionSettings`はこの定義を再利用し、別のdefaultや検証を持たない。

## 3. notifySettingsのlegacyフィールド

`notifySettings/config`に過去保存された`alertMonths`と`validityYears`が存在しても、runtimeは
読まず、通知設定の保存payloadにも含めない。`setDoc(..., { merge: true })`により既存値を
削除・上書きしない。

- 一括migrationを行わない。
- 本番legacyデータを自動削除しない。
- 通知設定が保存するシステムfieldは`emails`と`updatedAt`だけとする。
- LINE設定は従来どおり`lineConfigs`を正本とする。

## 4. 運用制御

状態遷移モードは危険設定として扱う。

- 保存値、実行値、policy revisionを常時表示する。
- 既定の`strict`以外は警告する。
- 変更前、変更後、影響を示す独自確認dialogを通した場合だけ保存する。
- `expectedPolicyRevision`、管理者staff照合、rollout gate、read失敗時strict fallbackを維持する。
- 保存失敗を成功表示に変換しない。
- 状態遷移図への参照リンクを表示する。

## 5. 開発者ツール

開発者ツールは日常sidebarへ置かず、設定launcherから開く。

| tab | route | visibility |
|---|---|---|
| 状態遷移図 | `/admin/state-diagram` | `developer.stateDiagram.view` |
| Security Rules | `/admin/security-rules` | `developer.securityRules.view`を持つ管理者のみ |

Security Rulesはcapabilityがなければtabやlauncherに存在自体を表示しない。route直アクセスも
`AdminAuthGuard`で同じcapabilityを検証する。どちらもread-only表示で、Rules deployを行わない。

## 6. 変更境界

本設計は既存のFirestore document pathと業務上の値を維持する。Rules、indexes、Functions、
billing、customer identity、tank operationの状態遷移ロジック、production data migrationは変更しない。
