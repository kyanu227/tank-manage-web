# transitionPlan v1 cutover runbook

更新日: 2026-07-15

対象project: `okmarine-tankrental`
状態: **設計・Emulator検証用。production reset / restore executeは無効**

## 1. 安全原則

- Hosting、freeze Rules、通常Rules、Firestore data migrationを一つのdeploy commandへ混ぜない。
- Firebase CLIは常に`--project`と専用`--config`を明示する。
- reset / restoreの正本は暗号化snapshotだけとする。
- ambiguous responseで自動再実行しない。verify-only以外の操作を止める。
- maintenance解除とwriter再開はnormal Rules、Hosting、strict smoke、data verificationがすべて成功した後だけ行う。
- Rulesはserver client、Admin SDK、REST/RPCを止めないため、writer停止を別途証明する。

Firebase公式では、Rules更新が新規queryへ反映されるまで最大約1分、active listenerへ完全反映
されるまで最大10分かかり得る。freeze deploy後は10分待機し、開いていた全タブを終了して
fresh clientで確認する。

参考:

- <https://firebase.google.com/docs/firestore/security/get-started>
- <https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/get>
- <https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/get>
- <https://docs.cloud.google.com/firestore/docs/security/iam>
- <https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/testIamPermissions>

## 2. 現在のblocking state

このPRでは、次を実装してもproduction commit gateを開かない。

- reset CLI / service / lower REST client: blocked
- restore CLI / service / lower REST client: blocked
- markerへの実行principal保存: 最終execute解放PRへ残す
- dedicated data migration / Rules baseline read credentialへの本番IAM付与: 運用時に別承認
- freeze / normal Rules deploy: 未実施
- Hosting deploy、snapshot本番取得、Data Reset: 未実施

## 3. Cutover前準備

1. [Rules迂回writer棚卸し](./rules-bypass-writer-inventory.md)を全件記入する。
2. `datastore.googleapis.com`のData Access `DATA_WRITE` audit logが有効で、対象principalに
   exemptionがないことを確認する。Data Access logは通常無効なので、未設定・保存期間不足なら
   writer不存在の証明に使わず、cutoverを停止する。
3. Cloud Audit Logsで直近のFirestore write principalを列挙する。
4. data migration専用service account以外のdata writerを停止または一時権限剥奪する。
5. data migrationとfreeze前Rules baseline照合は、異なるservice accountとcustom roleに分ける。
   同じprincipalへ2つのroleを付与すると実効権限が9 permissionになるため禁止する。
   例として次の2 roleを期限付きで直接付与し、group経由で付与しない。
   - `transitionCutoverData`: data migration専用の7 permission
     - `datastore.databases.get`
     - `datastore.databases.getMetadata`
     - `datastore.entities.get`
     - `datastore.entities.list`
     - `datastore.entities.create`
     - `datastore.entities.update`
     - `datastore.entities.delete`
   - `transitionRulesBaselineRead`: Rules baseline read専用の2 permission
     - `firebaserules.releases.get`
     - `firebaserules.rulesets.get`
   custom role作成commandのレビュー用例は次のとおり。これは実行承認ではなく、作成前にrole ID、
   project、permission列を二名で照合する。

   ```bash
   gcloud iam roles create transitionCutoverData \
     --project=okmarine-tankrental \
     --title='Transition cutover data' \
     --description='Temporary Firestore data migration role' \
     --permissions='datastore.databases.get,datastore.databases.getMetadata,datastore.entities.get,datastore.entities.list,datastore.entities.create,datastore.entities.update,datastore.entities.delete' \
     --stage=GA

   gcloud iam roles create transitionRulesBaselineRead \
     --project=okmarine-tankrental \
     --title='Transition Rules baseline read' \
     --description='Temporary read-only Firebase Rules baseline role' \
     --permissions='firebaserules.releases.get,firebaserules.rulesets.get' \
     --stage=GA
   ```

   role作成と、service accountへの期限付き直接bindingは別の人間承認とする。このrunbookの
   command例をそのまま実行せず、作成後にrole descriptionとpermission列をread-onlyで再取得する。
