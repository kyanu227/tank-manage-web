# transitionPlan v1 cutover runbook

更新日: 2026-07-14

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
- dedicated credentialへの本番IAM付与: 運用時に別承認
- freeze / normal Rules deploy: 未実施
- Hosting deploy、snapshot本番取得、Data Reset: 未実施

## 3. Cutover前準備

1. [Rules迂回writer棚卸し](./rules-bypass-writer-inventory.md)を全件記入する。
2. `datastore.googleapis.com`のData Access `DATA_WRITE` audit logが有効で、対象principalに
   exemptionがないことを確認する。Data Access logは通常無効なので、未設定・保存期間不足なら
   writer不存在の証明に使わず、cutoverを停止する。
3. Cloud Audit Logsで直近のFirestore write principalを列挙する。
4. migration専用service account以外のwriterを停止または一時権限剥奪する。
5. migration用のcustom roleは次の9 permissionだけとし、maintenance直前に期限付きで付与し、
   normal復帰またはrollback完了直後に剥奪して再検査する。
6. freshな専用service accountのproject/folder/organization実効bindingを確認し、Owner、Editor、
   Datastore Owner/User、Firebase Rules Viewer等の広いrole、group経由role、9 permission以外の
   継承権限がないことを記録する。
   `testIamPermissions`は必要権限の存在だけを確認し、余分な権限の不存在は証明しない。
7. IAM policy変更後は最低10分待ち、反復したpermission確認が一致するまで進まない。公式には通常約2分、
   7分以上かかる場合もあり、group変更はさらに長いため専用principalをgroupへ入れない。
8. `GOOGLE_APPLICATION_CREDENTIALS`やuser ADCを暗黙利用せず、`--expected-principal`を照合する。
9. credentialには次の最小permissionだけをレビューする。
   - `datastore.databases.get`
   - `datastore.databases.getMetadata`
   - `datastore.entities.get`
   - `datastore.entities.list`
   - `datastore.entities.create`
   - `datastore.entities.update`
   - `datastore.entities.delete`
   - `firebaserules.releases.get`
   - `firebaserules.rulesets.get`
10. local service-account JSONを使う場合はrepository・同期folder外、owner本人、`0600`、hard link数1とする。
    repository直下の`firebase-service-account.json`や`*-firebase-adminsdk-*.json`は、使用中でなくても
    production CLIをfail closedさせる。使用履歴を確認し、有効な鍵なら失効してから安全な場所へ移すか削除する。
11. main SHA、現在のHosting release、通常Rules file hash、rollback対象Rules commit、live Rulesの
    release更新日時とruleset IDを記録する。

参考:

- <https://docs.cloud.google.com/logging/docs/audit/configure-data-access>
- <https://docs.cloud.google.com/firestore/native/docs/audit-logging>
- <https://docs.cloud.google.com/iam/docs/access-change-propagation>

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
  --expected-principal='<migration-service-account-email>'
```

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
成功後は他のRules deploy権限者・CIを動かさず、直ちに次のfreeze deployへ進む。

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
5. Audit Logsにmigration principal以外のwriteがないことを再確認する。

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
→ migration custom roleを剥奪
→ 10分以上待機
→ cutover:preflightがIAM不足で二回連続fail closedすることを確認
→ maintenance解除・既存writer再開
```

baseline read smokeでは、cutover前Hostingのstaff/admin/portalの既存read pathと認証だけを確認し、
業務writeを行わない。新schema、`transitionPlan`、rollout gate、reset markerは期待条件に含めない。
一つでもbaseline read、Audit Logs、IAM剥奪の確認に失敗した場合はmaintenanceを解除せず、
baseline Rulesの伝播完了を待ったままincidentとして扱う。

## 6. Read-only preflight

freeze後、production writeを行わずにprincipal、IAM、database UID、main SHA、census、unknown record、
subcollection、marker、予定write数・request sizeを検査する。

```bash
npm run --silent cutover:preflight -- \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='<database-uid>' \
  --expected-main-commit='<current-main-sha>' \
  --expected-principal='<migration-service-account-email>' \
  --key-id='<snapshot-key-id>'
```

出力は件数、status集計、write数、request bytes、hash、必要9 permissionの確認数だけとし、document ID、
顧客名、location、field内容、token、credential pathを含めない。

## 7. SnapshotとReset dry-run

```bash
npm run --silent cutover:snapshot:create -- \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='<database-uid>' \
  --expected-main-commit='<current-main-sha>' \
  --expected-principal='<migration-service-account-email>' \
  --key-id='<snapshot-key-id>' \
  --output='<local-non-sync-absolute-path>'

npm run --silent cutover:snapshot:reset -- \
  --project=okmarine-tankrental \
  --database='(default)' \
  --expected-database-uid='<database-uid>' \
  --expected-main-commit='<current-main-sha>' \
  --expected-principal='<migration-service-account-email>' \
  --key-id='<snapshot-key-id>' \
  --snapshot='<local-non-sync-absolute-path>'
```

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
  --expected-principal='<migration-service-account-email>' \
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
| audit | DATA_WRITEがmigration principalと事前記録したsmoke auth/session更新だけ | 同上 |

unexpected `permission-denied`、旧schema error、runtime advisory、mixed state、未記録principal/pathのwriteが
一つでもあれば、利用者へ開放せずdedicated freeze Rulesを再deployし、10分待ってdeny smokeをやり直す。

### 9.2 証跡とIAM剥奪

次をcutover記録へ保存する。

- operator / reviewer、開始・完了時刻、main SHA、Hosting release ID
- snapshot ID、payload/source/reset-plan SHA、verify stable-state SHA
- baseline live照合時のrelease/ruleset metadata、baseline / freeze / post-cutover Rules SHAと各deploy結果
- staff/admin/portal smoke結果、Audit Logs query期間、確認principal、許可したauth/session更新path
- migration custom roleの付与・剥奪時刻、実効bindingレビュー結果

smoke成功後、migration custom roleを剥奪する。最低10分待ってから同じ`cutover:preflight`を実行し、
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
  --expected-principal='<migration-service-account-email>' \
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
→ migration custom role剥奪・権限消失確認
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
