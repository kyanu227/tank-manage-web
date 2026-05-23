# Tank ID Operation Compatibility Audit

## Purpose

This document audits operation-side compatibility before connecting `src/lib/tank-id.ts` to manual operation, bulk return, order fulfillment, return tag processing, portal, or repository boundaries.

PR #89 connected only procurement / tank registration to the pure tank ID helper. That means new tank registration now creates `tanks/{canonicalTankId}` such as `A-01`. Before deploying or connecting the wider operation surface, this audit checks whether existing operation flows already read and write the same canonical shape, and where they still assume a narrower format.

This is a docs-only audit. It does not change implementation code, Firestore data, security rules, package files, or deploy configuration.

## Current status after PR #89

- PR #87 added the tank ID audit / model document.
- PR #88 added `src/lib/tank-id.ts` with pure helpers such as `parseTankId`, `tryParseTankId`, `normalizeTankId`, `formatTankId`, `buildTankSortKey`, and `compareTankIdNatural`.
- PR #89 connected procurement / tank registration to that helper.
- Procurement now canonicalizes accepted inputs before save:
  - `A1`, `A01`, `A-01`, `A001`, `a-01` -> `A-01`
  - `A100` -> `A-100`
  - `A0`, `A-00` -> invalid
- Procurement writes `tanks/{canonicalTankId}` and the procurement log from the normalized `tankIds` array.
- Manual operation, bulk return, order fulfillment, return tag processing, portal, `tanksRepository`, `logsRepository`, and `tank-operation.ts` are not connected to the new helper yet.
- Hosting deploy has not been run after PR #89.

## Operation-side tankId entry points

| Entry point | Current source | Produced form | Compatibility notes |
|---|---|---|---|
| `src/features/staff-operations/hooks/useManualTankOperation.ts` | `activePrefix` from `useTanks().prefixes` + hidden numeric input | `${activePrefix}-${val}` with `val.length === 2`; OK button can produce `${activePrefix}-OK` | Normal 2-digit operations produce `A-01`, which matches PR #89 canonical for 1-99. It cannot produce `A-100`. It does not accept `A1` / `A01` raw input. |
| `src/features/staff-operations/hooks/useOrderFulfillment.ts` | `orderActivePrefix` + hidden numeric input | `${orderActivePrefix}-${payload}`; auto-add only at 2 digits; OK can produce `A-OK` | Same as manual operation. 2-digit `A-01` is compatible, 100+ is not reachable from the UI. |
| `src/components/TankIdInput.tsx` | shared prefix drum + hidden numeric input | `${prefix}-${number}` when `number.length === digits`; default `digits=2`; OK can produce `A-OK` | Reused by damage and in-house. Default behavior is 2 digits and does not use `tank-id.ts`. |
| `src/app/staff/damage/page.tsx` | `TankIdInput` | `A-01` / `A-OK` | Queue accepts emitted value and later passes it to `applyBulkTankOperations`. No local existence validation. |
| `src/app/staff/inhouse/page.tsx` | `TankIdInput` plus local regex | `A-01` / `A-OK` only | Local regex `^[A-Z]+-(\d{2}|OK)$` rejects `A-100`. It checks `tankMap[tankId]` before `applyTankOperation`. |
| `src/components/PrefixNumberPicker.tsx` | existing `tankIds` list | select-only existing ID | Parses only `^([A-Z]+)-(\d{2})$`. Existing `A-100` IDs are invisible in picker choices. |
| `src/app/staff/dashboard/page.tsx` correction modal | `PrefixNumberPicker` with `tanks.map((t) => t.id)` | selected existing `A-01` style ID | Cannot select `A-100` because the picker filters it out. |
| `src/app/portal/unfilled/page.tsx` | `PrefixNumberPicker` from currently lent tank ids | selected existing `A-01` style ID | Cannot select lent `A-100` because the picker filters it out. |
| `src/app/portal/return/page.tsx` | list of currently lent `TankDoc.id` | existing doc id | Does not compose an ID. It submits the displayed `tank.id` as-is. |

The operation entry points are mostly already compatible with `A-01` for numbers 1-99 because they compose IDs with a hyphen and two digits. They are not compatible with the helper's broader `A-100` acceptance yet.

