# Staff Dashboard UI / Controller 境界 個別設計（PR-12）

- 作成日: 2026-07-27
- 対象base commit: `f13c7419d3aede2da5263678bf39abfc621fef06`
- 対象route: `/staff/dashboard`
- 対象残差: R-21のUI集中部分
- 前提: PR-11 merge済み
- 位置づけ: PR-12実装の個別設計正本
- 対象: page controllerとcontrolled presentational componentの境界
- 対象外: visual redesign、query、read model、write workflow、schema、Rules、package

## 1. 目的と正本性

本書は、staff dashboardの表示構造を後続PR-12で等価再編するため、component、state、handler、props、modal、helper、CSS、testの境界を実装前に確定する個別設計正本である。

構造化リファクタ全体の順序は[構造化リファクタのPR順序](../architecture/refactor-sequence.md)、feature境界は[Feature境界の正本設計](../architecture/feature-boundaries.md)、write ownerは[Write Ownershipの正本設計](../architecture/write-ownership.md)、資料の正本性は[設計資料の正本性](../architecture/document-authority.md)に従う。PR-11のread/query境界は[Staff Dashboard Query / Read Model 個別設計](./staff-dashboard-read-model-design.md)を継承する。

正本順位は次のとおりである。

```text
AGENTS.md
> 現行コード
> 現行テスト
> merge済み設計note
> その他docs
```

[残存構造課題のread-only差分監査](../refactor/residual-structure-audit-2026-07-19.md)のR-21は対象commit時点の証拠としてのみ参照し、historical snapshotである同資料は更新しない。

## 2. 結論

- 現行`src/app/staff/dashboard/page.tsx`はthin wrapperではない
- 採用architectureは**案B: page controller + section components**
- pageはPR-12後もthin wrapperにはせず、**presentation-light controller**とする
- 23 state、13 named handler、query/read model/write/history orchestrationはpageに残す
- childはdisplay-readyなreadonly data、controlled value、typed callbackだけを受け取る
- controller hook、context、reducer、store、UI view-model utilityは新設しない
- query、read model、write workflow、domain、repositoryは変更しない
- 後続PR-12は変更上限8ファイルの1PRで実施可能
- PR-12実装はCodexが担当する
- visual adjustmentを行う場合はPR-12完了後の任意のClaude UI-only別PRとする

## 3. 現行page監査

### 3.1 規模と責務

`src/app/staff/dashboard/page.tsx`は1,549 physical LOCである。default componentの`StaffDashboard`は約1,096行を占め、その後にpage-local component、business/format helper、style helperが続く。

現行pageが同時に所有する責務は次のとおりである。

- query orchestration
- read model orchestration
- session、locale、tank hookのcomposition
- 23 React state
- source fetchとloading
- edit modeとselection
- correction roleと72時間判定
- 4 write handler
- 4 modalのcontrolled state
- root historyのlazy fetch、cache、展開
- correction後の並列refresh
- alert、catch、finally
- display projection
- JSX
- inline CSS
- responsive CSS

単に行数が大きいからではなく、read、write、UI state、permission、cache、presentationという異なる責務と依存方向を同時に持つためthin wrapperではない。

### 3.2 Imports

| 分類 | 現行import |
|---|---|
| React | `useCallback`、`useEffect`、`useMemo`、`useState` |
| icon | `ArrowDownWideNarrow`、`ArrowUpNarrowWide`、`AlertTriangle`、`Building2`、`CheckCircle2`、`CheckSquare`、`ChevronDown`、`ChevronUp`、`ClipboardList`、`Clock`、`Edit2`、`Layers`、`Loader2`、`Square`、`Undo2`、`Users`、`X` |
| query | `fetchStaffDashboardLogHistory`、`fetchStaffDashboardSourceData` |
| read model | `buildStaffDashboardReadModel`、`sortStaffDashboardLogs`、`DashboardLogEntry`、`DashboardLogSortOrder` |
| write workflow | `correctDashboardLogLocations`、`correctDashboardLogTankId`、`voidDashboardLog`、`voidDashboardLogs` |
| session | `requireStaffIdentity`、`useStaffLocale`、`useStaffSession` |
| tanks | `useTanks` |
| domain/data type | `TransactionDoc`、`StaffCorrectionRole`、`CustomerSnapshot`、`TankActionCode`、`Locale` |
| UI component | `PrefixNumberPicker` |
| label/display helper | `STATUS_COLORS`、`coerceTankActionCode`、`coerceTankStatusCode`、`tankStatusCodeToLegacyStatus`、`getDashboardActionBadgeTone`、`getLegacyTankActionLabel`、`getLegacyTankStatusLabel` |

PR-12ではiconと`PrefixNumberPicker`のimportだけを表示ownerへ機械的に移せる。query、read model、write workflow、session、tanks、domain/display判定のimportはpageに残す。

### 3.3 State inventory

現行の23 stateはすべてpageが現在のownerであり、PR-12後もpageを唯一のownerとする。