6. 2つのfreshな専用service accountそれぞれについて、project/folder/organizationのIAM
   policyをread-onlyで取得し、直接・継承・group経由の実効bindingを記録する。Owner、Editor、
   Datastore Owner/User、Firebase Rules Viewer等の広いroleと、上記の各permission set以外の
   権限がないことを別途確認する。`testIamPermissions`は要求したpermissionの存在だけを
   確認するもので、余分な直接・継承権限の不存在を証明しない。
7. IAM policy変更後は最低10分待ち、反復したpermission確認が一致するまで進まない。公式には通常約2分、
   7分以上かかる場合もあり、group変更はさらに長いため専用principalをgroupへ入れない。
8. `GOOGLE_APPLICATION_CREDENTIALS`やuser ADCを暗黙利用しない。Rules baseline照合では
   `--expected-rules-principal`、data preflight / snapshot / reset / restore / verifyでは
   `--expected-data-principal`を照合する。Rules reader credentialをクリアせずにdata操作へ進んだり、
   data credentialでRules baselineを読んだりしない。
   credential切替は同じshellの上書きではなく、Rules reader専用のfresh processをbaseline照合後に
   終了し、そのcredential contextとroleを破棄・剥奪してから、data migration専用の別processを
   起動する。各processでは用途に対応するexpected principalを明示し、起動前後にprincipalと
   `GOOGLE_APPLICATION_CREDENTIALS`の有無だけを記録する。credential file pathや内容は証跡へ残さない。
9. service-account impersonationは、source / target principal、`roles/iam.serviceAccountTokenCreator`、
   短命token、有効期限、Audit Logsの証跡を別途検証した場合だけ承認する。
   clientがtarget principalを表示したことや、実装にprincipal照合があることだけでは承認済みとしない。
   証跡がなければ未承認としてcutoverを停止する。
   Google Cloudの候補手順は`gcloud auth application-default login --impersonate-service-account=<SA>`だが、
   現在のcutover CLIでtarget principal照合と7 / 2 permission分離を別々にread-only drillできるまでは
   production手順として使用しない。drill後もRules用ADCを終了・破棄してからdata用ADCを別processで作り、
   同一ADC fileやglobal gcloud impersonation設定を二用途で使い回さない。
10. local service-account JSONを使う場合はrepository・同期folder外、owner本人、`0600`、hard link数1とする。
    repository直下の`firebase-service-account.json`や`*-firebase-adminsdk-*.json`は、使用中でなくても
    production CLIをfail closedさせる。使用履歴を確認し、有効な鍵なら失効してから安全な場所へ移すか削除する。
11. main SHA、現在のHosting release、通常Rules file hash、rollback対象Rules commit、live Rulesの
    release更新日時とruleset IDを記録する。

参考:

- <https://docs.cloud.google.com/logging/docs/audit/configure-data-access>
- <https://docs.cloud.google.com/firestore/native/docs/audit-logging>
- <https://docs.cloud.google.com/iam/docs/access-change-propagation>
- <https://docs.cloud.google.com/sdk/gcloud/reference/iam/roles/create>
- <https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation>

## 4. Snapshot鍵の復旧drill

primary Keychainと同じMac、Git、iCloud、Google Drive、snapshotと同じ媒体だけに鍵を置かない。

1. 32-byte keyをcanonical Base64として、管理者用password managerまたはoffline暗号化APFS媒体へ別保管する。
2. manifestにはkey本体ではなくkey IDだけを保存する。
3. 別Mac / 別processで鍵を対話的に受け取り、Keychain Access GUIからKeychain service
   `tank-manage-cutover`、
   account `<projectId>:<keyId>`へ一時登録する。
