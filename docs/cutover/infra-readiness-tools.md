# Transition cutover infra / readiness tools

更新日: 2026-07-18

## Scope

transition cutover前のGoogle Cloud環境準備を補助する一度限りの運用toolを定義する。
infra plan / apply / readiness自体はapp runtime、Hosting、Firestore Rules、Firestore document、
production reset / restore gateを変更しない。Phase 3でproduction executeは別の固定one-time契約としてarmedされ、
readinessは「全境界closed」または「全境界が固定契約へ安全にarmed」のどちらかだけを受理する。

toolは`okmarine-tankrental`へ固定され、次だけを扱う。

- data migration service accountと7-permission custom role
- Rules baseline reader service accountと2-permission custom role
- 24時間以内の期限付きdirect role binding
- operatorから各target SAへの期限付き`roles/iam.serviceAccountTokenCreator`
- `datastore.googleapis.com`の`DATA_WRITE` Data Access Audit Logsのread-only状態確認
- snapshot keyのmacOS Keychain登録
- repository外のsnapshot directoryの安全性確認（推奨iCloud directoryが未作成ならguarded applyで作成）
- repository内Admin SDK credential候補のread-only棚卸し
- live Rules baselineとproduction document preflightの分離証跡

既存roleのupdate/delete、Owner/Editorの削除、既存SA keyの失効・削除、OAuth session失効、
Rules/Hosting deploy、Firestore writeは実装していない。

## Prerequisites

- macOS、OpenJDK 21、Google Cloud SDK (`gcloud`)
- active gcloud account/projectが明示operatorと`okmarine-tankrental`に一致
- snapshot directoryはrepository外。`local_encrypted`は非同期APFS、`icloud_encrypted`は暗号化済みiCloud Driveだけを許可
- iCloudの推奨先は`~/Library/Mobile Documents/com~apple~CloudDocs/TankCutover/`
- snapshotはAES-256-GCM暗号化済みだけとし、鍵はsnapshot fileや同directoryに置かずmacOS Keychainに分離
- 証跡fileもrepository外。機密値を含む場合はowner本人、permission `0600`、hard link数1
- binding expirationは明示RFC3339 UTC、実行時刻より未来、24時間以内

`gcloud`が見つからない場合、plan/readinessはfail closedとなる。別credentialへfallbackしない。

Homebrewを使えるMacでは次を確認する。既存OpenJDK 21があれば再installせず、
`JAVA_HOME` / `PATH`をそのprocessに限定して選択する。

```bash
brew --version
test -x /opt/homebrew/opt/openjdk@21/bin/java || brew install openjdk@21
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
java -version

command -v gcloud >/dev/null || brew install --cask gcloud-cli
gcloud version
```

## Commands

```bash
PROJECT='okmarine-tankrental'
OPERATOR='user:okmarineclub@gmail.com'
RULES_DEPLOY='user:<rules-deploy-email>'
EXPIRES_AT='<RFC3339-UTC-within-24-hours>'
KEY_ID='transition-cutover-20260718-v2'
SNAPSHOT_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/TankCutover"
SNAPSHOT_STORAGE_MODE='icloud_encrypted' # or local_encrypted
MAIN_SHA='<final-main-sha>'
DATABASE_UID='8dcf700f-01a3-4861-bee9-d901504f26b4'
```

### Read-only plan

```bash
npm run --silent cutover:infra:plan -- \
  --project="$PROJECT" \
  --expected-operator-principal="$OPERATOR" \
  --rules-deploy-principal="$RULES_DEPLOY" \
  --binding-expires-at="$EXPIRES_AT" \
  --key-id="$KEY_ID" \
  --snapshot-directory="$SNAPSHOT_DIR" \
  --snapshot-storage-mode="$SNAPSHOT_STORAGE_MODE"
```

`plan`はgcloud、Keychain、filesystemをread-onlyで検査する。Keychainの鍵は秘密用Bufferだけで取得し、
canonical Base64の32-byte値であることを検証後にzeroizeする。本文をstring、stdout、stderr、reportへ残さない。
Admin SDK JSONはpath、private key、key IDを出力せず、件数、対応SA、active user-managed key数だけを要約する。
keyの最終利用を自動断定しない。

