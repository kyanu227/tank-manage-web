# transitionPlan v1 cutover runbook

環境準備toolのCLI契約、credential分離証跡、human evidenceは
[`infra-readiness-tools.md`](./infra-readiness-tools.md)を正本とする。Phase 3 merge後の最終main SHAで
Rules / data / human evidenceを再生成し、`cutover:readiness`がGOであることをcutover operatorが
明示確認してからproduction executeへ進む。今回は一人運用とし、別reviewer principalを必須としない。

更新日: 2026-07-18

対象project: `okmarine-tankrental`
状態: **本番cutover完了。production reset / restoreの5 execute境界は再閉鎖済み**

実施結果は[`transition-cutover-result-2026-07-18.md`](../deploy/transition-cutover-result-2026-07-18.md)を参照する。

## 1. 安全原則

- Hosting、freeze Rules、通常Rules、Firestore data migrationを一つのdeploy commandへ混ぜない。
- Firebase CLIは常に`--project`と専用`--config`を明示する。
- reset / restoreの正本は暗号化snapshotだけとする。
- ambiguous responseで自動再実行しない。verify-only以外の操作を止める。
- advisoryはcutover完了後も無効のままとし、rollout gateを有効化しない。
- maintenance解除とwriter再開はnormal Rules、Hosting、strict smoke、data verificationがすべて成功した後だけ行う。
- Rulesはserver client、Admin SDK、REST/RPCを止めない。今回は本稼働前かつ外部writerなしという
  operatorの明示確認を証跡化し、企業監査水準の網羅証明はwarningとして残す。

Firebase公式では、Rules更新が新規queryへ反映されるまで最大約1分、active listenerへ完全反映
されるまで最大10分かかり得る。freeze deploy後は10分待機し、開いていた全タブを終了して
fresh clientで確認する。

参考:

- <https://firebase.google.com/docs/firestore/security/get-started>
- <https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/get>
- <https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/get>
- <https://docs.cloud.google.com/firestore/docs/security/iam>
- <https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/testIamPermissions>

## 2. 固定production execution契約

Phase 3ではreset CLI / service、restore CLI / service、lower REST clientの5境界を、任意の本番writeではなく
次の固定one-time契約に対してだけarmedとする。いずれか一境界だけが開いた状態や、固定値を検証できない状態は
readinessで`unsafe`として停止する。

- project: `okmarine-tankrental`
- database: `(default)`
- database UID: `8dcf700f-01a3-4861-bee9-d901504f26b4`
- data principal: `transition-cutover-data@okmarine-tankrental.iam.gserviceaccount.com`
- operator principal: `user:okmarineclub@gmail.com`
- reset confirmation: `EXECUTE_TRANSITION_CUTOVER_RESET_ONCE_20260718`
- restore confirmation: `EXECUTE_TRANSITION_CUTOVER_RESTORE_ONCE_20260718`
- CLIで明示したsnapshot ID、snapshot payload SHA-256、source census SHA-256、reset plan SHA-256が、
  復号済みsnapshotとcommit直前の再計画結果へ完全一致すること
- commit authorizationはlive censusを再読取した実plannerの凍結planからだけ発行し、operationと
  exact serialized request bodyのhash・件数へ結び付け、request開始前に一度だけconsumeすること
- reset contractとmarkerのscript versionは`2`とし、markerへoperator principal、data principal、snapshotと
  各hashを保存し、`exists:false` preconditionによって再実行を拒否すること
- reset / restore execute直後に同一processでverify-onlyを実行し、exact target stateを確認すること
- ambiguous responseでは同じcommitを再送せず、read-back verificationだけを反復すること

production executeのarmedはcutover期間だけの一時状態である。cutover完了後は5境界を個別に閉じる
小規模PRを作成し、reset / restoreを通常運用から再び実行不能にする。

Phase 3 mergeだけでは自動実行しない操作:

- dedicated data migration / Rules baseline read credentialへの本番IAM付与: 運用時に別承認
- freeze / normal Rules deploy: 未実施
- Hosting deploy、snapshot本番取得、Data Reset: 未実施

## 3. Cutover前準備

