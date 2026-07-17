# Cutover rules-bypass writer inventory

更新日: 2026-07-18

## 目的と今回の判定水準

transitionPlan必須schemaへのcutover中に、dedicated freeze Rulesを迂回してFirestoreへ
書き込める経路を確認する。Security RulesはWeb/mobile clientを停止するが、
Admin SDK、server client、REST/RPC、Console等のIAM writerは停止しない。

今回は本稼働前であり、operatorがGAS、Make、Zapier、別PCの自動処理を使用しておらず、
maintenance中に外部writerがないことを明示確認する限定契約とする。
企業監査水準の網羅証跡、Owner手動操作不存在の追加証明、DATA_WRITE Audit Logs、
別Mac復旧drillは推奨するが、それらの未実施だけでGOを妨げない。

## Human evidence

repository外の`0600` evidenceに、一人のoperatorが次を記録する。

```json
{
  "externalWritersConfirmedAbsent": true,
  "otherPcAutomationConfirmedAbsent": true,
  "maintenanceWindowApproved": true,
  "productionUsageStarted": false,
  "encryptedICloudSnapshotApproved": true
}
```

五つのいずれかが未回答、または上記と異なる値ならNO-GOとする。
`confirmedByPrincipal`はcutover operator本人でよく、別reviewer principalは今回必須ではない。

## リポジトリ内のwriter

| 経路 | Rules | cutover時の扱い |
|---|---|---|
| `src/**` のFirebase Web SDK writer | 適用される | freeze Rulesと全端末のタブ終了で停止 |
| cutover REST reset / restore | 迂回する | PR #127ではproduction commitをCLI・service・lower clientの全境界で無効のままにする |
| `scripts/read-only-audit-tank-ids.mts` | 迂回する | read-only。maintenance中も明示承認なしに実行しない |
| 旧`import_tanks.js` | 迂回する | 削除済み。Git履歴から復元して実行しない |
| Emulator test | Emulatorのみ | `demo-` projectとloopback host以外を拒否 |

現行repositoryはstatic exportで、Functions、API route、GAS、Apps Script、cron、Cloud Run、
Scheduler、GitHub Actions writerを含まない。repository外を機械的に完全証明できないことは
warningとし、human evidenceと矛盾する実在writerが見つかった場合はblockerとする。

## 簡易read-only確認

maintenance開始前に、repository、Firebase / Google Cloud Console、IAMの読み取り可能な範囲で
次を確認する。

- Cloud Functions gen 1 / gen 2、Cloud Run service / job、App Engineの実在有無
- Cloud Scheduler、Workflows、Pub/Sub、Eventarc、Cloud Tasks、Firebase Extensionsの実在有無
- repository内のCI/CD、local script、cron、常駐processの候補
- Firestore data-write権限を持つuser、group、service account
- `GOOGLE_APPLICATION_CREDENTIALS`、user ADC、Firebase CLI sessionの意図しないfallback有無
- repository内のignored Admin SDK credential候補数

repository内のAdmin SDK JSON候補は、private key・key ID・credential本文を表示せず、
repository外の保護directoryへ移して`0600`・owner本人をread-backする。利用先不明のまま
自動失効・削除せず、「利用停止中legacy credential」と記録する。

DATA_WRITE Audit Logsが有効な場合は直近のwrite principalを補助証跡として確認する。
未設定、観測期間不足、exemptionはwarningとし、無効なlogの0件をwriter不存在の証拠にしない。
infra applyからAudit Logs設定を変更しない。

## Rules release writerとcredential分離

Firestore data writerとは別に、`cloud.firestore` releaseを変更できる経路を確認する。

- Rules baseline reader: `firebaserules.releases.get` / `firebaserules.rulesets.get`だけ
- data migration principal: Firestore data用の7 permissionだけ
- Rules deploy principal: 上記2つと異なる第三の既存operator principal

三つのprincipalが一致したり、Rules readerとdata migrationのaccess tokenが用途間で使い回されたりする
場合はNO-GOとする。Rules baseline照合後はreader credential contextを破棄し、その後だけ
data migration credentialを作成する。

service-account impersonationではsource / target principal、`roles/iam.serviceAccountTokenCreator`、
期限付きbinding、targetの実効permissionを確認する。Audit Logsのimpersonation証跡は今回warningだが、
principalやpermissionを確定できない場合はblockerである。

| 項目 | 記録値 |
|---|---|
| Rules baseline reader principal / 2-permission role |  |
| Rules reader credential破棄・role剥奪時刻 |  |
| Data migration principal / 7-permission role |  |
| Rules deploy principal |  |
| live baseline確認時刻 / ruleset ID / normalized hash |  |
| freeze deploy開始時刻 |  |
| 3 principalがすべて異なること | confirmed / blocked |
| Operator |  |

## Blocking条件

次は今回もwarningへ降格しない。

- 五つのhuman evidenceが欠落する、または期待値と異なる。
- project / database / UID、live Rules baseline、main SHAのいずれかが不一致。
- data migrationとRules readerのcustom roleにpermission不足・過剰がある。
- Owner、Editor、Datastore Owner/User等の過剰role、group経由、無期限bindingが専用SAにある。
- project / ancestor IAM policyにgroup bindingがある。対象SAのgroup membership不存在を
  今回のtoolだけで証明できないため、五つのhuman evidenceでは解除しない。
- Rules baseline reader、data migration principal、Rules deploy principalのいずれかが同一。
- human evidenceと矛盾する実在のRules迂回writerが見つかり、停止できない。
- repository内にAdmin SDK credential候補が残る、またはambient credential fallbackを拒否できない。
- freeze Rules deploy後の反映待ちとfresh client deny smokeを完了できない。
- live baseline確認後、freeze deploy前にRules release metadataまたはsource hashが変化した。
- snapshot復号・hash・censusが不一致、unknown recordまたはsubcollectionを検出した。
- 最終censusとatomic commit間に新規・更新・削除documentが見つかった。

次は警告と作業記録に残すが、それだけでNO-GOにしない。

- DATA_WRITE Audit Logsの未設定・不十分な観測期間・exemption
- GAS / Make / Zapier / 別PC / Owner手動writeの企業監査水準の追加証跡がないこと
- snapshot鍵の別Mac / 別媒体復旧drillが未実施であること
- 外付けAPFS媒体を使用しないこと

blockerが一つでもあればproduction executeを開放せず、maintenance中ならfreezeを維持して停止する。