4. Emulator snapshotを復号し、verify-onlyまで成功させる。
5. 一時Keychain entryと作業用平文を削除する。

鍵をCLI引数、stdout、shell history、repository、同期folderへ出さない。snapshotはFileVault保護された
local APFSまたは暗号化APFSに保存し、`~/Library/Mobile Documents`と`~/Library/CloudStorage`を使わない。

## 5. Maintenanceとfreeze

全利用者へ停止を通知し、staff/admin/portalの全タブを終了する。次のcommandはrunbook例であり、
このPRでは実行しない。

freeze deployの直前に、productionの`cloud.firestore` releaseをRules APIからread-onlyで再取得する。
取得順はrelease → immutable ruleset source → releaseとし、途中でreleaseが変化した場合も停止する。
API sourceはmemory内でだけLF・末尾改行1つへ正規化し、本文をfileやstdoutへ出さない。

```bash
npm run --silent cutover:rules:verify-baseline -- \
  --project=okmarine-tankrental \
  --expected-main-commit='<current-main-sha>' \
  --expected-data-principal='<data-migration-service-account-email>' \
  --expected-rules-principal='<rules-baseline-reader-service-account-email>'
```

このcommandで有効にするのはRules baseline reader credentialだけとする。
`--expected-data-principal`は2 principalが異なることをnetwork access前に検査するためのidentity参照であり、
このcommandがdata migration credentialを使用することを意味しない。

この検証は、次の4者が一致した場合だけ成功する。

- live production Rules source
- `firestore.cutover-baseline.rules`
- `firestore.cutover-baseline.manifest.json`のhash・release・ruleset metadata
- commit `b7e853c8f38071937951b871cbe0e3281dd22876`の`firestore.rules`

現在のpinned正本は、release更新`2026-06-02T08:28:53.917518Z`、ruleset
`5e97d441-b926-473a-a983-b77e41293db4`、正規化SHA-256
`6c9d126dad4980f20f92feda660d13a7d3840b1625d3ac4c74da27ce9e31e1a8`である。
取得不能、hash・metadata・Git・fileの不一致はすべてfreeze deploy前にfail closedとする。
CLIはlocal `HEAD` / `origin/main`だけでなく、GitHub上の`refs/heads/main`も`git ls-remote`で
read-only照合する。remote mainを取得できない、または`expected-main-commit`と不一致なら停止する。
成功後はRules reader credentialのローカルcontextを破棄し、他のRules deploy権限者・CIを動かさず、
直ちに次のfreeze deployへ進む。freeze deployを行うRules deploy principalは、Rules baseline readerと
data migration principalのどちらでもない第三の承認済み主体とする。

```bash
firebase --project okmarine-tankrental \
  --config firebase.cutover-freeze.json \
  deploy --only firestore:rules
```

deploy後:

1. 10分待機する。
2. fresh/incognito clientでanonymous、staff、admin、portalのreadが`permission-denied`になることを確認する。
3. staff/adminのnormally-allowedな不存在document updateが、`not-found`ではなく
   `permission-denied`になることを確認する。実documentは作成しない。
4. active listenerも`permission-denied`になり、古いタブが残っていないことを確認する。
5. Audit LogsにFirestore data writeがないことを再確認する。この時点でdata migration credentialは
   まだ有効化・選択しない。

freezeのdeny smoke後、Rules baseline read roleを剥奪し、そのcredential contextが残っていないことを
確認する。その後にだけdata migration credentialへ切り替え、section 6のpreflightへ進む。
同一principal、同一credential file、未検証のimpersonationでこの切り替えを代替しない。

一つでも確認できなければ、Reset前の本番artifactとして固定したbaseline Rulesへ戻し、Resetへ進まない。
現在の`firestore.rules`は未deployの状態遷移差分を含むため、このabortには使用しない。