| state | 型 / 初期値 | 現行用途・更新経路 |
|---|---|---|
| `logs` | `DashboardLogEntry[]` / `[]` | source read、today/read model、sort、selection、logs表示。`fetchData`が更新 |
| `unfilledReports` | `TransactionDoc[]` / `[]` | read model入力と0〜10件badge。`fetchData`が更新 |
| `customerOptions` | `CustomerSnapshot[]` / `[]` | read model、bulk location options。`fetchData`が更新 |
| `logSortOrder` | `DashboardLogSortOrder` / `"desc"` | log sortとtoolbar。sort toggleが更新 |
| `dashboardLoading` | `boolean` / `true` | dashboard source loading。`fetchData`の開始/finallyで更新 |
| `isEditMode` | `boolean` / `false` | toolbar、selection、row action、history表示。`toggleEditMode`が更新 |
| `selectedLogIds` | `string[]` / `[]` | selected logs、row selection、bulk action。logs変更effectとselection/bulk handlerが更新 |
| `editingLog` | `DashboardLogEntry \| null` / `null` | ID変更対象、payload、modal open。`openEdit`、成功、closeが更新 |
| `editForm` | `EditForm \| null` / `null` | ID/reason controlled input、validation。`openEdit`、input、成功が更新 |
| `savingEdit` | `boolean` / `false` | ID変更close guard、disabled、copy。`handleSaveEdit`が更新 |
| `voidingLog` | `DashboardLogEntry \| null` / `null` | 単一取消対象、payload、modal open。row action、成功、closeが更新 |
| `voidReason` | `string` / `""` | 単一取消reason。open、input、成功が更新 |
| `savingVoid` | `boolean` / `false` | 単一取消close guard、disabled、copy。`handleVoid`が更新 |
| `bulkLocationModalOpen` | `boolean` / `false` | 一括貸出先変更modal open。open、成功、closeが更新 |
| `bulkLocationValue` | `string` / `""` | 一括貸出先選択、payload。open時の再選択とselectが更新 |
| `bulkLocationReason` | `string` / `""` | 一括貸出先変更reason。openとtextareaが更新 |
| `savingBulkLocation` | `boolean` / `false` | close guard、disabled、copy。`handleBulkLocationChange`が更新 |
| `bulkVoidModalOpen` | `boolean` / `false` | 一括取消modal open。toolbar、成功、closeが更新 |
| `bulkVoidReason` | `string` / `""` | 一括取消reason。open、input、成功が更新 |
| `savingBulkVoid` | `boolean` / `false` | close guard、disabled、copy。`handleBulkVoid`が更新 |
| `expandedRootId` | `string \| null` / `null` | revision history展開。toggle、edit mode終了、write成功が更新 |
| `historyByRoot` | `Record<string, DashboardLogEntry[]>` / `{}` | root history cache。history fetchとwrite成功が更新 |
| `historyLoadingRoot` | `string \| null` / `null` | root単位loading。`toggleHistory`の開始/finallyで更新 |

`PrefixNumberPicker`が既に内部所有する`pendingPrefix`は既存component内部stateのままとし、PR-12で移動・複製しない。

### 3.4 Derived state

次のderived stateはすべてpageに残す。

| derived | 現行意味 |
|---|---|
| `correctionRole` | session roleを`StaffCorrectionRole`へ正規化 |
| `tankIds` | tanksのID配列 |
| `todayInputs` | `[logs, staffLocale]`だけで`nowMillis`をcaptureする第1 memo |
| `dashboardReadModel` | tanks/customer/reports/todayInputsから構築する第2 memo |
| `totalTanks` / `summary` / `byLocation` / `todayStats` / `recentUnfilledReports` | read model alias |
| `sortedLogs` | current sort orderでcopy sortしたlogs |
| `loading` | `dashboardLoading \|\| tanksLoading` |
| `selectedLogs` | selected IDに対応するsource logs |
| `allSelectableLogIds` | tank logかつ訂正可能なID |
| `bulkLocationMode` | selected logsのaction/permissionから`lend` / `inhouse` / `null` |
| `bulkLocationOptions` | customer snapshotまたは自社option |
| `editDisabledReason` | ID変更confirmのdisabled reason |
| `voidDisabledReason` | 単一取消confirmのdisabled reason |
| `bulkLocationUnavailableReason` | 一括貸出先変更不可の説明 |

各log rowで現在算出している`rootId`、訂正可否、disabled reason、label、color、formatted time、history displayもpageでdisplay-ready propsへ投影する。新しい投影はplain per-render mappingとし、追加`useMemo`へ入れない。

現行ではstatus/report/logのJSX mappingは`loading === false`の分岐内だけで評価される。Viewへ渡すchildrenはViewのloading分岐より先に構築され得るため、pageのdisplay projectionは`loading ? [] : ...`でguardする。少なくとも`canModifyLogReason`と`canCorrectLogReason`をloading中に呼ばない。両helperは現行row mapと同じ順で独立に呼び、`canCorrectLogReason`内部が再度行うbase判定を共通化・dedupしない。これにより72時間判定の`Date.now()`回数・評価契機とformat helperの評価契機を維持する。

### 3.5 Named handlers

現行の13 named handlerを本文・責務ともpageに残す。

| handler | 責務 |
|---|---|
| `fetchData` | source query、3 source stateの順次反映、loading、error |
| `refreshAfterCorrection` | `fetchData()`と`refetchTanks()`の並列await |
| `openEdit` | correction可否guard、ID変更target/form初期化 |
| `handleSaveEdit` | 単一ID変更workflow、clear、refresh、alert、finally |
| `handleVoid` | 単一取消workflow、clear、refresh、alert、finally |
| `toggleEditMode` | edit mode切替、終了時selection/history展開clear |
| `toggleLogSelection` | 1件のselection toggle |
| `selectAllLogs` | selectable ID全選択 |
| `clearSelectedLogs` | selection clear |
| `openBulkLocationModal` | option guard、selected value調整、reason clear、open |
| `handleBulkLocationChange` | 一括貸出先変更workflow、clear、refresh、alert、finally |
| `handleBulkVoid` | 一括取消workflow、clear、refresh、alert、finally |
| `toggleHistory` | root展開、cache guard、lazy query、cache、alert、finally |

既存でcallback identityが保証されているのは`fetchData`だけである。PR-12では全handlerへの一律`useCallback`追加やchildの`memo`前提を導入しない。IDを受けるcomponent callbackはpage JSXで現行logへ接続する薄いadapterとし、上記13 handler、とりわけ4 write handlerの本文を変更しない。adapterのexact contractは§9に固定する。

### 3.6 JSX blocks

| block | 現行内容 |
|---|---|
| header | title、subtitle、session name |
| loading | spinnerと`読み込み中...` |
| tank status summary | total、status chip、empty |
| business status section | 3 dashboard panelのgrid |
| customer loan panel | 貸出先別lent/unreturned |
| today operations panel | today total/action breakdown |
| unfilled reports panel | 0〜10件badge、最大5件表示 |
| recent logs toolbar | active count、sort、edit mode |
| bulk action toolbar | selected count、select all/clear、2 bulk action |
| log row | selection、tank/action/location/staff/time、row actions |
| revision history | loading、empty、revision metadata |
| ID correction modal | tank picker、reason、confirm、disabled reason |
| single void modal | target、reason、confirm、disabled reason |
| bulk location modal | count、option、reason、confirm |
| bulk void modal | count、reason、confirm |
| responsive style | `spin`、log grid、720px breakpoint |

