# 残存構造課題のread-only差分監査

## 1. 監査情報

- 対象commit: 7a118a4c1bce2b12bd272a6de8a69291e9d8d2ef
- 監査日: 2026-07-19
- 基準: AGENTS.md > 現行コード > 現行テスト > 下記audit/design資料
- 対象範囲: 下記資料に記録された課題・未了項目の現行照合、および指定された重点領域・write経路・feature間importの現状記録
- 対象外: コードベース全体の再監査、設計案、リファクタ案、共通化案、変更実装

### 照合資料

- docs/refactor/refactor-roadmap.md
- docs/refactor/page-feature-boundary-audit.md
- docs/refactor/firestore-write-boundary-audit.md
- docs/refactor/staff-operation-service-boundary-design.md
- docs/design/implementation-layer-architecture.md
- docs/design/system-code-and-data-structure-audit.md
- docs/design/strict-vs-assisted-transition-mode.md
- docs/identity-and-operation-logging-design.md

### 分類

- resolved: 資料に記録された課題が現行コードでは解消済み
- partial: 一部の境界・経路は解消済みだが、同じ項目の残差がある
- unresolved: 資料の指摘内容が現行コードにも残る
- obsolete: 前提または現行方針が変わり、その項目を未了課題として扱えない
- unknown: repository内の証拠だけでは確定できない

## 2. 項目照合表

