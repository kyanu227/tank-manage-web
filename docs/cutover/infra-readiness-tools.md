# Transition cutover infra / readiness tools

更新日: 2026-07-17

## Scope

transition cutover前のGoogle Cloud環境準備を補助する一度限りの運用toolを定義する。
app runtime、Hosting、Firestore Rules、Firestore document、production reset / restore gateは変更しない。

toolは`okmarine-tankrental`へ固定され、次だけを扱う。

- data migration service accountと7-permission custom role
- Rules baseline reader service accountと2-permission custom role
- 24時間以内の期限付きdirect role binding
- operatorから各target SAへの期限付き`roles/iam.serviceAccountTokenCreator`
- `datastore.googleapis.com`の`DATA_WRITE` Data Access Audit Logs
- snapshot keyのmacOS Keychain登録
- repository内Admin SDK credential候補のread-only棚卸し
- live Rules baselineとproduction document preflightの分離証跡

既存roleのupdate/delete、Owner/Editorの削除、既存SA keyの失効・削除、OAuth session失効、
Rules/Hosting deploy、Firestore writeは実装していない。

## Prerequisites

- macOSとlocal APFS上の非同期snapshot directory
- Google Cloud SDK (`gcloud`)
- active gcloud account/projectが明示operatorと`okmarine-tankrental`に一致
- snapshot directoryと証跡fileはrepository、iCloud Mobile Documents、CloudStorage外
- 証跡fileはowner本人、permission `0600`、hard link数1
- binding expirationは明示RFC3339 UTC、実行時刻より未来、24時間以内

`gcloud`が見つからない場合、plan/readinessはfail closedとなる。別credentialへfallbackしない。

## Commands

```bash
PROJECT='okmarine-tankrental'
OPERATOR='user:<cutover-operator-email>'
RULES_DEPLOY='user:<rules-deploy-email>'
EXPIRES_AT='<RFC3339-UTC-within-24-hours>'
KEY_ID='<snapshot-key-id>'
SNAPSHOT_DIR='<absolute-non-synced-apfs-directory>'
MAIN_SHA='<final-main-sha>'
DATABASE_UID='<production-database-uid>'
```

### Read-only plan

```bash
npm run --silent cutover:infra:plan -- \
  --project="$PROJECT" \
  --expected-operator-principal="$OPERATOR" \
  --rules-deploy-principal="$RULES_DEPLOY" \
  --binding-expires-at="$EXPIRES_AT" \
  --key-id="$KEY_ID" \
  --snapshot-directory="$SNAPSHOT_DIR"
```

`plan`はgcloud、Keychain、filesystemをread-onlyで検査する。Keychainの鍵は秘密用Bufferだけで取得し、
canonical Base64の32-byte値であることを検証後にzeroizeする。本文をstring、stdout、stderr、reportへ残さない。
Admin SDK JSONはpath、private key、key IDを出力せず、件数、対応SA、active user-managed key数だけを要約する。
keyの最終利用を自動断定しない。

### Guarded apply

```bash
npm run --silent cutover:infra:apply -- \
  --project="$PROJECT" \
  --expected-operator-principal="$OPERATOR" \
  --rules-deploy-principal="$RULES_DEPLOY" \
  --binding-expires-at="$EXPIRES_AT" \
  --key-id="$KEY_ID" \
  --snapshot-directory="$SNAPSHOT_DIR" \
  --execute \
  --confirm=PREPARE_TRANSITION_CUTOVER_INFRA
```

`--execute`と完全一致するconfirmationのどちらかがなければ、git、gcloud、Keychainへaccessする前に拒否する。
既存resourceが完全一致ならno-opとし、権限不足・過剰、無期限binding、別condition、disabled SA、
user-managed key、Audit exemption等のdriftは更新せず停止する。

apply全体はcross-resource atomicではない。先に全driftを検査し、unprivilegedなSA/roleを作成して再検査し、
etag付きpolicyを一度だけ設定し、Keychainを最後に作成する。途中結果が曖昧ならblind retryせず、planを人間が再実行する。
部分成功後の再実行では、expirationを含む同一引数を使う。別expirationで既存bindingを置換せず、driftとして停止する。

## Credential separation and fresh evidence

Rules readerとdata migration credentialを同じprocessへ載せない。別processから安全要約だけを
non-synced APFS上の`0600` fileへ保存する。

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
  > '<non-synced-apfs>/rules-evidence.json'

# Rules process/credentialを破棄後、data用の別隔離HOME/config subshell内で実行する。
umask 077
npm run --silent cutover:preflight -- \
  --project="$PROJECT" \
  --database='(default)' \
  --expected-database-uid="$DATABASE_UID" \
  --expected-main-commit="$MAIN_SHA" \
  --expected-data-principal='transition-cutover-data@okmarine-tankrental.iam.gserviceaccount.com' \
  --key-id="$KEY_ID" \
  --readiness-evidence \
  > '<non-synced-apfs>/data-evidence.json'