表示順とDOM上の意味を維持する。modal overlaysは現行どおりroot container内、main contentの後、style blockの前に置く。

### 3.7 Page-local component / helper

現行page-local presentational componentは6件である。

```text
SectionLabel
DashboardPanel
IconTextButton
Modal
FieldLabel
DisabledReasonText
```

現行business/format helperは次の20件である。

```text
normalizeCorrectionRole
toTankActionCode
formatActionLabel
tankStatusColor
canModifyLog
canCorrectLogReason
canModifyLogReason
getEditDisabledReason
getVoidDisabledReason
getBulkLocationUnavailableReason
timestampToMillis
toDate
formatTime
formatReportSource
formatReportStatus
statusLabel
statusColor
actionBg
actionFg
errorMessage
```

style helperは次の7件である。

```text
labelStyle
inputStyle
iconButtonStyle
primaryButtonStyle
dangerButtonStyle
miniActionButtonStyle
dangerMiniButtonStyle
```

## 4. Architecture比較

| 比較軸 | 案A: page + single View | 案B: page + section components | 案C: controller hook + components |
|---|---|---|---|
| 挙動変更リスク | 中。巨大propsの一括接続でreview範囲が集中 | **低。現行section単位で機械移動** | 高。state/effect/write/cacheを別runtime境界へ移動 |
| page thinness | presentationは減るがcontrollerは残る | presentation-light controllerになる | 最もthin |
| props量 | 1 componentへ巨大集中 | **用途別に分割可能** | View propsは整理できる |
| callback安定性 | 巨大contractで変化を追いにくい | **現行identity非保証をsection単位で維持** | hook export時に再設計しやすく回帰リスク |
| write責務 | pageに残せる | **pageに明確に残る** | hookへ移り、UI再編を超える |
| future Claude適合 | single View全体の衝突面が大きい | **component別の安全なsurface** | Viewは安全だがcontroller抽出自体が高リスク |
| 単独revert | 可能 | **可能** | 可能だが移動量が最大 |
| test容易性 | props fixtureが巨大 | **sectionごとのstatic renderが可能** | hook interaction test基盤が必要 |
| PRサイズ | 中 | **管理可能な8ファイル** | 最大 |
| state重複リスク | 低 | **controlled contractで低** | hook移動時の一時重複リスク |
| circular dependency | 低 | **page→componentsの一方向** | hook/view/type分離で増えやすい |

案Aは一つのViewへ全propsを集中させ、logsとmodalの独立したreview境界を作れない。案Cは23 state、13 handler、effect、history cache、write orchestrationの移動を伴い、UI再編の範囲を超える。現行test環境にはhook interaction用libraryもない。

したがって案Bを採用する。

## 5. 後続PR-12のexact変更ファイル

更新する既存ファイルは1件だけとする。

```text
src/app/staff/dashboard/page.tsx
```

新設するファイルは7件に確定する。

```text
src/features/staff-dashboard/components/StaffDashboardView.tsx
src/features/staff-dashboard/components/DashboardSectionLabel.tsx
src/features/staff-dashboard/components/DashboardStatusSummary.tsx
src/features/staff-dashboard/components/DashboardOperationsSummary.tsx
src/features/staff-dashboard/components/DashboardLogsSection.tsx
src/features/staff-dashboard/components/DashboardCorrectionModals.tsx
src/features/staff-dashboard/components/dashboard-components.test.ts
```

想定変更は合計8ファイル、上限も8ファイルとする。次は新設しない。

```text
controller hook
context
reducer
store
types.ts
UI view-model utility
shared timestamp utility
styles file
barrel index.ts
package
```

component contract typeは各owner component fileに置く。PR-12で新たに追加するfeature内依存は`page → staff-dashboard/components`と、section componentから`DashboardSectionLabel`へのpresentational importだけとする。既存の`page → queries/services`は維持し、componentsは既存shared UI、icon、`DashboardSectionLabel`以外からquery、read model、workflow、repository、domain business層をimportしない。feature間直接importは作らず、`DashboardSectionLabel`以外の新設component同士は相互importしない。

## 6. PR-12後の責務

### 6.1 page / controller

`src/app/staff/dashboard/page.tsx`に次を残す。

- `useStaffSession()`、`useStaffLocale()`、`useTanks()`
- `fetchStaffDashboardSourceData()`
- `fetchStaffDashboardLogHistory()`
- `buildStaffDashboardReadModel()`
- `sortStaffDashboardLogs()`
- source fetchとeffect
- 23 state
- 全derived state
- correction role
- 72時間判定
- edit/void/bulk availability判定
- 13 named handler
- `correctDashboardLogTankId()`
- `voidDashboardLog()`
- `correctDashboardLogLocations()`
- `voidDashboardLogs()`
- `requireStaffIdentity`
- history fetch/cache
- refresh orchestration
- alert、catch、finally
- business/format helper
- component用display projection
- controlled propsとcallback adapterの作成

pageはpresentation-lightになるが、PR-12完了後もthin wrapperではない。したがってAGENTS.mdの例外条件を満たさず、後続Claude UI-only PRでもpageは編集対象外である。

### 6.2 Presentational components

componentsが持つ責務は次に限定する。

- 渡されたdisplay-ready dataの表示
- 渡されたcontrolled valueのinput反映
- DOM eventから渡されたtyped callbackの呼び出し
- 現行のicon、text、inline style、empty/loading、responsive display
- React keyの配置

componentsは次を行わない。

- Firestore接続
- repository、query、read model、write workflowのimport/call
- raw log、raw customer、session roleのbusiness解釈
- action/status/customer grouping
- correction permission判定
- disabled reason生成
- reason length判定
- timestamp変換
- `Date.now()`
- alert
- retry、catch、refresh
- local modal open state
- selection、saving、sort、history cacheの複製

## 7. State所有contract