1. [Rules迂回writer棚卸し](./rules-bypass-writer-inventory.md)の簡易確認を行い、human evidenceに次の5事実を記録する。
   - `externalWritersConfirmedAbsent: true`
   - `otherPcAutomationConfirmedAbsent: true`
   - `maintenanceWindowApproved: true`
   - `productionUsageStarted: false`
   - `encryptedICloudSnapshotApproved: true`
   GAS、Make、Zapier、別PC、Owner手動writeの企業監査水準の個別証跡は今回warningとし、
   operatorの明示確認とrepository / projectのread-only調査に矛盾がなければblockerとしない。
2. `DATA_WRITE` Audit Logsの設定とexemptionをread-onlyで記録する。未設定、観測期間不足、exemptionは
   今回warningであり、それだけでcutoverを停止しない。ただし、無効なAudit Logsの0件を
   writer不存在の証拠として扱わない。infra applyからAudit Logs設定は変更しない。
3. OpenJDK 21と`gcloud`を[`infra-readiness-tools.md`](./infra-readiness-tools.md)の手順で選択・導入し、
   active accountとprojectを明示照合する。
4. data migrationとfreeze前Rules baseline照合は、異なるservice accountとcustom roleに分ける。
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
   custom role作成commandのレビュー用例は次のとおり。これは実行承認ではなく、operatorが
   role ID、project、permission列を照合する。

   ```bash
   gcloud iam roles create transitionCutoverData \
     --project=okmarine-tankrental \
     --title='Transition Cutover Data' \
     --description='Exact Firestore data permissions for transition cutover' \
     --permissions='datastore.databases.get,datastore.databases.getMetadata,datastore.entities.get,datastore.entities.list,datastore.entities.create,datastore.entities.update,datastore.entities.delete' \
     --stage=GA

   gcloud iam roles create transitionRulesBaselineRead \
     --project=okmarine-tankrental \
     --title='Transition Rules Baseline Read' \
     --description='Exact Firebase Rules read permissions for cutover baseline' \
     --permissions='firebaserules.releases.get,firebaserules.rulesets.get' \
     --stage=GA
   ```

   SA IDは`transition-cutover-data`と`transition-rules-reader`に固定する。role/SA作成、期限付き直接binding、
   Keychain登録は[`infra-readiness-tools.md`](./infra-readiness-tools.md)のguarded applyで扱う。
   `--execute`とconfirmationをoperatorが照合し、作成後にrole descriptionとpermission列をread-onlyで再取得する。
5. 2つのfreshな専用service accountそれぞれについて、project/folder/organizationのIAM
   policyをread-onlyで取得し、直接・継承・group経由の実効bindingを記録する。Owner、Editor、
   Datastore Owner/User、Firebase Rules Viewer等の広いroleと、上記の各permission set以外の
   権限がないことを別途確認する。`testIamPermissions`は要求したpermissionの存在だけを
   確認するもので、余分な直接・継承権限の不存在を証明しない。
6. IAM policy変更後は最低10分待ち、反復したpermission確認が一致するまで進まない。公式には通常約2分、
   7分以上かかる場合もあり、group変更はさらに長いため専用principalをgroupへ入れない。
7. `GOOGLE_APPLICATION_CREDENTIALS`やambient user ADCを暗黙利用しない。Rules baseline照合では
   `--expected-rules-principal`、data preflight / snapshot / reset / restore / verifyでは
   `--expected-data-principal`を照合する。Rules reader credentialをクリアせずにdata操作へ進んだり、
   data credentialでRules baselineを読んだりしない。
   credential切替は同じshellの上書きではなく、[`infra-readiness-tools.md`](./infra-readiness-tools.md)の
   非同期APFS上に隔離した`HOME`と`CLOUDSDK_CONFIG`で作成したimpersonation ADCを使う。
   `CLOUDSDK_CONFIG`だけではauthentication libraryのwell-known ADC pathを隔離できない。
   Rules reader専用のfresh processをbaseline照合後に
   終了し、そのcredential contextとroleを破棄・剥奪してから、data migration専用の別processを
   起動する。各processでは用途に対応するexpected principalを明示し、起動前後にprincipalと
   `GOOGLE_APPLICATION_CREDENTIALS`の有無だけを記録する。credential file pathや内容は証跡へ残さない。
   証跡process終了後は隔離HOMEを削除し、元の`HOME`へ戻してからinfra plan/apply/readinessを実行する。
