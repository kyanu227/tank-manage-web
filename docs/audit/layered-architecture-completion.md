# Layered Architecture Completion Audit

Date: 2026-07-09

## Summary

This sprint continues the structural work after PR #120. It does not claim that every page is fully decomposed. It completes the next safe layer separation step by moving remaining low-risk Firestore reads and aggregation orchestration out of page/component code where the existing behavior could be preserved exactly.

No new product feature was added. This sprint does not change Firestore schema, Firestore Rules, indexes, Firebase config, package files, tank operation transition rules, billing calculation, customer grouping, portal authentication, memo-only recording, invoice finalization, or paid/unpaid state.

## Layer Responsibilities

Repository:

- Thin Firestore wrappers for core `tanks`, `logs`, and `transactions` reads/writes.
- No UI state.
- No page-specific view model shaping.
- No new business decisions beyond the existing repository contracts.

Service:

- Firestore path hiding for admin settings, master data, customer management, portal settings, billing settings, and workflow-specific writes.
- Screen/business read orchestration when a full repository layer would be premature.
- Multiple collection reads or save-time concurrency checks.
- Compatibility normalization that is tied to a stored document shape.

Hook:

- React loading/error state.
- Service/repository calls for a page-level view model.
- Aggregation helper calls needed by a page.
- Selection state only when it belongs to fetched page data.

Page:

- Layout, tab state, print/dialog state, and event handler wiring.
- Feature component or hook calls.
- No direct Firestore query construction where a service/hook exists.
- Billing preview display still renders provided `InvoiceCandidate` values without recalculating totals.

Component:

- Display and input only.
- No direct Firestore reads.
- No billing amount calculation.
- No tank status transition decisions.

## Extracted Services

Added or extended service read functions:

- `loadAdminMoneySettings()` in `src/lib/firebase/admin-money-settings.ts`
  - Reads `priceMaster` and `rankMaster`.
  - Keeps the existing rank sort order.
  - Leaves save-time diff/concurrency behavior in the same service.
- `loadAdminNotificationSettings()` in `src/lib/firebase/admin-notification-settings.ts`
  - Reads `notifySettings/config` and `lineConfigs`.
  - Keeps existing default values for missing notification settings.
- `getAdminPermissions()` in `src/lib/firebase/admin-permissions-service.ts`
  - Reads `settings/adminPermissions`.
  - Builds the same default admin/pre-admin permission map when the doc is missing.
- `getPortalAutoReturnSchedule()` in `src/lib/firebase/admin-settings.ts`
  - Reads only the configured portal auto-return schedule.
  - Preserves the previous `/portal/return` behavior where a missing settings doc does not enable auto-return.
- `listCustomersForManagement()` in `src/lib/firebase/customers-service.ts`
  - Reads `customers` for admin customer management.
  - Normalizes name/company/formal name/prices/isActive/email once in the service.
  - Keeps the existing created-at descending sort for the customer management table.
- `listCustomersForPortalUserLinking()` in `src/lib/firebase/customers-service.ts`
  - Reads the same normalized customer rows for portal-user linking.
  - Preserves the previous unsorted Firestore iteration order for the select list.

## Extracted Hooks

Added page-level hooks:

- `useBillingInvoiceCandidates()` in `src/hooks/useBillingInvoiceCandidates.ts`
  - Loads active logs, billing customer masters, and billing invoice settings.
  - Builds `InvoiceCandidate[]` through `buildInvoiceCandidates()`.
  - Owns loading state and selected invoice key.
  - Does not change billing calculation or settings save behavior.
- `useSalesStats()` in `src/hooks/useSalesStats.ts`
  - Loads recent active logs and monthly archive rows.
  - Builds daily stats through `buildDailyOperationStats()`.
  - Groups monthly archive rows for display.
- `useStaffAnalyticsStats()` in `src/hooks/useStaffAnalyticsStats.ts`
  - Loads active logs.
  - Builds staff operation counts through `buildStaffOperationStats()`.

## Page And Component Changes

Pages/components that no longer construct Firestore queries directly:

- `src/app/admin/money/page.tsx`
- `src/app/admin/notifications/page.tsx`
- `src/app/admin/permissions/page.tsx`
- `src/app/portal/return/page.tsx`
- `src/features/admin-customers/CustomerManagementPage.tsx`
- `src/features/admin-customers/PortalUsersPanel.tsx`