| state | 現在owner | PR-12後owner | childへ渡すprops | callback | 理由 |
|---|---|---|---|---|---|
| `logs` | page | page | raw配列は渡さず`activeLogCount`と`rows` | row ID callback | permission/format/history投影をcontrollerに固定 |
| `unfilledReports` | page | page | `unfilledReportCount`とformatted `recentUnfilledReports` | なし | source上限10件badgeと最大5件表示を維持 |
| `customerOptions` | page | page | raw配列は渡さずmodal option label/value | なし | `CustomerSnapshot`をchildで解釈しない |
| `logSortOrder` | page | page | `sortOrder` | `onToggleSort` | child local sort禁止 |
| `dashboardLoading` | page | page | combined `loading` | なし | tanks loadingとのORをpage所有 |
| `isEditMode` | page | page | `isEditMode` | `onToggleEditMode` | 終了時clearをpage所有 |
| `selectedLogIds` | page | page | `selectedCount`とrow `isSelected` | toggle/select all/clear | ID配列をchildで複製しない |
| `editingLog` | page | page | raw logは渡さずnullable ID modal model | open/close/confirm adapter | payload/permission対象をpage所有 |
| `editForm` | page | page | `selectedTankId`、`reason` | ID/reason change | controlled input維持 |
| `savingEdit` | page | page | `saving`、`confirmDisabled`、`disabledReason` | confirm/guarded close | child saving生成禁止 |
| `voidingLog` | page | page | nullable single void modelの表示値 | open/close/confirm adapter | raw logをchildで解釈しない |
| `voidReason` | page | page | `reason` | reason change | controlled input維持 |
| `savingVoid` | page | page | `saving`、`confirmDisabled`、`disabledReason` | confirm/guarded close | close guardをpage所有 |
| `bulkLocationModalOpen` | page | page | nullable bulk location model | open/guarded close | modal local state禁止 |
| `bulkLocationValue` | page | page | `selectedValue` | value change | controlled select維持 |
| `bulkLocationReason` | page | page | `reason` | reason change | controlled textarea維持 |
| `savingBulkLocation` | page | page | `saving`、`confirmDisabled` | confirm/guarded close | validation/writeをpage所有 |
| `bulkVoidModalOpen` | page | page | nullable bulk void model | open/guarded close | modal local state禁止 |
| `bulkVoidReason` | page | page | `reason` | reason change | controlled textarea維持 |
| `savingBulkVoid` | page | page | `saving`、`confirmDisabled` | confirm/guarded close | validation/writeをpage所有 |
| `expandedRootId` | page | page | row `isExpanded` | `onToggleHistory` | history identityをpage所有 |
| `historyByRoot` | page | page | formatted `historyEntries` | なし | raw cacheをchildへ移さない |
| `historyLoadingRoot` | page | page | row `historyLoading` | なし | query状態をpage所有 |

## 8. Component props contract

### 8.1 `StaffDashboardView`

```ts
export type StaffDashboardViewProps = {
  staffName: string | null;
  loading: boolean;
  children: React.ReactNode;
  overlays: React.ReactNode;
};
```

- `children`はstatus、operations、logsの3 section
- `overlays`は`DashboardCorrectionModals`
- staff session objectやroleは受け取らない
- 現行と同じroot、max width、header、loading分岐、overlay位置、style位置を所有する
- `staffName`から現行の空表示または`さん`表示だけを行う
- callbackなし

### 8.2 `DashboardSectionLabel`

```ts
export type DashboardSectionLabelProps = {
  icon: React.ReactNode;
  title: string;
  tone?: "alert";
};
```

- status、operations、logsから使用するfeature-local presentational primitive
- childrenなし
- callbackなし
- toneの現行contractを削除しない

### 8.3 `DashboardStatusSummary`

```ts
export type DashboardStatusItemView = Readonly<{
  key: string;
  label: string;
  count: number;
  color: string;
}>;

export type DashboardStatusSummaryProps = {
  totalTanks: number;
  items: readonly DashboardStatusItemView[];
};
```

- pageが`summary`を現行exact comparator `Object.entries(summary).sort((a, b) => b[1] - a[1])`でsortし、同数時のstable entry順、label、colorを維持する
- componentは`key`をReact keyに使用するが、keyの意味を生成しない
- empty判定は`totalTanks === 0`
- raw status code、locale、status helperを受け取らない
- children、callback、loadingなし

### 8.4 `DashboardOperationsSummary`

```ts
export type DashboardCustomerLoanRowView = Readonly<{
  key: string;
  displayName: string;
  lent: number;
  unreturned: number;
}>;

export type DashboardTodayOperationRowView = Readonly<{
  action: string;
  count: number;
}>;

export type DashboardUnfilledReportRowView = Readonly<{
  id: string;
  tankId: string;
  customerName: string;
  customerTitle: string;
  statusLabel: string;
  timeLabel: string;
  sourceLabel: string;
}>;

export type DashboardOperationsSummaryProps = {
  customerLoans: readonly DashboardCustomerLoanRowView[];
  todayTotal: number;
  todayOperations: readonly DashboardTodayOperationRowView[];
  unfilledReportCount: number;
  recentUnfilledReports: readonly DashboardUnfilledReportRowView[];
};
```

- `unfilledReportCount`はquery sourceの0〜10件badge
- `recentUnfilledReports`はread modelの0〜5件表示
- pageがtime/status/source/customer/tank fallback textを事前算出する
- `customerName`は画面本文へ表示する完成文字列であり、`report.customerName || "顧客未設定"`とする
- `customerTitle`は`title`属性へ設定する完成文字列であり、`report.customerName || ""`とする
- keysは`customerLoans[].key`、`todayOperations[].action`、`recentUnfilledReports[].id`
- `DashboardPanel`はこのfile内のprivate componentとする
- childrenは公開propsに使わない
- callback、loading、localeなし

未充填報告のpage projectionは次をexact contractとする。

```ts
const reportRows = loading
  ? []
  : recentUnfilledReports.map((report) => ({
      id: report.id,
      tankId: report.tankId || "-",
      customerName:
        report.customerName
        || "顧客未設定",
      customerTitle:
        report.customerName
        || "",
      statusLabel:
        formatReportStatus(report.status),
      timeLabel:
        formatTime(report.createdAt),
      sourceLabel:
        formatReportSource(report.source),
    }));
```

`DashboardOperationsSummary`はpageから渡された2つの完成文字列をそのまま使用する。