8. service-account impersonationは、source / target principal、`roles/iam.serviceAccountTokenCreator`、
   短命token、binding有効期限を検証する。Audit Logs証跡がないこと自体は今回warningとするが、
   target principalまたは実効permissionを確定できない場合は引き続き停止する。
   `gcloud auth application-default login --impersonate-service-account=<SA>`を隔離HOME/configuration内で使い、
   target principal照合と7 / 2 permission分離を別々にread-only drillする。drill後もRules用ADCを終了・破棄してからdata用ADCを別processで作り、
   同一ADC fileやglobal gcloud impersonation設定を二用途で使い回さない。
9. repository内のignored Admin SDK JSON候補はproduction CLIをfail closedさせる。private key本文を
   表示せず、repository外の保護directoryへ移動して`0600`とownerをread-backする。
   利用先不明のまま失効・削除せず、「利用停止中legacy credential」として記録する。
   移動先はsnapshot、Git、iCloud共有directory、shell historyと分離する。
10. snapshot保存方式は`--snapshot-storage-mode=icloud_encrypted`を明示し、推奨先
    `~/Library/Mobile Documents/com~apple~CloudDocs/TankCutover/`にrepository外の暗号化snapshotだけを保存する。
    snapshot鍵はKeychain service `tank-manage-cutover`へ保管し、snapshot内・同directory・CLI引数に置かない。
11. main SHA、現在のHosting release、通常Rules file hash、rollback対象Rules commit、live Rulesの
    release更新日時とruleset IDを記録する。

参考:

- <https://docs.cloud.google.com/logging/docs/audit/configure-data-access>
- <https://docs.cloud.google.com/firestore/native/docs/audit-logging>
- <https://docs.cloud.google.com/iam/docs/access-change-propagation>
- <https://docs.cloud.google.com/sdk/gcloud/reference/iam/roles/create>
- <https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation>

## 4. Snapshot鍵と復旧drill

今回のsnapshot鍵はmacOS Keychainに保存し、暗号化snapshotと同じiCloud directoryへ置かない。
別Mac / 別媒体からの復旧drillは強く推奨するが、本稼働前の今cutoverではwarningとし、
未実施だけでGOを妨げない。

1. 32-byte keyをcanonical Base64として、管理者用password managerまたはoffline暗号化APFS媒体へ別保管する。
2. manifestにはkey本体ではなくkey IDだけを保存する。
3. 別Mac / 別processで鍵を対話的に受け取り、Keychain Access GUIからKeychain service
   `tank-manage-cutover`、
   account `<projectId>:<keyId>`へ一時登録する。
4. Emulator snapshotを復号し、verify-onlyまで成功させる。
5. 一時Keychain entryと作業用平文を削除する。

鍵をCLI引数、stdout、shell history、repository、snapshot file、snapshot directoryへ出さない。
snapshotは`local_encrypted`ならlocal APFS、`icloud_encrypted`なら
`~/Library/Mobile Documents/com~apple~CloudDocs/TankCutover/`へ保存する。外付けAPFS媒体は必須ではない。

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

この検証は、次の3者のRules本文が一致した場合だけ成功する。

- live production Rules source
- `firestore.cutover-baseline.rules`
- commit `b7e853c8f38071937951b871cbe0e3281dd22876`の`firestore.rules`

現在のpinned正本は2026-06-02のGit正本で、正規化SHA-256は
`6c9d126dad4980f20f92feda660d13a7d3840b1625d3ac4c74da27ce9e31e1a8`である。
release / ruleset ID、更新日時、live source filenameは毎回のdeployで変わり得る監査情報として記録するが、
本文・hash・byte数が一致する限りfreezeのblocking条件にはしない。取得不能、本文hash・Git・baseline fileの
不一致はfreeze deploy前にfail closedとする。
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
5. DATA_WRITE Audit Logsが利用できる場合はFirestore data writeがないことを追加確認する。
   未設定ならwarningを記録し、五つのhuman evidenceとdeny smokeの結果で判定する。
   この時点でdata migration credentialはまだ有効化・選択しない。

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