## Read paths

| Read path | Current lookup key | Normalization | Compatibility notes |
|---|---|---|---|
| `useTanks()` | all `tanks` docs via `tanksRepository.getTanks()` | none for ids; `TankDoc.id = snap.id` | The in-memory `tankMap` is keyed by the raw Firestore document id. |
| `useTanks().prefixes` | `TankDoc.id.match(/^([A-Z]+)/i)` | prefix uppercase only | `A-01`, `A01`, and `A-100` all contribute prefix `A`. Prefix presence alone does not prove operation can find a specific doc id. |
| Manual operation validation | `allTanks[tankId]` | none | If UI emits `A-01`, it will not find an existing `tanks/A01` doc. |
| Order fulfillment validation | `allTanks[tankId]` | none | Same risk as manual operation. |
| Bulk return | `tanksRepository.getTanks({ statusIn })` then `tank.id` | none | Uses existing document ids directly, so `A-01`, `A01`, and `A-100` can all be read from Firestore. |
| Return tag processing | `tanksRepository.getTank(item.tankId)` | none | Uses `transactions.tankId` exactly. Compatible only if the transaction tankId matches the current tanks document id. |
| Portal return | `tanksRepository.getTanks({ location, status })` then `tank.id` | none | Uses existing document ids directly. No free text tankId lookup. |
| Portal unfilled | `tanksRepository.getTanks({ location, status })` then `PrefixNumberPicker` | picker requires 2 digits | Reads `A-100` from Firestore but the picker hides it. |
| `logsRepository.getActiveLogsByTank` | `logs.tankId == value.trim()` | trim only | `A1` / `A01` / `A-01` are separate query keys. |
| `tank-trace.ts` | `where("tankId", "==", tankId)` | none | Trace depends on callers passing the exact stored `logs.tankId`. |

The safest read paths are those that start from existing `TankDoc.id` and pass it through unchanged. The riskiest read paths are free or composed IDs that do not have a fallback for existing non-canonical document ids.

## Write paths

| Write path | Current write target | Normalization | Compatibility notes |
|---|---|---|---|
| `applyTankOperation` | `doc(db, "tanks", normalizeTankId(input.tankId))` | local `trim().toUpperCase()` only | Does not insert hyphen, remove internal spaces, collapse leading zeros, reject 0, or support helper validation. |
| `applyBulkTankOperations` | same as above for each input | same local normalize | Bulk duplicate check also uses local `trim().toUpperCase()`. |
| `commitPlannedOperations` | writes `logs.tankId = op.input.tankId`; updates `tanks/{op.input.tankId}` | receives normalized value from operation planning | `logs.tankId` follows the local operation normalize, not `tank-id.ts`. |
| `applyLogCorrection` | can change active log tank id and update old/new tank snapshots | patch tankId uses local `normalizeTankId`; old log tankId is used as-is | If existing logs/tanks use `A01`, changing only new patch input to helper later could create old/new lookup mismatches without fallback planning. |
| `voidLog` | reads `logs.tankId`, then updates `tanks/{tankId}` | none | Void depends on historical `logs.tankId` matching an existing `tanks` doc id exactly. |
| `updateLogNote` | `updateDoc(doc(db, "tanks", tankId), { logNote })` | none | Bulk return tag and in-house tag updates use existing ids, so raw document id pass-through is currently safest. |
| `portal-transaction-service` return / unfilled | creates `transactions.tankId` | `trim()` only | Inputs come from selected existing ids, but the service itself does not canonicalize. |

`tank-operation.ts` is the central write boundary for lifecycle logs and current tank snapshots. It already uppercases input, but its local helper is weaker than `src/lib/tank-id.ts`. Replacing it with `normalizeTankId` without a read strategy would change lookup behavior for any existing `A01` document id.

## Log paths