```

各証跡はproject、main SHA、credential principalのSHA-256、生成時刻、payload hashへ結び付く。
15分を超えた証跡、未来時刻、別project/main/principal、改ざん、database不一致は拒否する。
Rules evidenceはhashだけで判定せず、pinned manifestのrelease ID、release update time、ruleset ID、
normalized SHA-256、normalized byte数のすべてと一致する場合だけ有効とする。

## Human evidence

GAS、Make、Zapier、別PC、Owner手動write、group membership、親階層access、Audit Logs観測期間、
Firebase CLI sessionとRules deploy principalの一致、鍵の別媒体復旧drillはrepositoryから不存在・一致を
証明できない。未回答は常に`unknown`でNO-GOとなる。

保存先の機械検査はrepository、iCloud Mobile Documents、`~/Library/CloudStorage`を拒否するが、
任意場所を同期するSyncthing等のdaemonまでは検出できない。human evidence作成時に指定した
`SNAPSHOT_DIR`が他の同期・バックアップ対象でないことも確認し、未確認ならGO判定を採用しない。

同期領域外の`0600` JSONへ次のfieldだけを保存する。

```json
{
  "version": 1,
  "projectId": "okmarine-tankrental",
  "mainCommit": "<final-main-sha>",
  "keyId": "<snapshot-key-id>",
  "expectedOperatorPrincipal": "user:<cutover-operator-email>",
  "rulesDeployPrincipal": "user:<rules-deploy-email>",
  "reviewedAt": "<RFC3339-UTC-within-60-minutes>",
  "reviewerPrincipal": "user:<reviewer-email>",
  "writers": {
    "cloud_functions": "unknown",
    "cloud_run_services": "unknown",
    "cloud_run_jobs": "unknown",
    "app_engine": "unknown",
    "cloud_scheduler": "unknown",
    "workflows": "unknown",
    "pubsub_eventarc_cloud_tasks": "unknown",
    "firebase_extensions": "unknown",
    "ci_other_repositories": "unknown",
    "local_scripts_cron": "unknown",
    "manual_rest_rpc": "unknown",
    "gas": "unknown",
    "make": "unknown",
    "zapier": "unknown",
    "other_computers": "unknown",
    "owner_manual_writes": "unknown"
  },
  "adminSdkCredentialReview": "unknown",
  "firebaseCliSessionReview": "unknown",
  "groupMembershipReview": "unknown",
  "inheritedIamReview": "unknown",
  "auditLogObservationWindow": "unknown",
  "snapshotKeyRecoveryDrill": "unknown"
}
```

writer statusは`unknown`、`absent`、`confirmed_stopped`、confirmationは`unknown`、`confirmed`だけを許可する。
human evidenceはproduction project、最終main SHA、snapshot key ID、expected operator principal、
Rules deploy principal、人間reviewer、生成時刻へ結び付け、60分で失効する。
readiness reportのhuman evidence SHA-256と根拠をcutover作業記録へappend-onlyで残す。

## Readiness

```bash
npm run --silent cutover:readiness -- \
  --project="$PROJECT" \
  --expected-operator-principal="$OPERATOR" \
  --rules-deploy-principal="$RULES_DEPLOY" \
  --binding-expires-at="$EXPIRES_AT" \
  --key-id="$KEY_ID" \
  --snapshot-directory="$SNAPSHOT_DIR" \
  --expected-main-commit="$MAIN_SHA" \
  --database='(default)' \
  --expected-database-uid="$DATABASE_UID" \
  --human-evidence='<non-synced-apfs>/human-evidence.json' \
  --rules-baseline-evidence='<non-synced-apfs>/rules-evidence.json' \
  --data-preflight-evidence='<non-synced-apfs>/data-evidence.json'
```

exit codeはGO=`0`、NO-GO=`2`、tool failure=`1`。GOでもproduction execute gateは閉じたままであり、
reset CLI、restore CLI、reset service、restore service、lower REST commitの5境界は独立したfalse gateである。
execute解放はoperator/reviewer、二名確認、one-time contractを追加する別PRでだけ行う。

## IAM limitations

`testIamPermissions`は要求permissionの存在だけを示し、余剰permission不存在を証明しない。
project/folder/organization policy、target SA policy、group membership、継承roleをread-onlyで監査する。
取得不能・部分結果は`unknown`でNO-GOとする。Audit Logs設定は階層unionであり、親のexemptionをprojectで
打ち消せない。DATA_WRITE有効化後の十分な観測期間より前の0件をwriter不存在の証拠にしない。