Pages that were thinned by hooks:

- `src/app/admin/billing/page.tsx`
- `src/app/admin/sales/page.tsx`
- `src/app/admin/staff-analytics/page.tsx`

## What Remains In Pages

Kept in pages intentionally:

- `/admin/billing`
  - Print mode, active tab, month input, settings form state wiring, and invoice presentation remain in the page.
  - Splitting invoice presentation into components is UI work and should not be mixed with billing logic changes unless scoped separately.
  - Settings save remains in the page but uses `billing-settings-service`; this avoids changing save/reload behavior in the same PR as load extraction.
- `/staff/dashboard`
  - Still large and still owns log editing, summary, and modal state.
  - It touches operation correction flows and should be split in a focused dashboard PR.
- `/admin/page`
  - Still calls repositories for top-level dashboard summary.
  - This is a read-only summary and not a blocker for memo-only or billing finalization.
- `/staff/mypage`
  - Still calls `logsRepository.getActiveLogsByStaffId()`.
  - This is already repository-based and can move to a hook when staff profile/session pages are cleaned together.
- Portal/admin/staff layout pages
  - Still own localStorage/session/Auth guard behavior.
  - Session unification is deferred because portal Auth, staff passcode session, and admin Firebase Auth have different lifecycle rules.

## Remaining Firestore Direct Access

After this sprint, `src/app` and `src/features` direct Firestore query construction is reduced to:

- `src/features/procurement/lib/submitTankEntryBatch.ts`
  - Existing business batch for tank procurement.
  - Writes `tankProcurements`, `logs`, and `tanks`.
  - Kept because it is an explicit write workflow and not a page/component read.

Direct Firestore access remains in `src/lib/firebase/**`, `src/lib/firebase/repositories/**`, `src/lib/tank-operation.ts`, and `src/lib/tank-trace.ts` by design. Those are service/repository/domain locations, not UI locations.

## Deferred Layering Work

Deferred because it needs a tighter feature-specific PR:

- Split `/staff/dashboard` into hooks and feature components.
- Split `/admin/billing` invoice presentation and settings presentation into components.
- Move admin top-level dashboard and staff mypage repository reads into small hooks.
- Audit portal/admin/staff localStorage/session handling as one auth-session PR.
- Decide whether master/settings services should become repositories later. Current project policy allows direct service reads for settings/master collections.
- Replace legacy `monthly_stats.location` archive dependency only when monthly reporting requirements need customerId-based archives.

## Memo-Only Connection Point

Memo-only recording should connect after this layering as follows:

- Add a service such as `appendOperationMemoLog(input)`.
- Keep it outside `applyTankOperation()` and `applyBulkTankOperations()`.
- Write logs with `logKind: "operation_memo"`, `billable: false`, no `transitionAction`, and no tank state update.
- Add a hook for any memo UI that calls that service and owns loading/error state.
- Do not include memo logs in `useBillingInvoiceCandidates()`.
- Do not let memo logs enter `/staff/dashboard` correction flows unless a separate memo-edit design exists.

## Billing Finalization Connection Point

Billing finalization should connect after preview generation:

- Keep preview loading in `useBillingInvoiceCandidates()`.
- Keep amount calculation in `src/lib/billing/*`.
- Add a finalization service that receives an `InvoiceCandidate` and the normalized settings snapshot.
- Store finalized invoice snapshots separately from source `logs`.
- Allocate invoice numbers in the finalization service.
- Add paid/unpaid state to finalized invoice documents, not to preview candidates or source logs.
- Keep `/admin/billing` as the caller and presentation shell; do not recalculate invoice totals in the page.

## Validation

Validation for this sprint:

- `git diff --check`: passed.
- Changed-files eslint: passed for all modified TypeScript/TSX files.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run build`: passed.
- `npm run lint`: failed on existing baseline with 7 errors and 36 warnings.

Known expectation:

- The full lint failure is not introduced by this sprint.
- Current full lint errors remain in `import_tanks.js`, `src/app/admin/order-master/page.tsx`, `src/app/admin/staff/page.tsx`, and `src/components/PrefixNumberPicker.tsx`.
- This sprint removed touched-file `no-explicit-any` errors from `src/app/admin/permissions/page.tsx` and `src/features/admin-customers/PortalUsersPanel.tsx`.