```bash
test "$(shasum -a 256 firestore.cutover-baseline.rules | awk '{print $1}')" = \
  '6c9d126dad4980f20f92feda660d13a7d3840b1625d3ac4c74da27ce9e31e1a8'
firebase --project okmarine-tankrental \
  --config firebase.cutover-baseline.json \
  deploy --only firestore:rules
```

baseline artifactはfreeze直前のproduction Rulesと同じsourceを保持する。2026-06-02 releaseの
最終変更commit `b7e853c8f38071937951b871cbe0e3281dd22876`、上記hash、manifest metadataの
いずれかが不一致ならdeployしない。これによりabort・rollbackは作業直前のRules sourceへ戻る。

このReset前abortではsnapshot restoreを行わない。Resetは一度も実行されていないため、次の順序で
pre-cutover状態へ戻し、途中を省略しない。

```text
pinned baseline Rules deploy
→ 最大10分待機
→ fresh staff/admin/portalでbaseline read smoke
→ Audit Logsで想定外writeがないことを確認
→ Rules baseline read roleとdata migration roleをそれぞれ剥奪
→ 10分以上待機
→ read-only IAM policyと各principalのpermission検査で権限消失を二回連続確認
→ 各credential contextを破棄
→ maintenance解除・既存writer再開
```

baseline read smokeでは、cutover前Hostingのstaff/admin/portalの既存read pathと認証だけを確認し、
業務writeを行わない。新schema、`transitionPlan`、rollout gate、reset markerは期待条件に含めない。
一つでもbaseline read、Audit Logs、IAM剥奪の確認に失敗した場合はmaintenanceを解除せず、
baseline Rulesの伝播完了を待ったままincidentとして扱う。

## 6. Read-only preflight

freeze後、production writeを行わずにprincipal、IAM、database UID、main SHA、census、unknown record、
subcollection、marker、予定write数・request sizeを検査する。
Rules baseline readerで使用したcredential contextが破棄済み、Rules baseline read roleが剥奪済みであることを
証跡で確認してから、別のdata migration credentialを明示的に設定する。IAM policyのread-only再取得と
`testIamPermissions`の反復確認の両方が一致しない限りpreflightを実行しない。

```bash
npm run --silent cutover:preflight -- \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='<database-uid>' \
  --expected-main-commit='<current-main-sha>' \
  --expected-data-principal='<data-migration-service-account-email>' \
  --key-id='<snapshot-key-id>'
```

出力は件数、status集計、write数、request bytes、hash、data用の必要7 permissionの確認数だけとし、document ID、
顧客名、location、field内容、token、credential pathを含めない。

## 7. SnapshotとReset dry-run

```bash
npm run --silent cutover:snapshot:create -- \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='<database-uid>' \
  --expected-main-commit='<current-main-sha>' \
  --expected-data-principal='<data-migration-service-account-email>' \
  --key-id='<snapshot-key-id>' \
  --output='<local-non-sync-absolute-path>'

npm run --silent cutover:snapshot:reset -- \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='<database-uid>' \
  --expected-main-commit='<current-main-sha>' \
  --expected-data-principal='<data-migration-service-account-email>' \
  --key-id='<snapshot-key-id>' \
  --snapshot='<local-non-sync-absolute-path>'
```

上記の実行順は、Rules baseline readerによる照合 → Rules deploy principalによるfreeze →
Rules reader credential破棄・role剥奪 → data migration credentialへ切り替え → read-only preflight →
snapshot作成 → reset dry-runとする。後半を前倒ししたり、Rules readerでdata操作を行ったりしない。

preflightとsnapshot作成結果では対象counts、inventory、`sourceCensusSha256`、
`documentPathSha256`を比較する。preflightと、そのsnapshotを入力したReset dry-runではstatus集計、
write数、request bytesも比較する。snapshot ID・作成日時を含むpayload hashとreset plan hashは
preflightごとに変わり得るため比較対象にしない。reset plan hashは、同じ暗号化snapshotを入力した
dry-runと将来のexecute間でだけ一致させる。本番`--execute`は最終のexecute解放PRがmerge・
再レビューされるまで使用できない。

