# Staff English Mode Audit

## Baseline

- Audit base: `e19d8a67f9cc899d9b8167e3a1462e85a1fe64c0`
- Required merged ancestors: `#172`, `#173`, `#175`
- Staff routes: 14 page routes (12 screens and 2 compatibility redirects)
- Shared staff layout: 1
- Route-level `loading`, `error`, `not-found`, `template`, or `default` files: 0
- Runtime dynamic or lazy imports: 0
- Recursive staff-visible closure inspected: 118 files
- Production files enforced by the residual scanner: 79
- Initial Japanese source-line occurrences in the enforced scope: 732
- Initial fully localized screens: 0
- Initial partially localized screens: 6
- Initial screens without locale-aware UI: 6
- Native UI calls in the staff-visible closure: 29 `alert`, 10 `confirm`, 0 toast

The broader recursive inventory found 1,575 Japanese-containing source line-sites:

| Classification | Production | Tests / fixtures | English-display decision |
|---|---:|---:|---|
| Already locale-managed | 66 | 0 | translated by the existing locale table |
| Unmanaged UI or error copy | 569 | 0 | must be moved behind a locale boundary |
| Canonical value rendered directly | 1 | 0 | map for display without changing the value |
| System action, status, tag, or saved marker | 77 | 0 | preserve the stored value; translate only a known display mapping |
| Proper names | 3 | 0 | preserve exactly as entered |
| Japanese comments | 502 | 0 | non-rendered, reviewed exception |
| Developer-only or inert source | 94 | 0 | non-rendered, reviewed exception |
| Test and fixture data | 0 | 263 | preserve where it exercises legacy or user data |
| **Total** | **1,312** | **263** | |

The scanner count is intentionally a source-line count. It includes UI copy, Japanese
locale dictionaries, comments, canonical domain values, and developer-only messages.
`scripts/staff-i18n-baseline.json` pins each current line with a path-bound SHA-256
fingerprint so that new unmanaged Japanese cannot be added while migration is in
progress. The final cleanup must remove translated UI copy from the baseline and leave
only reviewed non-UI exceptions.

This fingerprint file is a temporary migration ratchet, not a translation catalog or a
permanent allowlist. E1-E4 must not add baseline fingerprints. Each migrated Japanese
UI line removes its old fingerprint, and E4 switches the baseline to strict mode so
stale fingerprints fail CI. Rebuilding the whole baseline to accept new Japanese copy
is not an allowed translation workflow. Permanent exceptions must be narrow, non-UI,
and documented by category (saved compatibility value, user content, Japanese comment,
test fixture, or developer-only text).

## Route Inventory

| Route | Primary file | Related staff-visible code | Existing locale coverage | Alerts / confirms | Accessibility focus | Stack PR | Risk |
|---|---|---|---|---|---|---|---|
| all `/staff/**` | `src/app/staff/layout.tsx` | `StaffAuthGuard`, `StaffJoinRequestPanel`, pending-order and transition-policy hooks | None for shell/auth; locale is available after staff profile restoration | none | Name menu/close controls; label auth state and inputs | E1 | high |
| `/staff` | `src/app/staff/page.tsx` | client redirect to `/staff/lend` | not applicable | none | no redirect status | E1 | low |
| `/staff/lend` | `src/app/staff/lend/page.tsx` | `OperationsTerminal`, manual-operation and order-fulfillment components/hooks | partial action/status/message coverage | manual and order confirmation/error paths | picker labels, icon controls, hidden inputs | E2 | high |
| `/staff/return` | `src/app/staff/return/page.tsx` | manual return, return-request approval, bulk return | partial tag/action/cycle-warning coverage | manual, request approval, and bulk paths | gesture launcher, accordion, icon controls | E2 + E3 | high |
| `/staff/fill` | `src/app/staff/fill/page.tsx` | `OperationsTerminal`, manual-operation components/hooks | partial action/status/message coverage | manual operation paths | picker labels, icon controls, hidden inputs | E2 | high |
| `/staff/damage` | `src/app/staff/damage/page.tsx` | maintenance tabs/swipe, `TankIdInput`, damage workflow | none | 1 confirm | textarea label, remove control, result status | E4 | medium-high |
| `/staff/repair` | `src/app/staff/repair/page.tsx` | maintenance tabs/swipe, repair workflow | none; status helper defaults to `ja` | 1 confirm | selection cards need button semantics | E4 | high |
| `/staff/inspection` | `src/app/staff/inspection/page.tsx` | maintenance tabs/swipe, inspection settings/workflow | none; dates fixed to `ja-JP` | 1 confirm | selection cards and live status | E4 | high |
| `/staff/inhouse` | `src/app/staff/inhouse/page.tsx` | `TankIdInput`, `ReturnTagSelector`, in-house workflows | return tags only | 2 alerts, 1 confirm | hidden input and live status | E4 | high |
| `/staff/dashboard` | `src/app/staff/dashboard/page.tsx` | six dashboard view components, read model, correction workflow | action labels only | 8 alerts | dialog semantics, focus, close labels | E4 | very high |
| `/staff/mypage` | `src/app/staff/mypage/page.tsx` | profile/session/locale services, recent log projection | locale selector messages and action labels only | none | associate language label and live feedback | E4 | high |
| `/staff/supply-order` | `src/app/staff/supply-order/page.tsx` | procurement tabs/swipe, order master and workflow | none | 1 confirm | selectable rows and quantity controls | E4 | high |
| `/staff/order` | `src/app/staff/order/page.tsx` | client redirect to `/staff/supply-order` | not applicable | none | no redirect status | E4 | low |
| `/staff/tank-purchase` | `src/app/staff/tank-purchase/page.tsx` | shared `TankEntryScreen`, procurement tabs/swipe | none | shared 1 confirm | labels, remove control, pressed states | E4 | very high |
| `/staff/tank-register` | `src/app/staff/tank-register/page.tsx` | shared `TankEntryScreen`, procurement tabs/swipe | none | shared 1 confirm | labels, remove control, pressed states | E4 | very high |