| Log path | Source tankId | Stored form | Compatibility notes |
|---|---|---|---|
| Manual lend / return / fill | queue item from composed UI ID | `logs.tankId` after `tank-operation.ts` local normalize | Usually `A-01` for 1-99. Not helper-normalized. |
| Order fulfillment | scanned tank id from composed UI ID | same | Usually `A-01` for 1-99. |
| Bulk return | `tank.id` from Firestore query | same after local uppercase | Preserves `A-01` or `A01` except casing. |
| Return tag processing | `transactions.tankId` from pending return | same after local uppercase | Requires transaction tankId to match `tanks` doc id. |
| Damage / repair / inspection / in-house | `TankIdInput` or existing `tank.id` | same | Damage / in-house input are 2-digit or `OK`; repair / inspection use existing ids. |
| Dashboard correction | selected `PrefixNumberPicker` value | new revision `logs.tankId` from local normalize | Picker cannot select `A-100`. |
| Void | existing active `logs.tankId` | does not create a new log | Uses log tankId exactly for tank lookup. |

No current operation path writes `logs.prefix`, `logs.number`, or `logs.sortKey`. That remains aligned with PR #87.

## Canonical compatibility risks

### 1. `A-01` is mostly compatible for normal 1-99 operations

Manual operation and order fulfillment compose IDs as `${prefix}-${twoDigitNumber}`. If a tank exists as `tanks/A-01`, the current operation UI can find it in `tankMap["A-01"]`, validate it, and send it to `tank-operation.ts`.

This means PR #89's new procurement output, `tanks/A-01`, is compatible with the main staff operation path for 1-99.

### 2. Existing `A01` document ids remain a serious risk

If production data contains `tanks/A01`, current manual operation still emits `A-01`, not `A01`. That means `allTanks["A-01"]` will be missing and the UI will mark it as an unregistered tank.

Connecting operation input to `normalizeTankId` alone does not solve this. It would make `A01` input normalize to `A-01`, which still cannot read `tanks/A01` without either migration or a compatibility read strategy.

### 3. `A-100` is now creatable by procurement but not fully operable

The helper allows `A100 -> A-100`, and PR #89 lets procurement create `tanks/A-100`.

However:

- manual operation hidden numeric input stops at 2 digits;
- order fulfillment hidden numeric input stops at 2 digits;
- `TankIdInput` defaults to `digits=2`;
- in-house local validation rejects anything other than two digits or `OK`;
- `PrefixNumberPicker` ignores anything other than exactly two digits.

So `A-100` can be registered, can appear in list-driven flows like bulk return or portal return, but cannot be entered in the main manual operation / order fulfillment UI and cannot be selected in picker-based flows.

### 4. `A-OK` is a reserved helper exception

Several staff flows allow `${prefix}-OK` as a special input. The helper model should treat `OK` as the only reserved nonnumeric exception, not as an arbitrary suffix model.

That means `A-OK` / `AOK` / `a-ok` are valid and normalize to `A-OK`, while `A-NG`, `A-TEST`, and `A-SPARE` remain invalid. Before PR #91 records production audit counts, its classification should treat `A-OK` as a valid OK exception rather than a nonnumeric anomaly.

### 5. Logs and trace require exact key consistency

`logsRepository.getActiveLogsByTank` and `tank-trace.ts` query exact `logs.tankId` equality. If a future implementation writes new logs as `A-01` while older logs remain `A01`, trace and history queries will be split unless a migration or dual-query strategy exists.

## Existing data risk: A01 vs A-01 document id

The code does not currently inspect production Firestore data, and this audit did not perform any Firestore reads or writes. Therefore the actual presence of `A01` document ids is unknown.

The code-level compatibility model is:

| Existing data shape | Current operation behavior | Risk after helper connection |
|---|---|---|
| Existing docs are `A-01` | Main operation flows work for 1-99. PR #89 procurement matches this. | Low for 1-99, still high for 100+. |
| Existing docs are `A01` | Main manual/order input already emits `A-01`, so those docs are hard to operate manually. Bulk list flows can still process them because they use existing `tank.id`. | High if operation entry normalizes to `A-01` without fallback or migration. |
| Mixed `A01` and `A-01` | Prefix list hides the distinction; manual input targets only `A-01`. Bulk/list flows preserve raw ids. | High. Duplicate physical IDs may exist under different document ids. |
| Existing docs include `A-100` | Bulk/list flows can read raw ids. Manual/order/picker flows cannot select or enter them. | High until UI/picker supports variable digit length. |
| Existing docs include `A-OK` | Some staff flows already have special handling for OK input. | Medium until all operation boundaries use the helper's reserved OK exception consistently. |