Keychain登録では`security add-generic-password -w`のTTY promptを使う。review済みのExpect scriptを
cleanな最新mainのHEAD blobからlocal temporary directoryへ展開し、Apple署名済みの
`/usr/bin/expect`を`-N -n -f`で起動してsystem／user startup fileを無効化し、
`/usr/bin/security`をPTY起動する。秘密は44-byte canonical Base64のstdinだけで渡し、
argv、環境変数、file、stdout、stderrに出さない。`-T /usr/bin/security`だけを設定し、`-U`は使用せず
既存entryを更新しない。Nodeが所有する生成bufferは実行後にzeroizeし、Expectはログを無効化して
直ちに終了する（Tcl allocator内の全一時copyのzeroizeまでは保証しない）。temporary scriptは削除する。
本番readerも秘密を文字列化せずBufferで取得する。Google credential用の隔離`HOME`は親processに維持し、
`security`／Expectの子processだけへOS accountの
正規homeを渡す。この子process環境へADC、gcloud、OAuth関連の環境変数を渡さない。

2026-07-18の初回準備では、旧CLIの`-w` stdin誤用によってkey ID
`transition-cutover-20260718-v1`へ空entryが作成された。暗号化snapshotは1件も作成されていないが、
このentryを自動削除・上書きせず、cutoverでは新しい`transition-cutover-20260718-v2`を使用する。
旧entryの削除はcutover完了後の明示的なKeychain cleanupとして分離する。

### Guarded apply

```bash
npm run --silent cutover:infra:apply -- \
  --project="$PROJECT" \
  --expected-operator-principal="$OPERATOR" \
  --rules-deploy-principal="$RULES_DEPLOY" \
  --binding-expires-at="$EXPIRES_AT" \
  --key-id="$KEY_ID" \
  --snapshot-directory="$SNAPSHOT_DIR" \
  --snapshot-storage-mode="$SNAPSHOT_STORAGE_MODE" \
  --execute \
  --confirm=PREPARE_TRANSITION_CUTOVER_INFRA
```

`--execute`と完全一致するconfirmationのどちらかがなければ、git、gcloud、Keychainへaccessする前に拒否する。
既存resourceが完全一致ならno-opとし、権限不足・過剰、無期限binding、別condition、disabled SA、
user-managed key等のIAM driftは更新せず停止する。DATA_WRITE Audit Logsの未設定やexemptionは
今回のpre-production cutoverではwarningとし、applyがAudit Logs設定を追加・変更しない。

apply全体はcross-resource atomicではない。先に全driftを検査し、unprivilegedなSA/roleを作成して再検査し、
etag付きpolicyを一度だけ設定し、snapshot directoryとKeychainを最後に作成する。
directoryは新規作成だけを許可し、既存の非directory・symlink・repository内pathには触れない。
途中結果が曖昧ならblind retryせず、planを人間が再実行する。
部分成功後の再実行では、expirationを含む同一引数を使う。別expirationで既存bindingを置換せず、driftとして停止する。

## Credential separation and fresh evidence

Rules readerとdata migration credentialを同じprocessへ載せない。別processから安全要約だけを
`$SNAPSHOT_DIR`配下の`0600` fileへ保存する。これらはproject / principal / 件数 / hashだけを持ち、
credential、Firestore document本文、snapshot平文は含まない。credential用隔離`HOME`は
同期領域外のAPFSを使い、iCloud snapshot directoryと共用しない。

長期service-account JSON keyは作成しない。Node.js clientのproduction readには、operatorが
`roles/iam.serviceAccountTokenCreator`を持つ間だけ、非同期APFS上の隔離した`HOME`と
`CLOUDSDK_CONFIG`でservice-account impersonation ADCを作る。Google authentication libraryが探す
well-known ADC pathは`HOME`配下にあるため、`CLOUDSDK_CONFIG`だけの隔離では不十分である。
各processの終了後にADCをrevokeし、隔離HOME全体を削除する。

```bash
umask 077
RULES_HOME='<non-synced-apfs>/rules-reader-home'
RULES_CONFIG="$RULES_HOME/.config/gcloud"
mkdir -p -m 700 "$RULES_CONFIG"
(
  export HOME="$RULES_HOME"
  export CLOUDSDK_CONFIG="$RULES_CONFIG"
  unset GOOGLE_APPLICATION_CREDENTIALS GOOGLE_IMPERSONATE_SERVICE_ACCOUNT \
    CLOUDSDK_AUTH_ACCESS_TOKEN CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT CLOUDSDK_CORE_ACCOUNT CLOUDSDK_CORE_PROJECT
  gcloud auth application-default login \
    --impersonate-service-account='transition-rules-reader@okmarine-tankrental.iam.gserviceaccount.com'

  # 後述のRules evidence commandだけを、この位置で同じ隔離HOME/config内から実行する。
  gcloud auth application-default revoke --quiet
)
rm -rf "$RULES_HOME"
```