このPRでは本番Reset実行commandを意図的に記載しない。最終execute解放PRでprincipalのmarker保存、
二名確認、実行confirmationと一緒に追加する。現時点のCLIは`--execute`を指定してもproductionでは
CLI、service、REST clientの各境界で必ず拒否する。

## 8. Ambiguous outcome

commit応答が不明な場合、freezeとwriter停止を維持し、自動再commitを禁止する。

```bash
npm run --silent cutover:verify -- \
  --operation=reset \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='<database-uid>' \
  --expected-main-commit='<current-main-sha>' \
  --expected-data-principal='<data-migration-service-account-email>' \
  --key-id='<snapshot-key-id>' \
  --snapshot='<local-non-sync-absolute-path>'
```

- `reset_applied`: exact reset stateを反復確認した。次のschema verificationへ進む。
- `source_or_restored_observed`: 原状態を観測しただけで、遅延commitの不存在は証明しない。
- `unknown`: mixed / drift / read error。maintenanceを継続して担当者判断へ移る。

指定operationのexact target state以外では終了code 2となる。すべて`safeToRetry: false`とし、
同じcommitを再送しない。

`--operation=restore`は、同じsnapshotについて`reset_applied`とstable state hashを事前記録済みで、
その後にrestoreを試行した場合だけ使う。source状態だけでは「resetが一度も適用されなかった」のか
「restoreされた」のか区別できないため、事前記録がなければrestore成功の証跡にしない。

## 9. 通常復帰

将来のexecute成功後も、次の順序を崩さない。

```text
schema verification
→ rollout gate=falseのHosting deploy
→ dedicated normal Rules deploy
→ 最大10分待機
→ staff/admin/portal strict smoke
→ Audit Logs確認
→ maintenance解除
→ writer再開
```

schema verification成功後、記録済みのmain commitからrollout gate=falseを明示して静的成果物を生成し、
`out/`に同期競合copyや想定外fileがないことを確認してから、freeze中にHostingだけへ反映する。

buildとdeployの直前に、事前記録した値へfail closedで再照合する。

```bash
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = '<recorded-main-sha>'
test "$(git rev-parse origin/main)" = '<recorded-main-sha>'
test "$(shasum -a 256 firestore.rules | awk '{print $1}')" = '<recorded-post-cutover-rules-sha256>'
```

```bash
NEXT_PUBLIC_TANK_ADVISORY_ACTIVATION_ENABLED=false npm run build
```

```bash
firebase --project okmarine-tankrental deploy --only hosting
```

続けて、Hostingと混ぜずに通常Rulesだけを戻す。

```bash
firebase --project okmarine-tankrental \
  --config firebase.cutover-normal-rules.json \
  deploy --only firestore:rules
```

### 9.1 Rollbackを保ったstrict smoke

この段階ではrestoreが要求するexact reset状態を壊さないため、業務writeを送信しない。

| scenario | 期待結果 | 失敗時 |
|---|---|---|
| 管理設定 | 保存policy=`strict`、runtime表示=`strict`、gate停止表示 | freezeを再deployしてrollback |
| staff | tank一覧・dashboardが読め、操作確認をcancelするとwrite 0件 | 同上 |
| admin | review一覧、billing、sales、staff実績がschema errorなく読める | 同上 |
| portal | setup済み顧客でhome・履歴が読め、transaction submitはしない | 同上 |
| migration state | `cutover:verify --operation=reset`が`reset_applied`、`targetStateConfirmed=true` | 同上 |
| audit | DATA_WRITEがdata migration principalと事前記録したsmoke auth/session更新だけ | 同上 |

unexpected `permission-denied`、旧schema error、runtime advisory、mixed state、未記録principal/pathのwriteが
一つでもあれば、利用者へ開放せずdedicated freeze Rulesを再deployし、10分待ってdeny smokeをやり直す。