baseline artifactはfreeze直前のproduction Rulesと同じsourceを保持する。2026-06-02 Git正本の
最終変更commit `b7e853c8f38071937951b871cbe0e3281dd22876`と上記hashが不一致ならdeployしない。
これによりabort・rollbackは作業直前と同じRules本文へ戻る。

baseline deployは同じ本文でも新しいimmutable rulesetとrelease update timeを作成する。したがって、
abort・rollback後の再試行ではrelease → ruleset → releaseをread-onlyで安定読取し、本文hash・byte数が
Git正本と一致すればmanifest metadata更新PRを要求しない。本文hashが変わった場合だけ、新しいrollback
artifactとGit pinとして別レビューする。

このReset前abortではsnapshot restoreを行わない。Resetは一度も実行されていないため、次の順序で
pre-cutover状態へ戻し、途中を省略しない。

```text
pinned baseline Rules deploy
→ 最大10分待機
→ fresh staff/admin/portalでbaseline read smoke
→ 利用可能ならAudit Logsを補助証跡として確認（未設定はwarning）
→ Rules baseline read roleとdata migration roleをそれぞれ剥奪
→ 10分以上待機
→ read-only IAM policyと各principalのpermission検査で権限消失を二回連続確認
→ 各credential contextを破棄
→ maintenance解除・既存writer再開
```

baseline read smokeでは、cutover前Hostingのstaff/admin/portalの既存read pathと認証だけを確認し、
業務writeを行わない。新schema、`transitionPlan`、rollout gate、reset markerは期待条件に含めない。
一つでもbaseline readまたはIAM剥奪の確認に失敗した場合はmaintenanceを解除せず、
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
  --key-id='<snapshot-key-id>' \
  --snapshot-storage-mode=icloud_encrypted
```

出力は件数、status集計、write数、決定的なrequest bytes上限、hash、data用の必要7 permissionの確認数だけとし、document ID、
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
  --snapshot-storage-mode=icloud_encrypted \
  --output="$HOME/Library/Mobile Documents/com~apple~CloudDocs/TankCutover/<snapshot-file>"

npm run --silent cutover:snapshot:reset -- \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='<database-uid>' \
  --expected-main-commit='<current-main-sha>' \
  --expected-data-principal='<data-migration-service-account-email>' \
  --key-id='<snapshot-key-id>' \
  --snapshot-storage-mode=icloud_encrypted \
  --snapshot="$HOME/Library/Mobile Documents/com~apple~CloudDocs/TankCutover/<snapshot-file>"
```

上記の実行順は、Rules baseline readerによる照合 → Rules deploy principalによるfreeze →
Rules reader credential破棄・role剥奪 → data migration credentialへ切り替え → read-only preflight →
snapshot作成 → reset dry-runとする。Rules readerでdata操作を行わない。

preflightとsnapshot作成結果では対象counts、inventory、`sourceCensusSha256`、
`documentPathSha256`を比較する。preflightと、そのsnapshotを入力したReset dry-runではstatus集計、
write数、決定的なrequest bytes上限も比較する。この上限は全Firestore timestampを最大幅へ置換した
計測用copyから算出し、実際のtimestampやcommit bodyは変更しない。実bodyはこの上限以下でなければ停止し、
lower REST clientの認可は引き続き実bodyそのもののSHA-256へ結び付ける。snapshot ID・作成日時を含むpayload hashとreset plan hashは
preflightごとに変わり得るため比較対象にしない。reset plan hashは、同じ暗号化snapshotを入力した
dry-runとexecute間でだけ一致させる。

snapshot作成直後にKeychainから鍵を再取得し、同じ暗号化fileの読取・AES-GCM復号・
payload SHA-256・canonical検証・document countをReset dry-runで実行する。snapshot作成時にはrestoreの
write数・request bytes上限も内部検査するが、この値はsnapshot作成commandの比較証跡には出力しない。migration markerがまだ存在しないため、この時点で実状態を入力にする
restore dry-runは実行しない。実際のrestore dry-runはReset成功後、最初のstrict業務writeより前に行う。一時平文fileは作らず、
snapshot鍵・平文payload・document IDをstdout / stderrへ出さない。復号またはhashが一致しなければ停止する。