| ID | 出典資料 | 内容要約 | 分類 | 現行根拠 file:line | 備考 |
|---|---|---|---|---|---|
| R-01 | refactor-roadmap.md:82-117; page-feature-boundary-audit.md:106-120 | portal pageによるtransactions直接作成とuidのcustomerId代用 | resolved | src/lib/portal/identity.ts:94-132; src/lib/firebase/portal-transaction-service.ts:42-106,148-163; src/app/portal/order/page.tsx:61-77; src/app/portal/return/page.tsx:118-131; src/app/portal/unfilled/page.tsx:75-87 | linked/unlinked identityを分け、各pageは作成serviceを呼ぶ。 |
| R-02 | refactor-roadmap.md:101-107; page-feature-boundary-audit.md:120 | portal自動返却の時刻判定・日次実行責務 | partial | src/lib/firebase/admin-settings.ts:44-56; src/app/portal/return/page.tsx:87-106 | settings readはhelper経由。時刻比較、日次key、自動submitはpage内。 |
| R-03 | refactor-roadmap.md:111-115; page-feature-boundary-audit.md:137-139 | portal/setupによるcustomerUsers直接update | resolved | src/app/portal/setup/page.tsx:79-91; src/lib/firebase/portal-profile-service.ts:18-46 | writeはcompleteCustomerUserSetupに集約。 |
| R-04 | refactor-roadmap.md:53,181-195; page-feature-boundary-audit.md:122-135 | 旧admin/settings pageのstaff・customerUsers・settings複合責務 | partial | src/app/admin/settings/page.tsx:1-14; src/lib/firebase/staff-sync-service.ts:35-100; src/lib/firebase/customer-linking-service.ts:73-147; src/features/admin-customers/PortalUsersPanel.tsx:79-101,221-241 | 旧pageはredirect。writeはserviceへ移動したが、link actor解決はcomponent内。 |
| R-05 | refactor-roadmap.md:123-129; page-feature-boundary-audit.md:68,314-319 | customers CRUDとvalidationの画面同居 | partial | src/lib/firebase/customers-service.ts:28-45; src/features/admin-customers/CustomerManagementPage.tsx:58-77,195-225,238-278 | Firestore writeはservice化。payload構築と重複名判定はcomponent内。 |
| R-06 | refactor-roadmap.md:131-141; firestore-write-boundary-audit.md:43,128-130 | adminPermissionsのpage直接write | resolved | src/lib/firebase/admin-permissions-service.ts:17-24; src/app/admin/permissions/page.tsx:58-72 | savePermissions経由。 |
| R-07 | refactor-roadmap.md:181-195; firestore-write-boundary-audit.md:129 | customerUsersとpending orderの複数collection連動 | resolved | src/lib/firebase/customer-linking-service.ts:73-147 | customerUsers更新とpending_link order更新を同serviceのbatchで実行。 |
| R-08 | refactor-roadmap.md:197-202 | staff認証read時のstaffByEmail自動修復write | resolved | src/lib/firebase/staff-auth.ts:160-195; src/lib/firebase/staff-auth.ts:49-68 | findActiveStaffByEmailはread/fallbackのみ。mirror write helperは別入口。 |
| R-09 | firestore-write-boundary-audit.md:47,168,222-224 | staffByEmail mirrorの複数経路管理 | unresolved | src/lib/firebase/staff-auth.ts:49-68; src/lib/firebase/staff-sync-service.ts:63-98; src/lib/firebase/staff-locale-service.ts:55-64 | staff保存同期とlocale更新からmirrorが書かれる。 |
| R-10 | refactor-roadmap.md:204-210 | alertMonths / validityYearsの二重保存先 | unresolved | src/lib/firebase/admin-notification-settings.ts:66-84; src/lib/firebase/admin-settings.ts:85-94; src/app/admin/notifications/page.tsx:25-29,159-175; src/app/admin/settings/inspection/page.tsx:20-31,100-109 | notifySettings/configとsettings/inspectionに別々の編集・write経路がある。 |
| R-11 | firestore-write-boundary-audit.md:122-145; implementation-layer-architecture.md:97-100,223-250 | page/hookからFirestore write SDKを直接呼ぶ主要経路 | resolved | src/lib/firebase/portal-transaction-service.ts:42-163; src/lib/firebase/order-fulfillment-service.ts:14-70; src/lib/firebase/return-tag-processing-service.ts:69-208; src/lib/firebase/tank-tag-service.ts:5-17 | 指定主要page/hookの機械検索ではwrite SDK callなし。domain operation直呼出しの責務は別項目。 |
| R-12 | page-feature-boundary-audit.md:228-230; firestore-write-boundary-audit.md:100,143-145; system-code-and-data-structure-audit.md:79-84 | 手動貸出・返却・充填hookのUI stateとworkflow混在 | unresolved | src/features/staff-operations/hooks/useManualTankOperation.ts:71-78,98-163,251-361 | state、入力、validation、identity/context、action/location/note、operation呼出しが同一hook。実writeのみ共通処理へ委譲。 |
| R-13 | page-feature-boundary-audit.md:232-237; staff-operation-service-boundary-design.md:28-45,121-190 | order承認・貸出完了のhook/service境界 | partial | src/features/staff-operations/hooks/useOrderFulfillment.ts:100-117,128-187,219-257; src/lib/firebase/order-fulfillment-service.ts:14-70 | writeとtransaction完了のatomicityはservice。顧客・数量・種別validationはhook内。 |
| R-14 | page-feature-boundary-audit.md:239-241; staff-operation-service-boundary-design.md:192-231 | return tagのpreflight・action決定・複合writeがhook内 | resolved | src/features/staff-operations/hooks/useReturnTagProcessing.ts:65-90; src/lib/firebase/return-tag-processing-service.ts:69-152,163-207 | hookは選択・通知、serviceが再取得、変換、operation、transaction完了を処理。 |
| R-15 | page-feature-boundary-audit.md:243-248; firestore-write-boundary-audit.md:101,138-145; system-code-and-data-structure-audit.md:84,269 | 貸出先別一括返却hookのread/grouping・tag・workflow混在 | partial | src/features/staff-operations/hooks/useBulkReturnByLocation.ts:155-171,186-229,235-253,255-307 | tag writeはservice化済み。read/grouping、local state、payload構築、operation呼出しは同一hook。 |
| R-16 | refactor-roadmap.md:149-156; page-feature-boundary-audit.md:141-147 | tanks.logNoteのpage/hook直接update | resolved | src/lib/firebase/tank-tag-service.ts:5-17; src/app/staff/inhouse/page.tsx:67-81; src/features/staff-operations/hooks/useBulkReturnByLocation.ts:235-253 | field限定writeはupdateTankReturnTagMarker経由。fieldの意味は次項。 |
| R-17 | system-code-and-data-structure-audit.md:170,210,455-465,500-506; identity-and-operation-logging-design.md:346-356,393-397 | return conditionのtag/note分散とtanks.logNoteの一時tag利用 | partial | src/features/staff-operations/hooks/useManualTankOperation.ts:328-336; src/lib/firebase/return-tag-processing-service.ts:167-179; src/lib/firebase/tank-tag-service.ts:5-17; src/features/staff-operations/hooks/useBulkReturnByLocation.ts:200-208,275-294 | manualとreturn transaction処理はreturnConditionを保存。一括返却はlogNote markerを使い、operation contextにreturnConditionなし。 |
| R-18 | refactor-roadmap.md:216-224; page-feature-boundary-audit.md:176-178,305-312; identity-and-operation-logging-design.md:451-454 | damage・repair・inspectionの業務処理がpage内 | unresolved | src/features/maintenance/hooks/useMaintenanceSwipe.ts:17-110; src/app/staff/damage/page.tsx:58-81; src/app/staff/repair/page.tsx:66-90; src/app/staff/inspection/page.tsx:106-140 | maintenance featureはnavigation hook中心。各pageがselection・payload・operation呼出しを保持。 |
| R-19 | refactor-roadmap.md:216-224; page-feature-boundary-audit.md:161-164 | inspectionの次回期限算出がpage内 | unresolved | src/app/staff/inspection/page.tsx:39-45,106-131 | todayとvalidityYearsから日付を算出しtankExtraをpageで構築。 |
| R-20 | refactor-roadmap.md:216-224; firestore-write-boundary-audit.md:102,206-213 | 自社利用・自社返却のpage直workflow | unresolved | src/app/staff/inhouse/page.tsx:45-81,83-127,130-160 | tag read/write、自社利用事後報告、一括返却payloadとoperation呼出しがpage内。 |
| R-21 | refactor-roadmap.md:226-234; page-feature-boundary-audit.md:98-104; system-code-and-data-structure-audit.md:56-63,102-103 | staff dashboardへの取得・集計・訂正・取消・履歴・一括処理集中 | unresolved | src/app/staff/dashboard/page.tsx:160-281,341-391,428-525 | applyLogCorrection / voidLogのruntime callerも同pageのみ。 |
| R-22 | refactor-roadmap.md:236-243; page-feature-boundary-audit.md:149-159; system-code-and-data-structure-audit.md:275-282,508-512 | sales・billing・staff analyticsのraw action/location依存とpage集計 | partial | src/lib/analytics/operation-stats.ts:46-109; src/lib/billing/source-logs.ts:54-139; src/lib/billing/invoice-candidate.ts:81-110,180-184; src/hooks/useSalesStats.ts:56-60 | action code/official projectionへ移行済み。billingにはlegacy location/name fallbackが残る。 |
| R-23 | implementation-layer-architecture.md:92-93,374-432,438-576; system-code-and-data-structure-audit.md:63-66,102 | admin statsとunfilled report handlingの分離計画 | partial | src/lib/firebase/portal-transaction-service.ts:85-106; src/app/staff/dashboard/page.tsx:163-179,725-732; src/app/admin/page.tsx:42-86; src/lib/firebase/repositories/types.ts:106-126 | createはservice化。staff側はread-onlyで、admin countはpage内。handling fieldsはTransactionDocにない。 |
| R-24 | identity-and-operation-logging-design.md:93-154,215-220,267-306,434-458; system-code-and-data-structure-audit.md:185-210 | OperationContextとtop-level typed identity/action field導入 | resolved | src/lib/operation-context.ts:3-45; src/lib/tank-operation.ts:92-118,624-660,1347-1366; src/lib/tank-action-status-labels.ts:12-69 | contextはinput必須。writerはcode actionとtyped identityをlogへ保存。 |
| R-25 | identity-and-operation-logging-design.md:308-356,451-458 | source / workflow / returnConditionのcaller coverage | partial | src/lib/tank-operation.ts:1347-1366; src/app/staff/damage/page.tsx:63-70; src/app/staff/repair/page.tsx:72-80; src/app/staff/inspection/page.tsx:111-129; src/features/staff-operations/hooks/useBulkReturnByLocation.ts:275-294 | writerは保存対応。maintenanceはactorのみ、一括返却はreturnConditionなし。 |
| R-26 | refactor-roadmap.md:174-179 | legacy actor文字列approvedBy / fulfilledByのwrite停止 | unresolved | src/lib/firebase/order-fulfillment-service.ts:21,63; src/lib/firebase/return-tag-processing-service.ts:53,203; src/lib/order-types.ts:36,40,101,105 | typed actor fieldsと併記して旧fieldも書く。 |
| R-27 | identity-and-operation-logging-design.md:217-218,310-313,391; system-code-and-data-structure-audit.md:237,307 | transactionとtank logの明示link | resolved | src/lib/firebase/order-fulfillment-service.ts:37-46; src/lib/firebase/return-tag-processing-service.ts:167-175; src/lib/tank-operation.ts:1347-1366 | order/returnのtransactionIdをoperation logへ保存。 |
| R-28 | system-code-and-data-structure-audit.md:168-176,292-303,451-453,498; identity-and-operation-logging-design.md:429,502 | current loan projection不足とupdatedAtによる貸出日時近似 | partial | src/lib/tank-types.ts:6-20; src/lib/tank-operation.ts:604-664,1138-1161; src/app/portal/return/page.tsx:60-69; src/features/staff-operations/hooks/useBulkReturnByLocation.ts:52-61,200-210 | customer projectionは追加済み。currentLentAt/currentLentLogIdはなく、日付poolはupdatedAtを使う。 |
| R-29 | system-code-and-data-structure-audit.md:67-69,270-272,467-482; identity-and-operation-logging-design.md:27,54-55,460-462 | portal current/historyとbillingのcustomer name/location依存 | partial | src/lib/portal/customer-reads.ts:54-71,74-91; src/lib/billing/invoice-candidate.ts:81-110,180-184 | customerIdが主経路。legacy location/name fallbackを併用。 |
| R-30 | system-code-and-data-structure-audit.md:125,279,494,523 | tank traceのrepository外queryとaction依存 | unresolved | src/lib/tank-trace.ts:13-22,66-80,120-139,167-220 | unreturned sourceはwhere(action == lend)を使用。order_lendは同query条件に含まれない。 |
| R-31 | system-code-and-data-structure-audit.md:210-212,572 | non-tank logs混在時のlogKind未考慮 | resolved | src/lib/tank-transition-projections.ts:43-60,197-200 | order/procurementを除外し、未知kindはofficial aggregation対象外。 |
| R-32 | system-code-and-data-structure-audit.md:488-490; identity-and-operation-logging-design.md:358-372; strict-vs-assisted-transition-mode.md:134-143 | correction/voidのtyped actorとlatest-only制約 | resolved | src/lib/tank-operation.ts:842-869,1054-1066,1399-1412 | typed editor/voiderを保存し、active/latestとrecovery制約をoperation側でも検証。 |
| R-33 | refactor-roadmap.md:131-141,245-250; page-feature-boundary-audit.md:254-262,347-357 | master/settings readを一律repository化する旧計画 | obsolete | AGENTS.md:307-350; src/hooks/useInspectionSettings.ts:30-44; src/components/AdminAuthGuard.tsx:197-205 | 現行方針ではmaster/settingsはPhase 2-B対象外で直接access許容。 |
| R-34 | page-feature-boundary-audit.md:35-38,341-345 | repositoryのnot implemented skeletonを未了write移行とみなす前提 | obsolete | AGENTS.md:307-325; src/lib/firebase/repositories/tanks.ts:131-165; src/lib/firebase/repositories/logs.ts:233-235,299-319; src/lib/firebase/repositories/transactions.ts:110-115,249-278 | read migrationは完了扱い、write未全面移行は意図的なphase分離。stubのrepository外参照は0件。 |
| R-35 | refactor-roadmap.md:271-276; page-feature-boundary-audit.md:250-252 | useDestinationsという廃止collection由来の名称 | partial | src/features/staff-operations/hooks/useDestinations.ts:5-7,22-53; src/features/staff-operations/OperationsTerminal.tsx:10,141 | 名称は残るが、read先はcustomers-serviceでdestinations collection accessはない。 |
| R-36 | refactor-roadmap.md:256-262; page-feature-boundary-audit.md:426-430 | staffSessionのread/write/clear分散 | partial | src/hooks/useStaffSession.ts:29-35,132-145; src/components/AdminAuthGuard.tsx:92-115,150-165; src/components/StaffAuthGuard.tsx:121-180; src/app/admin/layout.tsx:132 | read/parseはhookへ集約。write/clearは複数箇所。 |
| R-37 | refactor-roadmap.md:264-269; page-feature-boundary-audit.md:436-441 | staffLogin / opStyleChangeのCustomEvent依存 | unresolved | src/hooks/useStaffSession.ts:92,120-124; src/app/staff/layout.tsx:57-60; src/features/staff-operations/OperationsTerminal.tsx:115-123 | 両event経路が現行コードに残る。 |
| R-38 | page-feature-boundary-audit.md:432-434 | customerSession identity fallbackとstorage access分散 | partial | src/lib/portal/identity.ts:94-142; src/lib/firebase/customer-user.ts:138; src/app/portal/login/page.tsx:25-33; src/app/portal/layout.tsx:36-74 | uidのcustomerId代用は解消。remove処理は複数箇所。 |
| R-39 | firestore-write-boundary-audit.md:215-220,242-245 | settings/master writeへのedit_history差込み | unresolved | src/lib/firebase/admin-permissions-service.ts:17-24; src/lib/firebase/admin-settings.ts:59-94; src/lib/firebase/admin-notification-settings.ts:66-84 | 現行src/lib/firebaseにはedit_history / delete_history writerなし。資料上も将来項目。 |
| R-40 | refactor-roadmap.md:329; page-feature-boundary-audit.md:443 | dev-auth固定staffId dev-staffと実データの衝突 | unknown | src/lib/auth/dev-auth.ts:8-15 | 固定値は存在するが、Firestore実データとの衝突有無はコードから判定不能。 |
| R-41 | identity-and-operation-logging-design.md:399-415,465-467 | typed identity query用composite indexの作成状態 | unknown | src/lib/firebase/repositories/logs.ts:211-230,275-297; AGENTS.md:201 | query側の必要index記述はある。Console手動管理状態はrepositoryから確定不能。 |
| R-42 | strict-vs-assisted-transition-mode.md:5-170 | strict/advisory policy、transitionPlan、review、atomic上限 | resolved | src/lib/tank-transition-policy.ts:18-19; src/lib/firebase/tank-operation-policy-service.ts:50-115; src/lib/tank-operation.ts:405-675; src/lib/tank-operation-limits.ts:2-10; src/lib/tank-transition-policy.test.ts:22-119 | policy保存、planner、atomic commit、review制約、上限の実装・pure testが存在。 |
| R-43 | strict-vs-assisted-transition-mode.md:231-238 | production Reset executeがpre-cutover未準備という前提 | obsolete | docs/design/strict-vs-assisted-transition-mode.md:179-181; scripts/cutover/production-execute-gates.ts:25-30 | 同資料がcutover完了を記録し、現行gateは完了後の定常閉鎖。 |

