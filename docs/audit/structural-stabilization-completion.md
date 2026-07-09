# Structural Stabilization Completion Audit

Date: 2026-07-09

## Completion Definition

Structural stabilization means the current system is ready for later feature work without making Firestore state, billing calculation, customer identity, operation logs, or display behavior harder to reason about.

For this project, the stabilized structure is:

- Formal tank operations go through `applyTankOperation()` / `applyBulkTankOperations()` or a service that delegates to them.
- `tanks` remains the current-state snapshot.
- `logs` remains the operation-history source of truth.
- `transactions` remains the customer-initiated workflow source.
- `customerId` is the primary customer identity.
- `customerName`, `staffName`, and `location` are display or compatibility snapshots.
- Billing calculation stays in `src/lib/billing/*`.
- Billing UI consumes `InvoiceCandidate` output and does not recalculate totals.
- Portal, billing, bulk return, and dashboard reads prefer `customerId` and preserve legacy fallback.
- New features should attach through small services/helpers rather than expanding page-level Firestore logic.

This audit does not mean all features are complete. Invoice finalization, invoice numbers, paid/unpaid management, memo-only recording, mail, LINE, and full payment management remain future work.

## Audited Areas

Checked areas:

- `src/lib/tank-operation.ts`
- `src/lib/tank-action-status-codes.ts`
- `src/lib/tank-rules.ts`
- `src/lib/customer-identity-read.ts`
- `src/lib/billing/*`
- `src/app/admin/billing/page.tsx`
- `src/app/admin/sales/page.tsx`
- `src/app/admin/staff-analytics/page.tsx`
- `src/app/staff/dashboard/page.tsx`
- `src/app/staff/order/page.tsx`
- `src/app/staff/supply-order/page.tsx`
- `src/features/staff-operations/**`
- `src/features/procurement/**`
- `src/lib/firebase/repositories/**`
- `src/app/portal/**`

Notes:

- `src/app/staff/orders/page.tsx` does not exist in the current tree. Staff order functionality is routed through `src/app/staff/order/page.tsx` as a redirect and `src/features/staff-operations/**`.
- Direct Firestore writes for tank operations are still centralized around `tank-operation.ts` and operation-specific services. This PR does not add a new `tanks.status` write path.

## Fixed Structural Issues

This sprint made small, closed refactors only:

- Moved billing customer master reads out of `/admin/billing` into `getBillingCustomerMasters()`.
- Moved monthly sales archive reads out of `/admin/sales` into `getMonthlyStats()`.
- Moved daily sales and staff analytics aggregation into pure helpers in `src/lib/analytics/operation-stats.ts`.
- Reused `listOrderItems()` for staff supply-order and tank entry screens instead of reading `orderMaster` directly from those UI components.
- Added `listActiveCustomerSnapshots()` for active customer identity reads and used it from staff operations and dashboard.
- Removed the dashboard action badge fallback that classified unknown action strings with Japanese substring checks. Known legacy labels still go through `coerceTankActionCode()`.
- Cleaned the touched staff analytics import so the changed file no longer contributes unused icon warnings.

These changes do not alter billing amounts, tank transition rules, Firestore schema, transaction status, customer grouping rules, or portal behavior.

## Remaining Non-Blockers

Remaining items that are not structural blockers:

- `src/app/staff/dashboard/page.tsx` and `src/app/admin/billing/page.tsx` are still large pages. Further splitting should be feature-specific, not a broad rewrite.
- Admin master/settings screens still read settings collections directly in page/feature code:
  - `notifySettings`
  - `lineConfigs`
  - `priceMaster`
  - `rankMaster`
  - customer management screens
- `features/procurement/lib/submitTankEntryBatch.ts` still writes `tankProcurements`, `logs`, and tanks in its own transaction. It is an existing business batch, not a new operation bypass.
- `tank-rules.ts` still has a legacy display helper `isInHouseAction(action: string)` using `action.includes("自社")`. Because `tank-action-status-codes.ts` imports `ACTION` from `tank-rules.ts`, replacing that helper inside `tank-rules.ts` would require a larger dependency reshuffle and is deferred.
- Sales monthly archive still displays `monthly_stats.location` as historical snapshot data.
- Lint baseline remains outside this sprint except for touched-file cleanup.

## Extension Points

Use these connection points for future feature work:

- Formal tank operation features:
  - Add workflow/service code that produces `TankOperationInput`.
  - Delegate final state changes to `applyTankOperation()` or `applyBulkTankOperations()`.
  - Do not add new direct `tanks.status` writers.
- Customer identity reads:
  - Use `buildCustomerIdentityGroup()` when grouping mixed current and legacy tank/log data.
  - Use `listActiveCustomerSnapshots()` when UI needs active customer choices.
  - Keep `location` fallback explicit and local to compatibility reads.
- Billing:
  - Source candidates through `buildInvoiceCandidates()`.
  - Calculate amounts through `calculateBillingCandidate()`.
  - Read billing customer masters through `getBillingCustomerMasters()`.
  - Treat `InvoiceCandidate` as the UI contract.
- Analytics:
  - Use `buildDailyOperationStats()` and `buildStaffOperationStats()` for operation counts.
  - Add future analytics helpers beside these instead of duplicating action-code counting in pages.

## Memo-Only Safe Connection Point

When memo-only recording is implemented, attach it as a separate service:

- Add a new append-only service such as `appendOperationMemoLog()`.
- Write `logs` documents with `logKind: "operation_memo"` and `billable: false`.
- Do not write `transitionAction`.
- Do not update `tanks`.
- Do not update `transactions`.
- Do not enter the tank-operation revision chain.
- Keep dashboard display in a separate memo panel or explicitly gated view.
- Keep billing source matching on formal tank-operation logs only.

Do not implement `settings/operationMode` or memo-only writes as part of structural stabilization.

## Invoice Finalization Safe Connection Point

When invoice finalization is implemented, attach it after `InvoiceCandidate` generation:

- Keep preview calculation in `src/lib/billing/*`.
- Create a finalization service that receives an `InvoiceCandidate` and settings snapshot.
- Store finalized invoice snapshots separately from candidate preview state.
- Add invoice number allocation in the finalization service, not in the React component.
- Add paid/unpaid state on the finalized invoice model, not on source logs.
- Do not mutate historical `logs` to mark billing state unless a separate billing-source ledger is designed.

Do not add `monthlyInvoices`, invoice numbering, or paid/unpaid state in this sprint.

## Do Not Touch Yet

Avoid these areas unless a later PR explicitly scopes them:

- `applyTankOperation()` transition semantics.
- `applyBulkTankOperations()` transaction semantics.
- Firestore Rules and indexes.
- `firebase.json`.
- `package.json` and lockfile.
- billing tax, rounding, return-tag discount, or customer grouping logic.
- production Firestore data, migrations, and backfills.
- strict/pass-through mode switching in the formal operation path.

## Next PR Candidates

Recommended order after this PR:

1. Billing manual smoke result and any tiny bug fixes found during smoke.
2. Memo-only operation recording, with no tank state update.
3. Invoice finalization design before adding `monthlyInvoices`.
4. Invoice number and paid/unpaid implementation.
5. Sales / staff analytics improvements.
6. Lint baseline cleanup.

## Validation

Validation during this sprint:

- `git diff --check`: passed.
- Changed-files eslint: passed for all modified TypeScript/TSX files.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run build`: passed.
- `npm run lint`: failed on existing baseline with 10 errors and 36 warnings.

The lint failure is not introduced by this sprint. The touched files pass targeted eslint, and the previous unused imports in `src/app/admin/staff-analytics/page.tsx` were removed.