### 7.1 固定契約によるproduction Reset

Phase 3 merge後の最終main SHAを取得したら、Rules / data / human evidenceをそのSHAへ結び付けて再生成し、
cleanなmainで`cutover:readiness`が`GO`かつgate postureが
`armed_for_fixed_transition_v1`であることを確認する。古いmain SHAへ結び付いた証跡を再利用しない。

Reset dry-runの非機密summaryからsnapshot ID、snapshot payload SHA-256、source census SHA-256、
reset plan SHA-256を作業記録へ転記し、同じ暗号化snapshotを入力したexecuteへ明示する。値は
command履歴へ残り得るため秘密値を入れず、記録済みhashだけを使用する。

```bash
npm run --silent cutover:snapshot:reset -- \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='8dcf700f-01a3-4861-bee9-d901504f26b4' \
  --expected-main-commit='<final-main-sha>' \
  --expected-data-principal='transition-cutover-data@okmarine-tankrental.iam.gserviceaccount.com' \
  --key-id='<snapshot-key-id>' \
  --snapshot-storage-mode=icloud_encrypted \
  --snapshot="$HOME/Library/Mobile Documents/com~apple~CloudDocs/TankCutover/<snapshot-file>" \
  --operator-principal='user:okmarineclub@gmail.com' \
  --expected-snapshot-id='<recorded-snapshot-id>' \
  --expected-snapshot-payload-sha256='<recorded-snapshot-payload-sha256>' \
  --expected-source-census-sha256='<recorded-source-census-sha256>' \
  --expected-reset-plan-sha256='<recorded-reset-plan-sha256>' \
  --execute \
  --confirm=EXECUTE_TRANSITION_CUTOVER_RESET_ONCE_20260718
```

CLI、reset service、lower REST clientはそれぞれ固定project / database / UID / data principal / operator、
main SHA、snapshot ID、三つのSHA、operationとwrite列を再検証する。resetは全対象writeとmarker作成を
一つのcommitへまとめ、markerの`exists:false`で一回限りにする。成功応答後も同一processのinline
verify-onlyが`reset_applied`を確認できなければ成功扱いにしない。

## 8. Ambiguous outcome

commit応答が不明な場合、freezeとwriter停止を維持し、自動再commitを禁止する。
reset / restore CLIは通常の成功応答時にもinline verify-onlyを必ず実行する。commit APIの応答が
timeout等で不明な場合も、serviceはcommitを再送せず、同じsnapshotを正本とするread-backだけを反復する。