Before deployment or broad helper connection, one of these must be chosen explicitly:

- verify production data is already `A-01` for all active tank docs and avoid 100+ registration until UI support lands;
- migrate existing document ids to canonical IDs in a separate migration plan;
- implement compatibility reads such as canonical lookup first, then legacy raw lookup, with explicit logging and no automatic writes;
- temporarily constrain procurement UI/service to the currently operable range if 100+ should not be usable yet.

## Deploy block after PR #89

PR #89 is already merged, but Hosting deploy should remain blocked until the operation compatibility gap is closed or explicitly accepted.

The reason is not the `A-01` canonical form itself. For 1-99, the main staff operation UI already composes IDs such as `A-01`. The immediate deploy risk is that procurement can now create `A-100`, while several operation-side controls still assume exactly two numeric digits.

If PR #89 were deployed as-is, production could create a tank that exists as `tanks/A-100` but cannot be entered through manual operation / order fulfillment and cannot be selected through `PrefixNumberPicker`. That creates an operationally stranded tank even though the domain helper is valid.

Deploy should wait until one of these is true:

- operation UI and picker flows support 2+ digit canonical IDs;
- procurement temporarily rejects 100+ input at the UI/service boundary while the domain helper remains broader;
- production operators explicitly agree not to register 100+ IDs until the operation-side support lands.

This block is separate from Firestore data migration. No migration should be executed as part of PR #90.

## Required read-only Firestore data audit

Before connecting `tank-operation.ts`, manual operation, order fulfillment, return tag processing, or repositories to `src/lib/tank-id.ts`, a read-only Firestore data audit is required.

The audit should inspect, without creating, updating, or deleting Firestore data:

- `tanks` document ids that match `A01` or similar no-hyphen forms;
- `tanks` document ids that match canonical `A-01` style forms;
- `tanks` document ids with 100+ numbers such as `A-100`;
- `tanks` document ids that use the reserved OK exception, such as `A-OK`;
- `tanks` document ids outside the numeric + OK model, such as `A-NG` or other arbitrary suffixes;
- `logs.tankId` values that are raw, non-canonical, summary strings, or nonnumeric;
- whether `logKind="procurement"` and `logKind="tank"` use compatible `tankId` meanings;
- whether active tank lifecycle logs and current `tanks` document ids can be joined exactly.

If any `tanks/A01` documents exist, a simple operation-side `normalizeTankId(raw) -> A-01` connection is unsafe. It can make existing documents unreachable through exact `doc(db, "tanks", tankId)` reads. In that case, one of these must be designed first:

- a read compatibility strategy, such as canonical-first plus explicit legacy fallback;
- a separate Firestore data migration plan;
- a temporary policy that only list-driven flows operate legacy IDs until migration is complete.

The data audit should also check whether `A-OK` actually exists and whether any non-OK suffix IDs exist. `A-OK` should be classified as the reserved OK exception. Non-OK suffixes still need a legacy/special cleanup policy if they exist.

## Decision points before implementation

### `A01` vs `A-01`

If existing production data is already canonical `A-01`, connecting operation inputs to the helper is mostly a UI and boundary cleanup for 1-99.

If existing production data contains `A01`, helper connection is a migration problem, not just a normalization refactor. Exact reads in `tankMap`, `tanksRepository.getTank`, `tank-operation.ts`, `logsRepository`, and trace queries can split between old and new IDs.

### 100+ tank numbers

There are three viable choices:

| Option | Description | Tradeoff |
|---|---|---|
| A | Keep the domain helper broad and update operation UI / pickers to handle 3+ digits. | Best long-term model, but requires UI and validation work before deploy. |
| B | Temporarily block 100+ creation in procurement while leaving `tank-id.ts` domain helper broad. | Fastest deploy safety, but adds a temporary UI/service constraint that must be removed later. |
| C | Allow procurement/admin to create 100+ but do not deploy until operation UI support lands. | Preserves model purity, but delays production rollout. |

Current recommendation: do not deploy PR #89 behavior until either option A or option B is implemented, or option C is explicitly accepted as a release hold.

### `A-OK` and nonnumeric IDs