## 3. 重点領域の現状記録

### 3.1 手動貸出・返却・充填

- /staff/lend、/staff/return、/staff/fillはOperationsTerminalを呼ぶ薄いwrapper: src/app/staff/lend/page.tsx:3-6; src/app/staff/return/page.tsx:3-6; src/app/staff/fill/page.tsx:3-6。
- OperationsTerminalがtank/customer readとmanual/bulk/order/return hookを組み立てる: src/features/staff-operations/OperationsTerminal.tsx:139-167。
- useManualTankOperationのUI stateはsrc/features/staff-operations/hooks/useManualTankOperation.ts:71-78、入力・queue・transition判定は:80-249、confirm・actor/context・action/location/note・payload構築は:251-361。
- 同hookはapplyBulkTankOperationsを:295-339で呼ぶ。実transactionはsrc/lib/tank-operation.ts:384-403,435-675。
- 現状はUI state/inputと業務workflow構築が同じhook、Firestore transaction実行が共通operationという分離。

### 3.2 貸出先別一括返却

- candidate readはgetBulkReturnCandidateTanks: src/features/staff-operations/hooks/useBulkReturnByLocation.ts:155-171。
- identity/date pool/grouping helperは同:29-153、read結果のgroup組立てとReact state更新は:186-229。
- tagはtank.logNoteから復元: 同:200-208。local state更新と保存呼出しは:235-253。
- 保存先はtanks/{id}.logNote: src/lib/firebase/tank-tag-service.ts:5-17。したがってtanks.logNoteを返却確定前の一時tag markerとして使用している。
- confirm、context、tag別action/location、operation payload構築、applyBulkTankOperations呼出しは同hook:255-307。
- 確定operationはtankNoteを空文字で渡す: 同:290-293。共通operationはtankNoteをtank snapshotのlogNoteへ反映する: src/lib/tank-operation.ts:601-618。
- 現状はtag単独writeとatomic tank/log writeは別関数だが、read/grouping・UI state・tag操作・返却workflowは同hook内。