```bash
npm run --silent cutover:verify -- \
  --operation=reset \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='<database-uid>' \
  --expected-main-commit='<current-main-sha>' \
  --expected-data-principal='<data-migration-service-account-email>' \
  --key-id='<snapshot-key-id>' \
  --snapshot-storage-mode=icloud_encrypted \
  --snapshot="$HOME/Library/Mobile Documents/com~apple~CloudDocs/TankCutover/<snapshot-file>"
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

Reset execute成功後も、次の順序を崩さない。

```text
schema verification
→ 必須restore dry-run・snapshot/hash/write数/request bytes上限の記録
→ rollout gate=falseのHosting deploy
→ dedicated normal Rules deploy
→ 最大10分待機
→ staff/admin/portal read / cancel smoke
→ explicit point-of-no-return
→ strict充填 → 貸出 → 返却 smoke
→ 利用可能ならAudit Logsを補助確認
→ maintenance解除
```

schema verification直後、Hosting deployより前にsection 10と同じrestore commandを`--execute`なしで実行する。
この必須dry-runでreset marker、current exact reset state、snapshot ID、payload / source / reset-plan SHA、
write数、決定的なrequest bytes上限を確認して作業記録へ保存する。失敗時はHostingや通常Rulesへ進まず、
freezeを維持して停止する。このdry-runは復元を実行せず、最初のstrict業務writeまでのexact restore可能性を証明する。

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

### 9.1 Exact restoreを保ったread / cancel smoke

この段階ではrestoreが要求するexact reset状態を壊さないため、業務writeを送信しない。

| scenario | 期待結果 | 失敗時 |
|---|---|---|
| 管理設定 | 保存policy=`strict`、runtime表示=`strict`、gate停止表示 | freezeを再deployしてexact restore / rollback判断 |
| staff | tank一覧・dashboardが読め、操作確認をcancelするとwrite 0件 | 同上 |
| admin | review一覧、billing、sales、staff実績、個別/一括印刷previewがschema errorなく読める | 同上 |
| portal | setup済み顧客でhome・履歴が読め、transaction submitはしない | 同上 |
| migration state | `cutover:verify --operation=reset`が`reset_applied`、`targetStateConfirmed=true` | 同上 |
| audit（利用可能な場合） | 想定外writeがない | warningと実測結果を記録 |

unexpected `permission-denied`、旧schema error、runtime advisory、mixed state、cancel後writeが
一つでもあれば、利用者へ開放せずdedicated freeze Rulesを再deployし、10分待ってから停止判断する。

### 9.2 Point-of-no-returnとstrict業務smoke

section 9.1の全項目成功後、operatorは「次の最初の業務write以後、snapshotのexact restore契約は
そのままでは成立しない」ことを作業記録に明示する。ここがpoint-of-no-returnである。
専用test tank一件に限り、maintenanceを維持したまま次を順番に行う。

```text
empty
→ strict充填
→ strict貸出
→ strict返却
```

操作ごとに保存後reload、一操作一tank log、必須`transitionPlan`、tank snapshotとlogのatomic対応、
policy=`strict`、rollout gate=false、advisory recovery不可を確認する。返却後にbilling、sales、staff実績、
個別/一括印刷を再取得し、raw codeや内部fieldがUIへ露出しないことも確認する。

最初のwrite後に一つでも失敗した場合、即時にfreeze Rulesを再deployしてmaintenanceを維持する。
履歴を削除したり「exact snapshot restoreがまだ可能」と扱ったりせず、incidentとしてforward-fixする。
restoreが必要な場合は、新規smoke logとtank updateを含む現状を別途評価し、既存snapshotをblindに適用しない。

### 9.3 証跡、IAM剥奪、maintenance解除

次をcutover記録へ保存する。

- operator、開始・point-of-no-return・完了時刻、main SHA、Hosting release ID
- snapshot ID、payload/source/reset-plan SHA、verify stable-state SHA
- migration markerのscript version `2`、operator principal、data principal、作成・削除の確認結果
- baseline live照合時のrelease/ruleset metadata、baseline / freeze / post-cutover Rules SHAと各deploy結果
- staff/admin/portalのread / cancel / strict write smoke結果、Audit Logsが利用可能ならquery期間と確認principal
- Rules baseline read principal、2-permission role、付与・剥奪時刻、baseline照合結果、
  project/folder/organizationのread-only IAM policyレビュー結果
- data migration principal、7-permission role、付与・剥奪時刻、各data commandのprincipal照合結果、
  project/folder/organizationのread-only IAM policyレビュー結果
- Rules deploy principal、deploy時刻、Rules reader / data migrationと異なprincipalであることの確認
- impersonationを使う場合はsource / target principal、Token Creator binding、token有効期限。
  Audit Logs証跡がない場合はwarningとして残す

Rules baseline read roleはsection 6へ進む前に剥奪済みとする。smoke成功後、data migration roleを剥奪する。
最低10分待ってから同じ`cutover:preflight`を実行し、
data readへ進む前に「必要なIAM権限が不足」とfail closedすることを二回確認する。権限が一つでも残る、
または結果が揺れる場合はmaintenanceを解除しない。上記とstrict smokeが成功した場合だけ
maintenanceを解除する。advisoryは有効化しない。

## 10. Rollback

このexact snapshot rollbackはsection 9.2のpoint-of-no-returnより前だけを対象とする。
最初のstrict業務write後は新しいlogとtank updateがあるため、本節をそのまま適用せずfreeze + forward-fixとする。

point-of-no-return前は、freezeとwriter停止を維持したまま、暗号化snapshotからrestoreを計画し、
Phase 3の固定restore契約でだけ実行する。restoreが曖昧なら`--operation=restore`でverify-onlyを行う。

まず本番writeなしのrestore dry-runを実行し、reset時に記録した同じsnapshot/hashを確認する。

```bash
npm run --silent cutover:snapshot:restore -- \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='8dcf700f-01a3-4861-bee9-d901504f26b4' \
  --expected-main-commit='<recorded-main-sha>' \
  --expected-data-principal='transition-cutover-data@okmarine-tankrental.iam.gserviceaccount.com' \
  --key-id='<snapshot-key-id>' \
  --snapshot-storage-mode=icloud_encrypted \
  --snapshot="$HOME/Library/Mobile Documents/com~apple~CloudDocs/TankCutover/<snapshot-file>"