```tsx
<span
  title={report.customerTitle}
  style={existingStyle}
>
  {report.customerName}
</span>
```

raw customer objectをcomponentへ渡さず、componentでcustomer identityやfallbackを解釈しない。`customerName`と`customerTitle`はpageで完成値にする。nullish以外の正規化、trim、`??`への変更を追加せず、現行の`||`を維持する。実際に`顧客未設定`という名前の顧客と未設定を混同するため、componentで`report.customerName === "顧客未設定"`のような比較を行わない。

### 8.5 `DashboardLogsSection`

```ts
export type DashboardHistoryEntryView = Readonly<{
  id: string;
  revisionLabel: string;
  statusLabel: string;
  statusColor: string;
  actionLabel: string;
  timeLabel: string;
  editMetadata: string | null;
  voidMetadata: string | null;
}>;

export type DashboardLogRowView = Readonly<{
  id: string;
  tankId: string;
  actionLabel: string;
  actionBackground: string;
  actionForeground: string;
  locationLabel: string;
  staffLabel: string;
  timeLabel: string;
  isTankLog: boolean;
  logKindLabel: string;
  isSelected: boolean;
  canModify: boolean;
  modifyDisabledReason: string | null;
  canCorrect: boolean;
  correctionDisabledReason: string | null;
  isExpanded: boolean;
  historyLoading: boolean;
  historyEntries: readonly DashboardHistoryEntryView[];
}>;

export type DashboardLogsSectionProps = {
  activeLogCount: number;
  rows: readonly DashboardLogRowView[];
  sortOrder: "asc" | "desc";
  isEditMode: boolean;
  selectedCount: number;
  bulkLocationDisabled: boolean;
  bulkVoidDisabled: boolean;
  bulkLocationUnavailableReason: string | null;
  onToggleSort: () => void;
  onToggleEditMode: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenBulkLocation: () => void;
  onOpenBulkVoid: () => void;
  onToggleSelection: (logId: string) => void;
  onOpenEdit: (logId: string) => void;
  onOpenVoid: (logId: string) => void;
  onToggleHistory: (logId: string) => Promise<void>;
};
```

- pageはraw `DashboardLogEntry`を渡さない
- `rootId`はpageのcache/展開identityに残し、childには投影済み`isExpanded`、loading、entriesだけを渡す
- pageはaction label/tone、location/staff fallback、time、permission、disabled reason、history metadataを算出する
- componentは`row.id`とhistory `id`をReact keyに使うが、identityを生成しない
- sync UI callbackは同期関数
- history callbackだけは現行async handlerへ接続する`Promise<void>`
- childはhistory callbackをawait、catch、retryしない
- `IconTextButton`とmini button styleはこのfile内のprivate helperとする
- children、locale、session、raw role、overall loadingなし

callback identityはpublic contractに含めない。pageは現行と同様、renderごとに生成され得るcallbackを渡してよい。

### 8.6 `DashboardCorrectionModals`

```ts
export type DashboardIdCorrectionModalProps = {
  tankIds: string[];
  selectedTankId: string | null;
  reason: string;
  saving: boolean;
  confirmDisabled: boolean;
  disabledReason: string | null;
  onTankIdChange: (id: string | null) => void;
  onReasonChange: (reason: string) => void;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export type DashboardSingleVoidModalProps = {
  targetTankId: string;
  actionLabel: string;
  reason: string;
  saving: boolean;
  confirmDisabled: boolean;
  disabledReason: string | null;
  onReasonChange: (reason: string) => void;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export type DashboardBulkLocationOptionView = Readonly<{
  value: string;
  label: string;
}>;

export type DashboardBulkLocationModalProps = {
  selectedCount: number;
  options: readonly DashboardBulkLocationOptionView[];
  selectedValue: string;
  reason: string;
  saving: boolean;
  confirmDisabled: boolean;
  onValueChange: (value: string) => void;
  onReasonChange: (reason: string) => void;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export type DashboardBulkVoidModalProps = {
  selectedCount: number;
  reason: string;
  saving: boolean;
  confirmDisabled: boolean;
  onReasonChange: (reason: string) => void;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export type DashboardCorrectionModalsProps = {
  idCorrection: DashboardIdCorrectionModalProps | null;
  singleVoid: DashboardSingleVoidModalProps | null;
  bulkLocation: DashboardBulkLocationModalProps | null;
  bulkVoid: DashboardBulkVoidModalProps | null;
};
```

- nullable bundleがexactなopen contract
- `tankIds`だけは既存`PrefixNumberPickerProps.tankIds`が`string[]`のためmutable型を維持する。componentは変更しない
- ID変更と単一取消はcontroller生成の`disabledReason`を表示し、controller生成の`confirmDisabled`をbuttonへそのまま使う
- bulk 2 modalは現行UIにdisabled reason textがないため追加せず、controller生成の`confirmDisabled`だけを使う
- `onConfirm`は既存async handlerをそのまま呼び、childはawait、catch、validationを追加しない
- `onClose`にはpageが現行saving guardを含めて渡す
- optionはdisplay用`value` / `label`だけ。`CustomerSnapshot`はpageに残す
- `Modal`、`FieldLabel`、`DisabledReasonText`、form/button styleはこのfile内のprivate helper
- childrenなし

## 9. Log row projection contract

pageは`sortedLogs`からrenderごとに`DashboardLogRowView[]`を作る。新しいread model fileやpure UI view-model functionは作らない。

| 現行source/計算 | row view |
|---|---|
| `log.id` | `id` |
| `log.tankId` | `tankId` |
| `formatActionLabel(log.action, staffLocale)` | `actionLabel` |
| `actionBg(log.action)` / `actionFg(log.action)` | `actionBackground` / `actionForeground` |
| `log.location \|\| "-"` | `locationLabel` |
| `log.staffName \|\| "-"` | `staffLabel` |
| `formatTime(log.originalAt ?? log.timestamp)` | `timeLabel` |
| `log.logKind === "tank"` | `isTankLog` |
| `log.logKind \|\| "-"` | `logKindLabel` |
| `selectedLogIds.includes(log.id)` | `isSelected` |
| `canModifyLogReason`結果 | `canModify` / `modifyDisabledReason` |
| `canCorrectLogReason`結果 | `canCorrect` / `correctionDisabledReason` |
| `expandedRootId === (log.rootLogId ?? log.id)` | `isExpanded` |
| `historyLoadingRoot === rootId` | `historyLoading` |
| `historyByRoot[rootId]`のformat結果 | `historyEntries` |