### 3.3 破損・修理・耐圧検査・自社利用/自社返却

| 処理 | 現行経路 |
|---|---|
| 破損報告 | src/app/staff/damage/page.tsx:39-52でID/queue、:58-81でACTION.DAMAGE_REPORT・location・noteを構築しapplyBulkTankOperations。 |
| 修理完了 | src/app/staff/repair/page.tsx:29-44で対象filter、:66-90でACTION.REPAIREDとcurrent statusを渡しapplyBulkTankOperations。 |
| 耐圧検査 | src/app/staff/inspection/page.tsx:52-84でsettings/read/filter、:106-140で期限とtankExtraを構築しapplyBulkTankOperations。 |
| 自社利用 | src/app/staff/inhouse/page.tsx:83-127で検証、ACTION.IN_HOUSE_USE_RETRO、location=自社、事後報告noteを構築しapplyTankOperation。 |
| 自社返却 | src/app/staff/inhouse/page.tsx:45-81でlogNote tag復元・保存、:130-160でtag別actionを構築しapplyBulkTankOperations。 |

各pageがUI state・selection・confirm・operation payloadを保持し、tanks/logsの状態遷移writeはapplyTankOperation / applyBulkTankOperationsを使用する。自社返却はtag marker用tanks.logNote単独writeも使用する。