### 9.2 証跡とIAM剥奪

次をcutover記録へ保存する。

- operator / reviewer、開始・完了時刻、main SHA、Hosting release ID
- snapshot ID、payload/source/reset-plan SHA、verify stable-state SHA
- baseline live照合時のrelease/ruleset metadata、baseline / freeze / post-cutover Rules SHAと各deploy結果
- staff/admin/portal smoke結果、Audit Logs query期間、確認principal、許可したauth/session更新path
- Rules baseline read principal、2-permission role、付与・剥奪時刻、baseline照合結果、
  project/folder/organizationのread-only IAM policyレビュー結果
- data migration principal、7-permission role、付与・剥奪時刻、各data commandのprincipal照合結果、
  project/folder/organizationのread-only IAM policyレビュー結果
- Rules deploy principal、deploy時刻、Rules reader / data migrationと異なprincipalであることの確認
- impersonationを使う場合はsource / target principal、Token Creator binding、token有効期限、Audit Logs。
  これらの証跡がなければ「未承認」と記録する

Rules baseline read roleはsection 6へ進む前に剥奪済みとする。smoke成功後、data migration roleを剥奪する。
最低10分待ってから同じ`cutover:preflight`を実行し、
data readへ進む前に「必要なIAM権限が不足」とfail closedすることを二回確認する。権限が一つでも残る、
または結果が揺れる場合はmaintenanceを解除しない。その後にmaintenanceを解除し、writerを再開する。

### 9.3 最初の業務write

maintenance解除後、担当者立会いで`empty` tank一件への既存direct操作を最初のwriteとして行い、
一操作一tank log、必須transitionPlan、状態projection、請求・実績画面の再取得を確認する。
advisory gateはfalseのままにする。このwrite後はsnapshot restore前提のrollback状態ではないため、
異常時は新規操作を止め、履歴を消さずincidentとしてforward-fix判断へ移る。

## 10. Rollback

freezeとwriter停止を維持したまま、暗号化snapshotからrestoreを計画し、将来の明示的な
production restore gate解放後だけ実行する。restoreが曖昧なら`--operation=restore`でverify-onlyを行う。

まず本番writeなしのrestore dry-runを実行し、reset時に記録した同じsnapshot/hashを確認する。

```bash
npm run --silent cutover:snapshot:restore -- \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='<database-uid>' \
  --expected-main-commit='<recorded-main-sha>' \
  --expected-data-principal='<data-migration-service-account-email>' \
  --key-id='<snapshot-key-id>' \
  --snapshot='<local-non-sync-absolute-path>'
```

```text
snapshot restore
→ snapshot内容との完全一致確認
→ rollback対象Hosting release
→ pinned pre-cutover baseline Rules
→ 最大10分待機
→ baseline rollback smoke
→ Audit Logs確認
→ Rules baseline read roleとdata migration roleをそれぞれ剥奪・権限消失確認
→ maintenance解除・writer再開
```

snapshot復号不可、principal不一致、IAM不足、unknown状態、snapshot後drift、subcollection、
hash不一致のいずれかがあれば、restore / resetを実行せずincidentとして扱う。

本番restore commandも最終execute解放PRまで意図的に記載しない。Hosting rollbackはcutover前に
記録したreleaseをFirebase Consoleで選び、現在のworktreeから再buildして代用しない。Rules rollbackは
section 5のhash確認済み`firebase.cutover-baseline.json`だけを使い、post-cutover normal configを使わない。
baseline rollback smokeはcutover前Hostingのstaff/admin/portalの既存read pathと認証を対象とし、
section 9.1の新`transitionPlan`、rollout gate、reset markerを期待しない。業務writeは送信せず、
操作画面ではcancel時にwrite 0件であることだけを確認する。成功後もsection 9.2と同じAudit Logs確認、
IAM剥奪、10分以上の反映待ち、権限不足の二回連続確認を行い、それからmaintenance解除とwriter再開へ進む。
