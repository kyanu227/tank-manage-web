# Strict Vs Memo-Only Operation Mode Design

> Superseded on 2026-07-12. The implemented source of truth is
> [strict-vs-assisted-transition-mode.md](./strict-vs-assisted-transition-mode.md).
> Memo-only remains a possible separate feature, but it is not the implemented
> strict/advisory switch.

Date: 2026-07-09

## Summary

Do not add a setting that weakens the strict tank operation path. The safe design is to keep strict operations as the only source of truth for `tanks`, billing, portal state, dashboard state, and bulk-return candidates, then add a separate memo-only operation flow for fast field notes.

Recommended direction:

- Strict operation: existing `applyTankOperation()` / `applyBulkTankOperations()` path.
- Memo-only operation: future append-only log path with no tank state update and no billing effect.
- Admin setting: enable or hide memo recording, but never let memo recording affect tank state in the first implementation.

## Current Strict Flow

The current strict flow is intentionally centralized:

- UI and workflow hooks validate operation intent before submission.
- `applyTankOperation()` and `applyBulkTankOperations()` run Firestore transactions.
- Each strict operation reads the current tank document.
- Transition validation uses status/action code rules.
- The transaction writes an active `logs` document with `logKind: "tank"`.
- The transaction updates the corresponding `tanks` snapshot.
- Revision and void flows only apply to active tank logs and restore tank snapshots as needed.

This path is used by manual lend / return / fill, bulk return, return tag processing, order fulfillment, and correction workflows.

Because this path writes both `logs` and `tanks`, it feeds downstream behavior:

- Billing source matching reads active logs and counts lend-compatible action codes.
- Portal reads current tanks and recent active logs by `customerId`, with legacy fallback.
- Bulk return candidates read current `tanks.status`.
- Dashboard summaries read current tanks and active logs.
- Log correction depends on `logKind === "tank"` and latest active tank log semantics.

## Why Strict Flow Is Valuable

Strict operation keeps the system recoverable:

- A tank has one current snapshot.
- A tank operation has one active revision chain.
- Invalid transitions are rejected before state is mutated.
- Return requests are not treated as confirmed returns until staff confirmation updates tanks/logs.
- Billing can derive candidates from operation logs without guessing which notes were formal work.
- Correction and void can restore previous tank snapshots.

The current strict flow is a business invariant, not just a UI preference.

## Pass-Through That Affects Tank State

This option should not be implemented as the first field-speed solution.

Definition:

- Skip or loosen strict validation.
- Record lend / return / fill as if it were a formal operation.
- Update `tanks.status`, `location`, `customerId`, `latestLogId`, and billing source logs from the relaxed path.

Risks:

- Tank state can become impossible to trust.
- Billing may count memo-like entries as real billable rentals.
- Portal may show memo-only notes as current customer-visible rentals or returns.
- Bulk return candidates may disappear because `tanks.status` changed without the actual return flow.
- Dashboard and correction tools may treat an informal note as a formal tank operation.
- Later reconstruction becomes difficult because there is no durable distinction between “observed note” and “confirmed operation”.

This option is only acceptable after a separate formal reconciliation design exists, and even then it should use strong guards, audit history, and explicit conversion steps.

## Memo-Only Pass-Through

Memo-only is the recommended fast field-entry model.

Definition:

- Add a separate append-only log for field notes.
- Do not call `applyTankOperation()` for memo recording.
- Do not update `tanks`.
- Do not write a lend / return / fill `transitionAction`.
- Do not affect billing, portal current state, dashboard source state, or bulk-return candidates.
- Allow later conversion from memo to formal operation through a separate explicit workflow.

Proposed log fields:

```ts
{
  logKind: "operation_memo",
  logStatus: "active",
  billable: false,
  occurredAt: Timestamp,
  createdAt: Timestamp,
  tankId?: string,
  customerId?: string,
  customerName?: string,
  memoAction: "lend" | "return" | "fill" | "other",
  note: string,
  actor: {
    staffId: string,
    staffName: string,
    staffEmail?: string,
  },
  source: "manual_memo"
}
```

Fields intentionally not included:

- `transitionAction`
- `prevStatus`
- `newStatus`
- `prevTankSnapshot`
- `nextTankSnapshot`
- `latestLogId`
- any write to `tanks`