### 3.4 staff dashboardの訂正・取消

- applyLogCorrection / voidLogのruntime call siteはsrc/app/staff/dashboard/page.tsxの4経路のみ。
- 単一訂正: handleSaveEdit :341-368、applyLogCorrection呼出し :350-357。
- 単一取消: handleVoid :370-391、voidLog呼出し :375-380。
- 一括貸出先変更: handleBulkLocationChange :428-468、selected logsの逐次applyLogCorrection :439-452。
- 一括取消: handleBulkVoid :470-504、selected logsの逐次voidLog :476-487。
- 実装本体はsrc/lib/tank-operation.tsのapplyLogCorrection :817-1030、voidLog :1036-1095。
- mode=revertはsrc/lib/tank-operation.ts:824-826,871-899に実装されるが、現行srcにruntime callerはない。

## 4. collection別write経路一覧

対象は現行runtime src内。function/fileの列挙であり、評価は付けない。

| collection / doc | write関数・経路 |
|---|---|
| tanks | applyTankOperation / applyBulkTankOperations / commitPlannedOperations: src/lib/tank-operation.ts:364-403,435-675; applyLogCorrection: :817-1030; voidLog: :1036-1095; updateLogNote / updateTankReturnTagMarker: src/lib/firebase/tank-tag-service.ts:5-17; submitTankEntryBatch: src/features/procurement/lib/submitTankEntryBatch.ts:54-83 |
| logs | operation log作成・訂正・取消: src/lib/tank-operation.ts:624-660,969-1020,1076-1081; reviewOperationLogs: src/lib/firebase/operation-review-service.ts:164-312; submitTankEntryBatch: src/features/procurement/lib/submitTankEntryBatch.ts:54-83; submitSupplyOrder: src/lib/firebase/supply-order.ts:33-50 |
| transactions 共通writer | createTransaction / updateTransaction / updateTransactionInBatch: src/lib/firebase/repositories/transactions.ts:74-108。updateTransactionは現行srcにcallerなし。 |
| transactions: order | createPortalOrder: src/lib/firebase/portal-transaction-service.ts:42-71; linkCustomerUsersToCustomers: src/lib/firebase/customer-linking-service.ts:73-147; approveOrder / fulfillOrder: src/lib/firebase/order-fulfillment-service.ts:14-70 |
| transactions: return | createPortalReturnRequests / createPendingPortalReturnRequest: src/lib/firebase/portal-transaction-service.ts:73-83,148-163; confirmPendingReturnRequests: src/lib/firebase/return-tag-processing-service.ts:69-88,182-207 |
| transactions: uncharged_report | createPortalUnfilledReports: src/lib/firebase/portal-transaction-service.ts:85-106。作成後のruntime update経路は該当なし。 |
| customers | createCustomer / updateCustomer: src/lib/firebase/customers-service.ts:28-45 |
| customerUsers | ensureCustomerUser: src/lib/firebase/customer-user.ts:43-93; completeCustomerUserSetup: src/lib/firebase/portal-profile-service.ts:18-46; linkCustomerUsersToCustomers: src/lib/firebase/customer-linking-service.ts:73-147 |
| staff | saveStaffMembers: src/lib/firebase/staff-sync-service.ts:35-101; updateOwnStaffLocale: src/lib/firebase/staff-locale-service.ts:19-68; linkStaffUidByEmailAuth / writeStaffUidLink: src/lib/firebase/staff-uid-link-service.ts:140-166; approveStaffJoinRequestForExistingStaff: src/lib/firebase/staff-join-request-review-service.ts:64-138 |
| staffByEmail | setStaffAuthMirrorInBatch / deleteStaffAuthMirrorInBatch: src/lib/firebase/staff-auth.ts:49-68（saveStaffMembersから呼出し: src/lib/firebase/staff-sync-service.ts:63-98）; updateOwnStaffLocale: src/lib/firebase/staff-locale-service.ts:55-64 |
| settings/adminPermissions | savePermissions: src/lib/firebase/admin-permissions-service.ts:17-24 |
| settings/portal | savePortalSettings: src/lib/firebase/admin-settings.ts:59-68 |
| settings/inspection | saveInspectionSettings: src/lib/firebase/admin-settings.ts:85-94 |
| settings/billingInvoice | saveBillingInvoiceSettings: src/lib/firebase/billing-settings-service.ts:16-31 |
| settings/tankOperationPolicy | saveTankOperationPolicy: src/lib/firebase/tank-operation-policy-service.ts:50-115 |
| settings/tankAggregationRevision | operation/correction/void: src/lib/tank-operation.ts:584-594,974-986,1082-1092; recovery review: src/lib/firebase/operation-review-service.ts:270-280 |
| tankProcurements | submitTankEntryBatch: src/features/procurement/lib/submitTankEntryBatch.ts:54-83 |
| orders（資材発注collection） | submitSupplyOrder: src/lib/firebase/supply-order.ts:33-50 |