row projectionは`loading ? [] : sortedLogs.map(...)`でguardする。`modifyDisabledReason = canModifyLogReason(...)`を先に求め、その後に`correctionDisabledReason = canCorrectLogReason(...)`を現行どおり独立に求める。checkboxのtitleは次をexactに維持する。

```ts
canModify
  ? "選択"
  : modifyDisabledReason ?? "期限外または対象外"
```

history entryはpageで次を固定する。

| 現行表示 | history view |
|---|---|
| `rev.id` | `id` |
| ``v${rev.revision ?? "-"}`` | `revisionLabel` |
| `statusLabel(rev.logStatus)` / `statusColor(...)` | `statusLabel` / `statusColor` |
| `formatActionLabel(rev.action, staffLocale)` | `actionLabel` |
| `formatTime(rev.revisionCreatedAt)` | `timeLabel` |
| editor/reasonの現行`-` fallback | `editMetadata` |
| voider/reasonの現行`-` fallback | `voidMetadata` |

`editMetadata`と`voidMetadata`は次のexact expressionと同じ結果にする。`revisionLabel`は`v`を含む完成文字列であり、childで再付与しない。

```ts
const editMetadata =
  rev.editedByStaffName || rev.editReason
    ? `${rev.editedByStaffName || "-"} / ${rev.editReason || "-"}`
    : null;

const voidMetadata =
  rev.logStatus === "voided"
    ? `${rev.voidedByStaffName || "-"} / ${rev.voidReason || "-"}`
    : null;
```

raw logをchildに付随させない。row ID callbackはpageのcurrent source logへ接続するadapterであり、childはIDのbusiness意味を解釈しない。

### 9.1 Callback adapter

component callbackとpage state/handlerの接続を次に確定する。

| component callback | page adapter |
|---|---|
| `onToggleSort` | `setLogSortOrder(prev => prev === "desc" ? "asc" : "desc")` |
| `onToggleEditMode` | `toggleEditMode` |
| `onSelectAll` | `selectAllLogs` |
| `onClearSelection` | `clearSelectedLogs` |
| `onOpenBulkLocation` | `openBulkLocationModal` |
| `onOpenBulkVoid` | `setBulkVoidReason("")`の後に`setBulkVoidModalOpen(true)` |
| `onToggleSelection(logId)` | `toggleLogSelection(logId)` |
| `onOpenEdit(logId)` | `logs.find(log => log.id === logId)`、missingならno-op、存在時だけ`openEdit(log)` |
| `onOpenVoid(logId)` | 同じfind/no-op後、`setVoidingLog(log)`、続けて`setVoidReason("")` |
| `onToggleHistory(logId)` | 同じfind/no-op後、存在時だけ`toggleHistory(log)`。missing時はresolved `Promise<void>` |

find対象はpageが所有するcurrent `logs`とし、componentにraw log lookupを移さない。adapterを新しいnamed business handlerまたは`useCallback`へ昇格させる必要はなく、既存13 named handler数と本文を維持する。

## 10. Modal open / close contract

| modal | nullable modelを作る条件 | pageに残すtarget | close guard |
|---|---|---|---|
| ID変更 | `editingLog && editForm` | `editingLog`、`editForm` | `!savingEdit` |
| 単一取消 | `voidingLog` | `voidingLog`、`voidReason` | `!savingVoid` |
| 一括貸出先変更 | `bulkLocationModalOpen` | selected logs、full option、value、reason | `!savingBulkLocation` |
| 一括取消 | `bulkVoidModalOpen` | selected logs、reason | `!savingBulkVoid` |

ID modalのraw current logは、same-ID validationとwrite payloadのためpageに残す。componentへは表示・inputに必要なselected tank IDだけを渡す。単一取消もraw logを渡さず、表示するtank IDとaction labelだけを渡す。

close callbackのside effectは次に固定する。

- ID変更: saving中はno-op。それ以外は`editingLog`だけをnullにし、`editForm`をclearしない
- 単一取消: saving中はno-op。それ以外は`voidingLog`だけをnullにし、`voidReason`をclearしない
- 一括貸出先変更: saving中はno-op。それ以外は`bulkLocationModalOpen=false`だけ
- 一括取消: saving中はno-op。それ以外は`bulkVoidModalOpen=false`だけ

toolbarとmodalのdisabled式は次に固定する。

```ts
const bulkLocationDisabled =
  selectedLogIds.length === 0
  || bulkLocationOptions.length === 0;

const bulkVoidDisabled =
  selectedLogIds.length === 0;

const bulkLocationConfirmDisabled =
  savingBulkLocation
  || !bulkLocationValue
  || bulkLocationReason.trim().length < 5;

const bulkVoidConfirmDisabled =
  savingBulkVoid
  || bulkVoidReason.trim().length < 5;

const idCorrectionConfirmDisabled =
  Boolean(editDisabledReason);

const singleVoidConfirmDisabled =
  Boolean(voidDisabledReason);
```

ID変更・単一取消・一括2種の`onConfirm`は、それぞれ`handleSaveEdit`、`handleVoid`、`handleBulkLocationChange`、`handleBulkVoid`へ直接接続する。confirm callbackの発火条件、button disabled、close button disabled、backdrop close条件を現行から変更しない。component内でreasonをtrimしたりlengthを再判定したりしない。

## 11. Helper ownership