If a future UI needs localized labels, translate `memoAction` for display. Do not store Japanese UI labels as the memo action code.

## Admin Setting Proposal

Proposed document:

```text
settings/operationMode
```

Proposed fields:

```ts
type OperationModeSettings = {
  operationStrictness: "strict" | "strict_with_memo";
  memoModeEnabled: boolean;
  memoAffectsTankState: false;
  allowMemoBackdatedAt: boolean;
  allowMemoCustomerSelection: boolean;
  allowMemoTankOptional: boolean;
  showMemoInDashboard: boolean;
};
```

Recommended defaults:

```ts
{
  operationStrictness: "strict",
  memoModeEnabled: false,
  memoAffectsTankState: false,
  allowMemoBackdatedAt: true,
  allowMemoCustomerSelection: true,
  allowMemoTankOptional: true,
  showMemoInDashboard: false
}
```

Naming:

- Use `strict_with_memo`, not `passthrough`.
- UI label should be `簡易記録` or `メモ記録`.
- Do not expose a setting that says memo affects tank state.
- Keep `memoAffectsTankState` fixed to false for the first implementation.

## Future Service Shape

Proposed function name:

```ts
appendOperationMemoLog(input)
```

Proposed input:

```ts
type AppendOperationMemoLogInput = {
  occurredAt: Date;
  tankId?: string;
  customer?: {
    customerId: string;
    customerName: string;
  } | null;
  memoAction: "lend" | "return" | "fill" | "other";
  note: string;
  actor: {
    staffId: string;
    staffName: string;
    staffEmail?: string;
  };
};
```

Implementation rules:

- Write one document to `logs`.
- Normalize `tankId` if provided.
- Validate only memo field shape, not tank transition.
- Do not require the tank to exist if `allowMemoTankOptional` is enabled.
- Do not update `tanks`.
- Do not update `transactions`.
- Do not write `transitionAction`.
- Always write `billable: false`.

## Existing Feature Impact

Billing:

- Memo logs must not be source lines.
- Billing should continue to source only lend-compatible tank operation logs.
- A defensive future filter can require `logKind === "tank"` in billing source matching before considering action code.

Portal:

- Memo logs should not affect current lent tanks.
- Memo logs should not appear in customer-facing recent operation history unless a separate customer-visible memo policy is created.

Bulk return:

- Memo logs should not create, remove, or regroup return candidates.
- Candidates continue to come from `tanks.status` and customer identity fields.

Dashboard:

- Memo logs may be shown in a separate memo panel only if `showMemoInDashboard` is true.
- Existing log correction controls must continue to apply only to `logKind === "tank"`.

Sales and staff analytics:

- Memo logs should not count as lend / return / fill operation totals.
- A future separate memo count is acceptable if explicitly labeled.

## Safe Implementation Order

1. Keep this design doc as the source of the first decision.
2. Add `settings/operationMode` read helper with defaults only.
3. Add a staff UI entry point labelled `簡易記録` or `メモ記録`.
4. Add `appendOperationMemoLog()` with no tank writes.
5. Show memo logs in a separate dashboard panel only if enabled.
6. Add a conversion design that turns a memo into a strict operation through normal validation.
7. Only after conversion exists, revisit whether any broader assisted correction workflow is needed.

## Conditions Where Memo Should Not Be Implemented

Do not implement memo recording if any of the following would be required:

- Memo entries must immediately change `tanks.status`.
- Memo entries must be counted in billing.
- Memo entries must modify customer portal state.
- Memo entries must complete return requests or orders.
- Memo entries must bypass staff identity capture.
- Memo entries must use Japanese action strings as data codes.
- Memo entries must share the tank operation revision chain.

If any of these become required, stop and design a formal assisted correction or reconciliation workflow instead.

## Shortest Field-Usable Option

The fastest safe field option is:

- Enable memo recording by admin setting.
- Let staff enter time, optional tank ID, optional customer, memo action, and note.
- Store it as `logKind: "operation_memo"` and `billable: false`.
- Keep strict operations unchanged.
- Add a later “convert to formal operation” workflow after the strict path and memo path are both stable.

This gives field staff a quick record without weakening the operational source of truth.