補足として、指定一覧外のstaffByUidはsetStaffUidAuthMirrorInTransaction: src/lib/firebase/staff-auth.ts:70-87を、UID紐付けとjoin request承認経路から使用する。

## 5. feature間直接import一覧

src/features配下のimport specifierをalias（@/features/...）とrelative pathの両方で機械検索し、top-level feature名を比較した。

| source feature | target feature | import site |
|---|---|---|
| 該当なし | 該当なし | 0件 |

確認対象のtop-level featureはadmin-customers、maintenance、procurement、staff-operations。各feature内の自己importはあるが、features/Aからfeatures/Bへの直接importはない。

## 6. 未解消残差の要約

### 手動操作

- useManualTankOperationにUI state、入力処理、transition判定、identity/context、payload構築、共通operation呼出しが同居する（R-12）。
- order writeはservice化済みだが、顧客・数量・種別validationはuseOrderFulfillment内に残る（R-13）。
- manual return logのcustomer contextはlend時と同じ付与条件ではなく、provenance optional fieldのcaller coverageにも差がある（R-25）。

### 一括返却

- useBulkReturnByLocationにread/grouping、local state、tag操作、返却workflowが同居する（R-15）。
- tanks.logNoteを返却確定前の一時tag markerとして永続化し、一括返却contextにreturnConditionを渡していない（R-17）。
- 日付poolはtanks.updatedAtを貸出日時の近似として使う（R-28）。