`A-OK` is part of the canonical helper model as the only reserved nonnumeric exception. Existing staff inputs can emit it, and helper-based parsing should normalize `AOK` / `A-OK` / `a-ok` to `A-OK`.

Decision required:

- keep `OK` as the only reserved nonnumeric suffix;
- reject arbitrary suffixes such as `A-NG`, `A-TEST`, and `A-SPARE`;
- classify `A-OK` separately from helper-parse failures in PR #91's read-only audit.

This decision depends on the read-only Firestore data audit.

## Safe connection boundaries

### UI input boundary

Using `tryParseTankId` at UI confirmation time is safe for procurement-style free text. It is not safe to blindly apply the helper to staff operation inputs while existing `A01` document ids may exist. `A-OK` should be treated through the helper's reserved OK exception, not through ad hoc suffix handling.

For manual operation and order fulfillment, the first UI improvement should likely be variable-length numeric entry plus explicit handling of the `OK` shortcut, not just replacing string assembly.

### Hook boundary

Normalizing inside `useManualTankOperation.addToQueue` or `useOrderFulfillment.addScannedTank` would centralize queue keys, duplicate checks, and `tankMap` lookup. But if existing data contains `A01`, it can turn a raw matching id into a canonical non-match. Use this boundary only after data shape is known or a fallback lookup is designed.

### `tank-operation.ts` boundary

`tank-operation.ts` is the most important long-term boundary because it writes both `tanks` and `logs` atomically. It should eventually use `src/lib/tank-id.ts` for real tank lifecycle IDs.

However, changing it first is high risk because:

- it affects manual operation, order fulfillment, bulk return, damage, repair, inspection, in-house, return tag processing, dashboard correction, and void / revision behavior;
- void uses historical `logs.tankId` exactly;
- correction can move state between old and new tank refs;
- existing non-canonical document ids would become unreadable without a fallback strategy.

### Repository boundary

Normalizing inside `tanksRepository.getTank` may look attractive, but it can hide important migration problems and break exact-id callers. A safer design is to add an explicit compatibility function later, for example:

- `getTankByCanonicalId(canonicalTankId)`;
- `getTankByInputId(input)` with canonical-first / legacy fallback behavior;
- diagnostic return metadata showing whether a legacy fallback was used.

Do not silently normalize all repository calls until source-of-truth and migration policy are decided.

### List-driven flows

Bulk return, repair, inspection, in-house bulk return, portal return, and some dashboard flows start from `TankDoc.id` loaded from Firestore and pass the id through unchanged. These are the safest to leave unchanged until the data model is finalized, because they preserve whatever document id exists.

## Recommended next implementation PR scope

Do not connect all operation flows at once. A safe sequence is:

1. PR #91: add a read-only Firestore data audit script or a docs-only data-audit procedure. It must not mutate data.
2. PR #92: either update operation UI / pickers for `A-100`, or temporarily constrain procurement creation to currently operable IDs.
3. PR #93: connect operation-side normalization after the data-shape and UI compatibility decisions are settled.

The smallest implementation PR after this audit should likely be one of:

- update `PrefixNumberPicker` to parse canonical IDs with 2+ digits using `parseTankId` / `formatTankId`, while still selecting existing document ids;
- update the staff numeric input components to support variable-length number confirmation without changing `tank-operation.ts`;
- temporarily constrain procurement UI/service to 1-99 if that is the chosen release safety policy;
- add a docs-only or read-only data-shape verification procedure for existing `tanks` ids;
- add explicit unit-level tests around `tank-id.ts` if a test strategy is introduced separately.

If deployment is needed before operation-side connection, avoid registering 100+ tank numbers in production until operation UI support is added or procurement is temporarily constrained.

## Explicit non-goals

- No implementation code changes in this PR.
- No Firestore data reads, writes, seed, migration, or deletion.
- No `firestore.rules`, `firebase.json`, or package file changes.
- No Hosting, Firestore, Security Rules, or unscoped Firebase deploy.
- No connection of manual operation, bulk return, return tag processing, portal, `tanksRepository`, `logsRepository`, or `tank-operation.ts` to `src/lib/tank-id.ts`.
- No change to billing, sales, reward, trace, revision, void, or correction behavior.