```

dry-runがreset marker、current exact reset state、snapshot ID、payload / source / reset-plan SHAを完全一致で
確認した場合だけ、同じ記録値を次のguarded executeへ渡す。

```bash
npm run --silent cutover:snapshot:restore -- \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='8dcf700f-01a3-4861-bee9-d901504f26b4' \
  --expected-main-commit='<recorded-main-sha>' \
  --expected-data-principal='transition-cutover-data@okmarine-tankrental.iam.gserviceaccount.com' \
  --key-id='<snapshot-key-id>' \
  --snapshot-storage-mode=icloud_encrypted \
  --snapshot="$HOME/Library/Mobile Documents/com~apple~CloudDocs/TankCutover/<snapshot-file>" \
  --operator-principal='user:okmarineclub@gmail.com' \
  --expected-snapshot-id='<recorded-snapshot-id>' \
  --expected-snapshot-payload-sha256='<recorded-snapshot-payload-sha256>' \
  --expected-source-census-sha256='<recorded-source-census-sha256>' \
  --expected-reset-plan-sha256='<recorded-reset-plan-sha256>' \
  --execute \
  --confirm=EXECUTE_TRANSITION_CUTOVER_RESTORE_ONCE_20260718
```

restoreはresetとは異なるconfirmationを要求し、markerに保存されたversion `2`、operator、data principal、
snapshotとhashを再検証する。tank復元、log / transaction再作成、marker削除を一つのcommitへまとめ、
execute直後のinline verify-onlyが`source_or_restored_observed`を確認できなければ成功扱いにしない。
ambiguous response時もcommitを再送しない。

```text
snapshot restore
→ snapshot内容との完全一致確認
→ rollback対象Hosting release
→ pinned pre-cutover baseline Rules
→ 最大10分待機
→ baseline rollback smoke
→ 利用可能ならAudit Logs確認（未設定はwarning）
→ Rules baseline read roleとdata migration roleをそれぞれ剥奪・権限消失確認
→ maintenance解除・writer再開
```

snapshot復号不可、principal不一致、IAM不足、unknown状態、snapshot後drift、subcollection、
hash不一致のいずれかがあれば、restore / resetを実行せずincidentとして扱う。

Hosting rollbackはcutover前に記録したreleaseをFirebase Consoleで選び、現在のworktreeから再buildして
代用しない。Rules rollbackは
section 5のhash確認済み`firebase.cutover-baseline.json`だけを使い、post-cutover normal configを使わない。
baseline rollback smokeはcutover前Hostingのstaff/admin/portalの既存read pathと認証を対象とし、
section 9.1の新`transitionPlan`、rollout gate、reset markerを期待しない。業務writeは送信せず、
操作画面ではcancel時にwrite 0件であることだけを確認する。成功後もsection 9.3と同じIAM確認と、
Audit Logsが利用可能な場合の補助確認を行い、
IAM剥奪、10分以上の反映待ち、権限不足の二回連続確認を行い、それからmaintenance解除とwriter再開へ進む。

cutover成功またはrollback完了後は、production reset / restoreのCLI、service、lower REST clientの
5境界を再び閉じる専用PRを直ちに作成する。advisory rollout gateはこの作業で有効化しない。