### maintenance系

- damage、repair、inspection、自社利用/返却の各pageがselection、confirm、operation payload、共通operation呼出しを保持する（R-18、R-20）。
- inspection pageが次回期限を算出する（R-19）。
- maintenance各callerのcontextはactorのみで、source/workflowを渡さない経路がある（R-25）。

### dashboard

- staff dashboard pageに取得・集計・品質報告・訂正・取消・履歴・一括loopが集中する（R-21）。
- applyLogCorrection / voidLogのcallerは同pageの単一・一括4経路のみで、mode=revertのruntime callerはない。
- admin dashboardのcount集計とuncharged_report表示/handlingの資料記載範囲は一部のみ実装されている（R-23）。

### write境界

- 主要page/hookからのFirestore write SDK直接呼出しは解消済みだが、domain operationのworkflow構築がpage/hookに残る経路がある（R-11〜R-21）。
- staffByEmail mirrorにはstaff保存とlocale更新のwrite経路がある（R-09）。
- notifySettings/configとsettings/inspectionにalertMonths / validityYearsの別write経路がある（R-10）。
- approvedBy / fulfilledByのlegacy actor fieldがtyped fieldと併記される（R-26）。
- settings/master writeにedit_history / delete_historyを作るruntime writerはない（R-39）。

### その他