| helper | PR-12 owner / 処理 |
|---|---|
| `SectionLabel` | `DashboardSectionLabel.tsx`へ機械移動 |
| `DashboardPanel` | `DashboardOperationsSummary.tsx`のprivate helperへ機械移動 |
| `IconTextButton` | `DashboardLogsSection.tsx`のprivate helperへ機械移動 |
| `Modal` | `DashboardCorrectionModals.tsx`のprivate helperへ機械移動 |
| `FieldLabel` | `DashboardCorrectionModals.tsx`のprivate helperへ機械移動 |
| `DisabledReasonText` | `DashboardCorrectionModals.tsx`のprivate helperへ機械移動 |
| `normalizeCorrectionRole` | pageに本文不変で残す |
| `toTankActionCode` | pageに本文不変で残す |
| `canModifyLog` | pageに本文不変で残す |
| `canModifyLogReason` | pageに本文不変で残す |
| `canCorrectLogReason` | pageに本文不変で残す |
| `getEditDisabledReason` | pageに本文不変で残す |
| `getVoidDisabledReason` | pageに本文不変で残す |
| `getBulkLocationUnavailableReason` | pageに本文不変で残す |
| `timestampToMillis` | pageに本文不変で残す |
| `toDate` | pageに本文不変で残す |
| `formatTime` | pageでcomponent props用文字列を生成 |
| `formatActionLabel` | pageでcomponent props用文字列を生成 |
| `formatReportStatus` | pageでcomponent props用文字列を生成 |
| `formatReportSource` | pageでcomponent props用文字列を生成 |
| `statusLabel` / `statusColor` | pageでhistory propsを生成 |
| `tankStatusColor` | pageでstatus item propsを生成 |
| `actionBg` / `actionFg` | pageでlog row toneを生成 |
| `errorMessage` | pageに本文不変で残す |
| form/modal style helper | `DashboardCorrectionModals.tsx`へ機械移動 |
| mini action style helper | `DashboardLogsSection.tsx`へ機械移動 |

shared timestamp utility、test-only export、business helperのcomponent移動は行わない。page、query、read modelの3箇所にあるtimestamp helper本文一致を引き続き維持する。

## 12. CSS ownership

PR-12はCSS再設計を行わない。

- 既存inline styleは対応する表示ownerへそのまま機械移動する
- root、max-width、header、loading styleは`StaffDashboardView.tsx`
- status styleは`DashboardStatusSummary.tsx`
- business panel styleは`DashboardOperationsSummary.tsx`
- toolbar、row、history styleは`DashboardLogsSection.tsx`
- modal/form styleは`DashboardCorrectionModals.tsx`
- 現行末尾`<style>`全体は`StaffDashboardView.tsx`へ本文不変で移動する
- `@keyframes spin`を維持する
- `.dashboard-log-row`等のclass名を維持する
- `@media (max-width: 720px)`を維持する
- `<style>`はView rootの末尾に置き、loading時も存在させる

CSS module、feature-local CSS file、Tailwind全面移行、design token化、class renameは行わない。現在のstyle blockはdashboard root内で出力される既存形を維持し、他page向けselectorを追加しない。

## 13. Future Claude UI-only surface

PR-12完了後、任意の別Claude UI-only PRで編集可能なファイルは次の6件だけとする。

```text
src/features/staff-dashboard/components/StaffDashboardView.tsx
src/features/staff-dashboard/components/DashboardSectionLabel.tsx
src/features/staff-dashboard/components/DashboardStatusSummary.tsx
src/features/staff-dashboard/components/DashboardOperationsSummary.tsx
src/features/staff-dashboard/components/DashboardLogsSection.tsx
src/features/staff-dashboard/components/DashboardCorrectionModals.tsx
```

Claudeが編集してはいけない範囲:

```text
src/app/staff/dashboard/page.tsx
src/features/staff-dashboard/components/dashboard-components.test.ts
src/features/staff-dashboard/queries/**
src/features/staff-dashboard/services/**
src/lib/firebase/**
src/lib/tank-operation.ts
domain / label / identity helper
package.json
package-lock.json
firestore.rules
firestore.indexes.json
firebase.json
```

Claude UI-only PRはprops contractを変更せず、business logic、Firestore read/write、billing、settings schema、customer/staff identity、package/Rules/index/Firebase設定を変更しない。PR-12とClaude作業を同一PRまたは同一pageで並行しない。

## 14. 実装不変条件

### 14.1 Query / read

- 初期3readと`Promise.all`
- `getActiveLogs({ orderBy: null })`
- repository返却順の先頭200件cap
- customer options順
- unfilled reportの現行sort、10件state、5件表示
- `useTanks()`
- today二段memoとdependency
- browser runtime local day
- log sort asc/desc
- timestamp helper本文と`NaN`境界値
- root history exact query、revision sort、cache
- error透過とpage側catch

### 14.2 Write

- 4 write handler本文
- workflow service 4関数
- exact payload
- raw reason
- correction role
- `requireStaffIdentity`のresolver位置
- 一括入力順、continue-on-error、failure順
- alert textと発火順
- modal/selection/history state clear順
- correction後の`Promise.all([fetchData(), refetchTanks()])`
- await有無
- catch/finally
- atomic coreとrepository差分ゼロ

### 14.3 UI state

- 23 stateの唯一owner
- edit mode切替
- edit mode終了時clear
- selection prune
- select all対象
- clear selection
- row checkbox disabled/title
- modal open/close条件
- close時に現行以上のform/reason clearを追加しない
- saving guard
- disabled reason
- controlled input
- sort toggle
- root history expand/collapse
- cache済みrootの再queryなし
- history loading

### 14.4 Display

- header、session name、全copy
- DOM上のsection/modal/style順
- icon種類とsize
- status/action badge
- active log count
- empty state
- loading表示とanimation
- title属性
- disabled属性
- colors
- spacing
- border
- font size/weight/family
- max heightとoverflow
- 720px responsive grid
- StaffAuthGuardの認証・maintenance挙動

PR-12ではaccessibility redesignも行わない。既存`aria-label`、button type、title、disabledを維持し、新規仕様を混ぜない。

## 15. 後続PR-12のtest計画

### 15.1 Test環境

現行はVitestのNode環境で、`@testing-library/*`とjsdomを導入していない。`react`、`react-dom`、TypeScript compiler APIは既存dependencyで利用可能である。

新設する`dashboard-components.test.ts`は追加packageなしで次を組み合わせる。

- `react-dom/server`のstatic render
- `React.createElement`による`.test.ts` fixture
- TypeScript AST/source comparison
- `tsc`によるprops compile contract

