# Current Blockers And Fast Stabilization Audit

Date: 2026-07-09

## Summary

The current application is not blocked by a missing core billing preview or a broken customer identity read path. The fastest stable point is to keep the existing strict operation flow unchanged, finish a small manual smoke pass for billing and portal linked accounts, and defer invoice finalization features to a later PR.

This audit is docs-only. It does not change runtime code, Firestore schema, billing calculation, Security Rules, package files, Firebase config, deploy settings, migrations, or backfills.

## Current State

- Current branch started from `main`.
- Recent history shows PR #118 merged after billing PR #116.
- Billing preview is implemented in `/admin/billing`.
- Billing calculation is centralized in `src/lib/billing/calculate.ts`, `src/lib/billing/source-logs.ts`, and `src/lib/billing/invoice-candidate.ts`.
- Billing settings are saved through `settings/billingInvoice` via `src/lib/firebase/billing-settings-service.ts`.
- Customer identity reads prefer `customerId` and keep legacy `customerName` / `location` fallback.
- Bulk return and staff dashboard grouping use `buildCustomerIdentityGroup()` so new data groups by `customerId` and old data remains visible.

## Real Blockers

These items should be cleared before treating the current billing preview as operationally stable:

- Billing manual smoke is incomplete.
  - Confirm settings save.
  - Confirm reload persistence.
  - Confirm original value restoration after saving.
  - Confirm single invoice PDF save through the browser print dialog.
  - Confirm bulk invoice PDF save through the browser print dialog.
  - Confirm unused return and unfilled return billing settings against real data.
  - Confirm registration number warning appears when `issuerRegistrationNumber` is empty and warning display is enabled.
- Portal linked-account smoke is still useful.
  - Confirm a linked portal account sees `customerId`-matched active tanks and recent logs.
  - Confirm legacy fallback still shows old `location == customerName` data.

These are smoke blockers, not architecture blockers. They can be tested without changing Firestore schema or billing calculation.

## Non-Blockers Still Remaining

These are known missing features, but they do not block using the current billing screen as a preview:

- Invoice finalization is not implemented.
  - No `monthlyInvoices` collection write.
  - No invoice number persistence.
  - No paid / unpaid management.
  - No finalized invoice snapshot.
- Billing tank category is still effectively 10L default.
  - `BillingTankCategory` already has `steel10`, `steel12`, and `aluminum`, but source classification is not complete.
- Sales monthly archive still displays `monthly_stats.location`.
  - Daily sales counts use action-code helpers.
  - Monthly archive remains a legacy snapshot display and can be deferred unless reporting depends on customerId grouping immediately.
- Staff analytics uses `staffId` grouping and action-code helpers, but it is still a lightweight count dashboard.
- `npm run lint` has an existing baseline failure and should be handled as a separate cleanup PR.

## Billing Audit

Billing preview is usable as a candidate generator:

- `/admin/billing` reads active logs, customers, and billing invoice settings.
- Candidate construction is delegated to `buildInvoiceCandidates()`.
- Tax, rounding, return-tag adjustment, and carry-over extra calculations are delegated to `calculateBillingCandidate()`.
- Source log matching is delegated to `collectBillingSourceLogMatches()`.
- Registration number warning is rendered in both settings and invoice preview when enabled and empty.
- Existing design doc `docs/billing-rule-design.md` correctly marks finalization, invoice numbering, and paid / unpaid management as out of scope.

Risk to watch:

- `logsRepository.getActiveLogs()` returns every active log. Billing currently filters by action code in source-log collection, but a future memo log must not accidentally use a lend-compatible action or transition action.
- Invoice settings are normalized on read and save. Manual smoke should verify values survive reload exactly as expected for operational use.

## Customer Identity And Portal Audit

Current identity behavior is stable enough for preview use:

- `src/lib/customer-identity-read.ts` uses `customerId` as the primary key when present.
- Legacy data falls back to `customerName` and then `location`.
- `src/lib/portal/customer-reads.ts` reads current tanks by `customerId` first, then merges legacy `location == customerName` tanks.
- Portal recent logs read by `customerId` first, then merge legacy `location == customerName` logs.