- current loanの専用日時projectionがなく、updatedAt近似が残る（R-28）。
- customerId主経路にlegacy location/name fallbackを併用する（R-29）。
- tank-traceの一部はrepository外queryとaction == lend条件を使う（R-30）。
- useDestinations名称、staffSession分散、CustomEvent、customerSession remove分散が残る（R-35〜R-38）。
- dev-staffの実データ衝突有無とtyped identity query用Console index状態はrepository内の証拠だけではunknown（R-40、R-41）。

## 7. レビュー補遺（2026-07-19 read-onlyレビューによる追加）

docs PR #142 のread-onlyレビューで、§4「collection別write経路一覧」に以下の漏れが確認されたため補記する。§1〜6の本文は監査時点のまま保持する。

| collection | write関数・経路 |
|---|---|
| priceMaster / rankMaster | writeBatch一括保存: src/lib/firebase/admin-money-settings.ts:65-139（caller: src/app/admin/money/page.tsx:104） |
| orderMaster | writeBatch一括保存: src/lib/firebase/order-master-settings.ts:26-74（caller: src/app/admin/order-master/page.tsx:80） |
| lineConfigs | src/lib/firebase/admin-notification-settings.ts:86-118 |
| staffJoinRequests | 本人作成・更新: src/lib/firebase/staff-join-requests.ts:132-180 / 承認・却下: src/lib/firebase/staff-join-request-review-service.ts:64-168 |
| operationReviewEvents | src/lib/firebase/operation-review-service.ts:187,296-310 |
| notifySettings/config | src/lib/firebase/admin-notification-settings.ts:79-84（§4に行が無かったため補記。二重保存の論点はR-10） |

軽微訂正: §3.1の「実transactionは src/lib/tank-operation.ts:384-403,435-675」について、runTransaction開始行は :413-418。