## Shared UI Inventory

The staff routes directly or transitively render these shared presentation components:

- `src/components/StaffAuthGuard.tsx`
- `src/components/StaffJoinRequestPanel.tsx`
- `src/components/StaffSectionTabs.tsx`
- `src/components/MaintenanceTabs.tsx`
- `src/components/ProcurementTabs.tsx`
- `src/components/QuickSelect.tsx`
- `src/components/DrumRoll.tsx`
- `src/components/PrefixNumberPicker.tsx`
- `src/components/ReturnTagSelector.tsx`
- `src/components/TankIdInput.tsx`

Cross-surface regression boundaries:

- `ReturnTagSelector` is also used by the portal return screen.
- `PrefixNumberPicker` is also used by the portal unfilled-report screen.
- `useStaffSession` is also used by admin screens.
- action/status label helpers are also used by portal and admin screens.

Shared APIs therefore keep Japanese defaults and receive locale or translated copy as
optional presentation inputs. The locale source, storage, authentication contract, and
Firestore reads/writes are not changed.

## Display Boundary Decisions

- `status`, `action`, and `transitionAction`: coerce to stable code and translate only
  with the existing label helpers.
- `ReturnTag`: preserve `normal`, `unused`, `uncharged`, and `keep`; translate only the
  rendered label.
- System location values: preserve `倉庫` and `自社`; render `Warehouse` and `In-house`
  in English.
- Customer locations, `customerName`, `staffName`, tank IDs, order IDs, free-form notes,
  and user-created names: render unchanged.
- Bulk-return pool codes and timestamps are stable data. Japanese `poolLabel` and
  `dateLabel` are not English display sources; English labels are derived from pool code
  and timestamp at the presentation boundary.
- Known UI validation branches use stable conditions and localized messages. Unknown
  errors remain in logging, while English UI receives a non-sensitive generic message.
- No UI label is reverse-mapped into a saved value or used by a transition condition.

## Glossary

Existing repository terminology is preferred. These choices are the staff English-mode
canonical display vocabulary:

| Japanese | English | Decision |
|---|---|---|
| 貸出 | Lend | Existing action label |
| 返却 | Return | Existing action label |
| 一括返却 | Bulk return | Concise grouped operation |
| 充填 | Fill | Existing action label; do not mix with refill/charge |
| 未充填 | Uncharged | Existing return-tag label |
| 返却／持ち越し | Return / Carry over | Mirrors the two resulting operations |
| 持ち越し | Carry over | Existing return-tag/action label |
| 破損 | Damage / Damaged | Noun for workflow, adjective for status |
| 修理 | Repair / Repaired | Workflow and completed status |
| 耐圧検査 | Inspection | Existing action label |
| 自社 | In-house | Existing action/status vocabulary |
| 倉庫 | Warehouse | System location display only |
| 顧客 | Customer | Existing bulk-return English copy |
| タンク | Tank | Product-wide term; do not mix with cylinder |
| 本数 | Tanks / count | Natural English count text |
| 操作 | Operation | Product-wide operation term |
| 確認 | Confirm | Action button |
| 取消 | Void | Log-revision operation; use Cancel only for ordinary UI dismissal |
| 保存 | Save | Settings and edit action |
| 完了 | Complete | Workflow completion |
| 承認 | Approve | Order approval |
| 却下 | Rejected | Join-request state |
| 未処理 | Pending | Workflow state |
| 処理中 | Processing | In-progress UI |
| エラー | Error | Generic error heading |
| タグ | Tag | Return tag |
| 資材発注 | Supply order | Existing action vocabulary |
| 注文／受注 | Order / customer order | Use “fulfillment” for the staff completion workflow |
| 返却申請 | Return request | Request is distinct from confirmed return |
| 貸出先 | Customer | Existing staff bulk-return usage; saved customer identity is unchanged |
| 現在地 | Current location | Display label only |
| 選択中 | Selected | Selection state |
| 対象なし | No items | Context-specific empty state |
| 読み込み中 | Loading | Loading state |
| 再試行 | Try again | Recovery action |

## PR Boundaries

1. E0: this inventory, glossary, key-parity test, and exact Japanese baseline.
2. E1: locale foundation, display mappers, staff shell/auth, and shared UI.
3. E2: manual operation, order fulfillment, return-request processing, tabs, and pickers.
4. E3: bulk-return panel/hook/read-model presentation and return-segment launcher.
5. E4: dashboard, mypage, maintenance, in-house, procurement, supply order, and final
   strict residual cleanup.

The E3 boundary intentionally keeps A2 cycle-readiness logic unchanged. E4 handles the
dashboard and `TankEntryScreen` last because their presentation is adjacent to correction
and write workflows.
