# Cutover rules-bypass writer inventory

更新日: 2026-07-14

## 目的

transitionPlan必須schemaへのcutover中に、dedicated freeze Rulesを迂回してFirestoreへ
書き込める経路を停止し、その証跡を残す。Security RulesはWeb/mobile clientを停止するが、
Admin SDK、server client、REST/RPC、Console等のIAM writerは停止しない。

## リポジトリ内のwriter

| 経路 | Rules | cutover時の扱い |
|---|---|---|
| `src/**` のFirebase Web SDK writer | 適用される | freeze Rulesと全端末のタブ終了で停止 |
| cutover REST reset / restore | 迂回する | production commitはCLI・service・lower clientで無効のまま |
| `scripts/read-only-audit-tank-ids.mts` | 迂回する | read-only。maintenance中も明示承認なしに実行しない |
| 旧`import_tanks.js` | 迂回する | 無条件batch writerだったため削除。Git履歴から復元して実行しない |
| Emulator test | Emulatorのみ | `demo-` projectとloopback host以外を拒否 |

現行repositoryはstatic exportで、Functions、API route、GAS、Apps Script、cron、Cloud Run、
Scheduler、GitHub Actions writerを含まない。ただし、repositoryにない外部writerの不存在は
この棚卸しだけでは証明できない。

## 本番で確認する外部writer

maintenance開始前に、以下をCloud Console、Cloud Audit Logs、IAM、各ownerへの確認で棚卸しする。

Cloud Audit Logsを証跡に使う前に、`datastore.googleapis.com`のData Access `DATA_WRITE`が有効で、
exempted principalがないことを確認する。未設定または必要期間のlogが残っていない場合は、
「writeなし」と結論せず`unknown`としてcutoverを停止する。

- Cloud Functions gen 1 / gen 2
- Cloud Run service / job、App Engine
- Cloud Scheduler、Workflows、Pub/Sub、Eventarc、Cloud Tasks
- Firebase Extensions
- GAS / Apps Script trigger、Sheets連携
- Make、Zapier等の外部automation
- CI/CD、別repository、別PC、local cron、常駐process
- Firebase / Google Cloud Consoleからの手動編集者
- Firestoreへdata-write権限を持つuser、group、service account

## Rules release writer

Firestore data writerとは別に、`cloud.firestore` releaseを変更できるuser、service account、CI、
別PCを棚卸しする。migration credentialのRules関連権限は`get`だけとし、freeze deployには使わない。
freeze deploy担当者以外のRules deploy経路を停止し、`cutover:rules:verify-baseline`成功から
freeze Rules deploy完了まで他のRules releaseを作成・更新しない。

| 項目 | 記録値 |
|---|---|
| Rules deploy principal |  |
| deploy元PC / CI / repository |  |
| 停止した他のdeploy経路 |  |
| live baseline確認時刻 / ruleset ID |  |
| freeze deploy開始時刻 |  |
| 確認者 |  |

## 停止証跡

各経路について次を記録し、一件でも`unknown`ならResetへ進まない。

| 項目 | 記録値 |
|---|---|
| writer名 / principal |  |
| owner |  |
| 通常の起動元 |  |
| 停止方法 |  |
| 停止日時 |  |
| 停止確認command / Console画面 |  |
| 最終write時刻 |  |
| Audit Logs確認結果 | stopped / none / unknown |
| DATA_WRITE log設定 / 保存期間 | enabled / sufficient / unknown |
| 再開条件 |  |
| 確認者 |  |

## Blocking条件

- migration専用principal以外のdata-write主体を停止または一時的に権限剥奪できない。
- maintenance開始後のFirestore writeがAudit Logsで観測された。
- 開いたstaff/admin/portalタブを全端末で終了できない。
- freeze Rules deploy後10分待機とfresh client deny smokeを完了できない。
- live baseline確認後、freeze deploy前にRules release metadataまたはsource hashが変化した。
- live baseline確認からfreeze deploy完了まで、別のRules deploy経路を停止できない。
- 最終censusとcommit間に新規documentを作れるRules迂回writerが残る。

上記のいずれかに該当する場合、production executeを開放せずmaintenanceを解除する。