Portal linked-account smoke remains recommended, but it is not a global blocker because the read path already keeps both primary and legacy data visible.

## Bulk Return And Dashboard Audit

Bulk return and staff dashboard are aligned with the current customer identity direction:

- Bulk return candidates are selected by status code `lent` / `unreturned`, with legacy status fallback by reading all tanks and coercing status.
- Bulk return groups use `buildCustomerIdentityGroup()` and include pool information such as today, past, unknown, and long-term.
- Staff dashboard groups active rental tanks through `buildCustomerIdentityGroup()` and uses current customer master names when `customerId` is available.
- Log editing and correction in staff dashboard only allows `logKind === "tank"` active logs.

This means memo-only logs can be added later without becoming editable tank-operation logs, as long as they use a separate `logKind` and are not used to update `tanks`.

## Sales And Staff Analytics Audit

The daily operational counts are mostly aligned with action-code migration:

- Sales daily stats use `isLendTankLogAction()`, `isReturnTankLogAction()`, and `isFillTankLogAction()`.
- Staff analytics uses the same action-code helper style and groups by `staffId` when available.

Remaining legacy area:

- Sales monthly archive still reads `monthly_stats` and displays `location`.
- That archive should be treated as historical snapshot output, not as proof that current customer identity grouping is incomplete.
- Do not rush a rewrite unless monthly customer reporting is needed before billing finalization.

## Validation Result

Commands run for this docs-only change:

- `git status --short`: only the two new docs files were present.
- `git log --oneline -10`: latest commit was `92e1970 Merge pull request #118 from kyanu227/codex/align-codex-claude-workflow`.
- `git diff --check`: passed.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run lint`: failed on existing baseline with 10 errors and 38 warnings.

Docs-only validation notes:

- Changed-files eslint is not applicable because only Markdown files changed.
- `npm run build` was not run because no runtime code changed.
- No deploy was performed.

## Lint Baseline

Current lint baseline:

- `npm run lint`: failed with existing baseline.

Observed lint baseline:

- `import_tanks.js`: CommonJS `require()` import errors.
- Admin pages: several `@typescript-eslint/no-explicit-any` errors.
- `src/components/PrefixNumberPicker.tsx`: `react-hooks/set-state-in-effect`.
- Several unused variable and `next/no-img-element` warnings.
- Repository skeleton functions intentionally leave unused placeholder parameters that are currently warnings.

Recommendation:

- Do not mix lint baseline cleanup into stabilization or memo-mode design.
- Create a separate lint cleanup PR if lint starts slowing day-to-day development.
- Prioritize actual errors over warnings, and avoid changing business behavior while cleaning lint.

## Fast Stabilization Path

1. Finish billing manual smoke.
2. Confirm portal linked-account read path with one known linked account.
3. Keep current billing preview untouched unless smoke finds a concrete bug.
4. Use Claude only for invoice presentation polish, with the existing billing candidate contract unchanged.
5. Design memo-only operation logs separately from strict tank operations.
6. Implement memo-only recording in a later small PR.
7. Add invoice finalization, invoice numbering, and paid / unpaid management after preview and memo scope are stable.

## Next PR Candidates

- Billing manual smoke result doc and any tiny bug fixes found during smoke.
- Memo-only operation design implementation with no tank state update.
- Invoice presentation-only UI polish, preserving `InvoiceCandidate` values as provided.
- Invoice finalization design before adding `monthlyInvoices`.
- Lint baseline cleanup as a separate maintenance PR.

## Dangerous Areas To Avoid

- Do not loosen `applyTankOperation()` or `applyBulkTankOperations()` validation for field convenience.
- Do not let memo records update `tanks.status`, `tanks.location`, `latestLogId`, or `customerId`.
- Do not add memo logs as billing source logs.
- Do not change billing tax, rounding, return-tag discount, or customer grouping while doing docs or smoke work.
- Do not deploy Firestore Rules or connect `firestore.rules` in `firebase.json`.
- Do not backfill existing logs or tanks as part of this stabilization pass.