`.test.tsx`は新設せず、現行Vitest includeに確実に含まれる`.test.ts`とする。

### 15.2 Static render / component contract

最低限、次をfixtureで確認する。

- View header、session name、loading、children、overlays
- status total、item、empty
- customer loan panel populated/empty
- today panel total/breakdown/empty
- report badge、最大表示fixture、fallback済み文字列
- logs count、sort asc/desc、edit mode
- bulk toolbarとdisabled
- tank/non-tank log row
- selected/unselected row
- modify/correct disabled reason
- history loading、empty、revision metadata
- ID modal open/closed、picker value、reason、disabled reason
- single void modal
- bulk location modal options/disabled
- bulk void modal/disabled
- 全user-visible text/copy、class名、title、`aria-label`、disabled属性
- header→loading/content→overlay→styleのDOM順と、section/modal内の現行DOM順

未充填報告の顧客名は、次の境界値をcharacterizationとして固定する。

顧客名あり:

```ts
report.customerName = "顧客A";
```

```text
表示:
  顧客A

title:
  顧客A
```

顧客名なし:

```ts
report.customerName = undefined;
```

```text
表示:
  顧客未設定

title:
  ""
```

Static render testでは最低限次を固定する。

```ts
expect(html).toContain(
  'title=""',
);

expect(html).toContain(
  "顧客未設定",
);

expect(html).not.toContain(
  'title="顧客未設定"',
);
```

顧客名ありfixtureでは、可能なら次も固定する。

```ts
expect(html).toContain(
  'title="顧客A"',
);
```

server static renderはcallback実行を検証しない。event wiringはAST/source contractで固定する。

### 15.3 Static / AST contract

- pageに23 state名、型/初期値、ownerが残る
- 13 named handlerがpageに残る
- 4 write handler本文がcanonical source fixtureと一致
- query/read model callとtoday二段memoが一致
- `canModifyLogReason`、`canCorrectLogReason`、disabled helper本文が一致
- page/query/read modelのtimestamp helper本文一致
- component callback propが正しいpage handler/adapterへ接続される
- 4 modal confirmが正しいwrite handlerへ接続される
- 4 modal close guardが現行saving条件と一致
- display projectionが現行helperへ接続される
- `DashboardUnfilledReportRowView`に`customerTitle: string`がある
- page projectionが`customerTitle`へ`report.customerName || ""`を使用する
- componentが`title={report.customerTitle}`を使用し、本文表示へ`report.customerName`を使用する
- component内に顧客名fallback比較を追加しない
- 全現行JSX text/copy、title、`aria-label`、disabled expressionのsource inventoryが一致する
- header、section、modal、styleのDOM順が一致する
- responsive style block、class、720pxが一致
- componentにquery/read model function、write workflow、session/tanks hook、repository、Firestore、`Date.now()`、alertのforbidden import/callがない
- sourceのquery/read/write filesに差分がない

既存query/read model testとworkflow characterization testは変更せず回帰確認する。

### 15.4 全体検証

```text
git diff --check
changed-files eslint
npx tsc --noEmit --pretty false
npm run build
npm test
npm run test:rules:transition
npm run test:transition-policy
npm run test:transition-projections
```

package変更は行わない。

## 16. L0計画

PR-headのstaff dashboardで次を確認する。

- total tank数
- status別件数、色、label
- 貸出先別panel
- today total / breakdown
- 未充填報告badgeと最大5件表示
- active logs件数
- sort toggle
- edit mode
- selection、全選択、選択解除
- bulk action disabledと説明
- root history展開、loading、revision順
- ID変更modal表示とdisabled
- 単一取消modal表示とdisabled
- 一括貸出先変更modal表示とdisabled
- 一括取消modal表示とdisabled
- loading表示
- 720px以下のmobile layout
- console error有無

L0ではwrite confirmを実行しない。production business-data writeは0件とする。StaffAuthGuard maintenance writeが発生し得る場合はbusiness-data writeと分けて記録し、実施時の正本verification levelと承認条件に従う。

PR-12はUI構造の等価抽出であり、write経路を変更しない。production-write L2の要否は後続実装PRの最終確認時に変更責務と正本に基づき判定し、このdocs PRでは実施しない。

## 17. 1PR可否・rollback

PR-12は1PRで実施可能である。

根拠:

- query/read model/write/domain変更なし
- 23 stateと13 handlerの意味・owner変更なし
- controlled propsだけで分離可能
- UI view-model utility不要
- controller hook/context/reducer/store不要
- package追加不要
- exact 8ファイルでreview可能
- static renderとAST/source contractで固定可能
- page→新componentの一方向参照
- PR内新設fileはPR内のpageだけが参照
- 単独revertで参照が残らない

実装中にcontroller hook、business view-model file、state/write再設計、package、CSS全面移行、8ファイル超過が必要になった場合は、PR-12実装を停止して本設計の再改訂を行う。PR-12A等の番号は勝手に確定しない。

## 18. 対象外

- visual redesign
- copy変更
- color変更
- spacing変更
- accessibility redesign
- loading変更
- skeleton追加
- chart追加
- pagination
- realtime listener
- query変更
- read model変更
- write workflow変更
- validation変更
- state machine変更
- context/reducer/store導入
- controller hook抽出
- package追加
- CSS module化・Tailwind全面移行
- Claudeによる同時編集
- PR-D系列
- timestamp正規化
- legacy cleanup

## 19. 設計停止条件

後続実装で次が必要と判明した場合は停止する。

- state ownerの二重化
- write handler本文変更
- query/read model変更
- new controller hook/context/reducer/store
- business view-model utility
- package追加
- CSS全面変更
- schema、Rules、index変更
- visual redesignとの混在
- §5の指定8件以外の変更、指定fileの欠落、または8ファイル超過

現行監査ではいずれも必要なく、正本との矛盾もない。

## 20. PR-12実装開始条件

- 本docs-only PRがmerge済み
- 実装baseがmerge後の最新`origin/main`
- 変更対象が§5の指定8件すべて、かつその8件だけ
- Codex単独担当
- query/read model/write/domain不変
- visual redesign非混在
- 本書のprops/state/helper/CSS/test contractを採用

本条件を満たした後にのみPR-12実装を開始する。