data principalも別の隔離`HOME`・configuration・processで同じ手順を行う。隔離`HOME`、
`CLOUDSDK_CONFIG`、ADCをRules/data間で再利用しない。infra plan/apply/readiness自身はambient credential
overrideを拒否するため、証跡用subshellを終了し、隔離directoryを削除した後、元の`HOME`で実行する。
公式契約: [service account impersonation](https://cloud.google.com/docs/authentication/use-service-account-impersonation)、
[`gcloud auth application-default login`](https://cloud.google.com/sdk/gcloud/reference/auth/application-default/login)。

```text
Rules reader context → live Rules evidence → process終了・credential破棄
data migration context → production preflight evidence → process終了
cutover:readiness → 2証跡を検証・統合
```

```bash
# このRules commandはRules reader用subshellのlogin後・revoke前に実行する。
umask 077
npm run --silent cutover:rules:verify-baseline -- \
  --project="$PROJECT" \
  --expected-main-commit="$MAIN_SHA" \
  --expected-data-principal='transition-cutover-data@okmarine-tankrental.iam.gserviceaccount.com' \
  --expected-rules-principal='transition-rules-reader@okmarine-tankrental.iam.gserviceaccount.com' \
  --readiness-evidence \
  > "$SNAPSHOT_DIR/rules-evidence.json"

# Rules process/credentialを破棄後、data用の別隔離HOME/config subshell内で実行する。
umask 077
npm run --silent cutover:preflight -- \
  --project="$PROJECT" \
  --database='(default)' \
  --expected-database-uid="$DATABASE_UID" \
  --expected-main-commit="$MAIN_SHA" \
  --expected-data-principal='transition-cutover-data@okmarine-tankrental.iam.gserviceaccount.com' \
  --key-id="$KEY_ID" \
  --snapshot-storage-mode="$SNAPSHOT_STORAGE_MODE" \
  --readiness-evidence \
  > "$SNAPSHOT_DIR/data-evidence.json"
```

各証跡はproject、main SHA、credential principalのSHA-256、生成時刻、payload hashへ結び付く。
15分を超えた証跡、未来時刻、別project/main/principal、改ざん、database不一致は拒否する。
Rules evidenceはhashだけで判定せず、pinned manifest v2のrelease ID、release update time、ruleset ID、
normalized SHA-256、normalized byte数のすべてと一致する場合だけ有効とする。manifest v2は
`pinnedGitRulesFile`と`liveRulesSourceFile`を分離し、証跡生成時にはlive rulesetのsource filenameも
完全一致で検証する。

baseline Rulesをabort・rollbackで再deployすると、本文が同じでもruleset ID、release update time、
live source filenameが新しいdeploymentを表す。次回cutoverの前に安定したrelease → ruleset → releaseを取得し、
Git正本・hash・byte数が不変であることを確認してmanifestのlive attestationをレビュー付きcommitで更新する。
metadataが古いままの証跡生成や、旧filenameの互換受理はfail closedとする。

## Human evidence

今回は本稼働前の限定cutoverであり、一人のoperatorが次の5事実を明示確認する。
未回答や逆の値をツールが推測で補わず、readinessはNO-GOとする。一方、
DATA_WRITE Audit Logs、別Mac鍵復旧drill、外付けAPFS媒体、Owner手動操作不存在の企業監査証跡、
GAS / Make / Zapier / 別PCを個別に網羅した追加証明はwarning・後続推奨事項とし、
これらだけでNO-GOにしない。

repository外の`0600` JSONへ次のfieldだけを保存する。

```json
{
  "version": 1,
  "projectId": "okmarine-tankrental",
  "mainCommit": "<final-main-sha>",
  "keyId": "<snapshot-key-id>",
  "expectedOperatorPrincipal": "user:<cutover-operator-email>",
  "rulesDeployPrincipal": "user:<rules-deploy-email>",
  "reviewedAt": "<RFC3339-UTC-within-60-minutes>",
  "confirmedByPrincipal": "user:<cutover-operator-email>",
  "externalWritersConfirmedAbsent": true,
  "otherPcAutomationConfirmedAbsent": true,
  "maintenanceWindowApproved": true,
  "productionUsageStarted": false,
  "encryptedICloudSnapshotApproved": true
}
```

`confirmedByPrincipal`は`expectedOperatorPrincipal`と同一でよく、別reviewerは必須としない。
human evidenceはproduction project、最終main SHA、snapshot key ID、expected operator principal、
Rules deploy principal、生成時刻へ結び付け、60分で失効する。
readiness reportのhuman evidence SHA-256と根拠をcutover作業記録へappend-onlyで残す。

## Legacy Admin SDK credential quarantine

repository内のignored Admin SDK JSON候補は、private key・key ID・本文を出力せず棚卸し、
利用先不明のまま自動失効・削除しない。cutover前にrepository外の保護directoryへ
atomicに移動し、file permission `0600`、owner本人、repository内候補0件をread-backする。
旧principalと保管日を「利用停止中legacy credential」として記録し、失効・rotationは利用先確認後の
別作業とする。移動先はsnapshot directory、Git、shell history、共有directoryにしない。

## Readiness

Phase 3 merge後は、そのmergeを含む最終main SHAへ結び付けたRules evidence、data preflight evidence、
human evidenceをすべて再生成する。15分を超えたRules / data evidence、60分を超えたhuman evidence、
merge前mainの証跡は再利用しない。

```bash
npm run --silent cutover:readiness -- \
  --project="$PROJECT" \
  --expected-operator-principal="$OPERATOR" \
  --rules-deploy-principal="$RULES_DEPLOY" \
  --binding-expires-at="$EXPIRES_AT" \
  --key-id="$KEY_ID" \
  --snapshot-directory="$SNAPSHOT_DIR" \
  --snapshot-storage-mode="$SNAPSHOT_STORAGE_MODE" \
  --expected-main-commit="$MAIN_SHA" \
  --database='(default)' \
  --expected-database-uid="$DATABASE_UID" \
  --human-evidence="$SNAPSHOT_DIR/human-evidence.json" \
  --rules-baseline-evidence="$SNAPSHOT_DIR/rules-evidence.json" \
  --data-preflight-evidence="$SNAPSHOT_DIR/data-evidence.json"
```

exit codeはGO=`0`、NO-GO=`2`、tool failure=`1`。production execute gate postureは次のどちらかだけを
GO候補として受理する。

- `closed`: reset CLI、restore CLI、reset service、restore service、lower REST commitの5境界がすべて閉じている。
- `armed_for_fixed_transition_v1`: 5境界がすべて、後述する同一の固定one-time契約を検証できる。

一部の境界だけが開く、固定契約を構築できない、reset intentをrestoreへ流用できる等は`unsafe`でNO-GOとする。

## Phase 3 production execute contract

armed状態で許可するのは、次へ完全一致する一回限りのtransition v1 reset / restoreだけである。

- project `okmarine-tankrental`
- database `(default)`
- database UID `8dcf700f-01a3-4861-bee9-d901504f26b4`
- data principal `transition-cutover-data@okmarine-tankrental.iam.gserviceaccount.com`
- operator principal `user:okmarineclub@gmail.com`
- reset confirmation `EXECUTE_TRANSITION_CUTOVER_RESET_ONCE_20260718`
- restore confirmation `EXECUTE_TRANSITION_CUTOVER_RESTORE_ONCE_20260718`
- CLIで明示する`--expected-snapshot-id`、`--expected-snapshot-payload-sha256`、
  `--expected-source-census-sha256`、`--expected-reset-plan-sha256`

CLI、service、lower REST clientはidentity、operation、snapshot、hash、write列をそれぞれ再検証する。
markerはversion `2`、operator / data principal、snapshotとhashを保存する。commit authorizationは一回だけ
consumeされ、ambiguous outcomeでも自動再送しない。reset / restoreのexecute直後には同一processで
verify-onlyを行い、exact target stateを確認できなければ成功扱いにしない。

実際のguarded execute commandは
[`transition-plan-v1-runbook.md`](./transition-plan-v1-runbook.md)を正本とする。hash欄には同じsnapshotの
dry-runで記録した値だけを渡し、秘密値や鍵をCLI引数へ置かない。cutover後は5境界を閉じる専用PRを作成する。
Hostingは`NEXT_PUBLIC_TANK_ADVISORY_ACTIVATION_ENABLED=false`でbuildし、advisoryを有効化しない。

## IAM limitations

`testIamPermissions`は要求permissionの存在だけを示し、余剰permission不存在を証明しない。
project/folder/organization policy、target SA policy、group membership、継承roleをread-onlyで監査する。
取得不能・部分結果は`unknown`でNO-GOとする。不足・過剰IAM、project / database / UID不一致、
Rules baseline不一致、snapshot / census / hash不一致、unknown record、subcollectionはwarningへ降格しない。
projectまたはancestor IAM policyにgroup bindingが一つでもあれば、今回の五つのhuman evidenceでは
解除せずhard stopとする。対象SAのgroup経由過剰権限を機械的に否定できないためである。
Audit Logs設定は階層unionであり、親のexemptionをprojectで打ち消せない。未設定や観測期間不足は
今回warningとするが、0件をwriter不存在の監査証跡とは記録しない。
